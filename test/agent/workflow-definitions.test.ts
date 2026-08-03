import { describe, expect, it } from "vitest";
import { buildWorkflows } from "../../workflows/definitions";

const CONTRACT = "0x0000000000000000000000000000000000000001";

function triggerConfig(workflowKey: string): Record<string, unknown> {
  const workflow = buildWorkflows(CONTRACT, "123456789").find(
    (candidate) => candidate.key === workflowKey,
  );
  const trigger = workflow?.nodes.find((node) => node.type === "trigger");
  const data = trigger?.data as Record<string, unknown> | undefined;
  return (data?.config ?? {}) as Record<string, unknown>;
}

describe("KeeperHub workflow definitions", () => {
  it("covers every required automatic trigger", () => {
    const triggerTypes = buildWorkflows(CONTRACT, "123456789").flatMap(
      (workflow) => {
        const config = triggerConfig(workflow.key);
        return typeof config.triggerType === "string"
          ? [config.triggerType]
          : [];
      },
    );

    expect(new Set(triggerTypes)).toEqual(
      new Set(["Schedule", "Webhook", "Event", "Block"]),
    );
  });

  it("watches an event that LegacyKeeper actually emits", () => {
    const config = triggerConfig("grace-watch");

    expect(config.eventName).toBe("HeartbeatRecorded");
    expect(String(config.contractABI)).toContain("HeartbeatRecorded");
  });

  it("guards automatic inheritance actions after distribution is complete", () => {
    for (const key of ["liveness-monitor", "block-health"]) {
      const workflow = buildWorkflows(CONTRACT, "123456789").find(
        (candidate) => candidate.key === key,
      );
      const configs = workflow?.nodes.map((node) => {
        const data = node.data as Record<string, unknown>;
        return data.config as Record<string, unknown>;
      });

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ abiFunction: "inheritanceExecuted" }),
        ]),
      );
      expect(
        configs?.some((config) =>
          String(config.condition ?? "").includes("Inheritance State"),
        ),
      ).toBe(true);
    }
  });

  it("binds every Telegram action to the configured KeeperHub integration", () => {
    const workflows = buildWorkflows(CONTRACT, "123456789", "telegram-int-1");
    const telegramConfigs = workflows.flatMap((workflow) =>
      workflow.nodes.flatMap((node) => {
        const data = node.data as Record<string, unknown>;
        const config = data.config as Record<string, unknown>;
        return config.actionType === "telegram/send-message" ? [config] : [];
      }),
    );

    expect(telegramConfigs.length).toBeGreaterThan(0);
    expect(
      telegramConfigs.every(
        (config) => config.integrationId === "telegram-int-1",
      ),
    ).toBe(true);
  });
});
