'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EXPLORER } from '@/lib/contract';
import { formatClock, formatGas, shortAddress } from '@/lib/format';
import { useApplication } from '@/components/shell/ApplicationShell';

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
  errorCode?: string;
}

interface ActivityPage {
  entries: Entry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const TRIGGER_LABEL: Record<string, string> = {
  scheduled: 'Scheduled trigger',
  webhook: 'Webhook trigger',
  manual: 'Manual relay',
  panic: 'Panic trigger',
};

const ACTION_LABEL: Record<string, string> = {
  createPlan: 'Plan creation',
  configurePlan: 'Plan configuration',
  executeInheritance: 'Inheritance',
  executeInheritanceERC20: 'Token inheritance',
  evacuate: 'Emergency evacuation',
  heartbeatBySig: 'Heartbeat',
};

export function ExecutionRecord() {
  const owner = useApplication().address;
  return <WalletExecutionRecord key={owner ?? 'disconnected'} owner={owner} />;
}

function WalletExecutionRecord({ owner }: { owner?: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['wallet-activity', owner, page],
    queryFn: () => loadActivity(owner ?? '', page),
    enabled: Boolean(owner),
    refetchInterval: 10_000,
  });
  const activity = owner ? (query.data ?? null) : emptyActivity();
  const entries = activity?.entries ?? [];

  return (
    <section className="ledger" id="evidence" aria-labelledby="evidence-title">
      <ActivityHeading activity={activity} unavailable={query.isError} />
      <p className="evidence-intro">
        A successful result never erases the failure before it. The complete route stays visible
        and independently verifiable on Etherscan.
      </p>

      {query.isError && (
        <div className="empty" role="alert">
          <p>Activity is temporarily unavailable.</p>
          <button
            type="button"
            className="secondary compact"
            onClick={() => void query.refetch()}
          >
            Retry activity
          </button>
        </div>
      )}
      {!query.isError && activity !== null && entries.length === 0 && (
        <p className="empty" style={{ color: '#b9bcaf' }}>
          No executions recorded for this wallet yet.
        </p>
      )}
      <ActivityEntries entries={entries} />
      <ActivityPagination activity={activity} changePage={setPage} />
    </section>
  );
}

function ActivityHeading({
  activity,
  unavailable,
}: {
  activity: ActivityPage | null;
  unavailable: boolean;
}) {
  return (
    <div className="card-head">
      <h2 id="evidence-title">Execution record</h2>
      <span className="badge">{activityStatus(activity, unavailable)}</span>
    </div>
  );
}

function activityStatus(
  activity: ActivityPage | null,
  unavailable: boolean
): string {
  if (unavailable) return 'unavailable';
  if (activity === null) return 'loading';
  return `${activity.total} activities`;
}

function ActivityEntries({ entries }: { entries: readonly Entry[] }) {
  const recovered = recoveredExecutionKeys(entries);
  return entries.map((entry, index) => (
    <ActivityEvent
      key={`${entry.executionKey}-${entry.attempt}-${index}`}
      entry={entry}
      recovered={recovered.has(entry.executionKey) && entry.attempt > 1}
    />
  ));
}

function ActivityEvent({
  entry,
  recovered,
}: {
  entry: Entry;
  recovered: boolean;
}) {
  const successful = entry.outcome === 'success';
  return (
    <article className={`event ${successful ? 'success' : 'failed'}`}>
      <time dateTime={entry.timestamp}>
        {formatClock(entry.timestamp)}
        <br />
        attempt {String(entry.attempt).padStart(2, '0')}
      </time>
      <span className="event-marker" aria-hidden="true" />
      <div className="event-body">
        <strong>
          {ACTION_LABEL[entry.action] ?? entry.action}
          {outcomeLabel(entry, successful && recovered, successful)}
        </strong>
        <span>
          {TRIGGER_LABEL[entry.trigger?.type] ?? entry.trigger?.type}
          {' · '}
          {successful ? formatGas(entry.gasUsed) : 'no transaction sent · retry retained'}
          {entry.keeperhubExecutionId
            ? ` · KeeperHub ${shortAddress(entry.keeperhubExecutionId, 4, 3)}`
            : ''}
        </span>
      </div>
      <ActivityProof entry={entry} />
    </article>
  );
}

function ActivityProof({ entry }: { entry: Entry }) {
  return entry.txHash ? (
    <a className="event-proof" href={`${EXPLORER}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">
      View proof ↗
    </a>
  ) : (
    <span className="event-proof">Failure preserved</span>
  );
}

function ActivityPagination({
  activity,
  changePage,
}: {
  activity: ActivityPage | null;
  changePage: Dispatch<SetStateAction<number>>;
}) {
  if (!activity || activity.totalPages <= 1) return null;
  return (
    <nav className="ledger-pagination" aria-label="Activity pages">
      <button
        type="button"
        className="secondary compact"
        aria-label="Show newer activity"
        disabled={activity.page <= 1}
        onClick={() => changePage((current) => Math.max(1, current - 1))}
      >
        ← Newer
      </button>
      <span>Page {activity.page} of {activity.totalPages}</span>
      <button
        type="button"
        className="secondary compact"
        aria-label="Show older activity"
        disabled={activity.page >= activity.totalPages}
        onClick={() => changePage((current) => current + 1)}
      >
        Older →
      </button>
    </nav>
  );
}

function recoveredExecutionKeys(entries: readonly Entry[]): Set<string> {
  const keys = new Set(entries.map((entry) => entry.executionKey));
  return new Set(
    [...keys].filter((key) => {
      const attempts = entries.filter((entry) => entry.executionKey === key);
      return (
        attempts.some((entry) => entry.outcome !== 'success') &&
        attempts.some((entry) => entry.outcome === 'success')
      );
    })
  );
}

async function loadActivity(owner: string, page: number): Promise<ActivityPage> {
  const response = await fetch(
    `/api/audit?owner=${encodeURIComponent(owner)}&page=${page}`
  );
  if (!response.ok) throw new Error('Activity unavailable.');
  return response.json() as Promise<ActivityPage>;
}

function emptyActivity(): ActivityPage {
  return { entries: [], page: 1, pageSize: 5, total: 0, totalPages: 1 };
}

/** "Contract call failed: Error(LK: not yet due)" → "not yet due" */
function cleanError(raw: string): string {
  const match = raw.match(/Error\(LK: ([^)]+)\)/);
  return match ? match[1] : raw.slice(0, 60);
}

function failureLabel(entry: Entry): string {
  const detail = entry.error ? cleanError(entry.error) : entry.outcome;
  return entry.errorCode ? `${entry.errorCode}: ${detail}` : detail;
}

function outcomeLabel(entry: Entry, recovered: boolean, successful: boolean): string {
  if (recovered) return ' completed after recovery';
  if (successful) return ' completed';
  return ` paused — ${failureLabel(entry)}`;
}
