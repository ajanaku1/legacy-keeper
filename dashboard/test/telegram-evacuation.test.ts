import { describe, expect, it, vi } from "vitest";
import { executeSignedEvacuation, type EvacuationDependencies } from "../lib/evacuation-route";
import type { HeartbeatRequest } from "../lib/heartbeat-route";
import {
  createTelegramEvacuationEntry,
  verifyTelegramEvacuationEntry,
} from "../lib/telegram-evacuation";
import { createInMemoryTelegramRepository } from "../lib/telegram-repository";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PLAN = "0x2222222222222222222222222222222222222222" as const;
const RECOVERY = "0x3333333333333333333333333333333333333333" as const;
const WRONG_SIGNER = "0x4444444444444444444444444444444444444444" as const;
const NOW = new Date("2026-08-06T00:00:00.000Z");

async function linkedRepository() {
  const repository = createInMemoryTelegramRepository();
  await repository.createLinkSession({
    id: "linked-session",
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
  await repository.detectTelegramAccount("linked-session", {
    telegramUserId: "77",
    privateChatId: "7788",
    updatedAt: NOW,
  });
  await repository.activateLink({
    sessionId: "linked-session",
    telegramUserId: "77",
    plan: PLAN,
    now: NOW,
    walletLimit: 2,
  });
  return repository;
}

describe("Telegram-initiated recovery entry", () => {
  it("opens only a short-lived entry for an actively linked Telegram wallet", async () => {
    const repository = await linkedRepository();
    const [link] = await repository.listActiveLinks("77");
    const entry = createTelegramEvacuationEntry({
      telegramUserId: "77",
      link,
      secret: "telegram-action-secret",
      now: NOW,
      appUrl: "https://legacykeeper.test",
    });

    await expect(
      verifyTelegramEvacuationEntry(entry.token, {
        repository,
        secret: "telegram-action-secret",
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ owner: OWNER, plan: PLAN });
    expect(entry.url).toMatch(/^https:\/\/legacykeeper\.test\/recovery\/telegram\?entry=/);
  });

  it("still rejects a wrong signer before KeeperHub receives an evacuation", async () => {
    const request: HeartbeatRequest = {
      chainId: 11_155_111,
      owner: OWNER,
      plan: PLAN,
      nonce: "1",
      deadline: "1785974700",
      signature: "0xsig",
    };
    const submitToKeeperHub = vi.fn();
    const dependencies: EvacuationDependencies = {
      nowSeconds: () => 1_785_974_400,
      readRegisteredPlan: vi.fn(async () => PLAN),
      readOwner: vi.fn(async () => OWNER),
      readRecoveryState: vi.fn(async () => ({
        recoveryKey: RECOVERY,
        registered: true,
        evacuated: false,
      })),
      recoverSigner: vi.fn(async () => WRONG_SIGNER),
      nextIdempotencyKey: () => "evacuation-one",
      submitToKeeperHub,
      awaitSettlement: vi.fn(),
      verifyOnchain: vi.fn(),
    };

    await expect(
      executeSignedEvacuation(request, dependencies),
    ).rejects.toMatchObject({ code: "WRONG_SIGNER" });
    expect(submitToKeeperHub).not.toHaveBeenCalled();
  });
});
