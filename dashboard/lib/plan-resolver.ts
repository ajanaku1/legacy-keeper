import { zeroAddress, type Address } from 'viem';

export type PlanResolution =
  | { status: 'disconnected' }
  | { status: 'unconfigured' }
  | { status: 'loading'; owner: Address }
  | { status: 'missing'; owner: Address }
  | { status: 'resolved'; owner: Address; plan: Address }
  | { status: 'error'; message: string };

export interface FactoryReader {
  readPlanOf(factory: Address, owner: Address): Promise<Address>;
}

interface ResolvePlanInput {
  owner?: Address;
  factory?: Address;
  reader: FactoryReader;
}

const READ_ERROR =
  'Could not read your plan. Check your connection and try again.';

export async function resolvePlan(
  input: ResolvePlanInput,
): Promise<PlanResolution> {
  if (!input.owner) return { status: 'disconnected' };
  if (!input.factory) return { status: 'unconfigured' };

  try {
    const plan = await input.reader.readPlanOf(input.factory, input.owner);
    return classifyPlan(input.owner, plan);
  } catch {
    return { status: 'error', message: READ_ERROR };
  }
}

export function classifyPlan(owner: Address, plan?: Address): PlanResolution {
  if (!plan) return { status: 'loading', owner };
  if (plan === zeroAddress) return { status: 'missing', owner };
  return { status: 'resolved', owner, plan };
}

export function classifyFactoryPlans(
  owner: Address,
  plans: readonly Address[],
  complete: boolean,
): PlanResolution {
  const plan = plans.find((candidate) => candidate !== zeroAddress);
  if (plan) return { status: 'resolved', owner, plan };
  return complete ? { status: 'missing', owner } : { status: 'loading', owner };
}

export function planReadError(): PlanResolution {
  return { status: 'error', message: READ_ERROR };
}
