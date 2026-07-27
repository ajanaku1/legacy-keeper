'use client';

import { useEffect, useState } from 'react';
import { EXPLORER } from '@/lib/contract';
import { formatClock, formatGas, shortAddress } from '@/lib/format';

interface Entry {
  executionKey: string;
  attempt: number;
  timestamp: string;
  trigger: { type: string; source: string; detail?: string };
  action: string;
  keeperhubExecutionId?: string;
  txHash?: string;
  gasUsed?: string;
  outcome: string;
  error?: string;
}

const TRIGGER_LABEL: Record<string, string> = {
  scheduled: 'Scheduled trigger',
  webhook: 'Webhook trigger',
  manual: 'Manual relay',
  panic: 'Panic trigger',
};

const ACTION_LABEL: Record<string, string> = {
  executeInheritance: 'Inheritance',
  executeInheritanceERC20: 'Token inheritance',
  evacuate: 'Emergency evacuation',
  heartbeatBySig: 'Heartbeat',
};

export function ExecutionRecord() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/audit')
        .then((r) => r.json())
        .then((d) => setEntries(d.entries ?? []))
        .catch(() => setEntries([]));
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  // Group attempts so a recovery reads as one story rather than four rows.
  const keys = [...new Set((entries ?? []).map((e) => e.executionKey))];
  const recovered = new Set(
    keys.filter((key) => {
      const group = (entries ?? []).filter((e) => e.executionKey === key);
      return (
        group.some((e) => e.outcome !== 'success') &&
        group.some((e) => e.outcome === 'success')
      );
    })
  );

  return (
    <section className="ledger" id="evidence" aria-labelledby="evidence-title">
      <div className="card-head">
        <h2 id="evidence-title">Execution record</h2>
        <span className="badge">
          {entries === null ? 'loading' : `${entries.length} entries`}
        </span>
      </div>
      <p className="evidence-intro">
        A successful result never erases the failure before it. The complete route stays visible
        and independently verifiable on Etherscan.
      </p>

      {entries !== null && entries.length === 0 && (
        <p className="empty" style={{ color: '#b9bcaf' }}>
          No executions recorded yet. This reads the agent&rsquo;s audit ledger directly — it stays
          empty until the agent actually runs.
        </p>
      )}

      {(entries ?? []).map((e, i) => {
        const ok = e.outcome === 'success';
        const isRecovery = ok && recovered.has(e.executionKey) && e.attempt > 1;
        return (
          <article className={`event ${ok ? 'success' : 'failed'}`} key={`${e.executionKey}-${e.attempt}-${i}`}>
            <time dateTime={e.timestamp}>
              {formatClock(e.timestamp)}
              <br />
              attempt {String(e.attempt).padStart(2, '0')}
            </time>
            <span className="event-marker" aria-hidden="true" />
            <div className="event-body">
              <strong>
                {ACTION_LABEL[e.action] ?? e.action}
                {isRecovery ? ' completed after recovery' : ok ? ' completed' : ` paused — ${e.error ? cleanError(e.error) : e.outcome}`}
              </strong>
              <span>
                {TRIGGER_LABEL[e.trigger?.type] ?? e.trigger?.type}
                {' · '}
                {ok ? formatGas(e.gasUsed) : 'no transaction sent · retry retained'}
                {e.keeperhubExecutionId ? ` · KeeperHub ${shortAddress(e.keeperhubExecutionId, 4, 3)}` : ''}
              </span>
            </div>
            {e.txHash ? (
              <a className="event-proof" href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                View proof ↗
              </a>
            ) : (
              <span className="event-proof">Failure preserved</span>
            )}
          </article>
        );
      })}
    </section>
  );
}

/** "Contract call failed: Error(LK: not yet due)" → "not yet due" */
function cleanError(raw: string): string {
  const match = raw.match(/Error\(LK: ([^)]+)\)/);
  return match ? match[1] : raw.slice(0, 60);
}
