/**
 * KeeperHub executor — the agent's only path to a transaction.
 *
 * Every method here performs a real call and records the attempt in the audit
 * ledger. There is no simulated path: if something cannot execute it throws.
 * (The previous generation of this file returned a hardcoded
 * `0x` + 'a'.repeat(64) as a "successful" tx hash. verify.sh gate G3 now
 * fails the build if anything like that reappears.)
 *
 * Schemas below were read from the live API via tools/list, not inferred.
 */

import { McpClient, McpError, type IdempotencyRetry } from '../keeperhub/mcp-client';
import { AuditLedger, AuditEntry, Outcome, newExecutionKey } from '../audit/ledger';
import { chooseRoute, confirmRoute, assertRoutesExclusive } from '../keeperhub/route-policy';

export interface ExecutionResult {
  success: boolean;
  executionKey: string;
  keeperhubExecutionId?: string;
  txHash?: string;
  gasUsed?: string;
  attempts: number;
  error?: string;
}

export interface TriggerInfo {
  type: 'scheduled' | 'webhook' | 'manual' | 'panic';
  source: string;
  detail?: string;
}

export interface ContractCallOptions {
  /** >1 raises the gas limit. KeeperHub clamps values below its own floor. */
  gasLimitMultiplier?: number;
  priorityFeeGwei?: number;
  value?: string;
  maxAttempts?: number;
  /**
   * Base backoff between attempts. The default is tuned for transport faults;
   * a precondition that becomes true with time (a grace period that has not
   * elapsed yet) wants a much longer one.
   */
  retryBaseDelayMs?: number;
}

export interface VerificationRequest {
  action: string;
  args: unknown[];
  txHash: string;
}

export interface VerificationResult {
  verified: boolean;
  blockNumber?: number;
  gasUsed?: string;
  event?: string;
  resultingState?: string;
  error?: string;
}

export interface ExecutionVerifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

// KeeperHub reports 'completed' for a settled direct execution — whether the
// call itself succeeded is a separate `result.success` field. Treating
// 'completed' as non-terminal makes the poller wait out its whole timeout on
// a transaction that already landed.
const TERMINAL_STATUSES = ['completed', 'success', 'failed', 'reverted', 'cancelled'];

interface Settlement {
  outcome: Outcome;
  retryKey: IdempotencyRetry;
  txHash?: string;
  gasUsed?: string;
  blockNumber?: number;
  error?: string;
  /** Reported by KeeperHub, never assumed. */
  sponsored?: boolean;
  privateRoute?: boolean;
}

type JsonObject = Record<string, unknown>;
type RouteDecision = ReturnType<typeof chooseRoute>;

const DIRECT_CALL_ABI: Record<string, string> = {
  executeInheritance: JSON.stringify([
    {
      name: 'executeInheritance',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [],
      outputs: [],
    },
  ]),
  executeInheritanceERC20: JSON.stringify([
    {
      name: 'executeInheritanceERC20',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'token', type: 'address' }],
      outputs: [],
    },
  ]),
  evacuate: JSON.stringify([
    {
      name: 'evacuate',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'signature', type: 'bytes' },
      ],
      outputs: [],
    },
  ]),
  heartbeatBySig: JSON.stringify([
    {
      name: 'heartbeatBySig',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'signature', type: 'bytes' },
      ],
      outputs: [],
    },
  ]),
};

interface AttemptResult {
  record: AuditEntry;
  executionId?: string;
  retryKey: IdempotencyRetry;
}

interface AttemptContext {
  executionKey: string;
  attempt: number;
  idempotencyAttempt: number;
  functionName: string;
  args: unknown[];
  trigger: TriggerInfo;
  options: ContractCallOptions;
  routeDecision: RouteDecision;
}

interface Submission {
  executionId: string;
  parsed: JsonObject;
}

export class KeeperHubExecutor {
  constructor(
    private readonly mcp: McpClient,
    private readonly ledger: AuditLedger,
    private readonly chainId: number,
    private readonly contractAddress: string,
    private readonly verifier: ExecutionVerifier
  ) {
    if (!contractAddress) {
      throw new Error('KeeperHubExecutor: contractAddress is required');
    }
  }

  /**
   * Distribute the estate. Permissionless onchain; the keeper is the caller.
   *
   * Defaults are deliberately patient. A keeper that wakes on a cron may fire
   * slightly before the grace period expires and revert with "not yet due";
   * giving up there would strand an estate over a few seconds of drift.
   */
  async executeInheritance(
    trigger: TriggerInfo,
    options: ContractCallOptions = { maxAttempts: 4, retryBaseDelayMs: 45_000 }
  ): Promise<ExecutionResult> {
    return this.contractCall('executeInheritance', [], trigger, options);
  }

  /** Distribute one tracked ERC-20, pulled from the owner's wallet. */
  async executeInheritanceERC20(token: string, trigger: TriggerInfo): Promise<ExecutionResult> {
    return this.contractCall('executeInheritanceERC20', [token], trigger, {});
  }

  /** Emergency sweep. Authorized by the recovery key, never the wallet key. */
  async executeEvacuation(
    params: { nonce: number; deadline: number; signature: string },
    trigger: TriggerInfo,
    options: ContractCallOptions = {}
  ): Promise<ExecutionResult> {
    return this.contractCall(
      'evacuate',
      [params.nonce, params.deadline, params.signature],
      trigger,
      options
    );
  }

  /** Relayed heartbeat, so the owner never needs gas to stay alive. */
  async heartbeatBySig(
    params: { nonce: number; deadline: number; signature: string },
    trigger: TriggerInfo
  ): Promise<ExecutionResult> {
    return this.heartbeatBySigWithOptions(params, trigger, {});
  }

  /** Same, with gas controls exposed — used to exercise the failure path. */
  async heartbeatBySigWithOptions(
    params: { nonce: number; deadline: number; signature: string },
    trigger: TriggerInfo,
    options: ContractCallOptions
  ): Promise<ExecutionResult> {
    return this.contractCall(
      'heartbeatBySig',
      [params.nonce, params.deadline, params.signature],
      trigger,
      options
    );
  }

  /** Read-only contract call through KeeperHub. */
  async read(functionName: string, args: unknown[] = []): Promise<string> {
    return this.mcp.callTool('execute_contract_call', {
      contract_address: this.contractAddress,
      chain_id: String(this.chainId),
      function_name: functionName,
      function_args: JSON.stringify(args),
    });
  }

  async getExecutionStatus(executionId: string): Promise<string> {
    return this.mcp.callTool('get_direct_execution_status', {
      execution_id: executionId,
    });
  }

  // ────────────────────────────────────────────────────────────

  /**
   * One logical action, retried under a shared execution key so the ledger
   * shows the whole story. Unknown outcomes reuse the KeeperHub idempotency
   * key; only confirmed terminal failures rotate it for a fresh attempt. The
   * contract's executed flags remain the second line of defence.
   */
  private async contractCall(
    functionName: string,
    args: unknown[],
    trigger: TriggerInfo,
    options: ContractCallOptions
  ): Promise<ExecutionResult> {
    const executionKey = newExecutionKey(functionName);
    const maxAttempts = options.maxAttempts ?? 3;
    const routeDecision = chooseRoute(functionName);
    let lastError = '';
    let attemptsMade = 0;
    let idempotencyAttempt = 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsMade = attempt;
      const result = await this.runAttempt({
        executionKey,
        attempt,
        idempotencyAttempt,
        functionName,
        args,
        trigger,
        options,
        routeDecision,
      });
      const { record } = result;
      if (record.outcome === 'success') {
        return successfulResult(executionKey, attempt, result);
      }
      lastError = record.error ?? `execution ${record.outcome}`;
      if (result.retryKey === 'none' || attempt === maxAttempts) break;
      if (result.retryKey === 'rotate') idempotencyAttempt += 1;
      await this.pauseBeforeRetry(functionName, attempt, lastError, options);
    }

    return {
      success: false,
      executionKey,
      attempts: attemptsMade,
      error: lastError,
    };
  }

  private async runAttempt(context: AttemptContext): Promise<AttemptResult> {
    const startedAt = Date.now();
    const record = newAuditRecord(context);
    let retryKey: IdempotencyRetry = 'reuse';
    try {
      const submission = await this.submit(context);
      record.keeperhubExecutionId = submission.executionId;
      record.simulation = { ok: true, detail: 'accepted by KeeperHub' };
      const settled = await this.awaitSettlement(submission.executionId);
      retryKey = settled.retryKey;
      this.applySettlement(record, context.routeDecision, settled, submission);
      await this.verifyOnchain(record, context.functionName, context.args);
      return this.finishAttempt(record, startedAt, submission.executionId, retryKey);
    } catch (error) {
      const message = errorMessage(error);
      record.outcome = 'failed';
      record.error = message;
      record.simulation ??= { ok: false, detail: message };
      const failureRetryKey = error instanceof McpError ? error.retryKey : retryKey;
      return this.finishAttempt(record, startedAt, undefined, failureRetryKey);
    }
  }

  private async submit(context: AttemptContext): Promise<Submission> {
    const payload = this.buildPayload(context);
    const raw = await this.mcp.callTool('execute_contract_call', payload);
    const parsed = parseJsonObject(raw);
    const executionId = firstString(parsed, ['execution_id', 'executionId', 'id']);
    if (!executionId) {
      throw new McpError('KeeperHub response missing execution id', -32603, false);
    }
    return { executionId, parsed };
  }

  private buildPayload(context: AttemptContext): Record<string, unknown> {
    const {
      executionKey,
      attempt,
      idempotencyAttempt,
      functionName,
      args,
      options,
      routeDecision,
    } = context;
    const payload: Record<string, unknown> = {
      contract_address: this.contractAddress,
      chain_id: String(this.chainId),
      function_name: functionName,
      function_args: JSON.stringify(args),
      idempotency_key: `${executionKey}-a${idempotencyAttempt}`,
      ...routeDecision.payload,
    };
    const abi = DIRECT_CALL_ABI[functionName];
    if (abi) payload.abi = abi;
    if (options.gasLimitMultiplier !== undefined && attempt === 1) {
      payload.gas_limit_multiplier = String(options.gasLimitMultiplier);
    }
    if (options.priorityFeeGwei !== undefined) {
      payload.priority_fee_gwei = String(options.priorityFeeGwei);
    }
    if (options.value !== undefined) payload.value = options.value;
    return payload;
  }

  private applySettlement(
    record: AuditEntry,
    decision: RouteDecision,
    settled: Settlement,
    submission: Submission
  ): void {
    assertRoutesExclusive(settled);
    const route = confirmRoute(decision, settled);
    record.route = { requested: route.route, confirmed: route.confirmed };
    record.txHash = settled.txHash ?? firstString(submission.parsed, ['tx_hash', 'txHash']);
    record.gasUsed = settled.gasUsed;
    record.blockNumber = settled.blockNumber;
    record.outcome = settled.outcome;
    record.error = settled.error;
  }

  private async verifyOnchain(record: AuditEntry, action: string, args: unknown[]): Promise<void> {
    if (record.outcome !== 'success' || !record.txHash) return;
    const result = await this.verifier.verify({
      action,
      args,
      txHash: record.txHash,
    });
    record.verification = {
      receipt: result.verified,
      event: result.event,
      resultingState: result.resultingState,
      error: result.error,
    };
    record.blockNumber = result.blockNumber ?? record.blockNumber;
    record.gasUsed = result.gasUsed ?? record.gasUsed;
    if (!result.verified) {
      record.outcome = 'failed';
      record.error = result.error ?? 'onchain verification failed';
    }
  }

  private finishAttempt(
    record: AuditEntry,
    startedAt: number,
    executionId: string | undefined,
    retryKey: IdempotencyRetry
  ): AttemptResult {
    record.durationMs = Date.now() - startedAt;
    this.ledger.append(record);
    return { record, executionId, retryKey };
  }

  private async pauseBeforeRetry(
    functionName: string,
    attempt: number,
    lastError: string,
    options: ContractCallOptions
  ): Promise<void> {
    const base = options.retryBaseDelayMs ?? 1000;
    const delay = base * 2 ** (attempt - 1) * (0.5 + Math.random());
    console.log(
      `[executor] ${functionName} attempt ${attempt} failed (${lastError}); ` +
        `retrying in ${Math.round(delay / 1000)}s`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** Poll until KeeperHub reports a terminal state for this execution. */
  private async awaitSettlement(executionId: string, timeoutMs = 180_000): Promise<Settlement> {
    const deadline = Date.now() + timeoutMs;
    let delay = 2000;

    while (Date.now() < deadline) {
      const parsed = parseJsonObject(await this.getExecutionStatus(executionId));
      const status = (firstString(parsed, ['status', 'state']) ?? '').toLowerCase();

      if (TERMINAL_STATUSES.includes(status)) {
        return settlementFrom(parsed, status);
      }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15_000);
    }

    return {
      outcome: 'timeout',
      retryKey: 'reuse',
      error: `no terminal status in ${timeoutMs}ms`,
    };
  }
}

function parseJsonObject(text: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed as JsonObject;
  } catch {
    throw new McpError('KeeperHub tool returned non-JSON content', -32603, false);
  }
}

function newAuditRecord(context: AttemptContext): AuditEntry {
  return {
    executionKey: context.executionKey,
    attempt: context.attempt,
    timestamp: new Date().toISOString(),
    trigger: context.trigger,
    action: context.functionName,
    params: { args: context.args, ...context.options },
    route: { requested: context.routeDecision.route, confirmed: false },
    outcome: 'failed',
  };
}

function successfulResult(
  executionKey: string,
  attempt: number,
  result: AttemptResult
): ExecutionResult {
  return {
    success: true,
    executionKey,
    keeperhubExecutionId: result.executionId,
    txHash: result.record.txHash,
    gasUsed: result.record.gasUsed,
    attempts: attempt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settlementFrom(parsed: JsonObject, status: string): Settlement {
  const inner = objectValue(parsed.result);
  const reverted = firstBoolean(inner, ['reverted']) === true;
  const successFlag = firstBoolean(inner, ['success']);
  const explicitSuccess = status === 'success' || (status === 'completed' && successFlag === true);

  if (status === 'completed' && successFlag === undefined && !reverted && !explicitSuccess) {
    return {
      outcome: 'failed',
      retryKey: 'none',
      error: 'completed settlement has no explicit success signal',
    };
  }

  const txHash =
    firstString(parsed, ['transactionHash', 'tx_hash', 'txHash']) ??
    firstString(inner, ['transactionHash', 'tx_hash', 'txHash']);
  if (explicitSuccess && !txHash) {
    return {
      outcome: 'failed',
      retryKey: 'none',
      error: 'KeeperHub settlement missing transaction hash',
    };
  }

  const confirmedFailure = reverted || successFlag === false || isFailureStatus(status);

  return {
    outcome: settledOutcome(explicitSuccess, reverted, status),
    retryKey: confirmedFailure ? 'rotate' : 'none',
    txHash,
    gasUsed:
      firstScalarString(parsed, ['gasUsedWei', 'gas_used']) ??
      firstScalarString(inner, ['gasUsed', 'gas_used']),
    blockNumber: firstNumber(parsed, ['block_number', 'blockNumber']),
    error:
      firstString(parsed, ['error', 'failure_reason']) ??
      firstString(inner, ['revertReason', 'error']),
    sponsored: firstBoolean(inner, ['sponsored']) ?? firstBoolean(parsed, ['sponsored']),
    privateRoute: firstBoolean(inner, ['privateRoute']) ?? firstBoolean(parsed, ['privateRoute']),
  };
}

function isFailureStatus(status: string): boolean {
  return ['failed', 'reverted', 'cancelled'].includes(status);
}

function settledOutcome(explicitSuccess: boolean, reverted: boolean, status: string): Outcome {
  if (explicitSuccess) return 'success';
  if (reverted || status === 'reverted') return 'reverted';
  return 'failed';
}

function objectValue(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function firstString(object: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function firstBoolean(object: JsonObject, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function firstNumber(object: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstScalarString(object: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
}
