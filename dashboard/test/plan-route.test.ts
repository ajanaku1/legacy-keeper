import { describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import {
  executePlanCreation,
  parsePlanCreationRequest,
  type PlanCreationDependencies,
  type PlanCreationRequest,
} from '../lib/plan-route';
import { hashPlanConfig, planCreationTypedData } from '../lib/intent-signer';
import { buildPlanCreationRequest } from '../lib/plan-client';
import { createOnboardingDraft } from '../lib/onboarding-draft';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const FACTORY = '0x2222222222222222222222222222222222222222' as const;
const PLAN = '0x3333333333333333333333333333333333333333' as const;
const BENEFICIARY = '0x4444444444444444444444444444444444444444' as const;
const RECOVERY = '0x5555555555555555555555555555555555555555' as const;
const VAULT = '0x6666666666666666666666666666666666666666' as const;
const TX_HASH = `0x${'c'.repeat(64)}` as const;

function request(): PlanCreationRequest {
  return {
    chainId: 11155111,
    owner: OWNER,
    config: {
      heartbeatInterval: 86400,
      timeoutDuration: 60 * 86400,
      gracePeriod: 7 * 86400,
      beneficiaryWallets: [BENEFICIARY],
      beneficiaryShares: [10000],
      recoveryKey: RECOVERY,
      safeVault: VAULT,
      trackedTokens: [],
      allowSharedRecovery: false,
    },
    nonce: '12',
    deadline: '1300',
    signature: '0xsig',
  };
}

function dependencies(
  overrides: Partial<PlanCreationDependencies> = {},
): PlanCreationDependencies {
  return {
    nowSeconds: () => 1000,
    factoryAddress: FACTORY,
    readRegisteredPlan: vi
      .fn()
      .mockResolvedValue('0x0000000000000000000000000000000000000000'),
    recoverSigner: vi.fn().mockResolvedValue(OWNER),
    nextIdempotencyKey: vi.fn().mockReturnValue('plan-attempt-1'),
    submitToKeeperHub: vi.fn().mockResolvedValue({ executionId: 'kh_plan_1' }),
    awaitSettlement: vi.fn().mockResolvedValue({
      status: 'success',
      txHash: TX_HASH,
      sponsored: true,
    }),
    verifyOnchain: vi.fn().mockResolvedValue({
      receiptStatus: 'success',
      target: FACTORY,
      event: 'PlanCreated',
      eventOwner: OWNER,
      plan: PLAN,
      registeredPlan: PLAN,
      initialized: true,
    }),
    ...overrides,
  };
}

describe('plan creation route boundary', () => {
  it('accepts a zero grace period in a reviewed creation intent', () => {
    const zeroGraceRequest = {
      ...request(),
      config: { ...request().config, timeoutDuration: 86_400, gracePeriod: 0 },
    };

    expect(parsePlanCreationRequest(zeroGraceRequest)).toEqual(
      zeroGraceRequest,
    );
  });

  it('accepts only the reviewed creation intent fields', () => {
    expect(parsePlanCreationRequest(request())).toEqual(request());
    expect(() =>
      parsePlanCreationRequest({
        ...request(),
        apiKey: 'must-stay-server-side',
      }),
    ).toThrow(/unexpected field/i);
    expect(() =>
      parsePlanCreationRequest({
        ...request(),
        config: { ...request().config, beneficiaryShares: [9000] },
      }),
    ).toThrow(/10,000/i);
    expect(() =>
      parsePlanCreationRequest({
        ...request(),
        config: { ...request().config, allowSharedRecovery: 'false' },
      }),
    ).toThrow(/allowSharedRecovery.*boolean/i);
    expect(() =>
      parsePlanCreationRequest({
        ...request(),
        config: {
          ...request().config,
          beneficiaryWallets: [BENEFICIARY, BENEFICIARY],
          beneficiaryShares: [5000, 5000],
        },
      }),
    ).toThrow(/duplicate beneficiar/i);
  });

  it('rejects the wrong chain, expired deadline, or existing plan before submission', async () => {
    const submitToKeeperHub = vi.fn();
    await expect(
      executePlanCreation(
        { ...request(), chainId: 1 },
        dependencies({ submitToKeeperHub }),
      ),
    ).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
    await expect(
      executePlanCreation(
        { ...request(), deadline: '999' },
        dependencies({ submitToKeeperHub }),
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_EXPIRED' });
    await expect(
      executePlanCreation(
        request(),
        dependencies({
          submitToKeeperHub,
          readRegisteredPlan: vi.fn().mockResolvedValue(PLAN),
        }),
      ),
    ).rejects.toMatchObject({ code: 'PLAN_ALREADY_EXISTS' });
    expect(submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('rejects a signer other than the requested owner before KeeperHub', async () => {
    const deps = dependencies({
      recoverSigner: vi.fn().mockResolvedValue(BENEFICIARY),
    });

    await expect(executePlanCreation(request(), deps)).rejects.toMatchObject({
      code: 'WRONG_SIGNER',
    });
    expect(deps.submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('uses a server-generated per-attempt idempotency key', async () => {
    const deps = dependencies();

    await executePlanCreation(request(), deps);

    expect(deps.submitToKeeperHub).toHaveBeenCalledWith(
      request(),
      'plan-attempt-1',
    );
  });

  it('returns verified evidence only when settlement, receipt, event, target, and state agree', async () => {
    const result = await executePlanCreation(request(), dependencies());

    expect(result).toEqual({
      stage: 'verified',
      executionId: 'kh_plan_1',
      idempotencyKey: 'plan-attempt-1',
      txHash: TX_HASH,
      sponsored: true,
      receiptStatus: 'success',
      event: 'PlanCreated',
      owner: OWNER,
      plan: PLAN,
      initialized: true,
    });
  });

  it.each([
    ['wrong target', { target: PLAN }],
    ['missing event', { event: undefined }],
    ['wrong event owner', { eventOwner: BENEFICIARY }],
    ['registry mismatch', { registeredPlan: BENEFICIARY }],
    ['uninitialized plan', { initialized: false }],
  ])('fails closed for %s proof', async (_label, proof) => {
    const deps = dependencies({
      verifyOnchain: vi.fn().mockResolvedValue({
        receiptStatus: 'success',
        target: FACTORY,
        event: 'PlanCreated',
        eventOwner: OWNER,
        plan: PLAN,
        registeredPlan: PLAN,
        initialized: true,
        ...proof,
      }),
    });

    await expect(executePlanCreation(request(), deps)).rejects.toMatchObject({
      code: 'UNVERIFIED_RESULT',
    });
  });
});

describe('plan creation typed intent', () => {
  it('binds every reviewed config value into the signed config hash', () => {
    const first = hashPlanConfig(request().config);
    const changed = hashPlanConfig({
      ...request().config,
      timeoutDuration: request().config.timeoutDuration + 1,
    });

    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    expect(changed).not.toBe(first);
  });

  it('recovers the owner from the factory-bound typed data', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const intent = { ...request(), owner: account.address };
    const typedData = planCreationTypedData(intent, FACTORY);
    const signature = await account.signTypedData(typedData);

    await expect(
      recoverTypedDataAddress({ ...typedData, signature }),
    ).resolves.toBe(account.address);
  });

  it('converts the reviewed draft into exact factory units without a stored signature', () => {
    const draft = {
      ...createOnboardingDraft(OWNER, 11155111),
      timeoutDays: 60,
      graceDays: 7,
      beneficiaries: [{ address: BENEFICIARY, sharePercent: 100 }],
      recoverySigner: RECOVERY,
      safeVault: VAULT,
      assets: [
        {
          address: '0x7777777777777777777777777777777777777777',
          symbol: 'TKN',
          permitReadiness: 'supported' as const,
        },
      ],
    };

    expect(buildPlanCreationRequest(draft, 42n, 1_000)).toMatchObject({
      chainId: 11155111,
      owner: OWNER,
      nonce: '42',
      deadline: '1300',
      signature: '0x',
      config: {
        heartbeatInterval: 86_400,
        timeoutDuration: 5_184_000,
        gracePeriod: 604_800,
        beneficiaryWallets: [BENEFICIARY],
        beneficiaryShares: [10_000],
        recoveryKey: RECOVERY,
        safeVault: VAULT,
        trackedTokens: ['0x7777777777777777777777777777777777777777'],
      },
    });
  });
});
