import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ConfigurationEvidence {
  network: { chainId: number; factory: string };
  authorization: { owner: string; plan: string; action: string };
  change: {
    before: { gracePeriod: number };
    after: { gracePeriod: number };
  };
  keeperHub: { executionId: string; sponsored: boolean };
  receipt: { transactionHash: string; status: string };
  event: { address: string; name: string; key: string };
  postState: { gracePeriod: string; authorizationNonceConsumed: boolean };
  verification: Record<string, boolean>;
}

describe("current-factory configuration evidence", () => {
  it("retains the conservative KeeperHub execution through resulting state", () => {
    const evidence = JSON.parse(
      readFileSync("reports/current-factory-configuration-evidence.json", "utf8"),
    ) as ConfigurationEvidence;

    expect(evidence.network.chainId).toBe(11_155_111);
    expect(evidence.authorization.action).toBe("SetLivenessConfig");
    expect(evidence.change.after.gracePeriod).toBeGreaterThan(
      evidence.change.before.gracePeriod,
    );
    expect(evidence.keeperHub.executionId).toBe("1bce3s44ha57dy1zg7t7z");
    expect(evidence.keeperHub.sponsored).toBe(true);
    expect(evidence.receipt.status).toBe("success");
    expect(evidence.event).toMatchObject({
      address: evidence.authorization.plan,
      name: "ConfigUpdated",
      key: "liveness_config",
    });
    expect(evidence.postState.gracePeriod).toBe("691200");
    expect(evidence.postState.authorizationNonceConsumed).toBe(true);
    expect(Object.values(evidence.verification).every(Boolean)).toBe(true);
  });

  it("exposes a deterministic live verifier for the retained proof ladder", () => {
    const source = readFileSync("verify.sh", "utf8");

    expect(source).toContain("live-configuration");
    expect(source).toContain("verify_live_configuration");
    expect(source).toContain("ConfigUpdated(string)");
    expect(source).toContain("actionNonceUsed(bytes32,uint256)");
    expect(source).toContain(
      "npm --prefix dashboard run test:e2e -- --workers=1",
    );
  });
});
