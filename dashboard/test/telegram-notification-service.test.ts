import { describe, expect, it, vi } from "vitest";
import { createInMemoryTelegramRepository } from "../lib/telegram-repository";
import { createTelegramNotificationService } from "../lib/telegram-notification-service";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PLAN = "0x9999999999999999999999999999999999999999" as const;
const NOW = new Date("2026-08-06T00:00:00.000Z");

async function linkedRepository() {
  const repository = createInMemoryTelegramRepository();
  await repository.createLinkSession({
    id: "session",
    botTokenHash: "bot-hash",
    browserTokenHash: "browser-hash",
    owner: OWNER,
    chainId: 11_155_111,
    nonce: "nonce",
    deadline: "1785974700",
    expiresAt: new Date("2026-08-06T00:05:00.000Z"),
    state: "pending",
    createdAt: NOW,
  });
  await repository.detectTelegramAccount("session", {
    telegramUserId: "77",
    privateChatId: "7788",
    username: "keeper_user",
    updatedAt: NOW,
  });
  await repository.activateLink({
    sessionId: "session",
    telegramUserId: "77",
    plan: PLAN,
    now: NOW,
    walletLimit: 2,
  });
  return repository;
}

describe("wallet-scoped Telegram notification delivery", () => {
  it("sends once to the active recipient and deduplicates the event id", async () => {
    const repository = await linkedRepository();
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: true,
        status: 200,
      }),
    );
    const service = createTelegramNotificationService({
      repository,
      botToken: "bot-token",
      fetcher,
      now: () => NOW,
    });
    const event = {
      idempotencyKey: "event-1",
      source: "keeperhub" as const,
      eventType: "HeartbeatRecorded",
      chainId: 11_155_111,
      owner: OWNER,
      plan: PLAN,
      transactionHash: `0x${"a".repeat(64)}` as const,
    };

    await expect(service.deliver(event)).resolves.toBe("sent");
    await expect(service.deliver(event)).resolves.toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({
      chat_id: "7788",
    });
    await expect(
      repository.findLatestSentDelivery(OWNER, 11_155_111),
    ).resolves.toMatchObject({
      eventType: "HeartbeatRecorded",
      status: "sent",
    });
  });

  it("suppresses a delayed retry when the wallet was unlinked", async () => {
    const repository = await linkedRepository();
    const fetcher = vi
      .fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
        ok: true,
        status: 200,
      }))
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const service = createTelegramNotificationService({
      repository,
      botToken: "bot-token",
      fetcher,
      now: () => NOW,
    });
    const event = {
      idempotencyKey: "event-retry",
      source: "keeperhub" as const,
      eventType: "GraceElapsed",
      chainId: 11_155_111,
      owner: OWNER,
      plan: PLAN,
    };

    await expect(service.deliver(event)).resolves.toBe("failed");
    await repository.revokeLink({
      owner: OWNER,
      chainId: 11_155_111,
      telegramUserId: "77",
      now: new Date("2026-08-06T00:00:10.000Z"),
    });
    await expect(service.retry("event-retry")).resolves.toBe("suppressed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a failed idempotent event only after its bounded backoff", async () => {
    const repository = await linkedRepository();
    let now = NOW;
    const fetcher = vi
      .fn(async () => ({ ok: false, status: 429 }))
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const service = createTelegramNotificationService({
      repository,
      botToken: "bot-token",
      fetcher,
      now: () => now,
    });
    const event = {
      idempotencyKey: "event-backoff",
      source: "keeperhub" as const,
      eventType: "HeartbeatRecorded",
      chainId: 11_155_111,
      owner: OWNER,
      plan: PLAN,
    };

    await expect(service.deliver(event)).resolves.toBe("failed");
    await expect(service.deliver(event)).resolves.toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = new Date("2026-08-06T00:01:01.000Z");
    await expect(service.deliver(event)).resolves.toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
