/**
 * Append-only execution audit ledger (predicate C2).
 *
 * Every onchain action the agent attempts lands here with the full story:
 * what triggered it, what the simulation said, what was submitted, what it
 * cost, and how it ended. Retries append a new record rather than mutating
 * the old one, so a failure followed by a success stays visible as two
 * entries — which is the point. An audit trail that only shows the happy
 * path is not evidence of reliability.
 *
 * JSONL on disk: append-only, survives a crash mid-write, and greppable.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Outcome = 'success' | 'failed' | 'reverted' | 'timeout' | 'skipped';

export interface AuditEntry {
  /** Stable across retries of the same logical action. */
  executionKey: string;
  attempt: number;
  timestamp: string;

  trigger: {
    type: 'scheduled' | 'webhook' | 'manual' | 'panic';
    source: string;
    detail?: string;
  };

  action: string;
  params: Record<string, unknown>;

  simulation?: {
    ok: boolean;
    detail?: string;
  };

  keeperhubExecutionId?: string;
  txHash?: string;
  gasUsed?: string;
  blockNumber?: number;
  verification?: {
    receipt: boolean;
    event?: string;
    resultingState?: string;
    error?: string;
  };

  /**
   * Which submission path was asked for, and whether KeeperHub confirmed it.
   * Recorded separately because an intended route is not evidence of the
   * route actually used.
   */
  route?: {
    requested: 'sponsored' | 'private' | 'default';
    confirmed: boolean;
  };

  outcome: Outcome;
  error?: string;
  durationMs?: number;
}

export class AuditLedger {
  constructor(private readonly path: string = 'loop/memory/audit.jsonl') {
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  append(entry: AuditEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + '\n', 'utf8');
  }

  all(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  byKey(executionKey: string): AuditEntry[] {
    return this.all().filter((e) => e.executionKey === executionKey);
  }

  /**
   * Execution keys that failed at least once and later succeeded. This is the
   * C3 evidence: proof the retry path is real and not just configured.
   */
  recoveredAfterFailure(): string[] {
    const byKey = new Map<string, AuditEntry[]>();
    for (const e of this.all()) {
      const list = byKey.get(e.executionKey) ?? [];
      list.push(e);
      byKey.set(e.executionKey, list);
    }

    const recovered: string[] = [];
    for (const [key, entries] of byKey) {
      const ordered = entries.sort((a, b) => a.attempt - b.attempt);
      const failedFirst = ordered.some(
        (e) => e.outcome !== 'success' && e.outcome !== 'skipped'
      );
      const succeededLater = ordered[ordered.length - 1]?.outcome === 'success';
      if (failedFirst && succeededLater) recovered.push(key);
    }
    return recovered;
  }

  summary(): {
    total: number;
    success: number;
    failed: number;
    recovered: number;
    totalGas: bigint;
  } {
    const entries = this.all();
    return {
      total: entries.length,
      success: entries.filter((e) => e.outcome === 'success').length,
      failed: entries.filter((e) => e.outcome === 'failed' || e.outcome === 'reverted')
        .length,
      recovered: this.recoveredAfterFailure().length,
      totalGas: entries.reduce(
        (sum, e) => sum + (e.gasUsed ? BigInt(e.gasUsed) : 0n),
        0n
      ),
    };
  }
}

/** Groups every attempt at one logical action under a single key. */
export function newExecutionKey(action: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${action}-${stamp}-${rand}`;
}
