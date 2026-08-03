import {
  parseHeartbeatRequest,
  type HeartbeatRequest,
  type KeeperHubSettlement,
  type KeeperHubSubmission,
} from './heartbeat-route';

interface RecoveryState {
  recoveryKey: string;
  registered: boolean;
  evacuated: boolean;
}

interface EvacuationVerification {
  receiptStatus: string;
  event?: string;
  evacuated: boolean;
}

export interface VerifiedEvacuationEvidence {
  stage: 'verified';
  executionId: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: 'success';
  event: 'EvacuationTriggered';
  evacuated: true;
  routeConfidence: 'unavailable';
}

export interface EvacuationDependencies {
  nowSeconds: () => number;
  readRecoveryState: () => Promise<RecoveryState>;
  recoverSigner: (request: HeartbeatRequest) => Promise<string>;
  submitToKeeperHub: (request: HeartbeatRequest) => Promise<KeeperHubSubmission>;
  awaitSettlement: (executionId: string) => Promise<KeeperHubSettlement>;
  verifyOnchain: (txHash: `0x${string}`) => Promise<EvacuationVerification>;
}

export async function executeSignedEvacuation(
  rawRequest: HeartbeatRequest,
  deps: EvacuationDependencies
): Promise<VerifiedEvacuationEvidence> {
  const request = parseHeartbeatRequest(rawRequest);
  assertDeadline(request.deadline, deps.nowSeconds());
  const recovery = await deps.readRecoveryState();
  if (!recovery.registered) throw new Error('No recovery key is registered');
  if (recovery.evacuated) throw new Error('Evacuation has already executed');
  const signer = await deps.recoverSigner(request);
  if (signer.toLowerCase() !== recovery.recoveryKey.toLowerCase()) {
    throw new Error('Signature does not match the registered recovery key');
  }
  const submission = await deps.submitToKeeperHub(request);
  const settlement = await deps.awaitSettlement(submission.executionId);
  assertSettlement(settlement);
  const proof = await deps.verifyOnchain(settlement.txHash as `0x${string}`);
  if (proof.receiptStatus !== 'success' || proof.event !== 'EvacuationTriggered' || !proof.evacuated) {
    throw new Error('Onchain proof does not confirm evacuation');
  }
  return {
    stage: 'verified',
    executionId: submission.executionId,
    txHash: settlement.txHash as `0x${string}`,
    sponsored: true,
    receiptStatus: 'success',
    event: 'EvacuationTriggered',
    evacuated: true,
    routeConfidence: 'unavailable',
  };
}

function assertDeadline(value: string, now: number): void {
  const deadline = Number(value);
  if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > now + 600) {
    throw new Error('Evacuation deadline must be short-lived and in the future');
  }
}

function assertSettlement(value: KeeperHubSettlement): void {
  if (value.status !== 'success') throw new Error(`KeeperHub evacuation failed: ${value.status}`);
  if (!value.txHash) throw new Error('KeeperHub returned no evacuation transaction hash');
  if (value.sponsored !== true) throw new Error('KeeperHub did not confirm sponsorship');
}
