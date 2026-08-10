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
  waitForDirectKeeperHubSettlement,
} from "./keeperhub-server";
import {
  createKeeperHubClient,
  createSepoliaClient,
  readRegisteredPlan,
  requiredEnv,
  requiredFactory,
  type RoutePublicClient,
} from "./route-server";
import { serverActivityRepository } from "./activity-server";

const FACTORY_EVENTS = parseAbi([
  "event PlanCreated(address indexed owner, address indexed plan, uint256 indexed nonce)",
]);
const INHERITANCE_EVENTS = parseAbi([
  "event InheritanceExecuted(address indexed executedBy, uint64 timestamp)",
]);

export async function createInheritanceMonitorDependencies(): Promise<InheritanceMonitorDependencies> {
  const factory = requiredFactory();
  const deploymentBlock = BigInt(
    requiredEnv("LEGACY_KEEPER_FACTORY_DEPLOYMENT_BLOCK", "11419543"),
  );
  const client = createSepoliaClient();
  const keeperHub = createKeeperHubClient(requiredEnv("KEEPERHUB_API_KEY"));
  await keeperHub.connect();
  return {
    listRegisteredPlans: () =>
      listRegisteredPlans(client, factory, deploymentBlock),
    readRegisteredPlan: (owner) => readRegisteredPlan(client, factory, owner),
    readPlanState: (plan) => readPlanState(client, plan),
    submitInheritance: (plan, key) =>
      submitDirectInheritance(keeperHub, plan, key),
    awaitSettlement: (executionId) =>
      waitForDirectKeeperHubSettlement(keeperHub, executionId),
    verifyOnchain: (plan, txHash) => verifyInheritance(client, plan, txHash),
    recordResult,
  };
}

async function listRegisteredPlans(
  client: RoutePublicClient,
  factory: Address,
  deploymentBlock: bigint,
): Promise<RegisteredPlan[]> {
  const logs = await client.getContractEvents({
    address: factory,
    abi: FACTORY_EVENTS,
    eventName: "PlanCreated",
    fromBlock: deploymentBlock,
    toBlock: "latest",
  });
  return logs.flatMap((log) => {
    const { owner, plan } = log.args;
    return owner && plan && isAddress(owner) && isAddress(plan)
      ? [{ owner, plan }]
      : [];
  });
}

async function readPlanState(
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

function matchingEventTarget(
  events: readonly { address: Address }[],
  plan: Address,
): Address | undefined {
  return events.find(
    (item) => item.address.toLowerCase() === plan.toLowerCase(),
  )?.address;
}

async function recordResult(value: InheritanceMonitorResult): Promise<void> {
  if (value.status === "skipped") return;
  await serverActivityRepository().append({
    executionKey: `executeInheritance:${value.owner.toLowerCase()}:${value.plan.toLowerCase()}`,
    owner: value.owner,
    timestamp: new Date(),
    trigger: { type: "scheduled", source: "vercel-cron" },
    action: "executeInheritance",
    keeperhubExecutionId: value.executionId,
    txHash: value.txHash,
    outcome: value.status === "executed" ? "success" : "failed",
    error: value.error ?? value.reason,
    errorCode:
      value.status === "failed" ? "INHERITANCE_MONITOR_FAILED" : undefined,
  });
}
