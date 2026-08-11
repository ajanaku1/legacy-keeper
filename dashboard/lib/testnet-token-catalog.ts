import type { Address } from "viem";

export interface TestnetToken {
  chainId: 11155111;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  sourceUrl: string;
}

export const SEPOLIA_TOKEN_CATALOG: readonly TestnetToken[] = [
  {
    chainId: 11155111,
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    sourceUrl:
      "https://developers.circle.com/stablecoins/usdc-contract-addresses",
  },
  {
    chainId: 11155111,
    address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    symbol: "LINK",
    name: "Chainlink Token",
    decimals: 18,
    sourceUrl: "https://docs.chain.link/resources/link-token-contracts",
  },
  {
    chainId: 11155111,
    address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    sourceUrl:
      "https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts",
  },
];

export function searchSepoliaTokens(query: string): readonly TestnetToken[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SEPOLIA_TOKEN_CATALOG;
  return SEPOLIA_TOKEN_CATALOG.filter((token) =>
    [token.symbol, token.name, token.address].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}
