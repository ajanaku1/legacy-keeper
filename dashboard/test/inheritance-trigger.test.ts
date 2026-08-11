import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  parseInheritanceTriggerRequest,
  runInheritanceTrigger,
} from "../lib/inheritance-trigger";
import type { InheritanceMonitorDependencies } from "../lib/inheritance-monitor";
import type { TokenInheritanceMonitorDependencies } from "../lib/token-inheritance-monitor";

const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const PLAN = "0x00000000000000000000000000000000000000a2" as Address;

describe("immediate inheritance trigger", () => {
  it("accepts only an owner and plan address", () => {
    expect(
      parseInheritanceTriggerRequest({ owner: OWNER, plan: PLAN }),
    ).toEqual({
      owner: OWNER,
      plan: PLAN,
    });
    expect(() =>
      parseInheritanceTriggerRequest({ owner: OWNER, plan: PLAN, admin: true }),
    ).toThrow("Unexpected field: admin");
  });

  it("scopes native and token execution to the requested registered plan", async () => {
    const native = nativeDependencies();
    const tokens = tokenDependencies();

    const result = await runInheritanceTrigger(
      { owner: OWNER, plan: PLAN },
      native,
      tokens,
    );

    expect(result.native).toMatchObject({ status: "executed", plan: PLAN });
    expect(result.tokens).toHaveLength(0);
    expect(native.listRegisteredPlans).not.toHaveBeenCalled();
    expect(tokens.listRegisteredPlans).not.toHaveBeenCalled();
  });
});

function nativeDependencies(): InheritanceMonitorDependencies {
  return {
    listRegisteredPlans: vi.fn(async () => []),
    readRegisteredPlan: vi.fn(async () => PLAN),
    readPlanState: vi.fn(async () => ({
      livenessActive: true,
      graceElapsed: true,
      inheritanceExecuted: false,
      evacuationExecuted: false,
      beneficiaryCount: 1n,
      totalShareBps: 10_000,
      lastHeartbeat: 100n,
    })),
    submitInheritance: vi.fn(async () => ({ executionId: "kh-native" })),
    awaitSettlement: vi.fn(async () => ({
      status: "completed",
      txHash: `0x${"1".repeat(64)}` as `0x${string}`,
    })),
    verifyOnchain: vi.fn(async () => ({
      receiptStatus: "success",
      target: PLAN,
      event: "InheritanceExecuted",
      inheritanceExecuted: true,
    })),
    recordResult: vi.fn(async () => undefined),
  };
}

function tokenDependencies(): TokenInheritanceMonitorDependencies {
  return {
    listRegisteredPlans: vi.fn(async () => []),
    readRegisteredPlan: vi.fn(async () => PLAN),
    readPlanState: vi.fn(async () => ({
      livenessActive: true,
      graceElapsed: true,
      inheritanceExecuted: true,
      evacuationExecuted: false,
      beneficiaryCount: 1n,
      totalShareBps: 10_000,
      lastHeartbeat: 100n,
      tokens: [],
    })),
    submitTokenInheritance: vi.fn(async () => ({ executionId: "kh-token" })),
    awaitSettlement: vi.fn(async () => ({ status: "completed" })),
    verifyOnchain: vi.fn(async () => ({
      receiptStatus: "success",
      tokenDistributed: true,
    })),
    recordResult: vi.fn(async () => undefined),
  };
}
