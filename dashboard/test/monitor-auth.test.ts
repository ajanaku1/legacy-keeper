import { describe, expect, it, vi } from "vitest";
import {
  authorizeInheritanceMonitor,
  type MonitorTokenVerifier,
} from "../lib/monitor-auth";

const VALID_CLAIMS = {
  repository: "ajanaku1/legacy-keeper",
  ref: "refs/heads/main",
  event_name: "schedule",
  sub: "repo:ajanaku1/legacy-keeper:ref:refs/heads/main",
  workflow_ref:
    "ajanaku1/legacy-keeper/.github/workflows/inheritance-monitor.yml@refs/heads/main",
};

function verifier(claims = VALID_CLAIMS): MonitorTokenVerifier {
  return vi.fn(async () => claims);
}

describe("inheritance monitor authentication", () => {
  it("accepts manual dispatch from the same pinned workflow", async () => {
    await expect(
      authorizeInheritanceMonitor(
        "Bearer short-lived-token",
        verifier({ ...VALID_CLAIMS, event_name: "workflow_dispatch" }),
      ),
    ).resolves.toBe(true);
  });

  it("accepts an environment-qualified subject for the pinned workflow", async () => {
    await expect(
      authorizeInheritanceMonitor(
        "Bearer short-lived-token",
        verifier({
          ...VALID_CLAIMS,
          sub: "repo:ajanaku1/legacy-keeper:environment:Production",
        }),
      ),
    ).resolves.toBe(true);
  });

  it("accepts GitHub subjects qualified by immutable owner and repository IDs", async () => {
    await expect(
      authorizeInheritanceMonitor(
        "Bearer short-lived-token",
        verifier({
          ...VALID_CLAIMS,
          sub: "repo:ajanaku1@139287249/legacy-keeper@1314409398:ref:refs/heads/main",
        }),
      ),
    ).resolves.toBe(true);
  });

  it("accepts a verified token only for the exact scheduled workflow on main", async () => {
    await expect(
      authorizeInheritanceMonitor("Bearer short-lived-token", verifier()),
    ).resolves.toBe(true);
  });

  it.each([
    ["repository", { repository: "attacker/fork" }],
    ["branch", { ref: "refs/heads/feature" }],
    ["event", { event_name: "pull_request" }],
    [
      "workflow",
      {
        workflow_ref:
          "ajanaku1/legacy-keeper/.github/workflows/other.yml@refs/heads/main",
      },
    ],
  ])("rejects a token with the wrong %s claim", async (_name, override) => {
    await expect(
      authorizeInheritanceMonitor(
        "Bearer short-lived-token",
        verifier({ ...VALID_CLAIMS, ...override }),
      ),
    ).resolves.toBe(false);
  });

  it("rejects malformed authorization without invoking token verification", async () => {
    const verify = verifier();

    await expect(
      authorizeInheritanceMonitor("Basic credentials", verify),
    ).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects signature or issuer verification failures", async () => {
    const verify: MonitorTokenVerifier = vi.fn(async () => {
      throw new Error("signature invalid");
    });

    await expect(
      authorizeInheritanceMonitor("Bearer forged-token", verify),
    ).resolves.toBe(false);
  });
});
