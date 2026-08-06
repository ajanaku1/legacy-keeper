import type { Address } from 'viem';
import { ActionError, withActionEvidence } from './action-error';
import {
  assertSepolia,
  assertSettlement,
  assertSigningDeadline,
  sameAddress,
} from './action-validation';
import {
  parseHeartbeatRequest,
  type HeartbeatRequest,
  type KeeperHubSettlement,
  type KeeperHubSubmission,
} from './heartbeat-route';

interface RecoveryState {
  recoveryKey: Address;
  registered: boolean;
  evacuated: boolean;
}

interface EvacuationVerification {
  receiptStatus: string;
  target?: Address;
  event?: string;
  evacuated: boolean;
}

export interface VerifiedEvacuationEvidence {
  stage: 'verified';
  executionId: string;
  idempotencyKey: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: 'success';
  event: 'EvacuationTriggered';
  plan: Address;
  evacuated: true;
  routeConfidence: 'unavailable';
}

export interface EvacuationDependencies {
  nowSeconds: () => number;
  readRegisteredPlan: (owner: Address) => Promise<Address>;
  readOwner: (plan: Address) => Promise<Address>;
  readRecoveryState: (plan: Address) => Promise<RecoveryState>;
  recoverSigner: (request: HeartbeatRequest) => Promise<Address>;
  nextIdempotencyKey: () => string;
  submitToKeeperHub: (
    request: HeartbeatRequest,
    idempotencyKey: string
  ) => Promise<KeeperHubSubmission>;
  awaitSettlement: (executionId: string) => Promise<KeeperHubSettlement>;
  verifyOnchain: (
    plan: Address,
    txHash: `0x${string}`
  ) => Promise<EvacuationVerification>;
}

export async function executeSignedEvacuation(
  rawRequest: HeartbeatRequest,
  deps: EvacuationDependencies
): Promise<VerifiedEvacuationEvidence> {
  const request = parseHeartbeatRequest(rawRequest);
  assertSepolia(request.chainId);
  assertSigningDeadline(request.deadline, deps.nowSeconds());
  const registeredPlan = await deps.readRegisteredPlan(request.owner);
  if (!sameAddress(registeredPlan, request.plan)) {
    throw new ActionError('PLAN_MISMATCH', 'Factory registry does not match this plan.');
  }
  const planOwner = await deps.readOwner(request.plan);
  if (!sameAddress(planOwner, request.owner)) {
    throw new ActionError('WRONG_OWNER', 'The connected wallet does not own this plan.');
  }
  const recovery = await deps.readRecoveryState(request.plan);
  if (!recovery.registered) {
    throw new ActionError('INVALID_REQUEST', 'No recovery key is registered.');
  }
  if (recovery.evacuated) {
    throw new ActionError('INVALID_REQUEST', 'Evacuation has already executed.');
  }
  const signer = await deps.recoverSigner(request);
  if (!sameAddress(signer, recovery.recoveryKey)) {
    throw new ActionError('WRONG_SIGNER', 'Signature does not match the recovery key.');
  }
  const idempotencyKey = deps.nextIdempotencyKey();
  const submission = await deps.submitToKeeperHub(request, idempotencyKey);
  if (!submission.executionId) {
    throw new ActionError('KEEPERHUB_REJECTED', 'KeeperHub returned no execution ID.');
  }
  const executionEvidence = { executionId: submission.executionId };
  const settlement = await withActionEvidence(executionEvidence, async () => {
    const result = await deps.awaitSettlement(submission.executionId);
    assertSettlement(result);
    return result;
  });
  await withActionEvidence(
    { ...executionEvidence, txHash: settlement.txHash },
    async () => {
      const proof = await deps.verifyOnchain(request.plan, settlement.txHash);
      if (
        proof.receiptStatus !== 'success' ||
        !sameAddress(proof.target, request.plan) ||
        proof.event !== 'EvacuationTriggered' ||
        !proof.evacuated
      ) {
        throw new ActionError(
          'UNVERIFIED_RESULT',
          'Receipt, evacuation event, target, and resulting state did not agree.'
        );
      }
    }
  );
  return {
    stage: 'verified',
    executionId: submission.executionId,
    idempotencyKey,
    txHash: settlement.txHash,
    sponsored: true,
    receiptStatus: 'success',
    event: 'EvacuationTriggered',
    plan: request.plan,
    evacuated: true,
    routeConfidence: 'unavailable',
  };
}
