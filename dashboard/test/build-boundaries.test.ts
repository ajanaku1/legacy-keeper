import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legacyKeeperAbi } from "../lib/contract";

const files = [
  "app/providers.tsx",
  "components/HeartbeatPanel.tsx",
  "components/PanicCard.tsx",
  "app/api/heartbeat/route.ts",
  "app/api/evacuation/route.ts",
];

describe("dashboard production imports", () => {
  it("keeps indexed keeper reads stable when the shared ABI grows", () => {
    const functions = legacyKeeperAbi
      .filter((item) => item.type === "function")
      .map((item) => item.name);

    expect(functions.slice(0, 9)).toEqual([
      "owner",
      "getLivenessStatus",
      "getTimeoutStatus",
      "liveness",
      "vault",
      "getBeneficiaries",
      "totalShareBps",
      "inheritanceExecuted",
      "evacuationExecuted",
    ]);
  });

  it("does not pull optional connector and chain barrels into the bundle", () => {
    for (const file of files) {
      const source = readFileSync(
        new URL(`../${file}`, import.meta.url),
        "utf8",
      );
      expect(source).not.toContain("from 'wagmi/connectors'");
      expect(source).not.toContain("from 'viem/chains'");
    }
  });

  it("keeps public chain evidence visible before wallet connection", () => {
    const source = readFileSync(
      new URL("../app/page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("if (!account.isConnected)");
  });

  it("hydrates wallet storage from the request cookie before rendering", () => {
    const config = readFileSync(
      new URL("../lib/wagmi-config.ts", import.meta.url),
      "utf8",
    );
    const layout = readFileSync(
      new URL("../app/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(config).toContain("cookieStorage");
    expect(config).toContain("ssr: true");
    expect(config).not.toContain("window.localStorage");
    expect(layout).toContain("cookieToInitialState");
    expect(layout).toContain('(await headers()).get("cookie")');
  });

  it("loads server-only KeeperHub settings from the repository environment", () => {
    const source = readFileSync(
      new URL("../next.config.mjs", import.meta.url),
      "utf8",
    );

    expect(source).toContain("import nextEnv from '@next/env'");
    expect(source).toContain("const { loadEnvConfig } = nextEnv");
    expect(source).toMatch(
      /const projectRoot = .*new URL\('\.\.', import\.meta\.url\)/,
    );
    expect(source).toContain("loadEnvConfig(projectRoot)");
  });
});
