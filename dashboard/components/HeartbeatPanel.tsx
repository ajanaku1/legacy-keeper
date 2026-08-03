'use client';

import { useState } from 'react';
import { useSignTypedData } from 'wagmi';
import { EXPLORER, LEGACY_KEEPER_ADDRESS } from '@/lib/contract';
import { prepareHeartbeatMessage } from '@/lib/heartbeat-client';
import { formatCountdown, shortAddress } from '@/lib/format';
import { sepolia } from '@/lib/sepolia';

type Stage = 'idle' | 'signing' | 'submitting' | 'verified' | 'failed';

interface Evidence {
  stage: 'verified';
  executionId: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: 'success';
  event: 'HeartbeatRecorded';
  lastHeartbeat: string;
  routeConfidence: 'unavailable';
}

interface HeartbeatState {
  secondsUntilDue: number;
  lastHeartbeat: number;
  disabled: boolean;
  owner: boolean;
  connected: boolean;
}

interface Props {
  state: HeartbeatState;
  onVerified: () => void;
}

const STEPS = [
  'Request signing',
  'KeeperHub submission',
  'Settlement',
  'Receipt verification',
  'State verified',
];

export function HeartbeatPanel({ state, onVerified }: Props) {
  const { signTypedDataAsync } = useSignTypedData();
  const [stage, setStage] = useState<Stage>('idle');
  const [evidence, setEvidence] = useState<Evidence>();
  const [error, setError] = useState('');
  const busy = stage === 'signing' || stage === 'submitting';

  async function checkIn() {
    setError('');
    setEvidence(undefined);
    try {
      setStage('signing');
      const message = prepareHeartbeatMessage(
        crypto.getRandomValues(new Uint8Array(32)),
        Math.floor(Date.now() / 1_000)
      );
      const signature = await signTypedDataAsync(typedData(message));
      setStage('submitting');
      const result = await submitHeartbeat(message, signature);
      setEvidence(result);
      setStage('verified');
      onVerified();
    } catch (reason) {
      setStage('failed');
      setError(reason instanceof Error ? reason.message : 'Check-in failed');
    }
  }

  return (
    <>
      <section className="card plan-card" aria-labelledby="timer-title">
        <span className="section-label">Next recovery eligibility</span>
        <h2 className="timer" id="timer-title">{formatCountdown(state.secondsUntilDue)}</h2>
        <p className="muted">Check in before this timer expires to keep your plan dormant.</p>
        <button className="primary" disabled={state.disabled || busy} onClick={checkIn}>
          {buttonCopy(stage)}
        </button>
        <p className={`inline-status ${stage === 'failed' ? 'error' : ''}`} role="status" aria-live="polite">
          {statusCopy(stage, state.connected, state.owner, state.lastHeartbeat, error)}
        </p>
      </section>

      <LatestCheckIn evidence={evidence} lastHeartbeat={state.lastHeartbeat} />
      <VerificationJourney stage={stage} />
    </>
  );
}

function LatestCheckIn({ evidence, lastHeartbeat }: { evidence?: Evidence; lastHeartbeat: number }) {
  return (
    <section className="card proof-card" aria-labelledby="proof-title">
      <h2 id="proof-title">Latest check-in</h2>
      <div className="proof-body">
        <div className="proof-status">
          <strong>{lastHeartbeat ? formatTimestamp(lastHeartbeat) : 'Waiting for chain data'}</strong>
          <span className={evidence ? 'verified' : 'neutral'}>{evidence ? 'VERIFIED' : 'ONCHAIN'}</span>
        </div>
        <dl>
          <ProofRow label="KeeperHub execution" value={evidence ? shortAddress(evidence.executionId, 7, 5) : 'No session evidence'} />
          <ProofRow label="Transaction receipt" value={evidence ? 'STATUS 1' : 'Not in this session'} />
          <ProofRow label="Product state" value={evidence ? 'ADVANCED' : 'Chain state loaded'} />
        </dl>
        {evidence && <a className="proof-link" href={`${EXPLORER}/tx/${evidence.txHash}`} target="_blank" rel="noreferrer">View transaction proof</a>}
      </div>
    </section>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function VerificationJourney({ stage }: { stage: Stage }) {
  const active = stageIndex(stage);
  return (
    <section className="card journey" aria-labelledby="journey-title">
      <div className="section-head"><h2 id="journey-title">Check-in verification</h2><span>All stages required</span></div>
      <div className="steps">
        {STEPS.map((label, index) => (
          <div className={`verification-step ${stepState(index, active, stage)}`} key={label}>
            <b>{String(index + 1).padStart(2, '0')}</b><span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function typedData(message: { nonce: bigint; deadline: bigint }) {
  return {
    domain: { name: 'LegacyKeeper', version: '1', chainId: sepolia.id, verifyingContract: LEGACY_KEEPER_ADDRESS },
    types: { Heartbeat: [{ name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Heartbeat' as const,
    message,
  };
}

async function submitHeartbeat(message: { nonce: bigint; deadline: bigint }, signature: string): Promise<Evidence> {
  const response = await fetch('/api/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: message.nonce.toString(), deadline: message.deadline.toString(), signature }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isEvidence(body)) throw new Error(errorFrom(body));
  return body;
}

function isEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.stage === 'verified' && typeof item.executionId === 'string' && typeof item.txHash === 'string';
}

function errorFrom(value: unknown): string {
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).error === 'string') {
    return (value as Record<string, string>).error;
  }
  return 'KeeperHub could not verify this check-in';
}

function stageIndex(stage: Stage): number {
  if (stage === 'signing') return 0;
  if (stage === 'submitting') return 1;
  if (stage === 'verified') return 5;
  return -1;
}

function buttonCopy(stage: Stage): string {
  if (stage === 'signing') return 'Sign in your wallet';
  if (stage === 'submitting') return 'KeeperHub is verifying';
  return 'Check in now';
}

function stepState(index: number, active: number, stage: Stage): string {
  if (stage === 'failed' && index === Math.max(active, 0)) return 'failed';
  if (index < active || active === 5) return 'done';
  return index === active ? 'active' : '';
}

function statusCopy(stage: Stage, connected: boolean, owner: boolean, lastHeartbeat: number, error: string): string {
  if (!connected) return 'Connect the owner wallet to sign a gasless check-in.';
  if (!owner) return 'Only the plan owner can check in.';
  if (stage === 'signing') return 'One signature authorizes this check-in. Your wallet sends no transaction.';
  if (stage === 'submitting') return 'KeeperHub is settling the sponsored transaction and checking the result.';
  if (stage === 'verified') return 'Check-in verified. KeeperHub paid the gas and onchain state advanced.';
  if (stage === 'failed') return error;
  return lastHeartbeat ? `Last recorded ${formatTimestamp(lastHeartbeat)}.` : 'Ready for your first verified check-in.';
}

function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}
