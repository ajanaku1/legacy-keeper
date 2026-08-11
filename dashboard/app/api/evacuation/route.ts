import { NextRequest, NextResponse } from 'next/server';
import {
  parseAbi,
  parseEventLogs,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem';
import { runAuditedAction } from '@/lib/action-audit';
import { actionErrorBody } from '@/lib/action-error';
import { legacyKeeperAbi } from '@/lib/contract';
import {
  executeSignedEvacuation,
  type EvacuationDependencies,
} from '@/lib/evacuation-route';
import {
  parseHeartbeatRequest,
  type HeartbeatRequest,
} from '@/lib/heartbeat-route';
import {
  submitSignedWorkflowWebhook,
  waitForKeeperHubSettlement,
} from '@/lib/keeperhub-server';
import { evacuationWorkflowPayload } from '@/lib/keeperhub-call-payload';
import { notifyVerifiedAction } from '@/lib/telegram-notifications';
import {
  createKeeperHubClient,
  createSepoliaClient,
  readPlanOwner,
  readRegisteredPlanAcrossFactories,
  requiredEnv,
  requiredFactories,
  type RoutePublicClient,
} from '@/lib/route-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const WORKFLOW_ID =
  process.env.KEEPERHUB_PANIC_WORKFLOW_ID ?? 'pm22qhfnox30w0mnngw01';
const EVENT_ABI = parseAbi([
  'event EvacuationTriggered(address indexed executedBy, uint64 timestamp)',
]);

export async function POST(request: NextRequest) {
  try {
    const rawRequest: unknown = await request.json();
    const evidence = await runAuditedAction(
      'evacuate',
      rawRequest,
      async () => {
        const payload = parseHeartbeatRequest(rawRequest);
        const verified = await executeSignedEvacuation(
          payload,
          createDependencies(payload),
        );
        const notification = await notifyVerifiedAction({
          action: 'evacuate',
          owner: payload.owner,
          plan: verified.plan,
          txHash: verified.txHash,
        });
        return { ...verified, notification };
      },
    );
    return NextResponse.json(evidence);
  } catch (error) {
    return NextResponse.json(actionErrorBody(error), { status: 422 });
  }
}

function createDependencies(request: HeartbeatRequest): EvacuationDependencies {
  const factories = requiredFactories();
  const keeperHubKey = requiredEnv('KEEPERHUB_API_KEY');
  const webhookKey = requiredEnv('KEEPERHUB_WEBHOOK_API_KEY');
  const client = createSepoliaClient();
  const mcp = createKeeperHubClient(keeperHubKey);
  return {
    nowSeconds: () => Math.floor(Date.now() / 1_000),
    readRegisteredPlan: (owner) =>
      readRegisteredPlanAcrossFactories(client, factories, owner),
    readOwner: (plan) => readPlanOwner(client, plan),
    readRecoveryState: (plan) => readRecoveryState(client, plan),
    recoverSigner: () => recoverEvacuationSigner(request),
    nextIdempotencyKey: () => crypto.randomUUID(),
    submitToKeeperHub: (payload, idempotencyKey) =>
      submitSignedWorkflowWebhook(
        WORKFLOW_ID,
        webhookKey,
        evacuationWorkflowPayload(payload),
        idempotencyKey,
      ),
    awaitSettlement: async (executionId) => {
      await mcp.connect();
      return waitForKeeperHubSettlement(mcp, executionId);
    },
    verifyOnchain: (plan, txHash) => verifyEvacuation(client, plan, txHash),
  };
}

function recoverEvacuationSigner(request: HeartbeatRequest): Promise<Address> {
  return recoverTypedDataAddress({
    domain: {
      name: 'LegacyKeeper',
      version: '1',
      chainId: request.chainId,
      verifyingContract: request.plan,
    },
    types: {
      Evacuate: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Evacuate',
    message: {
      nonce: BigInt(request.nonce),
      deadline: BigInt(request.deadline),
    },
    signature: request.signature as Hex,
  });
}

async function verifyEvacuation(
  client: RoutePublicClient,
  plan: Address,
  txHash: `0x${string}`,
) {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });
  const logs = parseEventLogs({
    abi: EVENT_ABI,
    logs: receipt.logs,
    eventName: 'EvacuationTriggered',
  });
  const event = logs.find(
    (log) => log.address.toLowerCase() === plan.toLowerCase(),
  );
  const evacuated = await client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'evacuationExecuted',
  });
  return {
    receiptStatus: receipt.status,
    target: event?.address,
    event: event ? 'EvacuationTriggered' : undefined,
    evacuated,
  };
}

async function readRecoveryState(client: RoutePublicClient, plan: Address) {
  const [vault, evacuated] = await Promise.all([
    client.readContract({
      address: plan,
      abi: legacyKeeperAbi,
      functionName: 'vault',
    }),
    client.readContract({
      address: plan,
      abi: legacyKeeperAbi,
      functionName: 'evacuationExecuted',
    }),
  ]);
  return {
    recoveryKey: vault[1] as Address,
    registered: vault[2],
    evacuated,
  };
}
