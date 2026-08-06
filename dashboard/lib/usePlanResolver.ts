'use client';

import { useReadContract } from 'wagmi';
import { type Address } from 'viem';
import {
  LEGACY_KEEPER_FACTORY_ADDRESS,
  legacyKeeperFactoryAbi,
} from './contract';
import {
  classifyPlan,
  planReadError,
  type PlanResolution,
} from './plan-resolver';

export function usePlanResolver(owner?: Address): PlanResolution {
  const factory = LEGACY_KEEPER_FACTORY_ADDRESS;
  const read = useReadContract({
    address: factory,
    abi: legacyKeeperFactoryAbi,
    functionName: 'planOf',
    args: owner ? [owner] : undefined,
    query: { enabled: Boolean(factory && owner) },
  });

  if (!owner) return { status: 'disconnected' };
  if (!factory) return { status: 'unconfigured' };
  if (read.error) return planReadError();
  return classifyPlan(owner, read.data);
}
