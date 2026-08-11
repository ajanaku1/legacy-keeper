'use client';

import { useReadContracts } from 'wagmi';
import { type Address } from 'viem';
import {
  LEGACY_KEEPER_FACTORY_ADDRESSES,
  legacyKeeperFactoryAbi,
} from './contract';
import {
  classifyFactoryPlans,
  planReadError,
  type PlanResolution,
} from './plan-resolver';

export function usePlanResolver(owner?: Address): PlanResolution {
  const factories = LEGACY_KEEPER_FACTORY_ADDRESSES;
  const read = useReadContracts({
    contracts: factories.map((address) => ({
      address,
      abi: legacyKeeperFactoryAbi,
      functionName: 'planOf' as const,
      args: owner ? [owner] : undefined,
    })),
    query: { enabled: Boolean(factories.length && owner) },
  });

  if (!owner) return { status: 'disconnected' };
  if (factories.length === 0) return { status: 'unconfigured' };
  if (read.error) return planReadError();
  const plans = (read.data ?? []).flatMap((item) =>
    item.status === 'success' ? [item.result] : [],
  );
  return classifyFactoryPlans(
    owner,
    plans,
    read.data?.length === factories.length,
  );
}
