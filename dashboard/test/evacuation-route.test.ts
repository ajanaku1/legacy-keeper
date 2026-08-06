import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  executeSignedEvacuation,
  type EvacuationDependencies,
} from '../lib/evacuation-route';
import type { HeartbeatRequest } from '../lib/heartbeat-route';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const PLAN = '0x2222222222222222222222222222222222222222' as const;
const RECOVERY = '0x3333333333333333333333333333333333333333' as const;
const OTHER = '0x4444444444444444444444444444444444444444' as const;
const TX_HASH = `0x${'b'.repeat(64)}` as const;

function request(): HeartbeatRequest {
  return {
    chainId: 11155111,
    owner: OWNER,
    plan: PLAN,
    nonce: '4',
    deadline: '1300',
    signature: '0xsig',
  };
}

function dependencies(
  overrides: Partial<EvacuationDependencies> = {}
): EvacuationDependencies {
  return {
    nowSeconds: () => 1_000,
    readRegisteredPlan: vi.fn().mockResolvedValue(PLAN),
    readOwner: vi.fn().mockResolvedValue(OWNER),
    readRecoveryState: vi.fn().mockResolvedValue({
      recoveryKey: RECOVERY,
      registered: true,
      evacuated: false,
    }),
    recoverSigner: vi.fn().mockResolvedValue(RECOVERY),
    nextIdempotencyKey: vi.fn().mockReturnValue('evacuation-attempt-1'),
    submitToKeeperHub: vi.fn().mockResolvedValue({ executionId: 'kh_evac_1' }),
    awaitSettlement: vi.fn().mockResolvedValue({
      status: 'success',
      txHash: TX_HASH,
      sponsored: true,
    }),
    verifyOnchain: vi.fn().mockResolvedValue({
      receiptStatus: 'success',
      target: PLAN,
      event: 'EvacuationTriggered',
      evacuated: true,
    }),
    ...overrides,
  };
}

describe('wallet-scoped evacuation route boundary', () => {
  it('binds the recovery UI payload to the resolved wallet plan', () => {
    const source = readFileSync(
      new URL('../components/PanicCard.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain('planAddress');
    expect(source).toContain('ownerAddress');
    expect(source).not.toContain('LEGACY_KEEPER_ADDRESS');
  });

  it('resolves the owner plan and returns verified KeeperHub evidence', async () => {
    const deps = dependencies();
    const result = await executeSignedEvacuation(request(), deps);

    expect(deps.submitToKeeperHub).toHaveBeenCalledWith(
      request(),
      'evacuation-attempt-1'
    );
    expect(result).toMatchObject({
      stage: 'verified',
      executionId: 'kh_evac_1',
      txHash: TX_HASH,
      event: 'EvacuationTriggered',
      plan: PLAN,
      evacuated: true,
    });
  });

  it('rejects a factory mismatch before submission', async () => {
    const deps = dependencies({
      readRegisteredPlan: vi.fn().mockResolvedValue(OTHER),
    });

    await expect(executeSignedEvacuation(request(), deps)).rejects.toMatchObject({
      code: 'PLAN_MISMATCH',
    });
    expect(deps.submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('rejects any signer other than the registered recovery key', async () => {
    const deps = dependencies({
      recoverSigner: vi.fn().mockResolvedValue(OTHER),
    });

    await expect(executeSignedEvacuation(request(), deps)).rejects.toMatchObject({
      code: 'WRONG_SIGNER',
    });
    expect(deps.submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('fails closed if receipt target or resulting state does not prove evacuation', async () => {
    const deps = dependencies({
      verifyOnchain: vi.fn().mockResolvedValue({
        receiptStatus: 'success',
        target: OTHER,
        event: 'EvacuationTriggered',
        evacuated: true,
      }),
    });

    await expect(executeSignedEvacuation(request(), deps)).rejects.toMatchObject({
      code: 'UNVERIFIED_RESULT',
    });
  });
});
