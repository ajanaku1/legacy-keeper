export interface HeartbeatRequest {
  nonce: string;
  deadline: string;
  signature: string;
}

export interface KeeperHubSubmission {
  executionId: string;
}

export interface KeeperHubSettlement {
  status: string;
  txHash?: `0x${string}`;
  sponsored?: boolean;
}

export interface HeartbeatVerification {
  receiptStatus: string;
  event?: string;
  lastHeartbeat: bigint;
}

export interface HeartbeatDependencies {
  nowSeconds: () => number;
  readOwner: () => Promise<string>;
  readLastHeartbeat: () => Promise<bigint>;
  recoverSigner: (request: HeartbeatRequest) => Promise<string>;
  submitToKeeperHub: (request: HeartbeatRequest) => Promise<KeeperHubSubmission>;
  awaitSettlement: (executionId: string) => Promise<KeeperHubSettlement>;
  verifyOnchain: (
    txHash: `0x${string}`,
    previousHeartbeat: bigint
  ) => Promise<HeartbeatVerification>;
}

export interface VerifiedHeartbeatEvidence {
  stage: 'verified';
  executionId: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: 'success';
  event: 'HeartbeatRecorded';
  lastHeartbeat: string;
  routeConfidence: 'unavailable';
}

const REQUEST_FIELDS = ['deadline', 'nonce', 'signature'];
const MAX_DEADLINE_SECONDS = 600;

export function parseHeartbeatRequest(value: unknown): HeartbeatRequest {
  if (!isObject(value)) throw new Error('Heartbeat request must be an object');
  const keys = Object.keys(value).sort();
  const unexpected = keys.find((key) => !REQUEST_FIELDS.includes(key));
  if (unexpected) throw new Error(`Unexpected field: ${unexpected}`);
  if (keys.length !== REQUEST_FIELDS.length) {
    throw new Error('Heartbeat request requires nonce, deadline, and signature');
  }

  return {
    nonce: requiredString(value, 'nonce'),
    deadline: requiredString(value, 'deadline'),
    signature: requiredString(value, 'signature'),
  };
}

export async function executeSignedHeartbeat(
  rawRequest: HeartbeatRequest,
  dependencies: HeartbeatDependencies
): Promise<VerifiedHeartbeatEvidence> {
  const request = parseHeartbeatRequest(rawRequest);
  assertDeadline(request.deadline, dependencies.nowSeconds());

  const owner = await dependencies.readOwner();
  const signer = await dependencies.recoverSigner(request);
  if (signer.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Heartbeat signature does not match the onchain owner');
  }

  const previousHeartbeat = await dependencies.readLastHeartbeat();
  const submission = await dependencies.submitToKeeperHub(request);
  if (!submission.executionId) throw new Error('KeeperHub returned no execution ID');
  const settlement = await dependencies.awaitSettlement(submission.executionId);
  if (settlement.status !== 'success') {
    throw new Error(`KeeperHub execution did not settle successfully: ${settlement.status}`);
  }
  if (!settlement.txHash) throw new Error('KeeperHub settlement returned no transaction hash');
  if (settlement.sponsored !== true) {
    throw new Error('KeeperHub did not confirm sponsorship');
  }

  const verified = await dependencies.verifyOnchain(
    settlement.txHash,
    previousHeartbeat
  );
  if (verified.receiptStatus !== 'success') throw new Error('Transaction receipt failed');
  if (verified.event !== 'HeartbeatRecorded') {
    throw new Error('Expected HeartbeatRecorded event is missing');
  }
  if (verified.lastHeartbeat <= previousHeartbeat) {
    throw new Error('Onchain lastHeartbeat did not advance');
  }

  return {
    stage: 'verified',
    executionId: submission.executionId,
    txHash: settlement.txHash,
    sponsored: true,
    receiptStatus: 'success',
    event: 'HeartbeatRecorded',
    lastHeartbeat: verified.lastHeartbeat.toString(),
    routeConfidence: 'unavailable',
  };
}

function assertDeadline(rawDeadline: string, nowSeconds: number): void {
  const deadline = Number(rawDeadline);
  if (!Number.isSafeInteger(deadline)) throw new Error('Heartbeat deadline is invalid');
  if (deadline <= nowSeconds || deadline > nowSeconds + MAX_DEADLINE_SECONDS) {
    throw new Error('Heartbeat deadline must be short-lived and in the future');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`Heartbeat ${field} must be a non-empty string`);
  }
  return result;
}
