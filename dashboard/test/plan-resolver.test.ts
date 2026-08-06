import { describe, expect, it } from 'vitest';
import { zeroAddress } from 'viem';
import { resolvePlan, type FactoryReader } from '../lib/plan-resolver';

const owner = '0x1111111111111111111111111111111111111111' as const;
const factory = '0x2222222222222222222222222222222222222222' as const;
const plan = '0x3333333333333333333333333333333333333333' as const;

function reader(result: `0x${string}`): FactoryReader {
  return { readPlanOf: async () => result };
}

describe('resolvePlan', () => {
  it('waits for a connected owner before reading the factory', async () => {
    const result = await resolvePlan({
      owner: undefined,
      factory,
      reader: reader(plan),
    });

    expect(result).toEqual({ status: 'disconnected' });
  });

  it('reports a missing factory without inventing a plan address', async () => {
    const result = await resolvePlan({
      owner,
      factory: undefined,
      reader: reader(plan),
    });

    expect(result).toEqual({ status: 'unconfigured' });
  });

  it('distinguishes a new wallet from a registered wallet', async () => {
    await expect(
      resolvePlan({ owner, factory, reader: reader(zeroAddress) })
    ).resolves.toEqual({
      status: 'missing',
      owner,
    });
    await expect(
      resolvePlan({ owner, factory, reader: reader(plan) })
    ).resolves.toEqual({
      status: 'resolved',
      owner,
      plan,
    });
  });

  it('keeps factory read failures explicit and recoverable', async () => {
    const failedReader: FactoryReader = {
      readPlanOf: async () => {
        throw new Error('rpc unavailable');
      },
    };

    await expect(
      resolvePlan({ owner, factory, reader: failedReader })
    ).resolves.toEqual({
      status: 'error',
      message: 'Could not read your plan. Check your connection and try again.',
    });
  });
});
