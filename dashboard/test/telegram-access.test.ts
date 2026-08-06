import { describe, expect, it, vi } from "vitest";

async function moduleUnderTest() {
  return import("../lib/telegram-access");
}

describe("Telegram bot access", () => {
  it("builds a notification deep link from a configured bot username", async () => {
    const { resolveTelegramAccessUrl } = await moduleUnderTest();

    await expect(
      resolveTelegramAccessUrl({ TELEGRAM_BOT_USERNAME: "@LegacyKeeperBot" }),
    ).resolves.toBe("https://t.me/LegacyKeeperBot?start=notifications");
  });

  it("resolves the username through getMe without exposing the bot token", async () => {
    const { resolveTelegramAccessUrl } = await moduleUnderTest();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: { username: "LegacyKeeperBot" },
      }),
    }));

    const url = await resolveTelegramAccessUrl(
      { TELEGRAM_BOT_TOKEN: "super-secret-token" },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/botsuper-secret-token/getMe",
      expect.objectContaining({ method: "GET" }),
    );
    expect(url).toBe("https://t.me/LegacyKeeperBot?start=notifications");
    expect(url).not.toContain("super-secret-token");
  });

  it("returns no link when Telegram is unavailable or malformed", async () => {
    const { resolveTelegramAccessUrl } = await moduleUnderTest();
    const failedFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ ok: false }),
    }));

    await expect(resolveTelegramAccessUrl({})).resolves.toBeUndefined();
    await expect(
      resolveTelegramAccessUrl(
        { TELEGRAM_BOT_TOKEN: "token" },
        failedFetch,
      ),
    ).resolves.toBeUndefined();
  });
});
