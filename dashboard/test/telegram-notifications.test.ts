import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { notifyVerifiedAction } from "../lib/telegram-notifications";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PLAN = "0x3333333333333333333333333333333333333333" as const;
const TX_HASH = `0x${"a".repeat(64)}` as const;

describe("verified-action Telegram notifications", () => {
  it("routes a verified action through the repository-backed notifier", async () => {
    const deliver = vi.fn(async () => "sent" as const);
    await expect(
      notifyVerifiedAction(
        {
          action: "configurePlan",
          configurationAction: "liveness",
          owner: OWNER,
          plan: PLAN,
          txHash: TX_HASH,
        },
        { deliver },
      ),
    ).resolves.toBe("sent");
    expect(deliver).toHaveBeenCalledWith({
      idempotencyKey: `dashboard:configurePlan:${TX_HASH}`,
      source: "dashboard",
      eventType: "Timing updated",
      chainId: 11_155_111,
      owner: OWNER,
      plan: PLAN,
      transactionHash: TX_HASH,
    });
  });

  it("does not fail a verified action when Telegram delivery fails", async () => {
    const deliver = vi.fn(async () => "failed" as const);
    await expect(
      notifyVerifiedAction(
        {
          action: "heartbeatBySig",
          owner: OWNER,
          plan: PLAN,
          txHash: TX_HASH,
        },
        { deliver },
      ),
    ).resolves.toBe("failed");
  });

  it("wires Telegram after every verified dashboard transaction", () => {
    for (const route of [
      "../app/api/plans/route.ts",
      "../app/api/configuration/route.ts",
      "../app/api/heartbeat/route.ts",
      "../app/api/evacuation/route.ts",
    ]) {
      expect(readFileSync(new URL(route, import.meta.url), "utf8")).toContain(
        "notifyVerifiedAction",
      );
    }
  });
});
