import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("wallet connection hydration", () => {
  it("only reconnects on mount when the server restored persisted wallet state", () => {
    const providers = source("../app/providers.tsx");

    expect(providers).toContain("reconnectOnMount={Boolean(initialState)}");
  });

  it("uses Wagmi reconnecting state instead of a post-render mounted flag", () => {
    const shell = source("../components/shell/ApplicationShell.tsx");

    expect(shell).toContain('account.status === "reconnecting"');
    expect(shell).not.toContain("setMounted(true)");
  });

  it("never renders the connect-wallet surface while restoring", () => {
    const gate = source("../components/wallet/WalletAccessGate.tsx");

    expect(gate).toContain("wallet-restoring-shell");
    expect(gate.indexOf("if (restoring)")).toBeLessThan(
      gate.indexOf('className="access-gate"'),
    );
  });
});
