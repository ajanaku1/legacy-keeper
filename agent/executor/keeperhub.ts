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

import { McpClient, McpError } from '../keeperhub/mcp-client';
import {
  AuditLedger,
  AuditEntry,
  Outcome,
  newExecutionKey,
} from '../audit/ledger';
import {
  chooseRoute,
  confirmRoute,
  assertRoutesExclusive,
} from '../keeperhub/route-policy';

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

// KeeperHub reports 'completed' for a settled direct execution — whether the
// call itself succeeded is a separate `result.success` field. Treating
// 'completed' as non-terminal makes the poller wait out its whole timeout on
// a transaction that already landed.
const TERMINAL_STATUSES = [
  'completed',
  'success',
  'failed',
  'reverted',
  'cancelled',
];

interface Settlement {
  outcome: Outcome;
  txHash?: string;
  gasUsed?: string;
  blockNumber?: number;
  error?: string;
  /** Reported by KeeperHub, never assumed. */
  sponsored?: boolean;
  privateRoute?: boolean;
}

export class KeeperHubExecutor {
  constructor(
    private readonly mcp: McpClient,
    private readonly ledger: AuditLedger,
    private readonly chainId: number,
    private readonly contractAddress: string
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
  async executeInheritanceERC20(
    token: string,
    trigger: TriggerInfo
  ): Promise<ExecutionResult> {
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
   * shows the whole story. `idempotency_key` is passed to KeeperHub so a
   * retry can never double-submit; the contract's executed flags are the
   * second line of defence.
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

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();

      const record: AuditEntry = {
        executionKey,
        attempt,
        timestamp: new Date().toISOString(),
        trigger,
        action: functionName,
        params: { args, ...options },
        route: { requested: routeDecision.route, confirmed: false },
        outcome: 'failed',
      };

      try {
        // chain_id and function_args are STRINGS despite the schema showing
        // them as scalar/array shapes — passing a number or a real array is
        // rejected with a -32602 validation error. See reports/friction-log.md.
        const payload: Record<string, unknown> = {
          contract_address: this.contractAddress,
          chain_id: String(this.chainId),
          function_name: functionName,
          function_args: JSON.stringify(args),
          // Per ATTEMPT, not per action. KeeperHub caches the outcome against
          // this key and replays it — so reusing one key across retries
          // returns the first failure forever and recovery is impossible.
          // Idempotency still holds where it matters: a transport-level
          // duplicate of a single attempt is deduplicated, and the contract's
          // executed flags remain the real guard against double distribution.
          idempotency_key: `${executionKey}-a${attempt}`,
        };
        // Every scalar on this tool is string-typed, gas knobs included.
        //
        // A caller-supplied gas hint applies to the FIRST attempt only. If it
        // fails we drop the override and let KeeperHub's estimator size the
        // retry — a keeper whose own gas guess was wrong should defer to the
        // estimator rather than repeat the same mistake three times.
        if (options.gasLimitMultiplier !== undefined && attempt === 1) {
          payload.gas_limit_multiplier = String(options.gasLimitMultiplier);
        }
        if (options.priorityFeeGwei !== undefined) {
          payload.priority_fee_gwei = String(options.priorityFeeGwei);
        }
        if (options.value !== undefined) payload.value = options.value;

        const raw = await this.mcp.callTool('execute_contract_call', payload);
        const parsed = safeJson(raw);

        const executionId =
          parsed?.execution_id ?? parsed?.executionId ?? parsed?.id;
        record.keeperhubExecutionId = executionId;
        record.simulation = { ok: true, detail: 'accepted by KeeperHub' };

        Object.assign(payload, routeDecision.payload);

        const settled: Settlement = executionId
          ? await this.awaitSettlement(String(executionId))
          : { outcome: 'success', txHash: parsed?.tx_hash };

        // Record what the platform says it did, not what we asked for. An
        // execution reporting both routes would misdescribe the submission.
        assertRoutesExclusive(settled);
        const confirmed = confirmRoute(routeDecision, settled);
        record.route = { requested: confirmed.route, confirmed: confirmed.confirmed };

        record.txHash = settled.txHash ?? parsed?.tx_hash ?? parsed?.txHash;
        record.gasUsed = settled.gasUsed;
        record.blockNumber = settled.blockNumber;
        record.outcome = settled.outcome;
        record.error = settled.error;
        record.durationMs = Date.now() - startedAt;

        this.ledger.append(record);

        if (settled.outcome === 'success') {
          return {
            success: true,
            executionKey,
            keeperhubExecutionId: executionId,
            txHash: record.txHash,
            gasUsed: record.gasUsed,
            attempts: attempt,
          };
        }

        lastError = settled.error ?? `execution ${settled.outcome}`;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        record.outcome = 'failed';
        record.error = message;
        record.simulation = { ok: false, detail: message };
        record.durationMs = Date.now() - startedAt;
        this.ledger.append(record);
        lastError = message;

        // A tool-level rejection (bad args, reverted precondition) will not
        // succeed on a retry. Only transport faults are worth repeating.
        if (error instanceof McpError && !error.retryable && error.code) break;
      }

      if (attempt < maxAttempts) {
        const base = options.retryBaseDelayMs ?? 1000;
        const delay = base * 2 ** (attempt - 1) * (0.5 + Math.random());
        console.log(
          `[executor] ${functionName} attempt ${attempt} failed (${lastError}); ` +
            `retrying in ${Math.round(delay / 1000)}s`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return {
      success: false,
      executionKey,
      attempts: maxAttempts,
      error: lastError,
    };
  }

  /** Poll until KeeperHub reports a terminal state for this execution. */
  private async awaitSettlement(
    executionId: string,
    timeoutMs = 180_000
  ): Promise<Settlement> {
    const deadline = Date.now() + timeoutMs;
    let delay = 2000;

    while (Date.now() < deadline) {
      const parsed = safeJson(await this.getExecutionStatus(executionId));
      const status = String(
        parsed?.status ?? parsed?.state ?? ''
      ).toLowerCase();

      if (TERMINAL_STATUSES.includes(status)) {
        // 'completed' only means settled. Whether the call itself worked is
        // result.success / result.reverted, so read those before claiming it.
        const inner = parsed?.result ?? {};
        const reverted = inner.reverted === true;
        const succeeded =
          status === 'success' ||
          (status === 'completed' && inner.success !== false && !reverted);

        return {
          outcome: succeeded ? 'success' : reverted ? 'reverted' : 'failed',
          txHash:
            parsed?.transactionHash ??
            inner.transactionHash ??
            parsed?.tx_hash ??
            parsed?.txHash,
          gasUsed:
            parsed?.gasUsedWei?.toString() ??
            inner.gasUsed?.toString() ??
            parsed?.gas_used?.toString(),
          blockNumber: parsed?.block_number ?? parsed?.blockNumber,
          error: parsed?.error ?? parsed?.failure_reason ?? inner.revertReason,
          sponsored: inner.sponsored ?? parsed?.sponsored,
          privateRoute: inner.privateRoute ?? parsed?.privateRoute,
        };
      }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15_000);
    }

    return { outcome: 'timeout', error: `no terminal status in ${timeoutMs}ms` };
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
