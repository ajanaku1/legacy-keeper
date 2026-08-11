import type { Address } from "viem";
import { legacyKeeperAbi } from "./contract";
import {
  createInheritanceMonitorDependencies,
  createTokenInheritanceMonitorDependencies,
  readTokenPlanState,
} from "./inheritance-monitor-server";
import {
  runInheritanceTrigger,
  type InheritanceTriggerResult,
} from "./inheritance-trigger";
import type { InheritanceWatchState } from "./inheritance-watcher";
import {
  createSepoliaClient,
  readRegisteredPlanAcrossFactories,
  requiredFactories,
} from "./route-server";

export interface InheritanceWatchInput {
  owner: Address;
  plan: Address;
}

export interface ObservedInheritanceWatchState {
  state: InheritanceWatchState;
  nowSeconds: bigint;
}

export async function readInheritanceWatchState(
  input: InheritanceWatchInput,
): Promise<ObservedInheritanceWatchState> {
  const client = createSepoliaClient();
  const factories = requiredFactories();
  const [registeredPlan, planState, liveness, latestBlock] = await Promise.all([
    readRegisteredPlanAcrossFactories(client, factories, input.owner),
    readTokenPlanState(client, input.plan),
    client.readContract({
      address: input.plan,
      abi: legacyKeeperAbi,
      functionName: "liveness",
    }),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const pendingTokens = planState.tokens.filter((token) => !token.distributed);
  return {
    state: {
      owner: input.owner,
      plan: input.plan,
      registeredPlan,
      lastHeartbeat: planState.lastHeartbeat,
      timeoutDuration: liveness[1],
      gracePeriod: liveness[2],
      livenessActive: planState.livenessActive,
      inheritanceExecuted: planState.inheritanceExecuted,
      evacuationExecuted: planState.evacuationExecuted,
      beneficiaryCount: planState.beneficiaryCount,
      totalShareBps: planState.totalShareBps,
      actionableTokenCount: pendingTokens.filter(
        (token) => token.pullableAmount > 0n,
      ).length,
      pendingTokenCount: pendingTokens.length,
    },
    nowSeconds: latestBlock.timestamp,
  };
}

export async function executeWatchedInheritance(
  input: InheritanceWatchInput,
  idempotencyScope: string,
): Promise<InheritanceTriggerResult> {
  const options = {
    idempotencyScope,
    triggerSource: "vercel-workflow",
  };
  const [nativeDependencies, tokenDependencies] = await Promise.all([
    createInheritanceMonitorDependencies(options),
    createTokenInheritanceMonitorDependencies(options),
  ]);
  return runInheritanceTrigger(input, nativeDependencies, tokenDependencies);
}
