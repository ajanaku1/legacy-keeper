import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NATIVE_TX =
  "0xdc96cb02826a18982f4afc5701f59ef5f9155a5ea184e6e1b5292469ec7eec98";
const TOKEN_TX =
  "0x13d7dfa6523afac9095324171da254712de7ee3e1a29b6d55ec76e5e5a279cdd";

describe("current-factory inheritance evidence", () => {
  it("publishes both new receipts on the public product surface", () => {
    const landing = readFileSync(
      new URL("../components/landing/LandingPage.tsx", import.meta.url),
      "utf8",
    );

    expect(landing).toContain("Current-factory live proof");
    expect(landing).toContain(NATIVE_TX);
    expect(landing).toContain(TOKEN_TX);
    expect(landing).toContain("324 USDC + 756 USDC");
  });

  it("retains a machine-readable receipt, event, and post-state record", () => {
    const evidenceUrl = new URL(
      "../../reports/current-factory-inheritance-evidence.json",
      import.meta.url,
    );

    expect(existsSync(evidenceUrl)).toBe(true);
    if (!existsSync(evidenceUrl)) return;

    const evidence = readFileSync(evidenceUrl, "utf8");
    expect(evidence).toContain(NATIVE_TX);
    expect(evidence).toContain(TOKEN_TX);
    expect(evidence).toContain('"tokenDistributed": true');
    expect(evidence).toContain('"ownerBalance": "0"');
  });

  it("provides a live RPC verifier for the retained evidence", () => {
    const verifier = readFileSync(
      new URL("../../verify.sh", import.meta.url),
      "utf8",
    );

    expect(verifier).toContain("live-inheritance");
    expect(verifier).toContain("verify_live_inheritance");
  });
});
