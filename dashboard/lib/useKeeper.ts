"use client";

import { useReadContracts } from "wagmi";
import { useEffect, useState } from "react";
import { type Address } from "viem";
import { legacyKeeperAbi } from "./contract";
import { confirmedRecoveryCountdown } from "./liveness-countdown";

export interface Beneficiary {
  wallet: string;
  shareBps: number;
}

export interface KeeperState {
  loading: boolean;
  configured: boolean;
  owner?: string;
  lastHeartbeat: number;
  timeSinceHeartbeat: number;
  heartbeatInterval: number;
  timeoutDuration: number;
  gracePeriod: number;
  livenessActive: boolean;
  timeoutExceeded: boolean;
  graceElapsed: boolean;
  inheritanceExecuted: boolean;
  inheritanceTimestamp: number;
  evacuationExecuted: boolean;
  safeVault?: string;
  recoveryKey?: string;
  recoveryKeyRegistered: boolean;
  privateRoutingEnabled: boolean;
  beneficiaries: Beneficiary[];
  totalShareBps: number;
  trackedTokens: string[];
  /** Live-ticking seconds until distribution becomes callable. */
  secondsUntilDue: number;
  refetch: () => void;
}

export function useKeeper(planAddress?: Address): KeeperState {
  const contract = { address: planAddress, abi: legacyKeeperAbi } as const;
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { ...contract, functionName: "owner" },
      { ...contract, functionName: "getLivenessStatus" },
      { ...contract, functionName: "getTimeoutStatus" },
      { ...contract, functionName: "liveness" },
      { ...contract, functionName: "vault" },
      { ...contract, functionName: "getBeneficiaries" },
      { ...contract, functionName: "totalShareBps" },
      { ...contract, functionName: "inheritanceExecuted" },
      { ...contract, functionName: "evacuationExecuted" },
      { ...contract, functionName: "getTrackedTokens" },
      { ...contract, functionName: "inheritanceTimestamp" },
    ],
    query: { enabled: Boolean(planAddress), refetchInterval: 15_000 },
  });

  const read = <T>(i: number): T | undefined =>
    data?.[i]?.status === "success" ? (data[i].result as T) : undefined;

  const status = read<readonly [bigint, bigint, boolean, boolean]>(1);
  const timeout = read<readonly [boolean, boolean]>(2);
  const cfg = read<readonly [bigint, bigint, bigint, bigint, boolean]>(3);
  const vault = read<readonly [string, string, boolean, boolean]>(4);
  const bens = read<readonly { wallet: string; shareBps: number }[]>(5);

  const timeSince = Number(status?.[1] ?? 0n);
  const timeoutDuration = Number(cfg?.[1] ?? 0n);
  const gracePeriod = Number(cfg?.[2] ?? 0n);
  const dueAt = timeoutDuration + gracePeriod;

  const snapshotKey = `${planAddress ?? ""}:${status?.[0] ?? 0n}:${timeSince}`;
  const [clock, setClock] = useState({ snapshotKey: "", tick: 0 });
  useEffect(() => {
    const id = setInterval(
      () => setClock((value) => ({ ...value, tick: value.tick + 1 })),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  useEffect(() => setClock({ snapshotKey, tick: 0 }), [snapshotKey]);
  const localTick = clock.snapshotKey === snapshotKey ? clock.tick : 0;
  const graceElapsed = Boolean(timeout?.[1]);

  return {
    loading: isLoading,
    configured: Boolean(planAddress && data !== undefined),
    owner: read<string>(0),
    lastHeartbeat: Number(status?.[0] ?? 0n),
    timeSinceHeartbeat: timeSince,
    heartbeatInterval: Number(cfg?.[0] ?? 0n),
    timeoutDuration,
    gracePeriod,
    livenessActive: Boolean(cfg?.[4]),
    timeoutExceeded: Boolean(timeout?.[0]),
    graceElapsed,
    inheritanceExecuted: Boolean(read<boolean>(7)),
    inheritanceTimestamp: Number(read<bigint>(10) ?? 0n),
    evacuationExecuted: Boolean(read<boolean>(8)),
    safeVault: vault?.[0],
    recoveryKey: vault?.[1],
    recoveryKeyRegistered: Boolean(vault?.[2]),
    privateRoutingEnabled: Boolean(vault?.[3]),
    beneficiaries: (bens ?? []).map((b) => ({
      wallet: b.wallet,
      shareBps: Number(b.shareBps),
    })),
    totalShareBps: Number(read<number>(6) ?? 0),
    trackedTokens: [...(read<readonly string[]>(9) ?? [])],
    secondsUntilDue: confirmedRecoveryCountdown({
      configuredDuration: dueAt,
      chainElapsed: timeSince,
      localTick,
      graceElapsed,
    }),
    refetch,
  };
}
