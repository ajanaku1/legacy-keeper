"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  createVaultTiltController,
  prefersReducedMotion,
  useLandingReveal,
  type VaultTiltController,
} from "@/components/landing/landing-motion";
import { WalletEntryButton } from "@/components/wallet/WalletEntryButton";
import { PRODUCT_POSITIONING } from "@/lib/product-positioning";

export function LandingPage() {
  return (
    <div className="landing-shell">
      <LandingHeader />
      <main id="main-content">
        <LandingHero />
        <TrustSeam />
        <ArchitectureSection />
        <OperationsSection />
        <ControlSection />
        <TelegramSection />
        <LandingCallToAction />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header className="landing-header">
      <Link className="landing-brand" href="/" aria-label="LegacyKeeper home">
        <Image
          src="/legacykeeper-mark.svg"
          alt=""
          width={38}
          height={38}
          priority
        />
        <strong>LegacyKeeper</strong>
      </Link>
      <nav className="landing-nav" aria-label="Public navigation">
        <a href="#architecture">Proof model</a>
        <a href="#operations">Operations</a>
        <a href="#telegram-alerts">Telegram alerts</a>
      </nav>
      <WalletEntryButton className="landing-header-action" />
    </header>
  );
}

function LandingHero() {
  return (
    <section className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-kicker">
          <span aria-hidden="true" /> {PRODUCT_POSITIONING.category}
        </p>
        <h1>The continuity agent that acts when you cannot.</h1>
        <p className="landing-lede">{PRODUCT_POSITIONING.full}</p>
        <div className="landing-actions">
          <WalletEntryButton />
          <a className="landing-secondary" href="#architecture">
            Inspect the architecture
          </a>
        </div>
        <dl className="landing-facts">
          <div>
            <dt>Network</dt>
            <dd>Sepolia</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>KeeperHub</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Your signature</dd>
          </div>
          <div>
            <dt>Alerts</dt>
            <dd>Private Telegram</dd>
          </div>
        </dl>
      </div>
      <ContinuityVault />
    </section>
  );
}

function ContinuityVault() {
  const { stackRef, onPointerMove, onPointerLeave } = useVaultTilt();

  return (
    <figure
      className="vault-scene"
      aria-labelledby="vault-caption"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="vault-geometry">
        <div className="vault-orbit vault-orbit-outer" aria-hidden="true" />
        <div className="vault-orbit vault-orbit-inner" aria-hidden="true" />
        <div className="vault-stack" aria-hidden="true" ref={stackRef}>
          <div className="vault-plane vault-plane-plan">
            <span>01</span>
            <strong>Wallet intent</strong>
            <small>Owner signed</small>
          </div>
          <div className="vault-plane vault-plane-route">
            <span>02</span>
            <strong>KeeperHub route</strong>
            <small>Policy checked</small>
          </div>
          <div className="vault-plane vault-plane-proof">
            <span>03</span>
            <strong>Chain proof</strong>
            <small>Receipt verified</small>
          </div>
          <div className="vault-core">
            <Image src="/legacykeeper-mark.svg" alt="" width={72} height={72} />
          </div>
        </div>
      </div>
      <figcaption id="vault-caption">
        <span>Continuity vault</span>
        Three independent checks before state is trusted.
      </figcaption>
    </figure>
  );
}

function useVaultTilt() {
  const stackRef = useRef<HTMLDivElement>(null);
  const controller = useRef<VaultTiltController | null>(null);

  useEffect(() => {
    controller.current = createVaultTiltController(() => stackRef.current);
    return () => controller.current?.cancel();
  }, []);

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || prefersReducedMotion()) return;
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - left) / width - 0.5;
    const vertical = (event.clientY - top) / height - 0.5;
    controller.current?.queue(vertical * -10, horizontal * 10);
  };

  return {
    stackRef,
    onPointerMove,
    onPointerLeave: () => controller.current?.reset(),
  };
}

function TrustSeam() {
  return (
    <section className="trust-seam" id="proof" aria-label="Verification model">
      <p>One signed instruction</p>
      <span aria-hidden="true">→</span>
      <p>KeeperHub-sponsored execution</p>
      <span aria-hidden="true">→</span>
      <p>Receipt + event + state agreement</p>
      <strong>Fail closed</strong>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section className="landing-section architecture-section" id="architecture">
      <div className="landing-section-heading">
        <span className="section-label">Architecture / 01</span>
        <h2>Autonomy without surrendering authority.</h2>
        <p>
          The agent can monitor, decide, execute, and verify. It cannot silently
          rewrite who owns the plan, who receives assets, or when recovery
          becomes eligible.
        </p>
      </div>
      <ol className="architecture-register">
        <li>
          <span>01</span>
          <div>
            <strong>Define</strong>
            <p>
              Set timing, beneficiaries, recovery authority, and optional
              assets.
            </p>
          </div>
          <b>Browser draft</b>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Authorize</strong>
            <p>
              Review one exact configuration and sign it with the owner wallet.
            </p>
          </div>
          <b>Wallet proof</b>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Execute</strong>
            <p>
              KeeperHub submits the sponsored workflow through the wallet-scoped
              factory.
            </p>
          </div>
          <b>Policy route</b>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Verify</strong>
            <p>
              LegacyKeeper trusts completion only when receipt, event, registry,
              and state agree.
            </p>
          </div>
          <b>On-chain proof</b>
        </li>
      </ol>
    </section>
  );
}

function ControlSection() {
  return (
    <section className="landing-section control-section" id="control">
      <div className="control-visual" aria-hidden="true">
        <div className="control-radar">
          <span />
          <span />
          <span />
        </div>
        <div className="control-readout">
          <small>PLAN STATUS</small>
          <strong>MONITORED</strong>
          <b>Last proof retained</b>
        </div>
      </div>
      <div className="landing-section-heading">
        <span className="section-label">Control / 03</span>
        <h2>An agent built for the moment you are not there to click.</h2>
        <p>
          Check in while active. If your configured timer expires, the plan
          enters a visible grace period before inheritance becomes callable. A
          separate recovery authority can trigger an emergency sweep.
        </p>
        <p>{PRODUCT_POSITIONING.safety}</p>
        <ul className="control-list">
          <li>
            <span>Heartbeat</span>
            <strong>Once-per-24-hour check-in</strong>
          </li>
          <li>
            <span>Inheritance</span>
            <strong>Timeout + grace enforcement</strong>
          </li>
          <li>
            <span>Recovery</span>
            <strong>Separated emergency authority</strong>
          </li>
        </ul>
      </div>
    </section>
  );
}

function OperationsSection() {
  const revealRef = useLandingReveal<HTMLElement>();
  return (
    <section
      className="landing-section operations-section"
      id="operations"
      ref={revealRef}
    >
      <div className="landing-section-heading">
        <span className="section-label">Operations / 02</span>
        <h2>A plan you can operate, not just deploy.</h2>
        <p>
          Setup is guided, policy changes stay owner-signed, and every attempt is
          retained beside its independent proof.
        </p>
      </div>
      <ol className="operations-register">
        <OperationRow index="01" title="Guided onboarding" detail="Seven resumable steps" />
        <OperationRow index="02" title="Once-per-24-hour check-in" detail="Verified liveness" />
        <OperationRow index="03" title="Signed plan updates" detail="Timing · people · recovery · assets" />
        <OperationRow index="04" title="Wallet-scoped activity" detail="Five records per page" />
      </ol>
    </section>
  );
}

interface OperationRowProps {
  index: string;
  title: string;
  detail: string;
}

function OperationRow({ index, title, detail }: OperationRowProps) {
  return (
    <li className="landing-reveal-item">
      <span>{index}</span>
      <strong>{title}</strong>
      <b>{detail}</b>
    </li>
  );
}

function TelegramSection() {
  const revealRef = useLandingReveal<HTMLElement>();
  return (
    <section
      className="landing-section telegram-section"
      id="telegram-alerts"
      ref={revealRef}
    >
      <TelegramProofPanel />
      <div className="landing-section-heading">
        <span className="section-label">Private alerts / 04</span>
        <h2>Private alerts without remote control.</h2>
        <p>
          Link a private chat with one wallet signature. LegacyKeeper sends only
          wallet-scoped, verified status and transaction alerts; chat access is
          never transaction authority.
        </p>
        <ul className="telegram-boundaries">
          <li><span>Capacity</span><strong>Two monitored wallets</strong></li>
          <li><span>Authority</span><strong>Telegram never signs</strong></li>
          <li><span>Evacuation</span><strong>Recovery wallet required</strong></li>
        </ul>
      </div>
    </section>
  );
}

function TelegramProofPanel() {
  return (
    <div className="telegram-proof-panel">
      <header>
        <TelegramGlyph />
        <div><small>NOTIFICATION CHANNEL</small><strong>Telegram alerts</strong></div>
        <b><i /> Connected</b>
      </header>
      <div className="telegram-proof-route">
        <ProofStep number="01" label="Private identity" value="Bot detected" />
        <ProofStep number="02" label="Wallet ownership" value="Owner signed" />
        <ProofStep number="03" label="Verified delivery" value="Alert sent" />
      </div>
      <footer>
        <span>1 / 2 wallets monitored</span>
        <strong>NO CUSTODY · NO BOT AUTHORITY</strong>
      </footer>
    </div>
  );
}

interface ProofStepProps {
  number: string;
  label: string;
  value: string;
}

function ProofStep({ number, label, value }: ProofStepProps) {
  return (
    <div className="landing-reveal-item">
      <span>{number}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function TelegramGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.5 3.2 18.3 20c-.2 1.2-.9 1.5-1.9.9l-4.8-3.6-2.3 2.3c-.3.3-.5.5-1 .5l.3-4.9 9-8.1c.4-.3-.1-.5-.6-.2L5.9 13.8l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20 3.6c.9-.3 1.7.2 1.5-.4Z" />
    </svg>
  );
}

function LandingCallToAction() {
  return (
    <section className="landing-cta">
      <span className="section-label">Your wallet. Your agent. Your rules.</span>
      <h2>Set the rules before they are needed.</h2>
      <WalletEntryButton />
      <p>One plan per wallet · two Telegram links · Sepolia testnet · no custody</p>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <span>LegacyKeeper</span>
      <p>{PRODUCT_POSITIONING.category}.</p>
      <a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer">
        Sepolia explorer ↗
      </a>
    </footer>
  );
}
