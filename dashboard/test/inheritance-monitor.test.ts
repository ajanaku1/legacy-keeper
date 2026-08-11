import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import {
  runInheritanceMonitor,
  type InheritanceMonitorDependencies,
  type RegisteredPlan,
} from "../lib/inheritance-monitor";

const OWNER_A = "0x00000000000000000000000000000000000000a1" as Address;
const OWNER_B = "0x00000000000000000000000000000000000000b1" as Address;
const PLAN_A = "0x00000000000000000000000000000000000000a2" as Address;
const PLAN_B = "0x00000000000000000000000000000000000000b2" as Address;
const TX_HASH = `0x${"1".repeat(64)}` as Hex;

function plan(owner = OWNER_A, address = PLAN_A): RegisteredPlan {
  return { owner, plan: address };
}

function dependencies(
  plans: RegisteredPlan[] = [plan()],
): InheritanceMonitorDependencies {
  return {
    listRegisteredPlans: vi.fn(async () => plans),
    readRegisteredPlan: vi.fn(async (owner) =>
      owner === OWNER_B ? PLAN_B : PLAN_A,
    ),
    readPlanState: vi.fn(async () => ({
      livenessActive: true,
      graceElapsed: true,
      inheritanceExecuted: false,
      evacuationExecuted: false,
      beneficiaryCount: 2n,
      totalShareBps: 10_000,
      lastHeartbeat: 100n,
    })),
    submitInheritance: vi.fn(async () => ({ executionId: "kh-execution" })),
    awaitSettlement: vi.fn(async () => ({
      status: "completed",
      txHash: TX_HASH,
      sponsored: true,
    })),
    verifyOnchain: vi.fn(async () => ({
      receiptStatus: "success",
      target: PLAN_A,
      event: "InheritanceExecuted",
      inheritanceExecuted: true,
    })),
    recordResult: vi.fn(async () => undefined),
  };
}

describe("inheritance monitor", () => {
  it("submits an eligible registered plan with a stable idempotency key", async () => {
    const deps = dependencies();

    const [result] = await runInheritanceMonitor(deps);

    expect(result).toMatchObject({
      status: "executed",
      owner: OWNER_A,
      plan: PLAN_A,
      executionId: "kh-execution",
      txHash: TX_HASH,
    });
    expect(deps.readRegisteredPlan).toHaveBeenCalledWith(OWNER_A);
    expect(deps.submitInheritance).toHaveBeenCalledWith(
      PLAN_A,
      `${PLAN_A.toLowerCase()}:100:execute-inheritance`,
    );
    expect(deps.recordResult).toHaveBeenCalledWith(result);
  });

  it("uses the durable workflow step as the retry idempotency scope", async () => {
    const deps = dependencies();
    deps.idempotencyKey = vi.fn(() => "workflow-step-1");

    await runInheritanceMonitor(deps);

    expect(deps.submitInheritance).toHaveBeenCalledWith(
      PLAN_A,
      "workflow-step-1:execute-inheritance",
    );
  });

  it.each([
    ["inactive", { livenessActive: false }],
    ["not-due", { graceElapsed: false }],
    ["already-inherited", { inheritanceExecuted: true }],
    ["evacuated", { evacuationExecuted: true }],
    ["no-beneficiaries", { beneficiaryCount: 0n }],
    ["incomplete-shares", { totalShareBps: 9_000 }],
  ])("skips %s plans without submitting", async (reason, override) => {
    const deps = dependencies();
    vi.mocked(deps.readPlanState).mockResolvedValue({
      livenessActive: true,
      graceElapsed: true,
      inheritanceExecuted: false,
      evacuationExecuted: false,
      beneficiaryCount: 2n,
      totalShareBps: 10_000,
      lastHeartbeat: 100n,
      ...override,
    });

    const [result] = await runInheritanceMonitor(deps);

    expect(result).toMatchObject({ status: "skipped", reason });
    expect(deps.submitInheritance).not.toHaveBeenCalled();
  });

  it("fails closed when the factory mapping changed before submission", async () => {
    const deps = dependencies();
    vi.mocked(deps.readRegisteredPlan).mockResolvedValue(PLAN_B);

    const [result] = await runInheritanceMonitor(deps);

    expect(result).toMatchObject({
      status: "failed",
      reason: "registry-mismatch",
    });
    expect(deps.submitInheritance).not.toHaveBeenCalled();
  });

  it.each([
    ["settlement-failed", { status: "failed" }, undefined],
    ["missing-transaction-hash", { status: "completed" }, undefined],
    [
      "receipt-not-successful",
      { status: "completed", txHash: TX_HASH },
      {
        receiptStatus: "reverted",
        target: PLAN_A,
        event: "InheritanceExecuted",
        inheritanceExecuted: true,
      },
    ],
    [
      "event-not-found",
      { status: "completed", txHash: TX_HASH },
      { receiptStatus: "success", target: PLAN_A, inheritanceExecuted: true },
    ],
    [
      "state-not-advanced",
      { status: "completed", txHash: TX_HASH },
      {
        receiptStatus: "success",
        target: PLAN_A,
        event: "InheritanceExecuted",
        inheritanceExecuted: false,
      },
    ],
  ] as const)("fails closed for %s", async (reason, settlement, proof) => {
    const deps = dependencies();
    vi.mocked(deps.awaitSettlement).mockResolvedValue(settlement);
    if (proof) vi.mocked(deps.verifyOnchain).mockResolvedValue(proof);

    const [result] = await runInheritanceMonitor(deps);

    expect(result).toMatchObject({ status: "failed", reason });
  });

  it("isolates one plan failure and continues scanning the others", async () => {
    const deps = dependencies([plan(), plan(OWNER_B, PLAN_B)]);
    vi.mocked(deps.submitInheritance)
      .mockRejectedValueOnce(new Error("KeeperHub unavailable"))
      .mockResolvedValueOnce({ executionId: "kh-second" });
    vi.mocked(deps.verifyOnchain).mockResolvedValue({
      receiptStatus: "success",
      target: PLAN_B,
      event: "InheritanceExecuted",
      inheritanceExecuted: true,
    });

    const results = await runInheritanceMonitor(deps);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      status: "failed",
      reason: "execution-error",
    });
    expect(results[1]).toMatchObject({ status: "executed", plan: PLAN_B });
    expect(deps.submitInheritance).toHaveBeenCalledTimes(2);
    expect(deps.recordResult).toHaveBeenCalledTimes(2);
  });
});
