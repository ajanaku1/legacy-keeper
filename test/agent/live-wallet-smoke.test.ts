import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live wallet-scoped smoke test", () => {
  it("uses an ephemeral owner without reading or printing a private key", () => {
    const source = readFileSync(
      "scripts/workflows/live-wallet-smoke.ts",
      "utf8",
    );

    expect(source).toContain("Wallet.createRandom()");
    expect(source).not.toContain("DEPLOYER_PRIVATE_KEY");
    expect(source).not.toMatch(/\.privateKey\b/);
  });

  it("creates a plan and heartbeat through wallet-scoped webhooks", () => {
    const source = readFileSync(
      "scripts/workflows/live-wallet-smoke.ts",
      "utf8",
    );

    expect(source).toContain("KEEPERHUB_PLAN_WORKFLOW_ID");
    expect(source).toContain("KEEPERHUB_HEARTBEAT_WORKFLOW_ID");
    expect(source).toContain("createPlanPayload");
    expect(source).toContain("heartbeatPayload");
    expect(source).toContain("planOf");
    expect(source).toContain("HeartbeatRecorded");
  });

  it("submits the heartbeat before running the final receipt audit", () => {
    const source = readFileSync(
      "scripts/workflows/live-wallet-smoke.ts",
      "utf8",
    );

    expect(source.indexOf("await relayHeartbeat")).toBeLessThan(
      source.indexOf("await verifyCreatedPlan"),
    );
  });

  it("accepts transaction evidence from a successful KeeperHub write-step log", () => {
    const source = readFileSync(
      "scripts/workflows/live-wallet-smoke.ts",
      "utf8",
    );

    expect(source).toContain("transactionHashFromSteps(logs.logs)");
    expect(source).toMatch(/if \(log\.status !== ["']success["']\) continue/);
  });
});
