import type { Address } from 'viem';
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

export type ConfigurationAction =
  | 'beneficiaries'
  | 'liveness'
  | 'recovery'
  | 'trackedTokens';

export type ConfigurationPayload =
  | { wallets: Address[]; shares: number[] }
  | { heartbeatInterval: number; timeoutDuration: number; gracePeriod: number }
  | { recoveryKey: Address; safeVault: Address; allowSharedRecovery: boolean }
  | { tokens: Address[] };

export interface ConfigurationRequest {
  chainId: number;
  owner: Address;
  plan: Address;
  action: ConfigurationAction;
  payload: ConfigurationPayload;
  nonce: string;
  deadline: string;
  signature: string;
}

export interface ConfigurationProof {
  receiptStatus: string;
  target?: Address;
  event?: string;
  stateMatches: boolean;
}

export interface ConfigurationDependencies {
  nowSeconds: () => number;
  readRegisteredPlan: (owner: Address) => Promise<Address>;
  readPlanOwner: (plan: Address) => Promise<Address>;
  readExpectedSigner: (
    plan: Address,
    action: ConfigurationAction
  ) => Promise<Address>;
  recoverSigner: (request: ConfigurationRequest) => Promise<Address>;
  nextIdempotencyKey: () => string;
  submitToKeeperHub: (
    request: ConfigurationRequest,
    idempotencyKey: string
  ) => Promise<KeeperHubSubmission>;
  awaitSettlement: (executionId: string) => Promise<KeeperHubSettlement>;
  verifyOnchain: (
    request: ConfigurationRequest,
    txHash: `0x${string}`
  ) => Promise<ConfigurationProof>;
}

export interface VerifiedConfigurationEvidence {
  stage: 'verified';
  action: ConfigurationAction;
  executionId: string;
  idempotencyKey: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: 'success';
  event: string;
  plan: Address;
}

const REQUEST_FIELDS = [
  'chainId',
  'owner',
  'plan',
  'action',
  'payload',
  'nonce',
  'deadline',
  'signature',
] as const;

export function parseConfigurationRequest(value: unknown): ConfigurationRequest {
  const request = exactObject(value, REQUEST_FIELDS, 'Configuration request');
  const action = parseAction(request.action);
  return {
    chainId: requiredInteger(request.chainId, 'chainId'),
    owner: requiredAddress(request.owner, 'owner'),
    plan: requiredAddress(request.plan, 'plan'),
    action,
    payload: parsePayload(action, request.payload),
    nonce: requiredString(request.nonce, 'nonce'),
    deadline: requiredString(request.deadline, 'deadline'),
    signature: requiredString(request.signature, 'signature'),
  };
}

export async function executeConfiguration(
  rawRequest: ConfigurationRequest,
  deps: ConfigurationDependencies
): Promise<VerifiedConfigurationEvidence> {
  const request = parseConfigurationRequest(rawRequest);
  assertSepolia(request.chainId);
  assertSigningDeadline(request.deadline, deps.nowSeconds());
  const registeredPlan = await deps.readRegisteredPlan(request.owner);
  if (!sameAddress(registeredPlan, request.plan)) {
    throw new ActionError('PLAN_MISMATCH', 'Factory registry does not match this plan.');
  }
  const planOwner = await deps.readPlanOwner(request.plan);
  if (!sameAddress(planOwner, request.owner)) {
    throw new ActionError('WRONG_OWNER', 'The connected wallet does not own this plan.');
  }
  const expectedSigner = await deps.readExpectedSigner(request.plan, request.action);
  assertSigner(await deps.recoverSigner(request), expectedSigner);
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
  const expectedEvent = eventFor(request.action);
  await withActionEvidence(
    { ...executionEvidence, txHash: settlement.txHash },
    async () => {
      const proof = await deps.verifyOnchain(request, settlement.txHash);
      if (
        proof.receiptStatus !== 'success' ||
        !sameAddress(proof.target, request.plan) ||
        proof.event !== expectedEvent ||
        !proof.stateMatches
      ) {
        throw new ActionError(
          'UNVERIFIED_RESULT',
          'Receipt, configuration event, and resulting state did not agree.'
        );
      }
    }
  );
  return {
    stage: 'verified',
    action: request.action,
    executionId: submission.executionId,
    idempotencyKey,
    txHash: settlement.txHash,
    sponsored: true,
    receiptStatus: 'success',
    event: expectedEvent,
    plan: request.plan,
  };
}

function parseAction(value: unknown): ConfigurationAction {
  if (
    value === 'beneficiaries' ||
    value === 'liveness' ||
    value === 'recovery' ||
    value === 'trackedTokens'
  ) {
    return value;
  }
  throw new ActionError('INVALID_REQUEST', 'Configuration action is unsupported.');
}

function parsePayload(
  action: ConfigurationAction,
  value: unknown
): ConfigurationPayload {
  if (action === 'beneficiaries') return parseBeneficiaries(value);
  if (action === 'liveness') return parseLiveness(value);
  if (action === 'recovery') return parseRecovery(value);
  const payload = exactObject(value, ['tokens'], 'Tracked-token payload');
  const tokens = addressList(payload.tokens, 'tracked token');
  assertUniqueAddresses(tokens, 'tracked token');
  return { tokens };
}

function parseBeneficiaries(value: unknown): ConfigurationPayload {
  const payload = exactObject(value, ['wallets', 'shares'], 'Beneficiary payload');
  const wallets = addressList(payload.wallets, 'beneficiary');
  const shares = integerList(payload.shares, 'beneficiary share');
  if (wallets.length !== shares.length || wallets.length < 1 || wallets.length > 10) {
    throw new ActionError('INVALID_REQUEST', 'Add 1 to 10 matching beneficiary shares.');
  }
  if (shares.reduce((total, share) => total + share, 0) !== 10_000) {
    throw new ActionError('INVALID_REQUEST', 'Beneficiary shares must total 10,000 bps.');
  }
  assertUniqueAddresses(wallets, 'beneficiary');
  return { wallets, shares };
}

function parseLiveness(value: unknown): ConfigurationPayload {
  const payload = exactObject(
    value,
    ['heartbeatInterval', 'timeoutDuration', 'gracePeriod'],
    'Liveness payload'
  );
  return {
    heartbeatInterval: requiredInteger(payload.heartbeatInterval, 'heartbeatInterval'),
    timeoutDuration: requiredInteger(payload.timeoutDuration, 'timeoutDuration'),
    gracePeriod: requiredInteger(payload.gracePeriod, 'gracePeriod'),
  };
}

function parseRecovery(value: unknown): ConfigurationPayload {
  const payload = exactObject(
    value,
    ['recoveryKey', 'safeVault', 'allowSharedRecovery'],
    'Recovery payload'
  );
  return {
    recoveryKey: requiredAddress(payload.recoveryKey, 'recoveryKey'),
    safeVault: requiredAddress(payload.safeVault, 'safeVault'),
    allowSharedRecovery: requiredBoolean(
      payload.allowSharedRecovery,
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

export function eventFor(action: ConfigurationAction): string {
  if (action === 'beneficiaries') return 'BeneficiaryAdded';
  if (action === 'trackedTokens') return 'TrackedTokensUpdated';
  return 'ConfigUpdated';
}
