"use client";

import Image from "next/image";
import Link from "next/link";
import { WalletEntryButton } from "./WalletEntryButton";

export function WalletAccessGate({ restoring }: { restoring: boolean }) {
  if (restoring) return <WalletRestoringShell />;

  return (
    <main className="access-gate" id="main-content">
      <Link className="access-brand" href="/" aria-label="LegacyKeeper home">
        <Image
          src="/legacykeeper-mark.svg"
          alt=""
          width={42}
          height={42}
          priority
        />
        <strong>LegacyKeeper</strong>
      </Link>
      <section className="access-panel" aria-labelledby="access-title">
        <span className="section-label">Private wallet workspace</span>
        <h1 id="access-title">Connect your wallet.</h1>
        <p>
          Dashboard state, beneficiaries, recovery controls, and activity are
          only loaded after a wallet connection.
        </p>
        <WalletEntryButton className="landing-primary" />
        <Link className="access-home" href="/">
          Return to public site
        </Link>
      </section>
      <p className="access-policy">
        No wallet connected · no plan data requested
      </p>
    </main>
  );
}

function WalletRestoringShell() {
  return (
    <main
      className="wallet-restoring-shell"
      id="main-content"
      aria-live="polite"
    >
      <header className="wallet-restoring-topbar">
        <span className="brand" aria-label="LegacyKeeper">
          <Image
            src="/legacykeeper-mark.svg"
            alt=""
            width={36}
            height={36}
            priority
          />
          <strong>LegacyKeeper</strong>
        </span>
        <span className="wallet-restoring-status">
          <i aria-hidden="true" /> Restoring secure wallet session…
        </span>
      </header>
      <div className="wallet-restoring-body" aria-hidden="true">
        <aside className="wallet-restoring-sidebar">
          <span />
          <span />
          <span />
          <span />
          <span />
        </aside>
        <section className="wallet-restoring-content">
          <div className="wallet-restoring-heading" />
          <div className="wallet-restoring-card" />
          <div className="wallet-restoring-grid">
            <span />
            <span />
          </div>
        </section>
      </div>
    </main>
  );
}
