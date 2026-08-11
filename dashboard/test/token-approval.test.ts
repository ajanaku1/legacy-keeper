import { describe, expect, it } from "vitest";
import { tokenNeedsApproval } from "../lib/token-approval";

const asset = {
  address: "0x1111111111111111111111111111111111111111" as const,
  symbol: "USDC",
  decimals: 6,
  ownerBalance: 1_080_000_000n,
  availableBalance: 0n,
  distributed: false,
};

describe("tracked-token approval", () => {
  it("requests approval when an owner balance is not pullable", () => {
    expect(tokenNeedsApproval(asset)).toBe(true);
  });

  it("does not request approval for empty, fully available, or distributed assets", () => {
    expect(tokenNeedsApproval({ ...asset, ownerBalance: 0n })).toBe(false);
    expect(
      tokenNeedsApproval({ ...asset, availableBalance: asset.ownerBalance }),
    ).toBe(false);
    expect(tokenNeedsApproval({ ...asset, distributed: true })).toBe(false);
  });
});
