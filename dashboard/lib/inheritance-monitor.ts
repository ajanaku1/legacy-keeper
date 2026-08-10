import type { Address, Hex } from "viem";

export interface RegisteredPlan {
  owner: Address;
  plan: Address;
}

export interface InheritancePlanState {
  livenessActive: boolean;
  graceElapsed: boolean;
  inheritanceExecuted: boolean;
  evacuationExecuted: boolean;
  beneficiaryCount: bigint;
  totalShareBps: number;
  lastHeartbeat: bigint;
}

export interface InheritanceSettlement {
  status: string;
  txHash?: Hex;
  sponsored?: boolean;
}

export interface InheritanceProof {
  receiptStatus: string;
  target?: Address;
  event?: string;
  inheritanceExecuted: boolean;
}

export type MonitorReason =
  | "inactive"
  | "not-due"
  | "already-inherited"
  | "evacuated"
  | "no-beneficiaries"
  | "incomplete-shares"
  | "registry-mismatch"
  | "settlement-failed"
  | "missing-transaction-hash"
  | "receipt-not-successful"
  | "event-not-found"
  | "state-not-advanced"
  | "execution-error";

export interface InheritanceMonitorResult extends RegisteredPlan {
  status: "skipped" | "executed" | "failed";
  reason?: MonitorReason;
  executionId?: string;
  txHash?: Hex;
  sponsored?: boolean;
  error?: string;
}

export interface InheritanceMonitorDependencies {
  listRegisteredPlans(): Promise<RegisteredPlan[]>;
  readRegisteredPlan(owner: Address): Promise<Address>;
  readPlanState(plan: Address): Promise<InheritancePlanState>;
  submitInheritance(
    plan: Address,
    idempotencyKey: string,
  ): Promise<{ executionId: string }>;
  awaitSettlement(executionId: string): Promise<InheritanceSettlement>;
  verifyOnchain(plan: Address, txHash: Hex): Promise<InheritanceProof>;
  recordResult(result: InheritanceMonitorResult): Promise<void>;
}

export async function runInheritanceMonitor(
  dependencies: InheritanceMonitorDependencies,
): Promise<InheritanceMonitorResult[]> {
  const plans = await dependencies.listRegisteredPlans();
  const results: InheritanceMonitorResult[] = [];
  for (const plan of plans) {
    const result = await inspectPlan(plan, dependencies);
    results.push(result);
    await safelyRecord(result, dependencies);
  }
  return results;
}

async function inspectPlan(
  registered: RegisteredPlan,
  dependencies: InheritanceMonitorDependencies,
): Promise<InheritanceMonitorResult> {
  try {
    const state = await dependencies.readPlanState(registered.plan);
    const skipReason = ineligibleReason(state);
    if (skipReason) return result(registered, "skipped", skipReason);
    const currentPlan = await dependencies.readRegisteredPlan(registered.owner);
    if (!sameAddress(currentPlan, registered.plan)) {
      return result(registered, "failed", "registry-mismatch");
    }
    return await executePlan(registered, state, dependencies);
  } catch (error) {
    return {
      ...registered,
      status: "failed",
      reason: "execution-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executePlan(
  registered: RegisteredPlan,
  state: InheritancePlanState,
  dependencies: InheritanceMonitorDependencies,
): Promise<InheritanceMonitorResult> {
  const idempotencyKey = `${registered.plan.toLowerCase()}:${state.lastHeartbeat}:execute-inheritance`;
  const submission = await dependencies.submitInheritance(
    registered.plan,
    idempotencyKey,
  );
  const settlement = await dependencies.awaitSettlement(submission.executionId);
  const failure = settlementFailure(settlement);
  if (failure) {
    return result(
      registered,
      "failed",
      failure,
      submission.executionId,
      settlement,
    );
  }
  return verifyExecution(
    registered,
    submission.executionId,
    settlement,
    dependencies,
  );
}

async function verifyExecution(
  registered: RegisteredPlan,
  executionId: string,
  settlement: InheritanceSettlement,
  dependencies: InheritanceMonitorDependencies,
): Promise<InheritanceMonitorResult> {
  const proof = await dependencies.verifyOnchain(
    registered.plan,
    settlement.txHash as Hex,
  );
  const proofFailure = proofFailureReason(proof, registered.plan);
  if (proofFailure) {
    return result(registered, "failed", proofFailure, executionId, settlement);
  }
  return {
    ...registered,
    status: "executed",
    executionId,
    txHash: settlement.txHash,
    sponsored: settlement.sponsored,
  };
}

function ineligibleReason(
  state: InheritancePlanState,
): MonitorReason | undefined {
  if (state.inheritanceExecuted) return "already-inherited";
  if (state.evacuationExecuted) return "evacuated";
  if (!state.livenessActive) return "inactive";
  if (!state.graceElapsed) return "not-due";
  if (state.beneficiaryCount === 0n) return "no-beneficiaries";
  if (state.totalShareBps !== 10_000) return "incomplete-shares";
  return undefined;
}

function settlementFailure(
  settlement: InheritanceSettlement,
): MonitorReason | undefined {
  if (!["completed", "success"].includes(settlement.status.toLowerCase())) {
    return "settlement-failed";
  }
  return settlement.txHash ? undefined : "missing-transaction-hash";
}

function proofFailureReason(
  proof: InheritanceProof,
  plan: Address,
): MonitorReason | undefined {
  if (proof.receiptStatus !== "success") return "receipt-not-successful";
  if (
    proof.event !== "InheritanceExecuted" ||
    !sameAddress(proof.target, plan)
  ) {
    return "event-not-found";
  }
  return proof.inheritanceExecuted ? undefined : "state-not-advanced";
}

function result(
  registered: RegisteredPlan,
  status: "skipped" | "failed",
  reason: MonitorReason,
  executionId?: string,
  settlement?: InheritanceSettlement,
): InheritanceMonitorResult {
  return {
    ...registered,
    status,
    reason,
    executionId,
    txHash: settlement?.txHash,
    sponsored: settlement?.sponsored,
  };
}

function sameAddress(left: Address | undefined, right: Address): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

async function safelyRecord(
  value: InheritanceMonitorResult,
  dependencies: InheritanceMonitorDependencies,
): Promise<void> {
  try {
    await dependencies.recordResult(value);
  } catch (error) {
    console.error("Unable to persist inheritance monitor result.", error);
  }
}
