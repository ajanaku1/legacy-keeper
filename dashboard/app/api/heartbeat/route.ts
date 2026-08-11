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
  executeSignedHeartbeat,
  parseHeartbeatRequest,
  type HeartbeatDependencies,
  type HeartbeatRequest,
} from '@/lib/heartbeat-route';
import {
  submitSignedWorkflowWebhook,
  waitForKeeperHubSettlement,
} from '@/lib/keeperhub-server';
import { heartbeatWorkflowPayload } from '@/lib/keeperhub-call-payload';
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

const HEARTBEAT_WORKFLOW_ID =
  process.env.KEEPERHUB_HEARTBEAT_WORKFLOW_ID ?? 'ryd34r3ayrg2u8o29fmrk';
const HEARTBEAT_EVENT_ABI = parseAbi([
  'event HeartbeatRecorded(address indexed sender, uint64 timestamp)',
]);

export async function POST(request: NextRequest) {
  try {
    const rawRequest: unknown = await request.json();
    const evidence = await runAuditedAction(
      'heartbeatBySig',
      rawRequest,
      async () => {
        const heartbeat = parseHeartbeatRequest(rawRequest);
        const verified = await executeSignedHeartbeat(
          heartbeat,
          createDependencies(heartbeat),
        );
        const notification = await notifyVerifiedAction({
          action: 'heartbeatBySig',
          owner: heartbeat.owner,
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

function createDependencies(request: HeartbeatRequest): HeartbeatDependencies {
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
    readLastHeartbeat: async (plan) => (await readLiveness(client, plan))[0],
    readHeartbeatInterval: async (plan) =>
      (await readLivenessConfig(client, plan))[0],
    recoverSigner: () => recoverHeartbeatSigner(request),
    nextIdempotencyKey: () => crypto.randomUUID(),
    submitToKeeperHub: (payload, idempotencyKey) =>
      submitSignedWorkflowWebhook(
        HEARTBEAT_WORKFLOW_ID,
        webhookKey,
        heartbeatWorkflowPayload(payload),
        idempotencyKey,
      ),
    awaitSettlement: async (executionId) => {
      await mcp.connect();
      return waitForKeeperHubSettlement(mcp, executionId);
    },
    verifyOnchain: (plan, txHash) => verifyHeartbeat(client, plan, txHash),
  };
}

async function recoverHeartbeatSigner(
  request: HeartbeatRequest,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: {
      name: 'LegacyKeeper',
      version: '1',
      chainId: request.chainId,
      verifyingContract: request.plan,
    },
    types: {
      Heartbeat: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Heartbeat',
    message: {
      nonce: BigInt(request.nonce),
      deadline: BigInt(request.deadline),
    },
    signature: request.signature as Hex,
  });
}

async function verifyHeartbeat(
  client: RoutePublicClient,
  plan: Address,
  txHash: `0x${string}`,
) {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });
  const events = parseEventLogs({
    abi: HEARTBEAT_EVENT_ABI,
    logs: receipt.logs,
    eventName: 'HeartbeatRecorded',
  });
  const event = events.find(
    (item) => item.address.toLowerCase() === plan.toLowerCase(),
  );
  const status = await readLiveness(client, plan);
  return {
    receiptStatus: receipt.status,
    target: event?.address,
    event: event ? 'HeartbeatRecorded' : undefined,
    lastHeartbeat: status[0],
  };
}

function readLiveness(client: RoutePublicClient, plan: Address) {
  return client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'getLivenessStatus',
  });
}

function readLivenessConfig(client: RoutePublicClient, plan: Address) {
  return client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'liveness',
  });
}
