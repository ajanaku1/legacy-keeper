import type { Address, Hex } from "viem";
import type {
  InheritanceSettlement,
  RegisteredPlan,
} from "./inheritance-monitor";

export interface MonitoredToken {
  token: Address;
  pullableAmount: bigint;
  distributed: boolean;
}

export interface TokenInheritancePlanState {
  livenessActive: boolean;
  graceElapsed: boolean;
  inheritanceExecuted: boolean;
  evacuationExecuted: boolean;
  beneficiaryCount: bigint;
  totalShareBps: number;
  lastHeartbeat: bigint;
  tokens: MonitoredToken[];
}

export interface TokenInheritanceProof {
  receiptStatus: string;
  target?: Address;
  event?: string;
  token?: Address;
  tokenDistributed: boolean;
}

export type TokenMonitorReason =
  | "inactive"
  | "not-due"
  | "evacuated"
  | "no-beneficiaries"
  | "incomplete-shares"
  | "allowance-or-balance-missing"
  | "already-distributed"
  | "registry-mismatch"
  | "settlement-failed"
  | "missing-transaction-hash"
  | "receipt-not-successful"
  | "event-not-found"
  | "state-not-advanced"
  | "execution-error";

export interface TokenInheritanceMonitorResult extends RegisteredPlan {
  token: Address;
  status: "skipped" | "executed" | "failed";
  reason?: TokenMonitorReason;
  executionId?: string;
  txHash?: Hex;
  sponsored?: boolean;
  error?: string;
}

export interface TokenInheritanceMonitorDependencies {
  listRegisteredPlans(): Promise<RegisteredPlan[]>;
  readRegisteredPlan(owner: Address): Promise<Address>;
  readPlanState(plan: Address): Promise<TokenInheritancePlanState>;
  submitTokenInheritance(
    plan: Address,
    token: Address,
    idempotencyKey: string,
  ): Promise<{ executionId: string }>;
  awaitSettlement(executionId: string): Promise<InheritanceSettlement>;
  verifyOnchain(
    plan: Address,
    token: Address,
    txHash: Hex,
  ): Promise<TokenInheritanceProof>;
  recordResult(result: TokenInheritanceMonitorResult): Promise<void>;
  idempotencyKey?(
    registered: RegisteredPlan,
    state: TokenInheritancePlanState,
  ): string;
}

export async function runTokenInheritanceMonitor(
  dependencies: TokenInheritanceMonitorDependencies,
): Promise<TokenInheritanceMonitorResult[]> {
  const plans = await dependencies.listRegisteredPlans();
  const results: TokenInheritanceMonitorResult[] = [];
  for (const registered of plans) {
    results.push(...(await runTokenInheritancePlan(registered, dependencies)));
  }
  return results;
}

export async function runTokenInheritancePlan(
  registered: RegisteredPlan,
  dependencies: TokenInheritanceMonitorDependencies,
): Promise<TokenInheritanceMonitorResult[]> {
  const state = await dependencies.readPlanState(registered.plan);
  const planReason = ineligiblePlanReason(state);
  const registeredPlan = await dependencies.readRegisteredPlan(
    registered.owner,
  );
  const results: TokenInheritanceMonitorResult[] = [];
  for (const monitored of state.tokens) {
    const result = await inspectToken({
      registered,
      registeredPlan,
      state,
      monitored,
      planReason,
      dependencies,
    });
    results.push(result);
    await safelyRecord(result, dependencies);
  }
  return results;
}

interface TokenInspection {
  registered: RegisteredPlan;
  registeredPlan: Address;
  state: TokenInheritancePlanState;
  monitored: MonitoredToken;
  planReason?: TokenMonitorReason;
  dependencies: TokenInheritanceMonitorDependencies;
}

async function inspectToken(
  inspection: TokenInspection,
): Promise<TokenInheritanceMonitorResult> {
  const reason = inspection.planReason ?? tokenSkipReason(inspection.monitored);
  if (reason) {
    return tokenResult(
      inspection.registered,
      inspection.monitored.token,
      "skipped",
      reason,
    );
  }
  if (!sameAddress(inspection.registeredPlan, inspection.registered.plan)) {
    return tokenResult(
      inspection.registered,
      inspection.monitored.token,
      "failed",
      "registry-mismatch",
    );
  }
  return executeToken(
    inspection.registered,
    inspection.state,
    inspection.monitored,
    inspection.dependencies,
  );
}

async function executeToken(
  registered: RegisteredPlan,
  state: TokenInheritancePlanState,
  monitored: MonitoredToken,
  dependencies: TokenInheritanceMonitorDependencies,
): Promise<TokenInheritanceMonitorResult> {
  try {
    const workflowScope = dependencies.idempotencyKey?.(registered, state);
    const key = workflowScope
      ? `${workflowScope}:${monitored.token.toLowerCase()}:execute-token-inheritance`
      : `${registered.plan.toLowerCase()}:${monitored.token.toLowerCase()}:${state.lastHeartbeat}:execute-token-inheritance`;
    const submission = await dependencies.submitTokenInheritance(
      registered.plan,
      monitored.token,
      key,
    );
    const settlement = await dependencies.awaitSettlement(
      submission.executionId,
    );
    const settlementReason = settlementFailure(settlement);
    if (settlementReason) {
      return tokenResult(
        registered,
        monitored.token,
        "failed",
        settlementReason,
        submission.executionId,
        settlement,
      );
    }
    return verifyTokenExecution(
      registered,
      monitored.token,
      submission.executionId,
      settlement,
      dependencies,
    );
  } catch (error) {
    return {
      ...registered,
      token: monitored.token,
      status: "failed",
      reason: "execution-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyTokenExecution(
  registered: RegisteredPlan,
  token: Address,
  executionId: string,
  settlement: InheritanceSettlement,
  dependencies: TokenInheritanceMonitorDependencies,
): Promise<TokenInheritanceMonitorResult> {
  const proof = await dependencies.verifyOnchain(
    registered.plan,
    token,
    settlement.txHash as Hex,
  );
  const reason = proofFailure(proof, registered.plan, token);
  if (reason) {
    return tokenResult(
      registered,
      token,
      "failed",
      reason,
      executionId,
      settlement,
    );
  }
  return {
    ...registered,
    token,
    status: "executed",
    executionId,
    txHash: settlement.txHash,
    sponsored: settlement.sponsored,
  };
}

function ineligiblePlanReason(
  state: TokenInheritancePlanState,
): TokenMonitorReason | undefined {
  if (state.evacuationExecuted) return "evacuated";
  if (!state.livenessActive) return "inactive";
  if (!state.graceElapsed) return "not-due";
  if (state.beneficiaryCount === 0n) return "no-beneficiaries";
  if (state.totalShareBps !== 10_000) return "incomplete-shares";
  return undefined;
}

function tokenSkipReason(
  token: MonitoredToken,
): TokenMonitorReason | undefined {
  if (token.distributed) return "already-distributed";
  if (token.pullableAmount === 0n) return "allowance-or-balance-missing";
  return undefined;
}

function settlementFailure(
  settlement: InheritanceSettlement,
): TokenMonitorReason | undefined {
  if (!["completed", "success"].includes(settlement.status.toLowerCase()))
    return "settlement-failed";
  return settlement.txHash ? undefined : "missing-transaction-hash";
}

function proofFailure(
  proof: TokenInheritanceProof,
  plan: Address,
  token: Address,
): TokenMonitorReason | undefined {
  if (proof.receiptStatus !== "success") return "receipt-not-successful";
  if (
    proof.event !== "InheritanceTransfer" ||
    !sameAddress(proof.target, plan) ||
    !sameAddress(proof.token, token)
  )
    return "event-not-found";
  return proof.tokenDistributed ? undefined : "state-not-advanced";
}

function tokenResult(
  registered: RegisteredPlan,
  token: Address,
  status: "skipped" | "failed",
  reason: TokenMonitorReason,
  executionId?: string,
  settlement?: InheritanceSettlement,
): TokenInheritanceMonitorResult {
  return {
    ...registered,
    token,
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
  result: TokenInheritanceMonitorResult,
  dependencies: TokenInheritanceMonitorDependencies,
): Promise<void> {
  try {
    await dependencies.recordResult(result);
  } catch (error) {
    console.error("Unable to persist token inheritance monitor result.", error);
  }
}
