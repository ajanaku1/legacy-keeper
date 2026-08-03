import { describe, expect, it } from "vitest";
import {
  resolveHeartbeatContract,
  webhookUrl,
} from "../../scripts/workflows/heartbeat-runner-utils";

describe("heartbeat workflow runner", () => {
  it("falls back to the deployed manifest contract", () => {
    expect(resolveHeartbeatContract(undefined, "0xmanifest")).toBe(
      "0xmanifest",
    );
  });

  it("prefers an explicit environment contract", () => {
    expect(resolveHeartbeatContract("0xenv", "0xmanifest")).toBe("0xenv");
  });

  it("targets the workflow-specific webhook endpoint", () => {
    expect(webhookUrl("heartbeat-workflow")).toBe(
      "https://app.keeperhub.com/api/workflows/heartbeat-workflow/webhook",
    );
  });
});
