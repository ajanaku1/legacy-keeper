import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  handleKeeperHubTelegramEvent,
  type KeeperHubTelegramEventDependencies,
} from "../lib/keeperhub-event-route";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PLAN = "0x9999999999999999999999999999999999999999" as const;
const TX_HASH = `0x${"a".repeat(64)}` as const;

function dependencies(
  overrides: Partial<KeeperHubTelegramEventDependencies> = {},
) {
  return {
    expectedSecret: "keeperhub-event-secret",
    readRegisteredPlan: vi.fn(async () => PLAN),
    verifyOnchainEvidence: vi.fn(async () => true),
    deliver: vi.fn(async () => "sent" as const),
    ...overrides,
  } satisfies KeeperHubTelegramEventDependencies;
}

const event = {
  eventId: "kh-event-1",
  eventType: "InheritanceExecuted",
  chainId: 11_155_111,
  owner: OWNER,
  plan: PLAN,
  transactionHash: TX_HASH,
};

describe("KeeperHub wallet-scoped Telegram event route", () => {
  it("rejects a missing or incorrect integration secret", async () => {
    await expect(
      handleKeeperHubTelegramEvent(event, "wrong-secret", dependencies()),
    ).rejects.toMatchObject({ code: "KEEPERHUB_EVENT_UNAUTHORIZED" });
  });

  it("rejects an event whose factory owner mapping or receipt evidence disagrees", async () => {
    const wrongPlan = dependencies({
      readRegisteredPlan: vi.fn(async () => OWNER),
    });
    await expect(
      handleKeeperHubTelegramEvent(event, "keeperhub-event-secret", wrongPlan),
    ).rejects.toMatchObject({ code: "KEEPERHUB_EVENT_PLAN_MISMATCH" });

    const badReceipt = dependencies({
      verifyOnchainEvidence: vi.fn(async () => false),
    });
    await expect(
      handleKeeperHubTelegramEvent(event, "keeperhub-event-secret", badReceipt),
    ).rejects.toMatchObject({ code: "KEEPERHUB_EVENT_UNVERIFIED" });
  });

  it("passes the dynamic event id as the delivery idempotency key", async () => {
    const deps = dependencies();
    await expect(
      handleKeeperHubTelegramEvent(
        event,
        "keeperhub-event-secret",
        deps,
      ),
    ).resolves.toEqual({ accepted: true, delivery: "sent" });
    expect(deps.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "kh-event-1",
        owner: OWNER,
        plan: PLAN,
        transactionHash: TX_HASH,
      }),
    );
  });

  it("requires a successful plan-addressed receipt with a plan event log", () => {
    const route = readFileSync(
      new URL("../app/api/integrations/keeperhub/events/route.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain('receipt.status === "success"');
    expect(route).toContain("sameAddress(receipt.to, event.plan)");
    expect(route).toContain(
      "receipt.logs.some((log) => sameAddress(log.address, event.plan))",
    );
  });
});
