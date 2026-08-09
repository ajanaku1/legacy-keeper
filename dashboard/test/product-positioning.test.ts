import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SHORT_POSITIONING = "Verifiable autonomous continuity agent";
const FULL_POSITIONING =
  "LegacyKeeper is a verifiable autonomous continuity agent that monitors wallet liveness, coordinates sponsored execution through KeeperHub, and proves every outcome onchain.";

function source(path: string): string {
  try {
    return readFileSync(new URL(path, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

describe("canonical product positioning", () => {
  it("defines one canonical short and full positioning statement", () => {
    const positioning = source("../lib/product-positioning.ts");

    expect(positioning).toContain(SHORT_POSITIONING);
    expect(positioning).toContain(FULL_POSITIONING);
    expect(positioning).toContain("LegacyKeeper — Autonomous Continuity Agent");
  });

  it("leads the public landing page with the approved autonomous-agent framing", () => {
    const landing = source("../components/landing/LandingPage.tsx");

    expect(landing).toContain("PRODUCT_POSITIONING.category");
    expect(landing).toContain("PRODUCT_POSITIONING.full");
  });

  it("carries the same framing into metadata and the wallet workspace", () => {
    const layout = source("../app/layout.tsx");
    const dashboard = source("../app/(application)/dashboard/page.tsx");

    expect(layout).toContain("PRODUCT_POSITIONING.title");
    expect(layout).toContain("PRODUCT_POSITIONING.full");
    expect(dashboard).toContain("PRODUCT_POSITIONING.category");
  });

  it("identifies the operational Telegram agent consistently", () => {
    const telegramWebhook = source("../lib/telegram-bot.ts");
    const agentBot = source("../../bot/index.ts");

    expect(telegramWebhook).toContain("PRODUCT_POSITIONING.category");
    expect(agentBot).toContain(SHORT_POSITIONING);
  });

  it("uses the approved framing in the repository and package description", () => {
    const readme = source("../../README.md");
    const packageJson = source("../../package.json");

    expect(readme).toContain(
      `**${SHORT_POSITIONING} for self-custodied wallets.**`,
    );
    expect(readme).toContain(FULL_POSITIONING);
    expect(packageJson).toContain(FULL_POSITIONING);
  });

  it("keeps AI authority claims out of canonical public positioning", () => {
    const publicCopy = [
      source("../components/landing/LandingPage.tsx"),
      source("../app/layout.tsx"),
      source("../../README.md"),
    ].join("\n");

    expect(publicCopy).not.toMatch(/AI[- ]powered|AI agent/i);
  });
});
