import { describe, expect, it } from "vitest";
import { confirmedRecoveryCountdown } from "../lib/liveness-countdown";

describe("confirmed recovery countdown", () => {
  it("never reports zero before Sepolia confirms the grace period elapsed", () => {
    expect(
      confirmedRecoveryCountdown({
        configuredDuration: 900,
        chainElapsed: 144,
        localTick: 900,
        graceElapsed: false,
      }),
    ).toBe(1);
  });

  it("reports zero once the on-chain grace flag is true", () => {
    expect(
      confirmedRecoveryCountdown({
        configuredDuration: 900,
        chainElapsed: 900,
        localTick: 0,
        graceElapsed: true,
      }),
    ).toBe(0);
  });

  it("uses the local tick only while it belongs to the current chain snapshot", () => {
    expect(
      confirmedRecoveryCountdown({
        configuredDuration: 900,
        chainElapsed: 600,
        localTick: 15,
        graceElapsed: false,
      }),
    ).toBe(285);
  });
});
