import type { Address } from 'viem';
import type { OnboardingDraft } from './onboarding-draft';
import { timingSeconds } from './timing';
import { userFacingActionError } from './client-action-error';
import type { PlanCreationRequest, VerifiedPlanEvidence } from './plan-route';

const SECONDS_PER_DAY = 86_400;
const SIGNING_WINDOW_SECONDS = 300;

export function buildPlanCreationRequest(
  draft: OnboardingDraft,
  nonce: bigint,
  nowSeconds: number,
): PlanCreationRequest {
  const timing = draft.advancedTiming
    ? timingSeconds(draft.advancedTiming)
    : {
        heartbeat: SECONDS_PER_DAY,
        timeout: draft.timeoutDays * SECONDS_PER_DAY,
        grace: draft.graceDays * SECONDS_PER_DAY,
      };
  return {
    chainId: draft.chainId,
    owner: draft.owner,
    config: {
      heartbeatInterval: timing.heartbeat,
      timeoutDuration: timing.timeout,
      gracePeriod: timing.grace,
      beneficiaryWallets: draft.beneficiaries.map(
        ({ address }) => address as Address,
      ),
      beneficiaryShares: draft.beneficiaries.map(({ sharePercent }) =>
        Math.round(sharePercent * 100),
      ),
      recoveryKey: draft.recoverySigner as Address,
      safeVault: draft.safeVault as Address,
      trackedTokens: draft.assets.map(({ address }) => address as Address),
      allowSharedRecovery: draft.allowSharedRecovery,
    },
    nonce: nonce.toString(),
    deadline: String(nowSeconds + SIGNING_WINDOW_SECONDS),
    signature: '0x',
  };
}

export async function submitPlanCreation(
  request: PlanCreationRequest,
): Promise<VerifiedPlanEvidence> {
  const response = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isPlanEvidence(body)) {
    throw new Error(
      userFacingActionError(body, 'KeeperHub could not verify plan creation.'),
    );
  }
  return body;
}

export function randomNonce(bytes: Uint8Array): bigint {
  if (bytes.length !== 32)
    throw new Error('Nonce requires exactly 32 random bytes.');
  let nonce = 0n;
  for (const byte of bytes) nonce = (nonce << 8n) | BigInt(byte);
  return nonce;
}

function isPlanEvidence(value: unknown): value is VerifiedPlanEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Record<string, unknown>;
  return (
    evidence.stage === 'verified' &&
    evidence.event === 'PlanCreated' &&
    typeof evidence.executionId === 'string' &&
    typeof evidence.txHash === 'string' &&
    typeof evidence.plan === 'string' &&
    evidence.initialized === true
  );
}
