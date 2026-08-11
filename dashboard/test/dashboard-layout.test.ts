import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard information hierarchy", () => {
  it("places check-in and its verification route before plan readiness", () => {
    const page = readFileSync(
      new URL("../app/(application)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );
    const heartbeat = page.indexOf("<HeartbeatPanel");
    const readiness = page.indexOf("<PlanReadiness");

    expect(heartbeat).toBeGreaterThan(-1);
    expect(readiness).toBeGreaterThan(-1);
    expect(heartbeat).toBeLessThan(readiness);
  });

  it("keeps a consistent gap before plan readiness", () => {
    const page = readFileSync(
      new URL("../app/(application)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(page).toMatch(
      /<section\s+className="ledger-card dashboard-readiness"/,
    );
    expect(styles).toMatch(
      /\.dashboard-readiness\s*\{[^}]*margin-top:\s*var\(--space-4\)/s,
    );
  });

  it("keeps tracked balances in the dashboard context instead of a new route", () => {
    const page = readFileSync(
      new URL("../app/(application)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );
    const assets = readFileSync(
      new URL("../components/TrackedAssets.tsx", import.meta.url),
      "utf8",
    );
    const navigation = readFileSync(
      new URL("../components/shell/Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(page).toContain("<TrackedAssets");
    expect(assets).toContain("Owner balance");
    expect(assets).toContain("Available to inherit");
    expect(navigation).not.toContain("/assets");
  });

  it("lets the owner sign a bounded token allowance for the plan", () => {
    const assets = readFileSync(
      new URL("../components/TrackedAssets.tsx", import.meta.url),
      "utf8",
    );

    expect(assets).toContain("Approve current balance");
    expect(assets).toContain('functionName: "approve"');
    expect(assets).toContain("args: [plan, asset.ownerBalance]");
    expect(assets).not.toContain("maxUint256");
  });

  it("replaces check-in controls with a clear inheritance outcome", () => {
    const page = readFileSync(
      new URL("../app/(application)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );
    const outcome = readFileSync(
      new URL("../components/InheritanceOutcome.tsx", import.meta.url),
      "utf8",
    );

    expect(page).toContain("<InheritanceOutcome");
    expect(outcome).toContain("Inheritance executed");
    expect(outcome).toContain("Token distributions");
    expect(outcome).toContain('href="/activity"');
    expect(page).toContain("recoveryEligibility(keeper, resolved)");
    expect(page).toMatch(
      /if \(keeper\.inheritanceExecuted\) return ["']Executed["']/,
    );
  });
});
