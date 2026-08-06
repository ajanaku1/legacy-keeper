import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWalletScopedWorkflows } from "../../workflows/wallet-scoped-definitions";

const FACTORY = "0x1111111111111111111111111111111111111111";

function configs(key: string): Record<string, unknown>[] {
  const workflow = buildWalletScopedWorkflows(FACTORY).find(
    (item) => item.key === key,
  );
  if (!workflow) throw new Error(`Missing workflow ${key}`);
  return workflow.nodes.map(
    (node) =>
      ((node.data as Record<string, unknown>).config ?? {}) as Record<
        string,
        unknown
      >,
  );
}

describe("wallet-scoped KeeperHub workflows", () => {
  it("has an explicit deploy mode that reads the factory address", () => {
    const source = readFileSync("scripts/workflows/deploy.ts", "utf8");
    expect(source).toContain("--wallet-scoped");
    expect(source).toContain("NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS");
    expect(source).toContain("buildWalletScopedWorkflows");
    expect(source).toContain("update_workflow_listing");
  });

  it("does not require a paid event callback for wallet-scoped deployment", () => {
    const source = readFileSync("scripts/workflows/deploy.ts", "utf8");

    expect(source).not.toContain("LEGACYKEEPER_KEEPERHUB_EVENT_URL");
    expect(source).not.toContain("KEEPERHUB_EVENTS_SECRET");
  });

  it("defines four signed write workflows", () => {
    expect(buildWalletScopedWorkflows(FACTORY).map(({ key }) => key)).toEqual([
      "plan-creation",
      "plan-configuration",
      "heartbeat-relay",
      "panic-evacuation",
    ]);
  });

  it("hard-binds plan creation to the deployed factory", () => {
    const write = configs("plan-creation").find(
      (config) => config.actionType === "web3/write-contract",
    );
    expect(write).toMatchObject({
      contractAddress: FACTORY,
      abiFunction: "createPlan",
      functionArgs: "{{@trigger-1:Plan Creation Webhook.functionArgs}}",
    });
  });

  it.each(["plan-configuration", "heartbeat-relay", "panic-evacuation"])(
    "%s re-resolves owner through the factory before writing to the supplied plan",
    (key) => {
      const nodes = configs(key);
      expect(nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionType: "web3/read-contract",
            contractAddress: FACTORY,
            abiFunction: "planOf",
          }),
          expect.objectContaining({
            actionType: "web3/write-contract",
            contractAddress: `{{@trigger-1:${triggerLabel(key)}.plan}}`,
            functionArgs: `{{@trigger-1:${triggerLabel(key)}.functionArgs}}`,
          }),
        ]),
      );
    },
  );

  it.each(["plan-configuration", "heartbeat-relay", "panic-evacuation"])(
    "%s compares the named planOf output to the supplied plan address",
    (key) => {
      const condition = configs(key).find(
        (config) => config.actionType === "Condition",
      );

      expect(condition?.condition).toContain(
        "{{@resolve-plan:Resolve Owner Plan.result.plan}}",
      );
      expect(condition?.condition).not.toContain('"{{');
    },
  );

  it("does not double-quote typed template values in action conditions", () => {
    const conditions = configs("plan-configuration")
      .filter((config) => config.actionType === "Condition")
      .map((config) => config.condition);

    expect(conditions).not.toEqual([]);
    expect(
      conditions.every((condition) => !String(condition).includes('"{{')),
    ).toBe(true);
  });

  it("routes each configuration action to a distinct signed contract function", () => {
    const functions = configs("plan-configuration")
      .filter((config) => config.actionType === "web3/write-contract")
      .map((config) => config.abiFunction);
    expect(functions).toEqual([
      "setBeneficiariesBySig",
      "setLivenessConfigBySig",
      "setRecoveryConfigBySig",
      "setTrackedTokensBySig",
    ]);
  });

  it("stays deployable on KeeperHub's free plan without HTTP Request actions", () => {
    for (const key of [
      "plan-configuration",
      "heartbeat-relay",
      "panic-evacuation",
    ]) {
      const requests = configs(key).filter(
        (config) => config.actionType === "HTTP Request",
      );
      expect(requests).toEqual([]);
    }
  });
});

function triggerLabel(key: string): string {
  if (key === "plan-configuration") return "Configuration Webhook";
  if (key === "heartbeat-relay") return "Heartbeat Webhook";
  return "Panic Webhook";
}
