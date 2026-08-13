import {
  isAddress,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { legacyKeeperAbi } from "./contract";
import {
  type InheritanceMonitorDependencies,
  type InheritanceMonitorResult,
  type InheritancePlanState,
  type RegisteredPlan,
} from "./inheritance-monitor";
import {
  submitDirectInheritance,
  submitDirectTokenInheritance,
  waitForDirectKeeperHubSettlement,
} from "./keeperhub-server";
import {
  type TokenInheritanceMonitorDependencies,
  type TokenInheritanceMonitorResult,
  type TokenInheritancePlanState,
} from "./token-inheritance-monitor";
import {
  createKeeperHubClient,
  createSepoliaClient,
  createSepoliaLogsClient,
  readRegisteredPlanAcrossFactories,
  requiredEnv,
  requiredFactories,
  type RoutePublicClient,
} from "./route-server";
import { serverActivityRepository } from "./activity-server";

const FACTORY_EVENTS = parseAbi([
  "event PlanCreated(address indexed owner, address indexed plan, uint256 indexed nonce)",
]);
const INHERITANCE_EVENTS = parseAbi([
  "event InheritanceExecuted(address indexed executedBy, uint64 timestamp)",
]);
const TOKEN_INHERITANCE_EVENTS = parseAbi([
  "event InheritanceTransfer(address indexed beneficiary, address indexed token, uint256 amount)",
]);
const EVENT_QUERY_CONCURRENCY = 500;

export interface MonitorDependencyOptions {
  idempotencyScope?: string;
  triggerSource?: string;
}

export async function createInheritanceMonitorDependencies(
  options: MonitorDependencyOptions = {},
): Promise<InheritanceMonitorDependencies> {
  const idempotencyScope = options.idempotencyScope;
  const factories = requiredFactories();
  const deployments = factoryDeployments(factories);
  const client = createSepoliaClient();
  const logsClient = createSepoliaLogsClient();
  const keeperHub = createKeeperHubClient(requiredEnv("KEEPERHUB_API_KEY"));
  await keeperHub.connect();
  return {
    listRegisteredPlans: () => listAllRegisteredPlans(logsClient, deployments),
    readRegisteredPlan: (owner) =>
      readRegisteredPlanAcrossFactories(client, factories, owner),
    readPlanState: (plan) => readPlanState(client, plan),
    submitInheritance: (plan, key) =>
      submitDirectInheritance(keeperHub, plan, key),
    awaitSettlement: (executionId) =>
      waitForDirectKeeperHubSettlement(keeperHub, executionId),
    verifyOnchain: (plan, txHash) => verifyInheritance(client, plan, txHash),
    recordResult: (result) =>
      recordResult(result, options.triggerSource ?? "vercel-cron"),
    idempotencyKey: idempotencyScope ? () => idempotencyScope : undefined,
  };
}

export async function createTokenInheritanceMonitorDependencies(
  options: MonitorDependencyOptions = {},
): Promise<TokenInheritanceMonitorDependencies> {
  const idempotencyScope = options.idempotencyScope;
  const factories = requiredFactories();
  const deployments = factoryDeployments(factories);
  const client = createSepoliaClient();
  const logsClient = createSepoliaLogsClient();
  const keeperHub = createKeeperHubClient(requiredEnv("KEEPERHUB_API_KEY"));
  await keeperHub.connect();
  return {
    listRegisteredPlans: () => listAllRegisteredPlans(logsClient, deployments),
    readRegisteredPlan: (owner) =>
      readRegisteredPlanAcrossFactories(client, factories, owner),
    readPlanState: (plan) => readTokenPlanState(client, plan),
    submitTokenInheritance: (plan, token, key) =>
      submitDirectTokenInheritance(keeperHub, plan, token, key),
    awaitSettlement: (executionId) =>
      waitForDirectKeeperHubSettlement(keeperHub, executionId),
    verifyOnchain: (plan, token, txHash) =>
      verifyTokenInheritance(client, plan, token, txHash),
    recordResult: (result) =>
      recordTokenResult(result, options.triggerSource ?? "vercel-cron"),
    idempotencyKey: idempotencyScope ? () => idempotencyScope : undefined,
  };
}

function factoryDeployments(factories: readonly Address[]) {
  const primaryBlock = BigInt(
    requiredEnv("LEGACY_KEEPER_FACTORY_DEPLOYMENT_BLOCK", "11419543"),
  );
  const legacyBlock = BigInt(
    requiredEnv("LEGACY_KEEPER_LEGACY_FACTORY_DEPLOYMENT_BLOCK", "11419543"),
  );
  return factories.map((factory, index) => ({
    factory,
    deploymentBlock: index === 0 ? primaryBlock : legacyBlock,
  }));
}

async function listAllRegisteredPlans(
  client: RoutePublicClient,
  deployments: readonly { factory: Address; deploymentBlock: bigint }[],
): Promise<RegisteredPlan[]> {
  const groups = await Promise.all(
    deployments.map(({ factory, deploymentBlock }) =>
      listRegisteredPlans(client, factory, deploymentBlock),
    ),
  );
  const plans = groups.flat();
  return plans.filter(
    (entry, index) =>
      plans.findIndex(
        (candidate) =>
          candidate.plan.toLowerCase() === entry.plan.toLowerCase(),
      ) === index,
  );
}

async function listRegisteredPlans(
  client: RoutePublicClient,
  factory: Address,
  deploymentBlock: bigint,
): Promise<RegisteredPlan[]> {
  const logs = await getPlanCreatedLogs(client, factory, deploymentBlock);
  return logs.flatMap((log) => {
    const { owner, plan } = log.args;
    return owner && plan && isAddress(owner) && isAddress(plan)
      ? [{ owner, plan }]
      : [];
  });
}

async function getPlanCreatedLogs(
  client: RoutePublicClient,
  factory: Address,
  deploymentBlock: bigint,
) {
  const latestBlock = await client.getBlockNumber();
  const ranges = blockRanges(deploymentBlock, latestBlock);
  const logs = [];
  for (
    let offset = 0;
    offset < ranges.length;
    offset += EVENT_QUERY_CONCURRENCY
  ) {
    const requests = ranges.slice(offset, offset + EVENT_QUERY_CONCURRENCY);
    const batches = await Promise.all(
      requests.map(({ fromBlock, toBlock }) =>
        client.getContractEvents({
          address: factory,
          abi: FACTORY_EVENTS,
          eventName: "PlanCreated",
          fromBlock,
          toBlock,
        }),
      ),
    );
    logs.push(...batches.flat());
  }
  return logs;
}

function blockRanges(
  deploymentBlock: bigint,
  latestBlock: bigint,
): Array<{ fromBlock: bigint; toBlock: bigint }> {
  const blockRange = eventQueryBlockRange();
  const ranges = [];
  for (
    let fromBlock = deploymentBlock;
    fromBlock <= latestBlock;
    fromBlock += blockRange
  ) {
    ranges.push({
      fromBlock,
      toBlock: minBlock(fromBlock + blockRange - 1n, latestBlock),
    });
  }
  return ranges;
}

function eventQueryBlockRange(): bigint {
  const range = BigInt(requiredEnv("SEPOLIA_LOGS_BLOCK_RANGE", "10"));
  if (range < 1n) {
    throw new Error("SEPOLIA_LOGS_BLOCK_RANGE must be a positive integer.");
  }
  return range;
}

function minBlock(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export async function readPlanState(
  client: RoutePublicClient,
  plan: Address,
): Promise<InheritancePlanState> {
  const contract = { address: plan, abi: legacyKeeperAbi } as const;
  const [liveness, timeout, beneficiaries, totalShares, inherited, evacuated] =
    await Promise.all([
      client.readContract({ ...contract, functionName: "getLivenessStatus" }),
      client.readContract({ ...contract, functionName: "getTimeoutStatus" }),
      client.readContract({ ...contract, functionName: "getBeneficiaries" }),
      client.readContract({ ...contract, functionName: "totalShareBps" }),
      client.readContract({ ...contract, functionName: "inheritanceExecuted" }),
      client.readContract({ ...contract, functionName: "evacuationExecuted" }),
    ]);
  return {
    lastHeartbeat: liveness[0],
    livenessActive: liveness[2],
    graceElapsed: timeout[1],
    beneficiaryCount: BigInt(beneficiaries.length),
    totalShareBps: Number(totalShares),
    inheritanceExecuted: inherited,
    evacuationExecuted: evacuated,
  };
}

export async function readTokenPlanState(
  client: RoutePublicClient,
  plan: Address,
): Promise<TokenInheritancePlanState> {
  const base = await readPlanState(client, plan);
  const tokens = await client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: "getTrackedTokens",
  });
  const tokenStates = await Promise.all(
    tokens.map(async (token) => {
      const [pullableAmount, distributed] = await Promise.all([
        client.readContract({
          address: plan,
          abi: legacyKeeperAbi,
          functionName: "pullableAmount",
          args: [token],
        }),
        client.readContract({
          address: plan,
          abi: legacyKeeperAbi,
          functionName: "tokenDistributed",
          args: [token],
        }),
      ]);
      return { token, pullableAmount, distributed };
    }),
  );
  return { ...base, tokens: tokenStates };
}

async function verifyInheritance(
  client: RoutePublicClient,
  plan: Address,
  txHash: Hex,
) {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });
  const events = parseEventLogs({
    abi: INHERITANCE_EVENTS,
    logs: receipt.logs,
    eventName: "InheritanceExecuted",
  });
  const inheritanceExecuted = await client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: "inheritanceExecuted",
  });
  const target = matchingEventTarget(events, plan);
  return {
    receiptStatus: receipt.status,
    target,
    event: target ? "InheritanceExecuted" : undefined,
    inheritanceExecuted,
  };
}

async function verifyTokenInheritance(
  client: RoutePublicClient,
  plan: Address,
  token: Address,
  txHash: Hex,
) {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });
  const events = parseEventLogs({
    abi: TOKEN_INHERITANCE_EVENTS,
    logs: receipt.logs,
    eventName: "InheritanceTransfer",
  });
  const matching = events.find(
    (event) =>
      event.address.toLowerCase() === plan.toLowerCase() &&
      event.args.token?.toLowerCase() === token.toLowerCase(),
  );
  const tokenDistributed = await client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: "tokenDistributed",
    args: [token],
  });
  return {
    receiptStatus: receipt.status,
    target: matching?.address,
    event: matching ? "InheritanceTransfer" : undefined,
    token: matching?.args.token,
    tokenDistributed,
  };
}

function matchingEventTarget(
  events: readonly { address: Address }[],
  plan: Address,
): Address | undefined {
  return events.find(
    (item) => item.address.toLowerCase() === plan.toLowerCase(),
  )?.address;
}

async function recordResult(
  value: InheritanceMonitorResult,
  source: string,
): Promise<void> {
  if (value.status === "skipped") return;
  await serverActivityRepository().append({
    executionKey: `executeInheritance:${value.owner.toLowerCase()}:${value.plan.toLowerCase()}`,
    owner: value.owner,
    timestamp: new Date(),
    trigger: { type: "scheduled", source },
    action: "executeInheritance",
    keeperhubExecutionId: value.executionId,
    txHash: value.txHash,
    outcome: value.status === "executed" ? "success" : "failed",
    error: value.error ?? value.reason,
    errorCode:
      value.status === "failed" ? "INHERITANCE_MONITOR_FAILED" : undefined,
  });
}

async function recordTokenResult(
  value: TokenInheritanceMonitorResult,
  source: string,
): Promise<void> {
  if (value.status === "skipped") return;
  await serverActivityRepository().append({
    executionKey: `executeInheritanceERC20:${value.owner.toLowerCase()}:${value.plan.toLowerCase()}:${value.token.toLowerCase()}`,
    owner: value.owner,
    timestamp: new Date(),
    trigger: { type: "scheduled", source },
    action: "executeInheritanceERC20",
    keeperhubExecutionId: value.executionId,
    txHash: value.txHash,
    outcome: value.status === "executed" ? "success" : "failed",
    error: value.error ?? value.reason,
    errorCode:
      value.status === "failed"
        ? "TOKEN_INHERITANCE_MONITOR_FAILED"
        : undefined,
  });
}
