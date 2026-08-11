import { isAddress, zeroAddress, type Address } from 'viem';
import {
  advancedTimingFromSeconds,
  validateAdvancedTiming,
  type AdvancedTiming,
  type DurationParts,
} from './timing';

export const SEPOLIA_CHAIN_ID = 11155111;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BeneficiaryDraft {
  address: string;
  sharePercent: number;
}

export interface AssetDraft {
  address: string;
  symbol: string;
  permitReadiness: 'supported' | 'unsupported' | 'unknown';
}

export interface OnboardingDraft {
  version: 1;
  owner: Address;
  chainId: number;
  step: number;
  timeoutDays: number;
  graceDays: number;
  advancedTiming?: AdvancedTiming;
  beneficiaries: BeneficiaryDraft[];
  recoverySigner: string;
  safeVault: string;
  allowSharedRecovery: boolean;
  assets: AssetDraft[];
  includeNativeFunding: boolean;
  updatedAt: number;
}

export interface WalletSession {
  owner?: string;
  chainId?: number;
}

export function browserDraftStorage(): DraftStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function draftStorageKey(owner: string, chainId: number): string {
  return `legacykeeper:onboarding:v1:${owner.toLowerCase()}:${chainId}`;
}

export function createOnboardingDraft(
  owner: Address,
  chainId: number,
): OnboardingDraft {
  return {
    version: 1,
    owner: owner.toLowerCase() as Address,
    chainId,
    step: 1,
    timeoutDays: 60,
    graceDays: 7,
    beneficiaries: [],
    recoverySigner: '',
    safeVault: '',
    allowSharedRecovery: false,
    assets: [],
    includeNativeFunding: false,
    updatedAt: Date.now(),
  };
}

export function loadOnboardingDraft(
  storage: DraftStorage,
  owner: Address,
  chainId: number,
): OnboardingDraft {
  const fallback = createOnboardingDraft(owner, chainId);
  try {
    const raw = storage.getItem(draftStorageKey(owner, chainId));
    if (!raw) return fallback;
    return parseDraft(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function saveOnboardingDraft(
  storage: DraftStorage,
  draft: OnboardingDraft,
): void {
  try {
    storage.setItem(
      draftStorageKey(draft.owner, draft.chainId),
      JSON.stringify(safeDraft(draft)),
    );
  } catch {
    // Storage may be disabled. The in-memory modal state remains usable.
  }
}

export function clearOnboardingDraft(
  storage: DraftStorage,
  owner: Address,
  chainId: number,
): void {
  try {
    storage.removeItem(draftStorageKey(owner, chainId));
  } catch {
    // A blocked storage API must not make the interface unusable.
  }
}

export function validateOnboardingStep(
  draft: OnboardingDraft,
  step: number,
  session?: WalletSession,
): string[] {
  const steps = step === 6 ? [1, 2, 3, 4, 5] : [step];
  const errors = steps.flatMap((current) =>
    stepErrors(draft, current, session),
  );
  return [...new Set(errors)];
}

function stepErrors(
  draft: OnboardingDraft,
  step: number,
  session?: WalletSession,
): string[] {
  if (step === 1) return sessionErrors(draft, session);
  if (step === 2) return timingErrors(draft);
  if (step === 3) return beneficiaryErrors(draft.beneficiaries);
  if (step === 4) return recoveryErrors(draft);
  if (step === 5) return assetErrors(draft.assets);
  return [];
}

function sessionErrors(
  draft: OnboardingDraft,
  session?: WalletSession,
): string[] {
  const errors: string[] = [];
  if (!session?.owner)
    errors.push('Connect the wallet that will own this plan.');
  else if (session.owner.toLowerCase() !== draft.owner.toLowerCase())
    errors.push('Reconnect the wallet that started this draft.');
  if (session?.chainId !== SEPOLIA_CHAIN_ID)
    errors.push('Switch to Sepolia to continue.');
  return errors;
}

function timingErrors(draft: OnboardingDraft): string[] {
  if (draft.advancedTiming) {
    const error = validateAdvancedTiming(draft.advancedTiming);
    return error ? [error] : [];
  }
  const errors: string[] = [];
  if (!Number.isInteger(draft.timeoutDays) || draft.timeoutDays < 1)
    errors.push('Inactivity period must be at least one day.');
  if (!Number.isInteger(draft.graceDays) || draft.graceDays < 0)
    errors.push('Grace period cannot be negative.');
  if (draft.graceDays >= draft.timeoutDays)
    errors.push('Grace period must be shorter than the inactivity period.');
  return errors;
}

function beneficiaryErrors(beneficiaries: BeneficiaryDraft[]): string[] {
  const errors: string[] = [];
  if (beneficiaries.length < 1) errors.push('Add at least one beneficiary.');
  if (beneficiaries.length > 10)
    errors.push('You can add up to 10 beneficiaries.');
  if (beneficiaries.some((item) => !validNonzeroAddress(item.address)))
    errors.push('Every beneficiary needs a valid nonzero address.');
  const normalized = beneficiaries.map((item) => item.address.toLowerCase());
  if (new Set(normalized).size !== normalized.length)
    errors.push('Beneficiary addresses must be unique.');
  if (
    beneficiaries.some(
      (item) =>
        !Number.isFinite(item.sharePercent) ||
        item.sharePercent <= 0 ||
        item.sharePercent > 100,
    )
  )
    errors.push('Each beneficiary share must be between 1% and 100%.');
  const total = beneficiaries.reduce((sum, item) => sum + item.sharePercent, 0);
  if (total !== 100) errors.push('Beneficiary shares must total exactly 100%.');
  return errors;
}

function recoveryErrors(draft: OnboardingDraft): string[] {
  const errors: string[] = [];
  const recovery = draft.recoverySigner.toLowerCase();
  const vault = draft.safeVault.toLowerCase();
  if (!validNonzeroAddress(recovery) || !validNonzeroAddress(vault))
    errors.push('Enter a valid recovery signer and safe vault address.');
  if (
    recovery === draft.owner.toLowerCase() ||
    vault === draft.owner.toLowerCase()
  )
    errors.push('Recovery addresses cannot be the owner wallet.');
  if (recovery === vault && !draft.allowSharedRecovery)
    errors.push(
      'A shared recovery signer and vault require explicit acknowledgement.',
    );
  return errors;
}

function assetErrors(assets: AssetDraft[]): string[] {
  if (assets.some((asset) => !validNonzeroAddress(asset.address)))
    return ['Every tracked token needs a valid contract address.'];
  return [];
}

function validNonzeroAddress(value: string): boolean {
  return isAddress(value) && value.toLowerCase() !== zeroAddress;
}

function safeDraft(draft: OnboardingDraft): OnboardingDraft {
  return {
    version: 1,
    owner: draft.owner.toLowerCase() as Address,
    chainId: draft.chainId,
    step: clampStep(draft.step),
    timeoutDays: draft.timeoutDays,
    graceDays: draft.graceDays,
    advancedTiming: draft.advancedTiming
      ? { ...draft.advancedTiming }
      : undefined,
    beneficiaries: draft.beneficiaries.map(({ address, sharePercent }) => ({
      address,
      sharePercent,
    })),
    recoverySigner: draft.recoverySigner,
    safeVault: draft.safeVault,
    allowSharedRecovery: draft.allowSharedRecovery,
    assets: draft.assets.map(({ address, symbol, permitReadiness }) => ({
      address,
      symbol,
      permitReadiness,
    })),
    includeNativeFunding: draft.includeNativeFunding,
    updatedAt: Date.now(),
  };
}

function parseDraft(
  value: unknown,
  fallback: OnboardingDraft,
): OnboardingDraft {
  if (!isRecord(value)) return fallback;
  if (
    value.version !== 1 ||
    value.owner?.toString().toLowerCase() !== fallback.owner ||
    value.chainId !== fallback.chainId
  )
    return fallback;
  return safeDraft({
    ...fallback,
    step: numberValue(value.step, fallback.step),
    timeoutDays: numberValue(value.timeoutDays, fallback.timeoutDays),
    graceDays: numberValue(value.graceDays, fallback.graceDays),
    advancedTiming: advancedTimingValue(value.advancedTiming),
    beneficiaries: beneficiaryList(value.beneficiaries),
    recoverySigner: stringValue(value.recoverySigner),
    safeVault: stringValue(value.safeVault),
    allowSharedRecovery: value.allowSharedRecovery === true,
    assets: assetList(value.assets),
    includeNativeFunding: value.includeNativeFunding === true,
    updatedAt: numberValue(value.updatedAt, fallback.updatedAt),
  });
}

function beneficiaryList(value: unknown): BeneficiaryDraft[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    address: stringValue(item.address),
    sharePercent: numberValue(item.sharePercent, 0),
  }));
}

function assetList(value: unknown): AssetDraft[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    address: stringValue(item.address),
    symbol: stringValue(item.symbol),
    permitReadiness: permitValue(item.permitReadiness),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function permitValue(value: unknown): AssetDraft['permitReadiness'] {
  return value === 'supported' || value === 'unsupported' ? value : 'unknown';
}

function advancedTimingValue(value: unknown): AdvancedTiming | undefined {
  if (!isRecord(value)) return undefined;
  const inactivity = durationValue(value.inactivity);
  const grace = durationValue(value.grace);
  if (inactivity && grace) return { inactivity, grace };
  if (value.unit !== 'minutes' && value.unit !== 'hours') return undefined;
  const multiplier = value.unit === 'hours' ? 3_600 : 60;
  return advancedTimingFromSeconds(
    numberValue(value.timeout, 0) * multiplier,
    numberValue(value.grace, 0) * multiplier,
  );
}

function durationValue(value: unknown): DurationParts | undefined {
  if (!isRecord(value)) return undefined;
  return {
    days: numberValue(value.days, 0),
    hours: numberValue(value.hours, 0),
    minutes: numberValue(value.minutes, 0),
    seconds: numberValue(value.seconds, 0),
  };
}

function clampStep(step: number): number {
  return Math.min(7, Math.max(1, Math.floor(step)));
}
