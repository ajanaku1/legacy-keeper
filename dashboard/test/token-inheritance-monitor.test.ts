import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import {
  runTokenInheritanceMonitor,
  type TokenInheritanceMonitorDependencies,
} from "../lib/token-inheritance-monitor";

const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const PLAN = "0x00000000000000000000000000000000000000a2" as Address;
const TOKEN = "0x00000000000000000000000000000000000000a3" as Address;
const TOKEN_B = "0x00000000000000000000000000000000000000a4" as Address;
const TX_HASH = `0x${"2".repeat(64)}` as Hex;

function dependencies(): TokenInheritanceMonitorDependencies {
  return {
    listRegisteredPlans: vi.fn(async () => [{ owner: OWNER, plan: PLAN }]),
    readRegisteredPlan: vi.fn(async () => PLAN),
    readPlanState: vi.fn(async () => ({
      livenessActive: true,
      graceElapsed: true,
      inheritanceExecuted: true,
      evacuationExecuted: false,
      beneficiaryCount: 2n,
      totalShareBps: 10_000,
      lastHeartbeat: 100n,
      tokens: [
        { token: TOKEN, pullableAmount: 1_080_000_000n, distributed: false },
      ],
    })),
    submitTokenInheritance: vi.fn(async () => ({ executionId: "kh-token" })),
    awaitSettlement: vi.fn(async () => ({
      status: "completed",
      txHash: TX_HASH,
    })),
    verifyOnchain: vi.fn(async () => ({
      receiptStatus: "success",
      target: PLAN,
      event: "InheritanceTransfer",
      token: TOKEN,
      tokenDistributed: true,
    })),
    recordResult: vi.fn(async () => undefined),
  };
}

describe("token inheritance monitor", () => {
  it("executes an approved token after native inheritance has already fired", async () => {
    const deps = dependencies();

    const [result] = await runTokenInheritanceMonitor(deps);

    expect(result).toMatchObject({
      status: "executed",
      owner: OWNER,
      plan: PLAN,
      token: TOKEN,
    });
    expect(deps.submitTokenInheritance).toHaveBeenCalledWith(
      PLAN,
      TOKEN,
      `${PLAN.toLowerCase()}:${TOKEN.toLowerCase()}:100:execute-token-inheritance`,
    );
  });

  it("uses the durable workflow step as the token retry idempotency scope", async () => {
    const deps = dependencies();
    deps.idempotencyKey = vi.fn(() => "workflow-step-2");

    await runTokenInheritanceMonitor(deps);

    expect(deps.submitTokenInheritance).toHaveBeenCalledWith(
      PLAN,
      TOKEN,
      `workflow-step-2:${TOKEN.toLowerCase()}:execute-token-inheritance`,
    );
  });

  it.each([
    ["allowance-or-balance-missing", { pullableAmount: 0n }],
    ["already-distributed", { distributed: true }],
  ])("skips tokens that are %s", async (reason, override) => {
    const deps = dependencies();
    vi.mocked(deps.readPlanState).mockResolvedValue({
      ...(await deps.readPlanState(PLAN)),
      tokens: [
        { token: TOKEN, pullableAmount: 1n, distributed: false, ...override },
      ],
    });

    const [result] = await runTokenInheritanceMonitor(deps);

    expect(result).toMatchObject({ status: "skipped", reason, token: TOKEN });
    expect(deps.submitTokenInheritance).not.toHaveBeenCalled();
  });

  it("fails closed if the receipt does not prove distribution of the same token", async () => {
    const deps = dependencies();
    vi.mocked(deps.verifyOnchain).mockResolvedValue({
      receiptStatus: "success",
      target: PLAN,
      event: "InheritanceTransfer",
      token: TOKEN_B,
      tokenDistributed: true,
    });

    const [result] = await runTokenInheritanceMonitor(deps);

    expect(result).toMatchObject({
      status: "failed",
      reason: "event-not-found",
    });
  });

  it("isolates one token failure and continues with the next token", async () => {
    const deps = dependencies();
    vi.mocked(deps.readPlanState).mockResolvedValue({
      ...(await deps.readPlanState(PLAN)),
      tokens: [
        { token: TOKEN, pullableAmount: 1n, distributed: false },
        { token: TOKEN_B, pullableAmount: 1n, distributed: false },
      ],
    });
    vi.mocked(deps.submitTokenInheritance)
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce({ executionId: "kh-second" });
    vi.mocked(deps.verifyOnchain).mockResolvedValue({
      receiptStatus: "success",
      target: PLAN,
      event: "InheritanceTransfer",
      token: TOKEN_B,
      tokenDistributed: true,
    });

    const results = await runTokenInheritanceMonitor(deps);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: "failed", token: TOKEN });
    expect(results[1]).toMatchObject({ status: "executed", token: TOKEN_B });
  });
});
