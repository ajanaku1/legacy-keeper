import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  getInheritanceWatchDecision,
  inheritanceWatcherToken,
  type InheritanceWatchState,
} from "../lib/inheritance-watcher";

const OWNER = "0x00000000000000000000000000000000000000A1" as Address;
const PLAN = "0x00000000000000000000000000000000000000A2" as Address;

function state(
  override: Partial<InheritanceWatchState> = {},
): InheritanceWatchState {
  return {
    owner: OWNER,
    plan: PLAN,
    registeredPlan: PLAN,
    lastHeartbeat: 100n,
    timeoutDuration: 600n,
    gracePeriod: 300n,
    livenessActive: true,
    inheritanceExecuted: false,
    evacuationExecuted: false,
    beneficiaryCount: 2n,
    totalShareBps: 10_000,
    actionableTokenCount: 0,
    pendingTokenCount: 0,
    ...override,
  };
}

describe("durable inheritance watcher", () => {
  it("waits until inactivity plus grace has elapsed", () => {
    expect(getInheritanceWatchDecision(state(), 999n)).toEqual({
      status: "wait",
      deadline: 1_000n,
    });
  });

  it("executes at the exact deadline", () => {
    expect(getInheritanceWatchDecision(state(), 1_000n)).toEqual({
      status: "execute",
    });
  });

  it("continues with approved tokens after native inheritance", () => {
    expect(
      getInheritanceWatchDecision(
        state({ inheritanceExecuted: true, actionableTokenCount: 1 }),
        1_000n,
      ),
    ).toEqual({ status: "execute" });
  });

  it("finishes once inheritance ran and no approved token remains", () => {
    expect(
      getInheritanceWatchDecision(state({ inheritanceExecuted: true }), 1_000n),
    ).toEqual({ status: "complete", reason: "inheritance-complete" });
  });

  it("keeps checking an undistributed token that still needs approval", () => {
    expect(
      getInheritanceWatchDecision(
        state({ inheritanceExecuted: true, pendingTokenCount: 1 }),
        1_000n,
      ),
    ).toEqual({ status: "wait", deadline: 1_300n });
  });

  it.each([
    ["registry-mismatch", { registeredPlan: OWNER }],
    ["inactive", { livenessActive: false }],
    ["evacuated", { evacuationExecuted: true }],
    ["no-beneficiaries", { beneficiaryCount: 0n }],
    ["incomplete-shares", { totalShareBps: 9_000 }],
  ] as const)("finishes terminal %s states", (reason, override) => {
    expect(getInheritanceWatchDecision(state(override), 1_000n)).toEqual({
      status: "complete",
      reason,
    });
  });

  it("derives one case-insensitive watcher identity per owner plan", () => {
    expect(inheritanceWatcherToken(OWNER, PLAN)).toBe(
      `legacykeeper:11155111:${OWNER.toLowerCase()}:${PLAN.toLowerCase()}`,
    );
  });
});
