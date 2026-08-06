'use client';

import { useApplication } from '@/components/shell/ApplicationShell';
import { type PlanResolution } from '@/lib/plan-resolver';

export function PlanNotice() {
  const app = useApplication();
  const copy = noticeCopy(app.resolution.status);
  if (!copy) return null;

  return (
    <section className="plan-notice" aria-live="polite">
      <div>
        <span className="notice-state">{copy.label}</span>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      {app.resolution.status === 'disconnected' && (
        <button className="primary compact" onClick={app.connectWallet}>
          Connect wallet
        </button>
      )}
      {app.resolution.status === 'error' && (
        <button
          className="secondary compact"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      )}
    </section>
  );
}

interface NoticeCopy {
  label: string;
  title: string;
  body: string;
}

type UnresolvedStatus = Exclude<PlanResolution['status'], 'resolved'>;

const NOTICE_COPY: Record<UnresolvedStatus, NoticeCopy> = {
  disconnected: {
    label: 'Wallet required',
    title: 'Connect the wallet that owns this plan.',
    body: 'Public activity stays visible. Personal plan data loads after connection.',
  },
  unconfigured: {
    label: 'Factory unavailable',
    title: 'The Sepolia plan registry is not configured.',
    body: 'Set the factory address, then reload this application.',
  },
  loading: {
    label: 'Reading Sepolia',
    title: 'Looking for your registered plan.',
    body: 'This normally takes a few seconds.',
  },
  missing: {
    label: 'Setup incomplete',
    title: 'This wallet does not have a LegacyKeeper plan yet.',
    body: 'Your setup will open over the dashboard and can be resumed at any time.',
  },
  error: {
    label: 'Read failed',
    title: 'We could not load your plan.',
    body: 'Check your connection and try the factory read again.',
  },
};

function noticeCopy(status: PlanResolution['status']): NoticeCopy | null {
  return status === 'resolved' ? null : NOTICE_COPY[status];
}
