import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildConfigurationRequest,
  submitConfiguration,
} from "../lib/configuration-client";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PLAN = "0x2222222222222222222222222222222222222222" as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configuration client", () => {
  it("exposes the signed configuration request boundary", async () => {
    const client = await import("../lib/configuration-client").catch(
      () => ({}),
    );

    expect(client).toMatchObject({
      buildConfigurationRequest: expect.any(Function),
      submitConfiguration: expect.any(Function),
    });
  });

  it("builds an expiring request for one exact configuration action", () => {
    const request = buildConfigurationRequest(
      {
        chainId: 11155111,
        owner: OWNER,
        plan: PLAN,
        action: "liveness",
        payload: {
          heartbeatInterval: 86_400,
          timeoutDuration: 30 * 86_400,
          gracePeriod: 7 * 86_400,
        },
      },
      42n,
      1_000,
    );

    expect(request).toEqual({
      chainId: 11155111,
      owner: OWNER,
      plan: PLAN,
      action: "liveness",
      payload: {
        heartbeatInterval: 86_400,
        timeoutDuration: 30 * 86_400,
        gracePeriod: 7 * 86_400,
      },
      nonce: "42",
      deadline: "1300",
      signature: "0x",
    });
  });

  it("accepts only verified configuration evidence from the API", async () => {
    const request = buildConfigurationRequest(
      {
        chainId: 11155111,
        owner: OWNER,
        plan: PLAN,
        action: "trackedTokens",
        payload: { tokens: [] },
      },
      42n,
      1_000,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          stage: "verified",
          action: "trackedTokens",
          executionId: "kh_config_1",
          idempotencyKey: "attempt-1",
          txHash: `0x${"a".repeat(64)}`,
          sponsored: true,
          receiptStatus: "success",
          event: "TrackedTokensUpdated",
          plan: PLAN,
        }),
      }),
    );

    await expect(submitConfiguration(request)).resolves.toMatchObject({
      stage: "verified",
      action: "trackedTokens",
      plan: PLAN,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/configuration",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("turns a wrong signer response into an actionable wallet message", async () => {
    const request = buildConfigurationRequest(
      {
        chainId: 11155111,
        owner: OWNER,
        plan: PLAN,
        action: "recovery",
        payload: {
          recoveryKey: OWNER,
          safeVault: PLAN,
          allowSharedRecovery: false,
        },
      },
      42n,
      1_000,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ stage: "failed", code: "WRONG_SIGNER" }),
      }),
    );

    await expect(submitConfiguration(request)).rejects.toThrow(
      "Use the required signing wallet",
    );
  });
});
