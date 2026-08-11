import { describe, expect, it } from 'vitest';
import {
  browserDraftStorage,
  createOnboardingDraft,
  draftStorageKey,
  loadOnboardingDraft,
  saveOnboardingDraft,
  validateOnboardingStep,
  type DraftStorage,
  type OnboardingDraft,
} from '../lib/onboarding-draft';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const BENEFICIARY_A = '0x2222222222222222222222222222222222222222';
const BENEFICIARY_B = '0x3333333333333333333333333333333333333333';
const RECOVERY = '0x4444444444444444444444444444444444444444';
const VAULT = '0x5555555555555555555555555555555555555555';
const TOKEN = '0x6666666666666666666666666666666666666666';

function memoryStorage(): DraftStorage & { value(key: string): string | null } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    value: (key) => values.get(key) ?? null,
  };
}

function validDraft(): OnboardingDraft {
  return {
    ...createOnboardingDraft(OWNER, 11155111),
    timeoutDays: 90,
    graceDays: 7,
    beneficiaries: [
      { address: BENEFICIARY_A, sharePercent: 60 },
      { address: BENEFICIARY_B, sharePercent: 40 },
    ],
    recoverySigner: RECOVERY,
    safeVault: VAULT,
  };
}

describe('onboarding draft storage', () => {
  it('keeps browser storage discovery safe during server rendering', () => {
    expect(browserDraftStorage()).toBeNull();
  });

  it('keys drafts by normalized owner wallet and chain', () => {
    expect(draftStorageKey(OWNER.toUpperCase(), 11155111)).toBe(
      `legacykeeper:onboarding:v1:${OWNER}:11155111`,
    );
  });

  it('starts at welcome with safe timing and optional asset defaults', () => {
    expect(createOnboardingDraft(OWNER, 11155111)).toMatchObject({
      version: 1,
      owner: OWNER,
      chainId: 11155111,
      step: 1,
      timeoutDays: 60,
      graceDays: 7,
      beneficiaries: [],
      recoverySigner: '',
      safeVault: '',
      allowSharedRecovery: false,
      assets: [],
      includeNativeFunding: false,
    });
  });

  it('resumes a saved draft while excluding signatures and secrets', () => {
    const storage = memoryStorage();
    const draft = { ...validDraft(), step: 5 } as OnboardingDraft & {
      signature: string;
      privateKey: string;
      secret: string;
    };
    draft.signature = '0xsigned';
    draft.privateKey = 'never-store-this';
    draft.secret = 'also-never-store-this';

    saveOnboardingDraft(storage, draft);

    const raw = storage.value(draftStorageKey(OWNER, 11155111));
    expect(raw).not.toMatch(/signature|privateKey|secret|never-store/i);
    expect(loadOnboardingDraft(storage, OWNER, 11155111)).toMatchObject({
      step: 5,
      owner: OWNER,
      chainId: 11155111,
      beneficiaries: validDraft().beneficiaries,
    });
  });

  it('migrates the previous minute-based advanced timing draft', () => {
    const storage = memoryStorage();
    const legacy = {
      ...validDraft(),
      advancedTiming: {
        unit: 'minutes',
        heartbeat: 5,
        timeout: 10,
        grace: 5,
      },
    };
    storage.setItem(
      draftStorageKey(OWNER, 11155111),
      JSON.stringify(legacy),
    );

    expect(loadOnboardingDraft(storage, OWNER, 11155111).advancedTiming).toEqual({
      inactivity: { days: 0, hours: 0, minutes: 10, seconds: 0 },
      grace: { days: 0, hours: 0, minutes: 5, seconds: 0 },
    });
  });

  it('falls back safely for corrupt data and isolates other wallets or chains', () => {
    const storage = memoryStorage();
    storage.setItem(draftStorageKey(OWNER, 11155111), '{broken');

    expect(loadOnboardingDraft(storage, OWNER, 11155111).step).toBe(1);
    expect(loadOnboardingDraft(storage, OWNER, 1).beneficiaries).toHaveLength(
      0,
    );
  });

  it('keeps working when browser storage is unavailable', () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(loadOnboardingDraft(storage, OWNER, 11155111).step).toBe(1);
    expect(() => saveOnboardingDraft(storage, validDraft())).not.toThrow();
  });
});

describe('onboarding validation', () => {
  it('requires Sepolia and the same connected wallet before signature', () => {
    const draft = validDraft();

    expect(
      validateOnboardingStep(draft, 1, { owner: OWNER, chainId: 1 }),
    ).toContain('Switch to Sepolia to continue.');
    expect(
      validateOnboardingStep(draft, 6, {
        owner: BENEFICIARY_A,
        chainId: 11155111,
      }),
    ).toContain('Reconnect the wallet that started this draft.');
  });

  it('accepts safe timing and rejects invalid grace periods', () => {
    expect(validateOnboardingStep(validDraft(), 2)).toEqual([]);
    expect(
      validateOnboardingStep(
        { ...validDraft(), timeoutDays: 1, graceDays: 0 },
        2,
      ),
    ).toEqual([]);
    expect(
      validateOnboardingStep({ ...validDraft(), graceDays: 90 }, 2),
    ).toContain('Grace period must be shorter than the inactivity period.');
  });

  it('accepts reviewed minute timing while keeping advanced timing opt-in', () => {
    const advanced = {
      ...validDraft(),
      advancedTiming: {
        inactivity: { days: 0, hours: 0, minutes: 10, seconds: 0 },
        grace: { days: 0, hours: 0, minutes: 5, seconds: 0 },
      },
    };

    expect(
      createOnboardingDraft(OWNER, 11155111).advancedTiming,
    ).toBeUndefined();
    expect(validateOnboardingStep(advanced, 2)).toEqual([]);
    expect(
      validateOnboardingStep(
        {
          ...advanced,
          advancedTiming: {
            ...advanced.advancedTiming,
            inactivity: { days: 0, hours: 0, minutes: 0, seconds: 0 },
          },
        },
        2,
      ),
    ).toContain('Inactivity must be at least one second.');
  });

  it('requires one to ten unique beneficiaries totaling exactly 100 percent', () => {
    expect(validateOnboardingStep(validDraft(), 3)).toEqual([]);
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          beneficiaries: [
            { address: BENEFICIARY_A, sharePercent: 70 },
            { address: BENEFICIARY_A, sharePercent: 20 },
          ],
        },
        3,
      ),
    ).toEqual(
      expect.arrayContaining([
        'Beneficiary addresses must be unique.',
        'Beneficiary shares must total exactly 100%.',
      ]),
    );
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          beneficiaries: Array.from({ length: 11 }, (_, index) => ({
            address: `0x${String(index + 10).padStart(40, '0')}`,
            sharePercent: index === 0 ? 100 : 0,
          })),
        },
        3,
      ),
    ).toContain('You can add up to 10 beneficiaries.');
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          beneficiaries: [
            { address: BENEFICIARY_A, sharePercent: 110 },
            { address: BENEFICIARY_B, sharePercent: -10 },
          ],
        },
        3,
      ),
    ).toContain('Each beneficiary share must be between 1% and 100%.');
  });

  it('keeps recovery addresses separate from the owner unless acknowledged', () => {
    expect(validateOnboardingStep(validDraft(), 4)).toEqual([]);
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          recoverySigner: OWNER,
          safeVault: RECOVERY,
        },
        4,
      ),
    ).toContain('Recovery addresses cannot be the owner wallet.');
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          safeVault: RECOVERY,
          allowSharedRecovery: false,
        },
        4,
      ),
    ).toContain(
      'A shared recovery signer and vault require explicit acknowledgement.',
    );
  });

  it('allows assets to be skipped but validates any tracked token entered', () => {
    expect(validateOnboardingStep(validDraft(), 5)).toEqual([]);
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          assets: [
            {
              address: 'not-an-address',
              symbol: 'BAD',
              permitReadiness: 'unknown',
            },
          ],
        },
        5,
      ),
    ).toContain('Every tracked token needs a valid contract address.');
    expect(
      validateOnboardingStep(
        {
          ...validDraft(),
          assets: [
            {
              address: TOKEN,
              symbol: 'USDC',
              permitReadiness: 'supported',
            },
          ],
        },
        5,
      ),
    ).toEqual([]);
  });
});
