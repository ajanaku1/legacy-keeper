import { describe, expect, it } from "vitest";

const OWNER = "0x1000000000000000000000000000000000000001" as const;
const NOW = new Date("2026-08-06T12:00:00.000Z");
const SECRET = "s".repeat(64);

describe("Telegram wallet session", () => {
  it("restores a wallet-bound session for seven days", async () => {
    const module = await import("../lib/telegram-wallet-session").catch(
      () => null,
    );
    expect(module).not.toBeNull();
    if (!module) return;

    const token = module.createTelegramWalletSession(
      { owner: OWNER, chainId: 11_155_111 },
      SECRET,
      NOW,
    );

    expect(
      module.readTelegramWalletSession(token, SECRET, NOW),
    ).toMatchObject({
      owner: OWNER,
      chainId: 11_155_111,
      issuedAt: Math.floor(NOW.getTime() / 1_000),
      expiresAt: Math.floor(NOW.getTime() / 1_000) + 7 * 24 * 60 * 60,
    });
  });

  it("rejects tampered, expired, and incorrectly signed sessions", async () => {
    const module = await import("../lib/telegram-wallet-session").catch(
      () => null,
    );
    expect(module).not.toBeNull();
    if (!module) return;
    const token = module.createTelegramWalletSession(
      { owner: OWNER, chainId: 11_155_111 },
      SECRET,
      NOW,
    );

    expect(
      module.readTelegramWalletSession(`${token}x`, SECRET, NOW),
    ).toBeUndefined();
    expect(
      module.readTelegramWalletSession(token, "x".repeat(64), NOW),
    ).toBeUndefined();
    expect(
      module.readTelegramWalletSession(
        token,
        SECRET,
        new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1_000 + 1),
      ),
    ).toBeUndefined();
  });

  it("defines a secure HTTP-only same-site cookie", async () => {
    const module = await import("../lib/telegram-wallet-session").catch(
      () => null,
    );
    expect(module).not.toBeNull();
    if (!module) return;

    expect(module.telegramSessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
  });
});
