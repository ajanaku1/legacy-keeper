'use client';

import Image from 'next/image';
import { useAccount, useConnect } from 'wagmi';
import { HeartbeatPanel } from '@/components/HeartbeatPanel';
import { ExecutionRecord } from '@/components/ExecutionRecord';
import { PanicCard } from '@/components/PanicCard';
import { EXPLORER, LEGACY_KEEPER_ADDRESS } from '@/lib/contract';
import { shortAddress } from '@/lib/format';
import { type KeeperState, useKeeper } from '@/lib/useKeeper';

const NAV_ITEMS = [
  ['Dashboard', 'dashboard'],
  ['Beneficiaries', 'beneficiaries'],
  ['Activity', 'activity'],
  ['Recovery', 'recovery'],
  ['Settings', 'settings'],
] as const;

export default function Page() {
  const account = useAccount();
  const { connect, connectors } = useConnect();
  const keeper = useKeeper();

  if (LEGACY_KEEPER_ADDRESS.length !== 42) return <ConfigurationNotice />;

  const isOwner = Boolean(account.address && keeper.owner && account.address.toLowerCase() === keeper.owner.toLowerCase());
  const settled = keeper.inheritanceExecuted || keeper.evacuationExecuted;
  const connectWallet = () => connectors[0] && connect({ connector: connectors[0] });

  return (
    <div className="app-shell">
      <AppHeader address={account.address} connected={account.isConnected} onConnect={connectWallet} />
      <Sidebar />
      <main className="main" id="dashboard">
        <PageHeading keeper={keeper} />
        <div className="columns">
          <HeartbeatPanel
            state={{
              secondsUntilDue: keeper.secondsUntilDue,
              lastHeartbeat: keeper.lastHeartbeat,
              disabled: !isOwner || settled || !keeper.livenessActive,
              owner: isOwner,
              connected: account.isConnected,
            }}
            onVerified={keeper.refetch}
          />
          <ProtectionDetails keeper={keeper} />
          <Beneficiaries keeper={keeper} />
          <ExecutionRecord />
          <PanicCard
            safeVault={keeper.safeVault}
            recoveryKeyRegistered={keeper.recoveryKeyRegistered}
            alreadyEvacuated={keeper.evacuationExecuted}
          />
        </div>
      </main>
    </div>
  );
}

function AppHeader({ address, connected, onConnect }: { address?: string; connected: boolean; onConnect: () => void }) {
  return (
    <header className="topbar">
      <a className="brand" href="#dashboard" aria-label="LegacyKeeper dashboard">
        <Image src="/legacykeeper-mark.svg" alt="" width={36} height={36} priority />
        <strong>LegacyKeeper</strong>
      </a>
      <div className="account">
        <span className="network-dot">Sepolia</span>
        {connected ? <span className="avatar">{shortAddress(address, 4, 3)}</span> : <button className="connect-button" onClick={onConnect}>Connect wallet</button>}
      </div>
    </header>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <span className="nav-label">Continuity plan</span>
      <nav className="nav" aria-label="Primary">
        {NAV_ITEMS.map(([label, target], index) => <a href={`#${target}`} aria-current={index === 0 ? 'page' : undefined} key={target}>{label}</a>)}
      </nav>
      <div className="connection">KeeperHub connection<b><span aria-hidden="true">●</span> Operational</b></div>
    </aside>
  );
}

function PageHeading({ keeper }: { keeper: KeeperState }) {
  return (
    <header className="page-head">
      <div><span className="section-label">Account status</span><h1>Your continuity plan</h1></div>
      <span className={`protected ${keeper.graceElapsed || !keeper.livenessActive ? 'warning' : ''}`}>
        {planStatus(keeper)}
      </span>
    </header>
  );
}

function ProtectionDetails({ keeper }: { keeper: KeeperState }) {
  return (
    <details className="card more" id="recovery">
      <summary><strong>Routing and recovery</strong></summary>
      <div className="details-body">
        <div className="detail-block"><span>ROUTE CONFIDENCE</span><p><b className="amber">Partial.</b> KeeperHub sponsorship and settlement are verified. Private route evidence is unavailable.</p></div>
        <div className="detail-block"><span>RECOVERY READINESS</span><p>{keeper.recoveryKeyRegistered ? `Recovery key ${shortAddress(keeper.recoveryKey)} is registered.` : 'A separate recovery key still needs to be registered.'}</p></div>
        <div className="detail-block" id="settings"><span>SAFE DESTINATION</span><p className="mono break">{keeper.safeVault || 'Not configured'}</p></div>
        <div className="detail-block"><span>PRIVATE ROUTING REQUEST</span><p>{keeper.privateRoutingEnabled ? 'Enabled onchain. Final route proof depends on KeeperHub response fields.' : 'Not enabled.'}</p></div>
      </div>
    </details>
  );
}

function Beneficiaries({ keeper }: { keeper: KeeperState }) {
  const complete = keeper.totalShareBps === 10_000;
  return (
    <section className="card beneficiary-card" id="beneficiaries" aria-labelledby="beneficiaries-title">
      <div className="section-head"><h2 id="beneficiaries-title">Beneficiaries</h2><span className={complete ? 'verified' : 'amber'}>{keeper.totalShareBps / 100}% ASSIGNED</span></div>
      {keeper.beneficiaries.length === 0 ? <p className="muted">No beneficiaries are registered yet.</p> : keeper.beneficiaries.map((person) => (
        <div className="person" key={person.wallet}><span className="person-mark">{person.wallet.slice(2, 3).toUpperCase()}</span><span><strong>{shortAddress(person.wallet, 8, 6)}</strong><small className="mono">{person.wallet}</small></span><b>{person.shareBps / 100}%</b></div>
      ))}
    </section>
  );
}

function ConfigurationNotice() {
  return <main className="connect-screen"><h1>Contract not configured</h1><p>Set <code>NEXT_PUBLIC_LEGACY_KEEPER_ADDRESS</code> and restart. LegacyKeeper does not display placeholder chain data.</p></main>;
}

function planStatus(keeper: KeeperState): string {
  if (keeper.evacuationExecuted) return 'Assets evacuated';
  if (keeper.inheritanceExecuted) return 'Estate distributed';
  if (!keeper.livenessActive) return 'Plan paused';
  if (keeper.graceElapsed) return 'Distribution is due';
  if (keeper.timeoutExceeded) return 'Grace window active';
  return keeper.loading ? 'Reading chain state' : 'Your plan is protected';
}
