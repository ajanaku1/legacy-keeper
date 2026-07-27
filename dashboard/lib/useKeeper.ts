'use client';

import { useReadContracts } from 'wagmi';
import { useEffect, useState } from 'react';
import { legacyKeeperAbi, LEGACY_KEEPER_ADDRESS } from './contract';

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
  timeoutDuration: number;
  gracePeriod: number;
  livenessActive: boolean;
  timeoutExceeded: boolean;
  graceElapsed: boolean;
  inheritanceExecuted: boolean;
  evacuationExecuted: boolean;
  safeVault?: string;
  recoveryKey?: string;
  recoveryKeyRegistered: boolean;
  privateRoutingEnabled: boolean;
  beneficiaries: Beneficiary[];
  totalShareBps: number;
  /** Live-ticking seconds until distribution becomes callable. */
  secondsUntilDue: number;
  refetch: () => void;
}

const contract = { address: LEGACY_KEEPER_ADDRESS, abi: legacyKeeperAbi } as const;

export function useKeeper(): KeeperState {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { ...contract, functionName: 'owner' },
      { ...contract, functionName: 'getLivenessStatus' },
      { ...contract, functionName: 'getTimeoutStatus' },
      { ...contract, functionName: 'liveness' },
      { ...contract, functionName: 'vault' },
      { ...contract, functionName: 'getBeneficiaries' },
      { ...contract, functionName: 'totalShareBps' },
      { ...contract, functionName: 'inheritanceExecuted' },
      { ...contract, functionName: 'evacuationExecuted' },
    ],
    query: { enabled: LEGACY_KEEPER_ADDRESS.length === 42 },
  });

  const read = <T,>(i: number): T | undefined =>
    data?.[i]?.status === 'success' ? (data[i].result as T) : undefined;

  const status = read<readonly [bigint, bigint, boolean, boolean]>(1);
  const timeout = read<readonly [boolean, boolean]>(2);
  const cfg = read<readonly [bigint, bigint, bigint, bigint, boolean]>(3);
  const vault = read<readonly [string, string, boolean, boolean]>(4);
  const bens = read<readonly { wallet: string; shareBps: number }[]>(5);

  const timeSince = Number(status?.[1] ?? 0n);
  const timeoutDuration = Number(cfg?.[1] ?? 0n);
  const gracePeriod = Number(cfg?.[2] ?? 0n);
  const dueAt = timeoutDuration + gracePeriod;

  // The chain only updates on refetch; tick locally so the countdown moves.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setTick(0), [timeSince]);

  return {
    loading: isLoading,
    configured: LEGACY_KEEPER_ADDRESS.length === 42 && data !== undefined,
    owner: read<string>(0),
    lastHeartbeat: Number(status?.[0] ?? 0n),
    timeSinceHeartbeat: timeSince,
    timeoutDuration,
    gracePeriod,
    livenessActive: Boolean(cfg?.[4]),
    timeoutExceeded: Boolean(timeout?.[0]),
    graceElapsed: Boolean(timeout?.[1]),
    inheritanceExecuted: Boolean(read<boolean>(7)),
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
    secondsUntilDue: Math.max(0, dueAt - timeSince - tick),
    refetch,
  };
}
