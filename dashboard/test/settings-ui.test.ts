import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("beneficiary register presentation", () => {
  it("uses centered ordinal markers instead of wallet characters", () => {
    const page = source("../app/(application)/beneficiaries/page.tsx");
    const css = source("../app/globals.css");

    expect(page).toContain("index + 1");
    expect(page).not.toContain("person.wallet.slice(2, 3)");
    expect(css).toMatch(/\.person-mark\s*{[^}]*display:\s*grid/s);
    expect(css).not.toMatch(/\.person-row span\s*{[^}]*display:\s*block/s);
    const marker = css.match(/\.person-mark\s*{([^}]*)\}/)?.[1] ?? "";
    expect(marker).not.toMatch(/border:/);
    expect(marker).toMatch(/background:\s*var\(--surface-raised\)/);
  });

  it("labels the two table columns and places capacity below the register", () => {
    const page = source("../app/(application)/beneficiaries/page.tsx");

    expect(page).toContain(">Beneficiaries</h2>");
    expect(page).toContain(">Allocation</span>");
    expect(page).not.toContain(">Current allocation</span>");
    expect(page).toContain('className="address-capacity"');
    expect(page.indexOf('className="address-capacity"')).toBeGreaterThan(
      page.lastIndexOf("</section>"),
    );
  });
});

describe("editable plan settings", () => {
  it("mounts a signed plan settings editor from the settings page", () => {
    const page = source("../app/(application)/settings/page.tsx");
    const editorPath = new URL(
      "../components/settings/PlanSettingsEditor.tsx",
      import.meta.url,
    );

    expect(existsSync(editorPath)).toBe(true);
    expect(page).toContain("<PlanSettingsEditor");
  });

  it("loads every editable value from the plan contract", () => {
    const keeper = source("../lib/useKeeper.ts");

    expect(keeper).toMatch(
      /interface KeeperState[\s\S]*heartbeatInterval: number/,
    );
    expect(keeper).toMatch(
      /interface KeeperState[\s\S]*trackedTokens: string\[\]/,
    );
    expect(keeper).toMatch(/functionName:\s*["']getTrackedTokens["']/);
  });

  it("uses a production configuration register with focused row editors", () => {
    const page = source("../app/(application)/settings/page.tsx");
    const editor = source("../components/settings/PlanSettingsEditor.tsx");

    expect(page).not.toContain('className="settings-grid"');
    expect(editor).toContain('className="settings-register"');
    expect(editor.match(/value: "/g)).toHaveLength(4);
    expect(editor).toContain("SECTIONS.map");
    expect(editor).toContain("Advanced plan changes");
    expect(editor).toContain("Review full plan");
    expect(editor).not.toContain("function SettingsActions");
    expect(editor).not.toContain("function SettingsTabs");
    expect(editor).not.toContain('role="tablist"');
  });

  it("keeps edit actions contextual and exposes signer requirements before editing", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");

    for (const label of ["Beneficiaries", "Timing", "Recovery", "Assets"]) {
      expect(editor).toContain(`title: "${label}"`);
    }
    expect(editor).toContain("Required signer");
    expect(editor).toContain("aria-label={`Edit ${item.title} settings`}");
  });

  it("renders every settings icon through one fixed green SVG system", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");
    const css = source("../app/globals.css");

    expect(editor).toContain("<SettingsIcon section={item.value} />");
    expect(editor).toContain('width="20"');
    expect(editor).toContain('height="20"');
    expect(editor).not.toMatch(/icon:\s*["']/);
    expect(css).toMatch(
      /\.settings-register-icon\s*{[^}]*color:\s*var\(--green\)/s,
    );
    expect(css).toMatch(
      /\.settings-register-icon svg\s*{[^}]*width:\s*20px[^}]*height:\s*20px/s,
    );
  });

  it("closes a completed editor into a persistent accessible success notice", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");

    expect(editor).toContain("<SettingsSuccessNotice");
    expect(editor).toContain('role="status"');
    expect(editor).toContain('aria-live="polite"');
    expect(editor).toContain("updated successfully");
    expect(editor).toContain("onVerified");
    expect(editor).toContain("setView(null)");
  });

  it("gives existing plan owners a dedicated Telegram notification entry", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");
    const panel = source("../components/telegram/TelegramLinkPanel.tsx");

    expect(editor).toContain("<TelegramLinkPanel />");
    expect(panel).toContain("Telegram alerts");
    expect(panel).toContain("Connect Telegram");
  });

  it("places full plan review before the final Telegram notification section", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");
    const review = editor.indexOf("<AdvancedSettings review={review} />");
    const telegram = editor.indexOf("<TelegramLinkPanel />");

    expect(review).toBeGreaterThan(-1);
    expect(telegram).toBeGreaterThan(review);
  });

  it("places a destructive stop-plan action at the end of settings", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");
    const telegram = editor.indexOf("<TelegramLinkPanel />");
    const danger = editor.indexOf("<DeletePlanSection");

    expect(danger).toBeGreaterThan(telegram);
    expect(editor).toContain("Stop plan");
    expect(editor).toContain("Stop this plan");
    expect(editor).toContain("Stopping plan…");
    expect(editor).toContain('STOP_PLAN_CONFIRMATION = "STOP"');
    expect(editor).toContain("Stopping the plan failed.");
    expect(editor).not.toContain('"Delete plan"');
    expect(editor).not.toContain("Delete this plan");
    expect(editor).not.toContain("Plan deletion failed.");
    expect(editor).toContain("<DeletePlanDialog");
  });

  it("requires explicit confirmation and accurately preserves onchain history", () => {
    const editor = source("../components/settings/PlanSettingsEditor.tsx");

    expect(editor).toContain('STOP_PLAN_CONFIRMATION = "STOP"');
    expect(editor).toContain(
      "Blockchain history and the factory registration remain onchain",
    );
    expect(editor).toContain('functionName: "toggleLiveness"');
    expect(editor).toContain("args: [false]");
  });

  it("exposes the owner-only liveness toggle through the dashboard ABI", () => {
    const contract = source("../lib/contract.ts");

    expect(contract).toMatch(
      /name:\s*['"]toggleLiveness['"][\s\S]*stateMutability:\s*['"]nonpayable['"][\s\S]*type:\s*['"]bool['"]/,
    );
  });

  it("uses Telegram blue only for Telegram controls and status", () => {
    const css = source("../app/globals.css").toLowerCase();
    const access = css.match(/\.telegram-access\s*\{([^}]*)\}/)?.[1] ?? "";
    const primary = css.match(/\.telegram-primary\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(css).toContain("--telegram: #229ed9");
    expect(access).toContain("color: var(--telegram)");
    expect(primary).toContain("background: var(--telegram)");
    expect(access).not.toContain("var(--green)");
    expect(primary).not.toContain("var(--green)");
  });

  it("renders the header Telegram link as a bare logo without button chrome", () => {
    const css = source("../app/globals.css").toLowerCase();
    const icon = css.match(/\.telegram-access-icon\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(icon).toContain("border: 0");
    expect(icon).toContain("background: transparent");
    expect(icon).not.toContain("border-radius");
  });
});
