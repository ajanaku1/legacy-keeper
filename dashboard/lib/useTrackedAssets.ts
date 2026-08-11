"use client";

import { useMemo } from "react";
import { erc20Abi, zeroAddress, type Address } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { legacyKeeperAbi } from "./contract";

const READS_PER_TOKEN = 5;

export interface TrackedAssetBalance {
  address: Address;
  symbol: string;
  decimals: number;
  ownerBalance: bigint;
  availableBalance: bigint;
  distributed: boolean;
}

export interface TrackedAssetState {
  planBalance: bigint;
  assets: TrackedAssetBalance[];
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useTrackedAssets(
  plan?: Address,
  owner?: string,
  trackedTokens: string[] = [],
): TrackedAssetState {
  const enabled = Boolean(plan && owner);
  const contracts = useMemo(
    () => tokenReadContracts(plan, owner, trackedTokens),
    [owner, plan, trackedTokens],
  );
  const native = useBalance({
    address: plan,
    query: { enabled: Boolean(plan), refetchInterval: 15_000 },
  });
  const tokenReads = useReadContracts({
    contracts,
    query: {
      enabled: enabled && trackedTokens.length > 0,
      refetchInterval: 15_000,
    },
  });

  return {
    planBalance: native.data?.value ?? 0n,
    assets: trackedTokens.map((token, index) =>
      assetFromReads(token as Address, index, tokenReads.data),
    ),
    loading: native.isLoading || tokenReads.isLoading,
    refetch: async () => {
      await Promise.all([native.refetch(), tokenReads.refetch()]);
    },
  };
}

function tokenReadContracts(
  plan: Address | undefined,
  owner: string | undefined,
  tokens: string[],
) {
  const planAddress = plan ?? zeroAddress;
  const ownerAddress = (owner ?? zeroAddress) as Address;
  return tokens.flatMap((token) =>
    tokenContracts(planAddress, ownerAddress, token as Address),
  );
}

function tokenContracts(plan: Address, owner: Address, token: Address) {
  return [
    { address: token, abi: erc20Abi, functionName: "symbol" },
    { address: token, abi: erc20Abi, functionName: "decimals" },
    {
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    },
    {
      address: plan,
      abi: legacyKeeperAbi,
      functionName: "pullableAmount",
      args: [token],
    },
    {
      address: plan,
      abi: legacyKeeperAbi,
      functionName: "tokenDistributed",
      args: [token],
    },
  ] as const;
}

function assetFromReads(
  address: Address,
  tokenIndex: number,
  reads: readonly { status: string; result?: unknown }[] | undefined,
): TrackedAssetBalance {
  const offset = tokenIndex * READS_PER_TOKEN;
  return {
    address,
    symbol: readResult<string>(reads, offset) ?? "TOKEN",
    decimals: Number(readResult<number>(reads, offset + 1) ?? 18),
    ownerBalance: readResult<bigint>(reads, offset + 2) ?? 0n,
    availableBalance: readResult<bigint>(reads, offset + 3) ?? 0n,
    distributed: Boolean(readResult<boolean>(reads, offset + 4)),
  };
}

function readResult<T>(
  reads: readonly { status: string; result?: unknown }[] | undefined,
  index: number,
): T | undefined {
  const read = reads?.[index];
  return read?.status === "success" ? (read.result as T) : undefined;
}
