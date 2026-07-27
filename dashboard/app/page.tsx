'use client';

import { useAccount, useConnect, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useKeeper } from '@/lib/useKeeper';
import { legacyKeeperAbi, LEGACY_KEEPER_ADDRESS, EXPLORER } from '@/lib/contract';
import { shortAddress, formatCountdown } from '@/lib/format';
import { ExecutionRecord } from '@/components/ExecutionRecord';
import { PanicCard } from '@/components/PanicCard';

export default function Page() {
  const { isConnected, address } = useAccount();
  const { connect, connectors } = useConnect();
  const k = useKeeper();

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  if (LEGACY_KEEPER_ADDRESS.length !== 42) {
    return (
      <div className="connect">
        <div>
          <h1>No contract configured</h1>
          <p>
            Set <code className="mono">LEGACY_KEEPER_ADDRESS</code> in <code className="mono">.env</code>{' '}
            and restart. The dashboard reads live chain state and will not render placeholder data.
          </p>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="connect">
        <div>
          <p className="eyebrow" style={{ justifyContent: 'center' }}>LegacyKeeper</p>
          <h1>Your people are protected, even when you can&rsquo;t be here.</h1>
          <p>
            Connect the wallet that owns this plan to see your liveness window, beneficiaries,
            and the full record of every action KeeperHub has taken.
          </p>
          <button onClick={() => connect({ connector: connectors[0] })}>
            Connect wallet
          </button>
        </div>
      </div>
    );
  }

  const isOwner = Boolean(
    address && k.owner && address.toLowerCase() === k.owner.toLowerCase()
  );
  const settled = k.inheritanceExecuted || k.evacuationExecuted;
  const sharesComplete = k.totalShareBps === 10000;

  return (
    <>
      <header className="app-header">
        <div className="brand"><span className="brand-seal" aria-hidden="true">LK</span>LegacyKeeper</div>
        <div className="header-status">
          <span className="hide-sm">Protected on Sepolia</span>
          <a className="mono" href={`${EXPLORER}/address/${LEGACY_KEEPER_ADDRESS}`}
             target="_blank" rel="noreferrer">
            {shortAddress(LEGACY_KEEPER_ADDRESS)}
          </a>
          <span className="badge">{shortAddress(address)}</span>
        </div>
      </header>

      <main className="layout">
        <div className="main-column">
          <section className="hero" aria-labelledby="page-title">
            <div>
              <p className={`eyebrow ${settled || !k.livenessActive ? 'warn' : ''}`}>
                {k.evacuationExecuted
                  ? 'Assets evacuated'
                  : k.inheritanceExecuted
                  ? 'Estate distributed'
                  : !k.livenessActive
                  ? 'Plan paused'
                  : k.graceElapsed
                  ? 'Distribution is due'
                  : k.timeoutExceeded
                  ? 'Grace period running'
                  : 'Your continuity plan is active'}
              </p>
              <h1 id="page-title">Your people are protected, even when you can&rsquo;t be here.</h1>
              <p className="hero-copy">
                LegacyKeeper watches for your heartbeat and keeps a verifiable record of every
                decision KeeperHub makes.
              </p>
              <div className="next-step">
                <span>Liveness window</span>
                <strong>
                  {k.timeoutDuration
                    ? `${Math.round(k.timeoutDuration / 86400) || '<1'} day timeout · ${
                        Math.round(k.gracePeriod / 86400) || '<1'
                      } day grace`
                    : 'loading…'}
                </strong>
              </div>
            </div>

            <div className="timer-wrap">
              <small>{k.graceElapsed ? 'Distribution is callable now' : 'Liveness window remaining'}</small>
              <div className={`timer ${k.graceElapsed ? 'due' : ''}`} aria-live="polite">
                {formatCountdown(k.secondsUntilDue)}
              </div>
              <div className="timer-legend"><span>days</span><span>hours</span><span>minutes</span></div>
              <button
                className="check-in"
                disabled={!isOwner || settled || isPending || confirming}
                onClick={() =>
                  writeContract({
                    address: LEGACY_KEEPER_ADDRESS,
                    abi: legacyKeeperAbi,
                    functionName: 'heartbeat',
                  })
                }
              >
                {confirming ? 'Confirming…' : isPending ? 'Check your wallet…' : 'Check in safely'}
              </button>
              {!isOwner && (
                <p className="empty">Only the plan owner can check in.</p>
              )}
              {txHash && (
                <p className="empty">
                  <a className="mono" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                    View check-in ↗
                  </a>
                </p>
              )}
            </div>
          </section>

          <div className="plan-grid">
            <section className="card" aria-labelledby="people-title">
              <div className="card-head">
                <h2 id="people-title">Who your plan protects</h2>
                <span className={`badge ${sharesComplete ? '' : 'warn'}`}>
                  {k.totalShareBps.toLocaleString()} bps {sharesComplete ? '✓' : '!'}
                </span>
              </div>

              {k.beneficiaries.length === 0 && (
                <p className="empty">
                  No beneficiaries registered yet. Distribution reverts until shares total 10,000 bps.
                </p>
              )}

              {k.beneficiaries.map((b) => (
                <div className="person" key={b.wallet}>
                  <span className="avatar" aria-hidden="true">{b.wallet.slice(2, 3).toUpperCase()}</span>
                  <span>
                    <strong>{shortAddress(b.wallet, 8, 6)}</strong>
                    <span className="addr">{b.wallet}</span>
                  </span>
                  <span className="share">{b.shareBps / 100}%</span>
                </div>
              ))}

              <div className={`total ${sharesComplete ? '' : 'warn'}`}>
                <span>Total assigned</span>
                <output>{k.totalShareBps / 100}%</output>
              </div>
            </section>

            <section className="card" aria-labelledby="route-title">
              <div className="card-head">
                <h2 id="route-title">How protection happens</h2>
                <span className="badge">2 modes ready</span>
              </div>
              <ol className="recovery-list">
                <li>
                  <span className="step">1</span>
                  <span><strong>We look for your heartbeat</strong>
                    <span className="sub">A scheduled KeeperHub workflow checks liveness onchain.</span></span>
                </li>
                <li>
                  <span className="step">2</span>
                  <span><strong>We preserve a grace window</strong>
                    <span className="sub">You can cancel by checking in before distribution begins.</span></span>
                </li>
                <li>
                  <span className="step">3</span>
                  <span><strong>We execute and leave proof</strong>
                    <span className="sub">Trigger, retries, gas and transaction stay together.</span></span>
                </li>
              </ol>
            </section>
          </div>

          <ExecutionRecord />
        </div>

        <aside className="side">
          <section className="side-card" aria-labelledby="vault-title">
            <div className="card-head">
              <h2 id="vault-title">Safe destination</h2>
              <span className={`badge ${k.recoveryKeyRegistered ? '' : 'warn'}`}>
                {k.recoveryKeyRegistered ? 'Ready ✓' : 'Not set'}
              </span>
            </div>
            <div className="vault">
              <strong>Recovery vault</strong>
              <span>{k.safeVault && k.safeVault !== '0x0000000000000000000000000000000000000000'
                ? k.safeVault : 'Not configured'}</span>
            </div>
            <ul className="recovery-list">
              <li>
                <span className="step">{k.recoveryKeyRegistered ? '✓' : '—'}</span>
                <span><strong>Separate recovery key</strong>
                  <span className="sub">
                    {k.recoveryKey && k.recoveryKeyRegistered
                      ? `${shortAddress(k.recoveryKey)} · owner key is not required`
                      : 'Register a key distinct from your wallet key.'}
                  </span></span>
              </li>
              <li>
                <span className="step">{k.privateRoutingEnabled ? '✓' : '—'}</span>
                <span><strong>Private routing requested</strong>
                  <span className="sub">Flag set onchain; submission path is chosen by KeeperHub.</span></span>
              </li>
            </ul>
          </section>

          <PanicCard
            safeVault={k.safeVault}
            recoveryKeyRegistered={k.recoveryKeyRegistered}
            alreadyEvacuated={k.evacuationExecuted}
          />
        </aside>
      </main>
    </>
  );
}
