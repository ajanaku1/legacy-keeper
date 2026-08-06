'use client';

import { useState } from 'react';
import type { Address } from 'viem';
import { prepareHeartbeatMessage } from '@/lib/heartbeat-client';
import { userFacingActionError } from '@/lib/client-action-error';

interface Props {
  ownerAddress?: Address;
  planAddress?: Address;
  chainId?: number;
  safeVault?: string;
  recoveryKeyRegistered: boolean;
  alreadyEvacuated: boolean;
}

interface PreparedPayload {
  nonce: string;
  deadline: string;
}

export function PanicCard(props: Props) {
  const [payload, setPayload] = useState<PreparedPayload>();
  const [signature, setSignature] = useState('');
  const [status, setStatus] = useState('No evacuation request has been created.');
  const [busy, setBusy] = useState(false);
  const readiness = evacuationReadiness(props);

  function prepare(): void {
    const message = prepareHeartbeatMessage(
      crypto.getRandomValues(new Uint8Array(32)),
      Math.floor(Date.now() / 1_000)
    );
    setPayload({
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
    });
    setSignature('');
    setStatus('Sign this typed payload with the separate recovery wallet.');
  }

  async function submit(): Promise<void> {
    if (!payload || !signature || !props.ownerAddress || !props.planAddress) return;
    setBusy(true);
    setStatus('KeeperHub is settling and verifying the evacuation.');
    try {
      const response = await fetch('/api/evacuation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId: props.chainId,
          owner: props.ownerAddress,
          plan: props.planAddress,
          ...payload,
          signature,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isVerifiedEvacuation(result)) {
        throw new Error(
          userFacingActionError(result, 'Evacuation could not be verified.')
        );
      }
      setStatus(`Evacuation verified. KeeperHub execution ${result.executionId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Evacuation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="danger-card" aria-labelledby="evacuation-title">
      <span className="section-label">Emergency evacuation</span>
      <h2 id="evacuation-title">Move supported assets to the safe vault.</h2>
      <p>
        The separate recovery wallet signs. LegacyKeeper never asks for its
        secret material.
      </p>
      {!payload ? (
        <button
          className="danger-button"
          disabled={readiness.code !== 'READY'}
          onClick={prepare}
        >
          Prepare evacuation
        </button>
      ) : (
        <div className="evacuation-form">
          <label>Typed data to sign</label>
          <pre>{JSON.stringify(typedPayload(props.planAddress, payload), null, 2)}</pre>
          <label htmlFor="recovery-signature">Recovery-wallet signature</label>
          <textarea
            id="recovery-signature"
            rows={3}
            value={signature}
            onChange={(event) => setSignature(event.target.value.trim())}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="confirm-actions">
            <button className="secondary" onClick={() => setPayload(undefined)}>
              Cancel
            </button>
            <button className="danger-button" disabled={!signature || busy} onClick={submit}>
              {busy ? 'Verifying' : 'Submit through KeeperHub'}
            </button>
          </div>
        </div>
      )}
      <p className="disabled-reason" role="status" aria-live="polite">
        {payload ? status : readiness.reason}
      </p>
    </article>
  );
}

function isVerifiedEvacuation(
  value: unknown
): value is { stage: 'verified'; executionId: string } {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.stage === 'verified' && typeof result.executionId === 'string';
}

function evacuationReadiness(props: Props): { code: string; reason: string } {
  if (!props.ownerAddress || !props.planAddress)
    return { code: 'SETUP_INCOMPLETE', reason: 'Load the owner plan first.' };
  if (props.chainId !== 11155111)
    return { code: 'WRONG_NETWORK', reason: 'Switch to Sepolia first.' };
  if (!props.recoveryKeyRegistered || !props.safeVault)
    return { code: 'RECOVERY_INCOMPLETE', reason: 'Configure both recovery addresses first.' };
  if (props.alreadyEvacuated)
    return { code: 'PLAN_SETTLED', reason: 'This plan has already evacuated.' };
  return { code: 'READY', reason: 'A separate recovery-wallet signature is required.' };
}

function typedPayload(plan: Address | undefined, message: PreparedPayload) {
  return {
    domain: {
      name: 'LegacyKeeper',
      version: '1',
      chainId: 11155111,
      verifyingContract: plan,
    },
    types: {
      Evacuate: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Evacuate',
    message,
  };
}
