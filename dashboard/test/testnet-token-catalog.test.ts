import { describe, expect, it } from "vitest";
import {
  SEPOLIA_TOKEN_CATALOG,
  searchSepoliaTokens,
} from "../lib/testnet-token-catalog";

describe("Sepolia token catalog", () => {
  it("contains only the curated Sepolia assets", () => {
    expect(SEPOLIA_TOKEN_CATALOG).toEqual([
      expect.objectContaining({
        symbol: "USDC",
        address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        decimals: 6,
      }),
      expect.objectContaining({
        symbol: "LINK",
        address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
        decimals: 18,
      }),
      expect.objectContaining({
        symbol: "WETH",
        address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
        decimals: 18,
      }),
    ]);
    expect(
      SEPOLIA_TOKEN_CATALOG.every((token) => token.chainId === 11155111),
    ).toBe(true);
  });

  it("searches by symbol, name, or contract address without case sensitivity", () => {
    expect(searchSepoliaTokens("usd").map((token) => token.symbol)).toEqual([
      "USDC",
    ]);
    expect(
      searchSepoliaTokens("chainlink").map((token) => token.symbol),
    ).toEqual(["LINK"]);
    expect(searchSepoliaTokens("FFF997").map((token) => token.symbol)).toEqual([
      "WETH",
    ]);
  });

  it("returns the popular assets when the search is empty", () => {
    expect(searchSepoliaTokens("")).toEqual(SEPOLIA_TOKEN_CATALOG);
  });
});
