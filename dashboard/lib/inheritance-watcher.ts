import type { Address } from "viem";

const SEPOLIA_CHAIN_ID = 11_155_111;
const TOKEN_RECHECK_SECONDS = 300n;

export interface InheritanceWatchState {
  owner: Address;
  plan: Address;
  registeredPlan: Address;
  lastHeartbeat: bigint;
  timeoutDuration: bigint;
  gracePeriod: bigint;
  livenessActive: boolean;
  inheritanceExecuted: boolean;
  evacuationExecuted: boolean;
  beneficiaryCount: bigint;
  totalShareBps: number;
  actionableTokenCount: number;
  pendingTokenCount: number;
}

export type InheritanceWatchDecision =
  | { status: "wait"; deadline: bigint }
  | { status: "execute" }
  | {
      status: "complete";
      reason:
        | "registry-mismatch"
        | "inactive"
        | "evacuated"
        | "no-beneficiaries"
        | "incomplete-shares"
        | "inheritance-complete";
    };

export function inheritanceWatcherToken(owner: Address, plan: Address): string {
  return `legacykeeper:${SEPOLIA_CHAIN_ID}:${owner.toLowerCase()}:${plan.toLowerCase()}`;
}

export function getInheritanceWatchDecision(
  state: InheritanceWatchState,
  nowSeconds: bigint,
): InheritanceWatchDecision {
  const terminal = terminalDecision(state);
  if (terminal) return terminal;

  if (state.inheritanceExecuted) {
    if (state.actionableTokenCount > 0) return { status: "execute" };
    if (state.pendingTokenCount > 0) {
      return { status: "wait", deadline: nowSeconds + TOKEN_RECHECK_SECONDS };
    }
    return { status: "complete", reason: "inheritance-complete" };
  }

  const deadline =
    state.lastHeartbeat + state.timeoutDuration + state.gracePeriod;
  return nowSeconds < deadline
    ? { status: "wait", deadline }
    : { status: "execute" };
}

function terminalDecision(
  state: InheritanceWatchState,
): InheritanceWatchDecision | undefined {
  if (!sameAddress(state.registeredPlan, state.plan)) {
    return { status: "complete", reason: "registry-mismatch" };
  }
  if (state.evacuationExecuted) {
    return { status: "complete", reason: "evacuated" };
  }
  if (!state.livenessActive) {
    return { status: "complete", reason: "inactive" };
  }
  if (state.beneficiaryCount === 0n) {
    return { status: "complete", reason: "no-beneficiaries" };
  }
  if (state.totalShareBps !== 10_000) {
    return { status: "complete", reason: "incomplete-shares" };
  }
  return undefined;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
