import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../app/api/telegram/links/route";

const ORIGINAL_SESSION_SECRET = process.env.TELEGRAM_SESSION_SECRET;

afterEach(() => {
  if (ORIGINAL_SESSION_SECRET === undefined) {
    delete process.env.TELEGRAM_SESSION_SECRET;
  } else {
    process.env.TELEGRAM_SESSION_SECRET = ORIGINAL_SESSION_SECRET;
  }
});

describe("Telegram link restore route", () => {
  it("fails closed without a wallet session and disables response caching", async () => {
    process.env.TELEGRAM_SESSION_SECRET = "s".repeat(64);
    const request = new NextRequest(
      "https://legacykeeper.test/api/telegram/links?owner=0x1000000000000000000000000000000000000001&chainId=11155111",
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "TELEGRAM_SESSION_REQUIRED",
      message: "Verify wallet ownership to continue.",
    });
  });
});
