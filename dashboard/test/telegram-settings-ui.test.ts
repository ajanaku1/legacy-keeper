import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Telegram settings UI", () => {
  it("exposes the approved linking and management states", () => {
    const panel = source("../components/telegram/TelegramLinkPanel.tsx");

    expect(panel).toContain('kind: "not-connected"');
    expect(panel).toContain('kind: "waiting-telegram"');
    expect(panel).toContain('kind: "waiting-signature"');
    expect(panel).toContain('kind: "connected"');
    expect(panel).toContain("Connect Telegram");
    expect(panel).toContain("Send test alert");
    expect(panel).toContain("Unlink Telegram");
    expect(panel).toContain("2-wallet free limit");
    expect(panel).toContain("Last successful alert");
  });

  it("keeps the header icon inside the app and the settings panel last", () => {
    const access = source("../components/telegram/TelegramAccessLink.tsx");
    const settings = source("../components/settings/PlanSettingsEditor.tsx");

    expect(access).toContain('href="/settings#telegram-notifications"');
    expect(access).not.toContain('target="_blank"');
    expect(settings.indexOf("<AdvancedSettings")).toBeLessThan(
      settings.indexOf("<TelegramLinkPanel"),
    );
  });

  it("keeps connected Telegram actions compact and accessible", () => {
    const panel = source("../components/telegram/TelegramLinkPanel.tsx");
    const styles = source("../app/globals.css");

    expect(panel).toContain('className="telegram-test-button"');
    expect(panel).toContain('className="telegram-unlink-button"');
    expect(panel).toContain('aria-label="Unlink Telegram"');
    expect(panel).toContain("<UnlinkIcon />");
    expect(styles).toMatch(/\.telegram-test-button\s*\{[^}]*min-width:/s);
    expect(styles).toMatch(/\.telegram-unlink-button\s*\{[^}]*width:\s*44px/s);
  });

  it("deduplicates a replayed signed test alert by its signed nonce", () => {
    const route = source("../app/api/telegram/test/route.ts");

    expect(route).toContain("test:${link.id}:${auth.nonce}");
    expect(route).not.toContain("randomUUID");
  });

  it("restores Telegram from an HTTP-only server session instead of tab storage", () => {
    const panel = source("../components/telegram/TelegramLinkPanel.tsx");
    const client = source("../lib/telegram-client.ts");
    const linksRoute = source("../app/api/telegram/links/route.ts");
    const unlinkRoute = source("../app/api/telegram/unlink/route.ts");

    expect(panel).toContain("restoreTelegramLink");
    expect(panel).not.toContain("sessionStorage");
    expect(panel).not.toContain("readTelegramPanelSession");
    expect(client).toContain('method: "GET"');
    expect(linksRoute).toContain("setTelegramSessionCookie");
    expect(linksRoute).toContain("readTelegramSessionCookie");
    expect(unlinkRoute).toContain("clearTelegramSessionCookie");
  });
});
