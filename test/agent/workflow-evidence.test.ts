import { describe, expect, it } from "vitest";
import { keeperHubRunId } from "../../scripts/workflows/evidence-utils";

describe("KeeperHub workflow evidence identity", () => {
  it("uses the scheduler dispatch key when KeeperHub omits runId", () => {
    expect(
      keeperHubRunId({
        runId: null,
        dispatchKey: "block:workflow:11155111:11399800",
      }),
    ).toBe("block:workflow:11155111:11399800");
  });

  it("prefers the execution runId when one is present", () => {
    expect(
      keeperHubRunId({ runId: "wrun_123", dispatchKey: "schedule:workflow:1" }),
    ).toBe("wrun_123");
  });

  it("uses the immutable execution ID for event runs without dispatch metadata", () => {
    expect(
      keeperHubRunId({ runId: null, dispatchKey: null, id: "exec_event_123" }),
    ).toBe("exec_event_123");
  });
});
