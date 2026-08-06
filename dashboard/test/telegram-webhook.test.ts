import { describe, expect, it, vi } from "vitest";
import {
  assertTelegramWebhookSecret,
  handleTelegramUpdate,
  type TelegramBotDependencies,
} from "../lib/telegram-bot";

function fixture(overrides: Partial<TelegramBotDependencies> = {}) {
  const dependencies: TelegramBotDependencies = {
    attachTelegramIdentity: vi.fn(async () => undefined),
    listWallets: vi.fn(async () => []),
    readPlanStatus: vi.fn(async () => ({
      lastHeartbeat: 1_786_003_200,
      timeoutExceeded: false,
      graceElapsed: false,
    })),
    unlinkWallet: vi.fn(async () => undefined),
    createEvacuationEntry: vi.fn(
      async () => "https://legacykeeper.test/recovery/telegram?id=one",
    ),
    createUnlinkAction: vi.fn(async () => "opaque-unlink-action"),
    consumeUnlinkAction: vi.fn(
      async (_telegramUserId: string, _actionId: string) => ({
        id: "link-one",
        owner: "0x1111111111111111111111111111111111111111" as const,
        chainId: 11_155_111,
        telegramUserId: "77",
        plan: "0x9999999999999999999999999999999999999999" as const,
        linkedAt: new Date("2026-08-06T00:00:00.000Z"),
      }),
    ),
    sendMessage: vi.fn(async () => undefined),
    ...overrides,
  };
  return dependencies;
}

describe("Telegram webhook security and commands", () => {
  it("rejects an invalid Telegram webhook secret", () => {
    expect(() =>
      assertTelegramWebhookSecret("wrong", "expected-secret"),
    ).toThrow(/secret/i);
  });

  it("accepts the exact secret without leaking comparison details", () => {
    expect(() =>
      assertTelegramWebhookSecret("expected-secret", "expected-secret"),
    ).not.toThrow();
  });

  it("refuses wallet linking outside a private chat", async () => {
    const deps = fixture();
    await handleTelegramUpdate(
      {
        update_id: 1,
        message: {
          text: "/start opaque-link-token",
          chat: { id: -1001, type: "group" },
          from: { id: 77, username: "keeper_user" },
        },
      },
      deps,
    );

    expect(deps.attachTelegramIdentity).not.toHaveBeenCalled();
    expect(deps.sendMessage).toHaveBeenCalledWith(
      -1001,
      expect.stringMatching(/private chat/i),
      undefined,
    );
  });

  it("attaches immutable Telegram identity from a private /start command", async () => {
    const deps = fixture();
    await handleTelegramUpdate(
      {
        update_id: 2,
        message: {
          text: "/start opaque-link-token",
          chat: { id: 7788, type: "private" },
          from: { id: 77, username: "keeper_user", first_name: "Keeper" },
        },
      },
      deps,
    );

    expect(deps.attachTelegramIdentity).toHaveBeenCalledWith({
      token: "opaque-link-token",
      chatType: "private",
      telegramUserId: "77",
      privateChatId: "7788",
      username: "keeper_user",
      firstName: "Keeper",
    });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      7788,
      expect.stringMatching(/return to LegacyKeeper/i),
      undefined,
    );
  });

  it.each(["/wallets", "/status", "/evacuate", "/unlink", "/help"])(
    "handles the %s command only for the Telegram user who sent it",
    async (command) => {
      const deps = fixture();
      await handleTelegramUpdate(
        {
          update_id: 3,
          message: {
            text: command,
            chat: { id: 7788, type: "private" },
            from: { id: 77 },
          },
        },
        deps,
      );

      expect(deps.sendMessage).toHaveBeenCalledWith(
        7788,
        expect.any(String),
        expect.anything(),
      );
    },
  );

  it("acknowledges an expired or replayed unlink callback without retrying it", async () => {
    const deps = fixture({
      consumeUnlinkAction: vi.fn(async () => {
        throw new Error("expired or already used");
      }),
    });

    await expect(
      handleTelegramUpdate(
        {
          update_id: 4,
          callback_query: {
            id: "callback-1",
            data: "unlink:expired-action",
            from: { id: 77 },
            message: { chat: { id: 7788, type: "private" } },
          },
        },
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(deps.unlinkWallet).not.toHaveBeenCalled();
    expect(deps.sendMessage).toHaveBeenCalledWith(
      7788,
      expect.stringMatching(/expired|already used/i),
      {},
    );
  });

  it("reads onchain liveness for /status instead of reporting a static link", async () => {
    const link = await fixture().consumeUnlinkAction("77", "action");
    const deps = fixture({ listWallets: vi.fn(async () => [link]) });

    await handleTelegramUpdate(
      {
        update_id: 5,
        message: {
          text: "/status",
          chat: { id: 7788, type: "private" },
          from: { id: 77 },
        },
      },
      deps,
    );

    expect(deps.readPlanStatus).toHaveBeenCalledWith(link);
    expect(deps.sendMessage).toHaveBeenCalledWith(
      7788,
      expect.stringMatching(/last check-in|recovery/i),
      {},
    );
  });
});
