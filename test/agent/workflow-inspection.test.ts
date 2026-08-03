import { describe, expect, it } from "vitest";
import { redactKeeperHubOutput } from "../../scripts/workflows/inspection-utils";

describe("KeeperHub inspection output", () => {
  it("redacts signed payloads and credentials recursively", () => {
    const result = redactKeeperHubOutput(
      JSON.stringify({
        input: { signature: "0xsigned" },
        config: { botToken: "secret-token" },
        transactionHash: "0xtx",
      }),
    );

    expect(result).not.toContain("0xsigned");
    expect(result).not.toContain("secret-token");
    expect(result).toContain("0xtx");
  });
});
