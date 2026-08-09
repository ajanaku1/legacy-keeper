import { describe, expect, it, vi } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  executeConfiguration,
  parseConfigurationRequest,
  type ConfigurationDependencies,
  type ConfigurationRequest,
} from '../lib/configuration-route';
import { configurationTypedData } from '../lib/intent-signer';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const PLAN = '0x2222222222222222222222222222222222222222' as const;
const BENEFICIARY = '0x3333333333333333333333333333333333333333' as const;
const OTHER = '0x4444444444444444444444444444444444444444' as const;
const TX_HASH = `0x${'d'.repeat(64)}` as const;

function request(): ConfigurationRequest {
  return {
    chainId: 11155111,
    owner: OWNER,
    plan: PLAN,
    action: 'beneficiaries',
    payload: { wallets: [BENEFICIARY], shares: [10000] },
    nonce: '14',
    deadline: '1300',
    signature: '0xsig',
  };
}

function dependencies(
  overrides: Partial<ConfigurationDependencies> = {},
): ConfigurationDependencies {
  return {
    nowSeconds: () => 1000,
    readRegisteredPlan: vi.fn().mockResolvedValue(PLAN),
    readPlanOwner: vi.fn().mockResolvedValue(OWNER),
    readExpectedSigner: vi.fn().mockResolvedValue(OWNER),
    recoverSigner: vi.fn().mockResolvedValue(OWNER),
    nextIdempotencyKey: vi.fn().mockReturnValue('config-attempt-1'),
    submitToKeeperHub: vi
      .fn()
      .mockResolvedValue({ executionId: 'kh_config_1' }),
    awaitSettlement: vi.fn().mockResolvedValue({
      status: 'success',
      txHash: TX_HASH,
      sponsored: true,
    }),
    verifyOnchain: vi.fn().mockResolvedValue({
      receiptStatus: 'success',
      target: PLAN,
      event: 'BeneficiaryAdded',
      stateMatches: true,
    }),
    ...overrides,
  };
}

describe('configuration route boundary', () => {
  it('accepts a zero grace period for controlled inheritance testing', () => {
    const livenessRequest = {
      ...request(),
      action: 'liveness' as const,
      payload: {
        heartbeatInterval: 86_400,
        timeoutDuration: 86_400,
        gracePeriod: 0,
      },
    };

    expect(parseConfigurationRequest(livenessRequest)).toEqual(livenessRequest);
  });

  it('parses an action-specific payload and rejects extra browser fields', () => {
    expect(parseConfigurationRequest(request())).toEqual(request());
    expect(() =>
      parseConfigurationRequest({ ...request(), workflowId: 'browser-chosen' }),
    ).toThrow(/unexpected field/i);
    expect(() =>
      parseConfigurationRequest({
        ...request(),
        payload: { wallets: [BENEFICIARY], shares: [9000] },
      }),
    ).toThrow(/10,000/i);
    expect(() =>
      parseConfigurationRequest({
        ...request(),
        payload: {
          wallets: [BENEFICIARY, BENEFICIARY],
          shares: [5000, 5000],
        },
      }),
    ).toThrow(/duplicate beneficiar/i);
    expect(() =>
      parseConfigurationRequest({
        ...request(),
        action: 'recovery',
        payload: {
          recoveryKey: BENEFICIARY,
          safeVault: OTHER,
          allowSharedRecovery: 'false',
        },
      }),
    ).toThrow(/allowSharedRecovery.*boolean/i);
  });

  it('re-resolves owner to plan and checks the plan owner before submission', async () => {
    const submitToKeeperHub = vi.fn();
    await expect(
      executeConfiguration(
        request(),
        dependencies({
          readRegisteredPlan: vi.fn().mockResolvedValue(OTHER),
          submitToKeeperHub,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PLAN_MISMATCH' });
    await expect(
      executeConfiguration(
        request(),
        dependencies({
          readPlanOwner: vi.fn().mockResolvedValue(OTHER),
          submitToKeeperHub,
        }),
      ),
    ).rejects.toMatchObject({ code: 'WRONG_OWNER' });
    expect(submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('rejects a signature that does not match the action authority', async () => {
    const deps = dependencies({
      recoverSigner: vi.fn().mockResolvedValue(OTHER),
    });

    await expect(executeConfiguration(request(), deps)).rejects.toMatchObject({
      code: 'WRONG_SIGNER',
    });
    expect(deps.submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('uses a new idempotency key for every retry attempt', async () => {
    const nextIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce('config-attempt-1')
      .mockReturnValueOnce('config-attempt-2');
    const deps = dependencies({ nextIdempotencyKey });

    await executeConfiguration(request(), deps);
    await executeConfiguration(request(), deps);

    expect(deps.submitToKeeperHub).toHaveBeenNthCalledWith(
      1,
      request(),
      'config-attempt-1',
    );
    expect(deps.submitToKeeperHub).toHaveBeenNthCalledWith(
      2,
      request(),
      'config-attempt-2',
    );
  });

  it('returns verified evidence only after event and resulting state match', async () => {
    await expect(
      executeConfiguration(request(), dependencies()),
    ).resolves.toEqual({
      stage: 'verified',
      action: 'beneficiaries',
      executionId: 'kh_config_1',
      idempotencyKey: 'config-attempt-1',
      txHash: TX_HASH,
      sponsored: true,
      receiptStatus: 'success',
      event: 'BeneficiaryAdded',
      plan: PLAN,
    });
    await expect(
      executeConfiguration(
        request(),
        dependencies({
          verifyOnchain: vi.fn().mockResolvedValue({
            receiptStatus: 'success',
            target: PLAN,
            event: 'BeneficiaryAdded',
            stateMatches: false,
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNVERIFIED_RESULT' });
  });
});

describe('configuration typed intent', () => {
  it('recovers the action authority from plan-bound beneficiary data', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const intent = { ...request(), owner: account.address };
    const typedData = configurationTypedData(intent);
    expect(typedData.primaryType).toBe('SetBeneficiaries');
    if (typedData.primaryType !== 'SetBeneficiaries') {
      throw new Error('Expected beneficiary typed data');
    }
    const signature = await account.signTypedData(typedData);
    await expect(
      recoverTypedDataAddress({ ...typedData, signature }),
    ).resolves.toBe(account.address);
  });
});
