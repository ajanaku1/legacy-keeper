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
import { sameAddress } from '@/lib/action-validation';
import {
  eventFor,
  executeConfiguration,
  parseConfigurationRequest,
  type ConfigurationAction,
  type ConfigurationDependencies,
  type ConfigurationRequest,
} from '@/lib/configuration-route';
import { legacyKeeperAbi } from '@/lib/contract';
import { configurationTypedData } from '@/lib/intent-signer';
import { configurationWorkflowPayload } from '@/lib/keeperhub-call-payload';
import { notifyVerifiedAction } from '@/lib/telegram-notifications';
import {
  submitSignedWorkflowWebhook,
  waitForKeeperHubSettlement,
} from '@/lib/keeperhub-server';
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

const CONFIG_EVENTS = parseAbi([
  'event BeneficiaryAdded(address indexed wallet, uint16 shareBps)',
  'event TrackedTokensUpdated(uint256 count)',
  'event ConfigUpdated(string key)',
]);

export async function POST(request: NextRequest) {
  try {
    const rawRequest: unknown = await request.json();
    const evidence = await runAuditedAction(
      'configurePlan',
      rawRequest,
      async () => {
        const intent = parseConfigurationRequest(rawRequest);
        const verified = await executeConfiguration(
          intent,
          createDependencies(intent),
        );
        const notification = await notifyVerifiedAction({
          action: 'configurePlan',
          configurationAction: intent.action,
          owner: intent.owner,
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

function createDependencies(
  intent: ConfigurationRequest,
): ConfigurationDependencies {
  const factories = requiredFactories();
  const keeperHubKey = requiredEnv('KEEPERHUB_API_KEY');
  const webhookKey = requiredEnv('KEEPERHUB_WEBHOOK_API_KEY');
  const workflowId = requiredEnv('KEEPERHUB_CONFIGURATION_WORKFLOW_ID');
  const client = createSepoliaClient();
  const mcp = createKeeperHubClient(keeperHubKey);
  return {
    nowSeconds: () => Math.floor(Date.now() / 1000),
    readRegisteredPlan: (owner) =>
      readRegisteredPlanAcrossFactories(client, factories, owner),
    readPlanOwner: (plan) => readPlanOwner(client, plan),
    readExpectedSigner: (plan, action) =>
      readExpectedSigner(client, plan, action),
    recoverSigner: () => recoverConfigurationSigner(intent),
    nextIdempotencyKey: () => crypto.randomUUID(),
    submitToKeeperHub: (payload, idempotencyKey) =>
      submitSignedWorkflowWebhook(
        workflowId,
        webhookKey,
        configurationWorkflowPayload(payload),
        idempotencyKey,
      ),
    awaitSettlement: async (executionId) => {
      await mcp.connect();
      return waitForKeeperHubSettlement(mcp, executionId);
    },
    verifyOnchain: (payload, txHash) =>
      verifyConfiguration(client, payload, txHash),
  };
}

async function recoverConfigurationSigner(
  request: ConfigurationRequest,
): Promise<Address> {
  const typedData = configurationTypedData(request);
  const signature = request.signature as Hex;
  switch (typedData.primaryType) {
    case 'SetBeneficiaries':
      return recoverTypedDataAddress({ ...typedData, signature });
    case 'SetLivenessConfig':
      return recoverTypedDataAddress({ ...typedData, signature });
    case 'SetRecoveryConfig':
      return recoverTypedDataAddress({ ...typedData, signature });
    case 'SetTrackedTokens':
      return recoverTypedDataAddress({ ...typedData, signature });
  }
}

async function verifyConfiguration(
  client: RoutePublicClient,
  request: ConfigurationRequest,
  txHash: `0x${string}`,
) {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });
  const expectedEvent = eventFor(request.action);
  const events = parseEventLogs({ abi: CONFIG_EVENTS, logs: receipt.logs });
  const event = events.find(
    (item) =>
      item.address.toLowerCase() === request.plan.toLowerCase() &&
      item.eventName === expectedEvent,
  );
  return {
    receiptStatus: receipt.status,
    target: event?.address,
    event: event ? expectedEvent : undefined,
    stateMatches: await resultingStateMatches(client, request),
  };
}

async function resultingStateMatches(
  client: RoutePublicClient,
  request: ConfigurationRequest,
): Promise<boolean> {
  const payload = request.payload;
  if ('wallets' in payload)
    return beneficiariesMatch(client, request.plan, payload);
  if ('heartbeatInterval' in payload)
    return livenessMatches(client, request.plan, payload);
  if ('recoveryKey' in payload)
    return recoveryMatches(client, request.plan, payload);
  const tokens = await client.readContract({
    address: request.plan,
    abi: legacyKeeperAbi,
    functionName: 'getTrackedTokens',
  });
  return (
    tokens.length === payload.tokens.length &&
    tokens.every((token, index) => sameAddress(token, payload.tokens[index]))
  );
}

async function beneficiariesMatch(
  client: RoutePublicClient,
  plan: Address,
  payload: Extract<ConfigurationRequest['payload'], { wallets: Address[] }>,
): Promise<boolean> {
  const [beneficiaries, total] = await Promise.all([
    client.readContract({
      address: plan,
      abi: legacyKeeperAbi,
      functionName: 'getBeneficiaries',
    }),
    client.readContract({
      address: plan,
      abi: legacyKeeperAbi,
      functionName: 'totalShareBps',
    }),
  ]);
  return (
    Number(total) === 10_000 &&
    beneficiaries.length === payload.wallets.length &&
    beneficiaries.every(
      (item, index) =>
        sameAddress(item.wallet, payload.wallets[index]) &&
        Number(item.shareBps) === payload.shares[index],
    )
  );
}

async function livenessMatches(
  client: RoutePublicClient,
  plan: Address,
  payload: Extract<
    ConfigurationRequest['payload'],
    { heartbeatInterval: number }
  >,
): Promise<boolean> {
  const liveness = await client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'liveness',
  });
  return (
    Number(liveness[0]) === payload.heartbeatInterval &&
    Number(liveness[1]) === payload.timeoutDuration &&
    Number(liveness[2]) === payload.gracePeriod
  );
}

async function recoveryMatches(
  client: RoutePublicClient,
  plan: Address,
  payload: Extract<ConfigurationRequest['payload'], { recoveryKey: Address }>,
): Promise<boolean> {
  const vault = await client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'vault',
  });
  return (
    sameAddress(vault[0], payload.safeVault) &&
    sameAddress(vault[1], payload.recoveryKey) &&
    vault[2] === true
  );
}

async function readExpectedSigner(
  client: RoutePublicClient,
  plan: Address,
  action: ConfigurationAction,
): Promise<Address> {
  if (action !== 'recovery') return readPlanOwner(client, plan);
  const [owner, vault] = await Promise.all([
    readPlanOwner(client, plan),
    client.readContract({
      address: plan,
      abi: legacyKeeperAbi,
      functionName: 'vault',
    }),
  ]);
  return vault[2] ? (vault[1] as Address) : owner;
}
