'use client';

import { PageHeader } from '@/components/application/PageHeader';
import { PlanNotice } from '@/components/application/PlanNotice';
import { PanicCard } from '@/components/PanicCard';
import { useApplication } from '@/components/shell/ApplicationShell';
import { shortAddress } from '@/lib/format';

export default function RecoveryPage() {
  const app = useApplication();
  const { keeper } = app;
  const ready = keeper.recoveryKeyRegistered && Boolean(keeper.safeVault);

  return (
    <>
      <PageHeader
        eyebrow="Recovery"
        title="Emergency authority"
        description="The recovery signer authorizes evacuation. The safe vault receives the assets."
        status={
          <span className={`status-chip ${ready ? 'verified' : ''}`}>
            {ready ? '● Ready' : '○ Incomplete'}
          </span>
        }
      />
      <PlanNotice />
      <section className="recovery-grid">
        <article className="ledger-card">
          <header className="ledger-head">
            <h2>Recovery register</h2>
            <span>{ready ? 'Verified onchain' : 'Action required'}</span>
          </header>
          <dl className="detail-list">
            <div>
              <dt>Recovery signer</dt>
              <dd>
                {keeper.recoveryKeyRegistered
                  ? shortAddress(keeper.recoveryKey, 8, 6)
                  : 'Not configured'}
              </dd>
            </div>
            <div>
              <dt>Safe vault</dt>
              <dd>
                {keeper.safeVault
                  ? shortAddress(keeper.safeVault, 8, 6)
                  : 'Not configured'}
              </dd>
            </div>
            <div>
              <dt>Address isolation</dt>
              <dd>
                {ready ? 'Separate roles recorded' : 'Cannot be checked yet'}
              </dd>
            </div>
          </dl>
        </article>
        <PanicCard
          ownerAddress={app.address}
          planAddress={
            app.resolution.status === 'resolved'
              ? app.resolution.plan
              : undefined
          }
          chainId={app.chainId}
          safeVault={keeper.safeVault}
          recoveryKeyRegistered={keeper.recoveryKeyRegistered}
          alreadyEvacuated={keeper.evacuationExecuted}
        />
      </section>
    </>
  );
}
