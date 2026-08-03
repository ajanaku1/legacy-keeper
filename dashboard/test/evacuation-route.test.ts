import { describe, expect, it, vi } from 'vitest';
import { executeSignedEvacuation, type EvacuationDependencies } from '../lib/evacuation-route';

const RECOVERY = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'b'.repeat(64)}` as const;

function dependencies(overrides: Partial<EvacuationDependencies> = {}): EvacuationDependencies {
  return {
    nowSeconds: () => 1_000,
    readRecoveryState: vi.fn().mockResolvedValue({ recoveryKey: RECOVERY, registered: true, evacuated: false }),
    recoverSigner: vi.fn().mockResolvedValue(RECOVERY),
    submitToKeeperHub: vi.fn().mockResolvedValue({ executionId: 'kh_evac_1' }),
    awaitSettlement: vi.fn().mockResolvedValue({ status: 'success', txHash: TX_HASH, sponsored: true }),
    verifyOnchain: vi.fn().mockResolvedValue({ receiptStatus: 'success', event: 'EvacuationTriggered', evacuated: true }),
    ...overrides,
  };
}

describe('evacuation route boundary', () => {
  it('accepts a recovery-key signature and returns verified KeeperHub evidence', async () => {
    const deps = dependencies();
    const request = { nonce: '4', deadline: '1300', signature: '0xsig' };
    const result = await executeSignedEvacuation(request, deps);
    expect(deps.submitToKeeperHub).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({ stage: 'verified', executionId: 'kh_evac_1', txHash: TX_HASH, event: 'EvacuationTriggered', evacuated: true });
  });

  it('rejects any signer other than the registered recovery key before submission', async () => {
    const deps = dependencies({ recoverSigner: vi.fn().mockResolvedValue('0x3333333333333333333333333333333333333333') });
    await expect(executeSignedEvacuation({ nonce: '4', deadline: '1300', signature: '0xsig' }, deps)).rejects.toThrow(/recovery key/i);
    expect(deps.submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('fails closed if the receipt does not prove evacuation', async () => {
    const deps = dependencies({ verifyOnchain: vi.fn().mockResolvedValue({ receiptStatus: 'success', evacuated: false }) });
    await expect(executeSignedEvacuation({ nonce: '4', deadline: '1300', signature: '0xsig' }, deps)).rejects.toThrow(/proof/i);
  });
});
