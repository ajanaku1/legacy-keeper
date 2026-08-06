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
import { planCreationTypedData } from '@/lib/intent-signer';
import { planWorkflowPayload } from '@/lib/keeperhub-call-payload';
import { notifyVerifiedAction } from '@/lib/telegram-notifications';
import { submitSignedWorkflowWebhook, waitForKeeperHubSettlement } from '@/lib/keeperhub-server';
import {
  executePlanCreation,
  parsePlanCreationRequest,
  type PlanCreationDependencies,
  type PlanCreationRequest,
} from '@/lib/plan-route';
import {
  createKeeperHubClient,
  createSepoliaClient,
  readRegisteredPlan,
  requiredEnv,
  requiredFactory,
  type RoutePublicClient,
} from '@/lib/route-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const PLAN_CREATED_ABI = parseAbi([
  'event PlanCreated(address indexed owner, address indexed plan, uint256 indexed nonce)',
]);
const INITIALIZED_ABI = parseAbi([
  'function initialized() view returns (bool)',
]);

export async function POST(request: NextRequest) {
  try {
    const rawRequest: unknown = await request.json();
    const evidence = await runAuditedAction('createPlan', rawRequest, async () => {
      const intent = parsePlanCreationRequest(rawRequest);
      const verified = await executePlanCreation(intent, createDependencies(intent));
      const notification = await notifyVerifiedAction({
        action: 'createPlan',
        owner: intent.owner,
        plan: verified.plan,
        txHash: verified.txHash,
      });
      return { ...verified, notification };
    });
    return NextResponse.json(evidence);
  } catch (error) {
    return NextResponse.json(actionErrorBody(error), { status: 422 });
  }
}

function createDependencies(
  request: PlanCreationRequest
): PlanCreationDependencies {
  const factoryAddress = requiredFactory();
  const keeperHubKey = requiredEnv('KEEPERHUB_API_KEY');
  const webhookKey = requiredEnv('KEEPERHUB_WEBHOOK_API_KEY');
  const workflowId = requiredEnv('KEEPERHUB_PLAN_WORKFLOW_ID');
  const client = createSepoliaClient();
  const mcp = createKeeperHubClient(keeperHubKey);
  return {
    nowSeconds: () => Math.floor(Date.now() / 1000),
    factoryAddress,
    readRegisteredPlan: (owner) =>
      readRegisteredPlan(client, factoryAddress, owner),
    recoverSigner: () => {
      const typedData = planCreationTypedData(request, factoryAddress);
      return recoverTypedDataAddress({
        ...typedData,
        signature: request.signature as Hex,
      });
    },
    nextIdempotencyKey: () => crypto.randomUUID(),
    submitToKeeperHub: (payload, idempotencyKey) =>
      submitSignedWorkflowWebhook(
        workflowId,
        webhookKey,
        planWorkflowPayload(payload),
        idempotencyKey
      ),
    awaitSettlement: async (executionId) => {
      await mcp.connect();
      return waitForKeeperHubSettlement(mcp, executionId);
    },
    verifyOnchain: (txHash, owner) =>
      verifyPlanCreation(client, factoryAddress, txHash, owner),
  };
}

async function verifyPlanCreation(
  client: RoutePublicClient,
  factory: Address,
  txHash: `0x${string}`,
  owner: Address
) {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });
  const events = parseEventLogs({
    abi: PLAN_CREATED_ABI,
    logs: receipt.logs,
    eventName: 'PlanCreated',
  });
  const event = events.find(
    (item) =>
      item.address.toLowerCase() === factory.toLowerCase() &&
      item.args.owner.toLowerCase() === owner.toLowerCase()
  );
  const plan = event?.args.plan;
  const [registeredPlan, initialized] = plan
    ? await Promise.all([
        readRegisteredPlan(client, factory, owner),
        client.readContract({ address: plan, abi: INITIALIZED_ABI, functionName: 'initialized' }),
      ])
    : [undefined, false];
  return {
    receiptStatus: receipt.status,
    target: event?.address,
    event: event ? 'PlanCreated' : undefined,
    eventOwner: event?.args.owner,
    plan,
    registeredPlan,
    initialized,
  };
}
