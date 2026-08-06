import { ActionError } from './action-error';
import type {
  ActivityRepository,
  ActivityWriteEntry,
} from './activity-ledger';
import { serverActivityRepository } from './activity-server';

export type AuditedAction =
  | 'createPlan'
  | 'configurePlan'
  | 'heartbeatBySig'
  | 'evacuate';

interface AuditOptions {
  repository?: ActivityRepository;
  now?: () => Date;
}

export async function runAuditedAction<Result>(
  action: AuditedAction,
  request: unknown,
  execute: () => Promise<Result>,
  options: AuditOptions = {}
): Promise<Result> {
  try {
    const result = await execute();
    await safelyRecord(action, request, result, undefined, options);
    return result;
  } catch (error) {
    await safelyRecord(action, request, undefined, error, options);
    throw error;
  }
}

async function safelyRecord(
  action: AuditedAction,
  request: unknown,
  result: unknown,
  error: unknown,
  options: AuditOptions
): Promise<void> {
  try {
    const repository = options.repository ?? serverActivityRepository();
    await repository.append(
      buildEntry(action, request, result, error, options.now?.() ?? new Date())
    );
  } catch (auditError) {
    console.error('Unable to persist LegacyKeeper activity entry.', auditError);
  }
}

function buildEntry(
  action: AuditedAction,
  request: unknown,
  result: unknown,
  error: unknown,
  now: Date
): ActivityWriteEntry {
  const owner = requestOwner(request);
  if (!owner) throw new Error('Activity owner is required.');
  const executionKey = buildExecutionKey(action, owner, request);
  const evidence = objectRecord(result);
  const failureEvidence =
    error instanceof ActionError ? objectRecord(error.evidence) : undefined;
  const failure = errorDetails(error);
  const executionId =
    stringField(evidence, 'executionId') ??
    stringField(failureEvidence, 'executionId');
  const txHash =
    stringField(evidence, 'txHash') ?? stringField(failureEvidence, 'txHash');
  return {
    id: crypto.randomUUID(),
    executionKey,
    owner: owner.toLowerCase(),
    timestamp: now,
    trigger: triggerFor(action),
    action,
    ...(executionId ? { keeperhubExecutionId: executionId } : {}),
    ...(txHash ? { txHash } : {}),
    outcome: error === undefined ? 'success' : 'failed',
    ...failure,
  };
}

function buildExecutionKey(
  action: AuditedAction,
  owner: string | undefined,
  request: unknown
): string {
  const value = objectRecord(request);
  const ownerKey = owner?.toLowerCase() ?? 'unknown-owner';
  const nonce = stringField(value, 'nonce') ?? crypto.randomUUID();
  return `${action}:${ownerKey}:${nonce}`;
}

function requestOwner(request: unknown): string | undefined {
  return stringField(objectRecord(request), 'owner');
}

function errorDetails(
  error: unknown
): Pick<ActivityWriteEntry, 'error' | 'errorCode'> {
  if (error === undefined) return {};
  if (error instanceof ActionError) {
    return { error: error.message, errorCode: error.code };
  }
  return {
    error: error instanceof Error ? error.message : 'Execution failed',
    errorCode: 'KEEPERHUB_REJECTED',
  };
}

function triggerFor(action: AuditedAction): ActivityWriteEntry['trigger'] {
  if (action === 'evacuate') return { type: 'panic', source: 'dashboard' };
  return { type: 'webhook', source: 'dashboard' };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string
): string | undefined {
  const item = value?.[field];
  return typeof item === 'string' && item ? item : undefined;
}
