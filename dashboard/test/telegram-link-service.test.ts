import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  createTelegramLinkService,
  telegramLinkTypedData,
  telegramActionTypedData,
  telegramUnlinkTypedData,
  walletLimitForTelegramUser,
} from "../lib/telegram-link-service";
import { createInMemoryTelegramRepository } from "../lib/telegram-repository";

const CHAIN_ID = 11_155_111;
const PLAN = "0x9999999999999999999999999999999999999999" as const;
const NOW = new Date("2026-08-06T00:00:00.000Z");
const accounts = [
  privateKeyToAccount(`0x${"1".repeat(64)}`),
  privateKeyToAccount(`0x${"2".repeat(64)}`),
  privateKeyToAccount(`0x${"3".repeat(64)}`),
];

function fixture() {
  let token = 0;
  const repository = createInMemoryTelegramRepository();
  const service = createTelegramLinkService({
    repository,
    now: () => NOW,
    randomToken: () => `opaque-token-${++token}-${"x".repeat(32)}`,
    readRegisteredPlan: async () => PLAN,
  });
  return { repository, service };
}

async function linkWallet(
  service: ReturnType<typeof createTelegramLinkService>,
  account: (typeof accounts)[number],
  telegramUserId = "44112233",
) {
  const session = await service.createLinkSession({
    owner: account.address,
    chainId: CHAIN_ID,
  });
  await service.attachTelegramIdentity({
    token: session.botToken,
    chatType: "private",
    telegramUserId,
    privateChatId: telegramUserId,
    username: "keeper_user",
  });
  const detected = await service.getLinkSession(
    session.sessionId,
    session.browserToken,
  );
  const request = {
    sessionId: session.sessionId,
    owner: account.address,
    chainId: CHAIN_ID,
    telegramUserId,
    nonce: session.nonce,
    deadline: session.deadline,
  };
  const signature = await account.signTypedData(telegramLinkTypedData(request));
  return service.linkWallet({ ...request, signature });
}

describe("Telegram wallet linking", () => {
  it("keeps the free monitoring limit at 2 without payment state", () => {
    expect(walletLimitForTelegramUser()).toBe(2);
  });

  it("links two wallets and rejects the third wallet at the limit of 2", async () => {
    const { service } = fixture();

    await linkWallet(service, accounts[0]);
    await linkWallet(service, accounts[1]);
    await expect(linkWallet(service, accounts[2])).rejects.toMatchObject({
      code: "TELEGRAM_WALLET_LIMIT",
    });

    await expect(service.listWallets("44112233")).resolves.toHaveLength(2);
  });

  it("consumes a link session exactly once and rejects signature replay", async () => {
    const { service } = fixture();
    const account = accounts[0];
    const session = await service.createLinkSession({
      owner: account.address,
      chainId: CHAIN_ID,
    });
    await service.attachTelegramIdentity({
      token: session.botToken,
      chatType: "private",
      telegramUserId: "44112233",
      privateChatId: "44112233",
    });
    const request = {
      sessionId: session.sessionId,
      owner: account.address,
      chainId: CHAIN_ID,
      telegramUserId: "44112233",
      nonce: session.nonce,
      deadline: session.deadline,
    };
    const signature = await account.signTypedData(
      telegramLinkTypedData(request),
    );

    await expect(
      service.linkWallet({ ...request, signature }),
    ).resolves.toMatchObject({
      owner: account.address.toLowerCase(),
      telegramUserId: "44112233",
    });
    await expect(
      service.linkWallet({ ...request, signature }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_SESSION_CONSUMED",
    });
  });

  it("treats a repeated private /start delivery as the same detected identity", async () => {
    const { service } = fixture();
    const session = await service.createLinkSession({
      owner: accounts[0].address,
      chainId: CHAIN_ID,
    });
    const identity = {
      token: session.botToken,
      chatType: "private",
      telegramUserId: "44112233",
      privateChatId: "44112233",
    };

    await expect(
      service.attachTelegramIdentity(identity),
    ).resolves.toMatchObject({
      state: "detected",
      telegramUserId: "44112233",
    });
    await expect(
      service.attachTelegramIdentity(identity),
    ).resolves.toMatchObject({
      state: "detected",
      telegramUserId: "44112233",
    });
  });

  it("rejects a signer that does not own the wallet named by the session", async () => {
    const { service } = fixture();
    const session = await service.createLinkSession({
      owner: accounts[0].address,
      chainId: CHAIN_ID,
    });
    await service.attachTelegramIdentity({
      token: session.botToken,
      chatType: "private",
      telegramUserId: "44112233",
      privateChatId: "44112233",
    });
    const request = {
      sessionId: session.sessionId,
      owner: accounts[0].address,
      chainId: CHAIN_ID,
      telegramUserId: "44112233",
      nonce: session.nonce,
      deadline: session.deadline,
    };
    const signature = await accounts[1].signTypedData(
      telegramLinkTypedData(request),
    );

    await expect(
      service.linkWallet({ ...request, signature }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WRONG_SIGNER",
    });
  });

  it("unlinks from Telegram and immediately frees one wallet slot", async () => {
    const { service } = fixture();
    await linkWallet(service, accounts[0]);
    await linkWallet(service, accounts[1]);

    await service.unlinkFromTelegram({
      telegramUserId: "44112233",
      owner: accounts[0].address,
      chainId: CHAIN_ID,
    });

    await expect(linkWallet(service, accounts[2])).resolves.toMatchObject({
      owner: accounts[2].address.toLowerCase(),
    });
  });

  it("requires the linked owner signature for dashboard unlinking", async () => {
    const { service } = fixture();
    const link = await linkWallet(service, accounts[0]);
    const request = {
      linkId: link.id,
      owner: accounts[0].address,
      chainId: CHAIN_ID,
      nonce: "unlink-nonce",
      deadline: String(Math.floor(NOW.getTime() / 1_000) + 300),
    };
    const wrongSignature = await accounts[1].signTypedData(
      telegramUnlinkTypedData(request),
    );
    await expect(
      service.unlinkFromDashboard({ ...request, signature: wrongSignature }),
    ).rejects.toMatchObject({ code: "TELEGRAM_WRONG_SIGNER" });

    const signature = await accounts[0].signTypedData(
      telegramUnlinkTypedData(request),
    );
    await expect(
      service.unlinkFromDashboard({ ...request, signature }),
    ).resolves.toEqual({ unlinked: true });
  });

  it("requires owner authentication before exposing linked Telegram metadata", async () => {
    const { service } = fixture();
    const link = await linkWallet(service, accounts[0]);
    const request = {
      action: "status" as const,
      linkId: link.id,
      owner: accounts[0].address,
      chainId: CHAIN_ID,
      nonce: "status-nonce",
      deadline: String(Math.floor(NOW.getTime() / 1_000) + 300),
    };
    const signature = await accounts[0].signTypedData(
      telegramActionTypedData(request),
    );

    await expect(
      service.authenticateDashboardAction({ ...request, signature }),
    ).resolves.toMatchObject({ id: link.id, telegramUserId: "44112233" });
  });

  it("restores an active link after server session authentication", async () => {
    const { service } = fixture();
    const link = await linkWallet(service, accounts[0]);

    await expect(
      service.restoreWalletAccess({
        owner: accounts[0].address,
        chainId: CHAIN_ID,
      }),
    ).resolves.toMatchObject({
      id: link.id,
      telegramUserId: "44112233",
    });
  });
});
