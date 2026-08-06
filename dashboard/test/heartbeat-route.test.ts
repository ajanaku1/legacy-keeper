import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { McpClient } from "../../agent/keeperhub/mcp-client";
import {
  executeSignedHeartbeat,
  parseHeartbeatRequest,
  type HeartbeatDependencies,
  type HeartbeatRequest,
} from "../lib/heartbeat-route";
import { prepareHeartbeatMessage } from "../lib/heartbeat-client";
import {
  parseKeeperHubExecution,
  parseWebhookExecutionId,
  waitForKeeperHubSettlement,
} from "../lib/keeperhub-server";
import { checkInAvailability } from "../components/HeartbeatPanel";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PLAN = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const TX_HASH = `0x${"a".repeat(64)}` as const;

function request(): HeartbeatRequest {
  return {
    chainId: 11155111,
    owner: OWNER,
    plan: PLAN,
    nonce: "12",
    deadline: "100300",
    signature: "0xsig",
  };
}

function dependencies(
  overrides: Partial<HeartbeatDependencies> = {},
): HeartbeatDependencies {
  return {
    nowSeconds: () => 100_000,
    readRegisteredPlan: vi.fn().mockResolvedValue(PLAN),
    readOwner: vi.fn().mockResolvedValue(OWNER),
    readLastHeartbeat: vi.fn().mockResolvedValue(100n),
    recoverSigner: vi.fn().mockResolvedValue(OWNER),
    nextIdempotencyKey: vi.fn().mockReturnValue("heartbeat-attempt-1"),
    submitToKeeperHub: vi.fn().mockResolvedValue({ executionId: "kh_123" }),
    awaitSettlement: vi.fn().mockResolvedValue({
      status: "success",
      txHash: TX_HASH,
      sponsored: true,
    }),
    verifyOnchain: vi.fn().mockResolvedValue({
      receiptStatus: "success",
      target: PLAN,
      event: "HeartbeatRecorded",
      lastHeartbeat: 101n,
    }),
    ...overrides,
  };
}

describe("wallet-scoped heartbeat route boundary", () => {
  it("returns a specific disabled remedy for every unavailable check-in state", () => {
    const ready = {
      connected: true,
      chainId: 11155111,
      ownerAddress: OWNER,
      plan: PLAN,
      planOwner: OWNER,
      livenessActive: true,
      inheritanceExecuted: false,
      evacuationExecuted: false,
    };

    expect(
      checkInAvailability({ ...ready, connected: false }, false).code,
    ).toBe("DISCONNECTED");
    expect(checkInAvailability({ ...ready, chainId: 1 }, false).code).toBe(
      "WRONG_NETWORK",
    );
    expect(checkInAvailability({ ...ready, plan: undefined }, false).code).toBe(
      "SETUP_INCOMPLETE",
    );
    expect(
      checkInAvailability({ ...ready, planOwner: OTHER }, false).code,
    ).toBe("WRONG_OWNER");
    expect(
      checkInAvailability({ ...ready, inheritanceExecuted: true }, false).code,
    ).toBe("PLAN_SETTLED");
    expect(checkInAvailability(ready, true).code).toBe("BUSY");
    expect(checkInAvailability(ready, false)).toEqual({
      code: "READY",
      reason: "",
    });
  });

  it("permits at most one check-in during a rolling 24-hour window", () => {
    const lastHeartbeat = 10_000;
    const ready = {
      connected: true,
      chainId: 11155111,
      ownerAddress: OWNER,
      plan: PLAN,
      planOwner: OWNER,
      livenessActive: true,
      inheritanceExecuted: false,
      evacuationExecuted: false,
      lastHeartbeat,
    };

    expect(
      checkInAvailability(ready, false, lastHeartbeat + 86_399),
    ).toMatchObject({ code: "COOLDOWN" });
    expect(checkInAvailability(ready, false, lastHeartbeat + 86_400)).toEqual({
      code: "READY",
      reason: "",
    });
  });

  it("keeps wallet, plan, and disabled remedies in the client request", () => {
    const source = readFileSync(
      new URL("../components/HeartbeatPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("state.plan");
    expect(source).toContain("state.ownerAddress");
    expect(source).toMatch(/WRONG_NETWORK/);
    expect(source).toMatch(/SETUP_INCOMPLETE/);
    expect(source).not.toContain("LEGACY_KEEPER_ADDRESS");
  });

  it("accepts only owner, plan, chain, nonce, deadline, and signature", () => {
    expect(parseHeartbeatRequest(request())).toEqual(request());
    expect(() =>
      parseHeartbeatRequest({
        ...request(),
        apiKey: "must-not-cross-the-browser-boundary",
      }),
    ).toThrow(/unexpected field/i);
  });

  it("re-resolves the factory mapping and plan owner before submission", async () => {
    const submitToKeeperHub = vi.fn();
    await expect(
      executeSignedHeartbeat(
        request(),
        dependencies({
          readRegisteredPlan: vi.fn().mockResolvedValue(OTHER),
          submitToKeeperHub,
        }),
      ),
    ).rejects.toMatchObject({ code: "PLAN_MISMATCH" });
    await expect(
      executeSignedHeartbeat(
        request(),
        dependencies({
          readOwner: vi.fn().mockResolvedValue(OTHER),
          submitToKeeperHub,
        }),
      ),
    ).rejects.toMatchObject({ code: "WRONG_OWNER" });
    expect(submitToKeeperHub).not.toHaveBeenCalled();
  });

  it("rejects wrong network, expired intent, or non-owner signer before KeeperHub", async () => {
    const submitToKeeperHub = vi.fn();
    await expect(
      executeSignedHeartbeat(
        { ...request(), chainId: 1 },
        dependencies({ submitToKeeperHub }),
      ),
    ).rejects.toMatchObject({ code: "WRONG_NETWORK" });
    await expect(
      executeSignedHeartbeat(
        { ...request(), deadline: "999" },
        dependencies({ submitToKeeperHub }),
      ),
    ).rejects.toMatchObject({ code: "SIGNATURE_EXPIRED" });
    await expect(
      executeSignedHeartbeat(
        request(),
        dependencies({
          submitToKeeperHub,
          recoverSigner: vi.fn().mockResolvedValue(OTHER),
        }),
      ),
    ).rejects.toMatchObject({ code: "WRONG_SIGNER" });
    expect(submitToKeeperHub).not.toHaveBeenCalled();
  });

  it("rejects a second check-in inside 24 hours before KeeperHub", async () => {
    const submitToKeeperHub = vi.fn();
    await expect(
      executeSignedHeartbeat(
        { ...request(), deadline: "96600" },
        dependencies({
          nowSeconds: () => 10_000 + 86_399,
          readLastHeartbeat: vi.fn().mockResolvedValue(10_000n),
          submitToKeeperHub,
        }),
      ),
    ).rejects.toMatchObject({ code: "HEARTBEAT_COOLDOWN" });
    expect(submitToKeeperHub).not.toHaveBeenCalled();
  });

  it("uses a per-attempt idempotency key and returns independent proof", async () => {
    const deps = dependencies();

    const result = await executeSignedHeartbeat(request(), deps);

    expect(deps.submitToKeeperHub).toHaveBeenCalledWith(
      request(),
      "heartbeat-attempt-1",
    );
    expect(result).toEqual({
      stage: "verified",
      executionId: "kh_123",
      idempotencyKey: "heartbeat-attempt-1",
      txHash: TX_HASH,
      sponsored: true,
      receiptStatus: "success",
      event: "HeartbeatRecorded",
      plan: PLAN,
      lastHeartbeat: "101",
      routeConfidence: "unavailable",
    });
  });

  it("fails closed when receipt target, event, or resulting state disagree", async () => {
    const wrongTarget = dependencies({
      verifyOnchain: vi.fn().mockResolvedValue({
        receiptStatus: "success",
        target: OTHER,
        event: "HeartbeatRecorded",
        lastHeartbeat: 101n,
      }),
    });
    await expect(
      executeSignedHeartbeat(request(), wrongTarget),
    ).rejects.toMatchObject({
      code: "UNVERIFIED_RESULT",
      evidence: { executionId: "kh_123", txHash: TX_HASH },
    });
    const staleState = dependencies({
      verifyOnchain: vi.fn().mockResolvedValue({
        receiptStatus: "success",
        target: PLAN,
        event: "HeartbeatRecorded",
        lastHeartbeat: 100n,
      }),
    });
    await expect(
      executeSignedHeartbeat(request(), staleState),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESULT" });
  });
});

describe("heartbeat client message", () => {
  it("derives a uint256 nonce from 32 random bytes and uses a short deadline", () => {
    const random = new Uint8Array(32);
    random[31] = 42;

    expect(prepareHeartbeatMessage(random, 1_000)).toEqual({
      nonce: 42n,
      deadline: 1_300n,
    });
  });

  it("rejects nonce sources that are not exactly 32 bytes", () => {
    expect(() => prepareHeartbeatMessage(new Uint8Array(16), 1_000)).toThrow(
      /32 random bytes/i,
    );
  });
});

describe("KeeperHub server response parsing", () => {
  it("extracts the webhook execution ID without trusting HTTP status alone", () => {
    expect(parseWebhookExecutionId({ executionId: "kh_webhook_1" })).toBe(
      "kh_webhook_1",
    );
    expect(() => parseWebhookExecutionId({ accepted: true })).toThrow(
      /execution ID/i,
    );
  });

  it("extracts terminal settlement evidence from get_execution", () => {
    expect(
      parseKeeperHubExecution({
        logs: {
          execution: {
            status: "success",
            transactionHashes: [{ hash: TX_HASH }],
            sponsored: true,
          },
        },
      }),
    ).toEqual({ status: "success", txHash: TX_HASH, sponsored: true });
  });

  it("reads sponsorship from the live KeeperHub execution output shape", () => {
    expect(
      parseKeeperHubExecution({
        logs: {
          execution: {
            status: "success",
            transactionHashes: [{ hash: TX_HASH }],
            output: { sponsored: true },
          },
        },
      }),
    ).toEqual({ status: "success", txHash: TX_HASH, sponsored: true });
  });

  it("reads the transaction hash from the live sponsored output shape", () => {
    expect(
      parseKeeperHubExecution({
        logs: {
          execution: {
            status: "success",
            output: { sponsored: true, transactionHash: TX_HASH },
          },
        },
      }),
    ).toEqual({ status: "success", txHash: TX_HASH, sponsored: true });
  });

  it("falls back to a successful write-step output when the execution omits its hash", () => {
    expect(
      parseKeeperHubExecution({
        logs: {
          execution: { status: "success", output: {} },
          logs: [
            {
              nodeId: "signed-write",
              status: "success",
              output: { sponsored: true, transactionHash: TX_HASH },
            },
          ],
        },
      }),
    ).toEqual({ status: "success", txHash: TX_HASH, sponsored: true });
  });

  it("keeps polling when success arrives before the transaction hash", async () => {
    vi.useFakeTimers();
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          logs: { execution: { status: "success", output: {} } },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          logs: {
            execution: {
              status: "success",
              output: { sponsored: true, transactionHash: TX_HASH },
            },
          },
        }),
      );
    const client = { callTool } as unknown as McpClient;

    const settlement = waitForKeeperHubSettlement(client, "kh_eventual");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(settlement).resolves.toEqual({
      status: "success",
      txHash: TX_HASH,
      sponsored: true,
    });
    expect(callTool).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
