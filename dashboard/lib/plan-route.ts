import { zeroAddress, type Address } from 'viem';
import { ActionError, withActionEvidence } from './action-error';
import {
  assertSepolia,
  assertSettlement,
  assertSigner,
  assertSigningDeadline,
  assertUniqueAddresses,
  exactObject,
  requiredAddress,
  requiredBoolean,
  requiredInteger,
  requiredString,
  sameAddress,
} from './action-validation';
import type {
  KeeperHubSettlement,
  KeeperHubSubmission,
} from './heartbeat-route';

export interface PlanConfigRequest {
  heartbeatInterval: number;
  timeoutDuration: number;
  gracePeriod: number;
  beneficiaryWallets: Address[];
  beneficiaryShares: number[];
  recoveryKey: Address;
  safeVault: Address;
  trackedTokens: Address[];
  allowSharedRecovery: boolean;
}

export interface PlanCreationRequest {
  chainId: number;
  owner: Address;
  config: PlanConfigRequest;
  nonce: string;
  deadline: string;
  signature: string;
}

export interface PlanCreationProof {
  receiptStatus: string;
  target?: Address;
  event?: string;
  eventOwner?: Address;
  plan?: Address;
  registeredPlan?: Address;
  initialized: boolean;
}

export interface PlanCreationDependencies {
  nowSeconds: () => number;
  factoryAddress: Address;
  readRegisteredPlan: (owner: Address) => Promise<Address>;
  recoverSigner: (request: PlanCreationRequest) => Promise<Address>;
  nextIdempotencyKey: () => string;
  submitToKeeperHub: (
    request: PlanCreationRequest,
    idempotencyKey: string
  ) => Promise<KeeperHubSubmission>;
  awaitSettlement: (executionId: string) => Promise<KeeperHubSettlement>;
  verifyOnchain: (
    txHash: `0x${string}`,
    owner: Address
  ) => Promise<PlanCreationProof>;
}

export interface VerifiedPlanEvidence {
  stage: 'verified';
  executionId: string;
  idempotencyKey: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: 'success';
  event: 'PlanCreated';
  owner: Address;
  plan: Address;
  initialized: true;
}

const REQUEST_FIELDS = [
  'chainId',
  'owner',
  'config',
  'nonce',
  'deadline',
  'signature',
] as const;
const CONFIG_FIELDS = [
  'heartbeatInterval',
  'timeoutDuration',
  'gracePeriod',
  'beneficiaryWallets',
  'beneficiaryShares',
  'recoveryKey',
  'safeVault',
  'trackedTokens',
  'allowSharedRecovery',
] as const;

export function parsePlanCreationRequest(value: unknown): PlanCreationRequest {
  const request = exactObject(value, REQUEST_FIELDS, 'Plan creation request');
  const config = parseConfig(request.config);
  return {
    chainId: requiredInteger(request.chainId, 'chainId'),
    owner: requiredAddress(request.owner, 'owner'),
    config,
    nonce: requiredString(request.nonce, 'nonce'),
    deadline: requiredString(request.deadline, 'deadline'),
    signature: requiredString(request.signature, 'signature'),
  };
}

export async function executePlanCreation(
  rawRequest: PlanCreationRequest,
  deps: PlanCreationDependencies
): Promise<VerifiedPlanEvidence> {
  const request = parsePlanCreationRequest(rawRequest);
  assertSepolia(request.chainId);
  assertSigningDeadline(request.deadline, deps.nowSeconds());
  assertRecoverySeparation(request);
  const registered = await deps.readRegisteredPlan(request.owner);
  if (registered !== zeroAddress) {
    throw new ActionError('PLAN_ALREADY_EXISTS', 'This wallet already has a plan.');
  }
  assertSigner(await deps.recoverSigner(request), request.owner);
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
  const proof = await withActionEvidence(
    { ...executionEvidence, txHash: settlement.txHash },
    async () => {
      const result = await deps.verifyOnchain(settlement.txHash, request.owner);
      assertPlanProof(result, request.owner, deps.factoryAddress);
      return result;
    }
  );
  return verifiedEvidence(request, submission.executionId, idempotencyKey, settlement.txHash, proof.plan as Address);
}

function parseConfig(value: unknown): PlanConfigRequest {
  const config = exactObject(value, CONFIG_FIELDS, 'Plan config');
  const beneficiaryWallets = addressList(config.beneficiaryWallets, 'beneficiary');
  const beneficiaryShares = integerList(config.beneficiaryShares, 'beneficiary share');
  if (beneficiaryWallets.length !== beneficiaryShares.length) {
    throw new ActionError('INVALID_REQUEST', 'Beneficiary addresses and shares must match.');
  }
  if (beneficiaryWallets.length < 1 || beneficiaryWallets.length > 10) {
    throw new ActionError('INVALID_REQUEST', 'Add between 1 and 10 beneficiaries.');
  }
  if (beneficiaryShares.reduce((sum, share) => sum + share, 0) !== 10_000) {
    throw new ActionError('INVALID_REQUEST', 'Beneficiary shares must total 10,000 bps.');
  }
  assertUniqueAddresses(beneficiaryWallets, 'beneficiary');
  const trackedTokens = addressList(config.trackedTokens, 'tracked token');
  assertUniqueAddresses(trackedTokens, 'tracked token');
  return {
    heartbeatInterval: requiredInteger(config.heartbeatInterval, 'heartbeatInterval'),
    timeoutDuration: requiredInteger(config.timeoutDuration, 'timeoutDuration'),
    gracePeriod: requiredInteger(config.gracePeriod, 'gracePeriod'),
    beneficiaryWallets,
    beneficiaryShares,
    recoveryKey: requiredAddress(config.recoveryKey, 'recoveryKey'),
    safeVault: requiredAddress(config.safeVault, 'safeVault'),
    trackedTokens,
    allowSharedRecovery: requiredBoolean(
      config.allowSharedRecovery,
      'allowSharedRecovery'
    ),
  };
}

function addressList(value: unknown, label: string): Address[] {
  if (!Array.isArray(value)) {
    throw new ActionError('INVALID_REQUEST', `${label} list must be an array.`);
  }
  return value.map((item) => requiredAddress(item, label));
}

function integerList(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new ActionError('INVALID_REQUEST', `${label} list must be an array.`);
  }
  return value.map((item) => requiredInteger(item, label));
}

function assertRecoverySeparation(request: PlanCreationRequest): void {
  const { config, owner } = request;
  if (sameAddress(config.recoveryKey, owner) || sameAddress(config.safeVault, owner)) {
    throw new ActionError('INVALID_REQUEST', 'Recovery addresses cannot be the owner wallet.');
  }
  if (
    sameAddress(config.recoveryKey, config.safeVault) &&
    !config.allowSharedRecovery
  ) {
    throw new ActionError('INVALID_REQUEST', 'Shared recovery authority requires acknowledgement.');
  }
}

function assertPlanProof(
  proof: PlanCreationProof,
  owner: Address,
  factory: Address
): void {
  const valid =
    proof.receiptStatus === 'success' &&
    sameAddress(proof.target, factory) &&
    proof.event === 'PlanCreated' &&
    sameAddress(proof.eventOwner, owner) &&
    sameAddress(proof.plan, proof.registeredPlan) &&
    proof.plan !== zeroAddress &&
    proof.initialized;
  if (!valid) {
    throw new ActionError(
      'UNVERIFIED_RESULT',
      'Receipt, PlanCreated event, registry, and plan state did not agree.'
    );
  }
}

function verifiedEvidence(
  request: PlanCreationRequest,
  executionId: string,
  idempotencyKey: string,
  txHash: `0x${string}`,
  plan: Address
): VerifiedPlanEvidence {
  return {
    stage: 'verified',
    executionId,
    idempotencyKey,
    txHash,
    sponsored: true,
    receiptStatus: 'success',
    event: 'PlanCreated',
    owner: request.owner,
    plan,
    initialized: true,
  };
}
