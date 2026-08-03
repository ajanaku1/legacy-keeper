'use client';

import { useState } from 'react';
import { sepolia } from '@/lib/sepolia';
import { LEGACY_KEEPER_ADDRESS } from '@/lib/contract';
import { prepareHeartbeatMessage } from '@/lib/heartbeat-client';
import { shortAddress } from '@/lib/format';

interface Props {
  safeVault?: string;
  recoveryKeyRegistered: boolean;
  alreadyEvacuated: boolean;
}

interface PreparedPayload {
  nonce: string;
  deadline: string;
}

export function PanicCard({ safeVault, recoveryKeyRegistered, alreadyEvacuated }: Props) {
  const [payload, setPayload] = useState<PreparedPayload>();
  const [signature, setSignature] = useState('');
  const [status, setStatus] = useState('No evacuation request has been created.');
  const [busy, setBusy] = useState(false);
  const vaultReady = safeVault && safeVault !== '0x0000000000000000000000000000000000000000';
  const ready = Boolean(vaultReady && recoveryKeyRegistered) && !alreadyEvacuated;

  function prepare() {
    const message = prepareHeartbeatMessage(crypto.getRandomValues(new Uint8Array(32)), Math.floor(Date.now() / 1_000));
    setPayload({ nonce: message.nonce.toString(), deadline: message.deadline.toString() });
    setSignature('');
    setStatus('Payload ready. Sign it with the separate recovery key, then paste only the signature here.');
  }

  async function submit() {
    if (!payload || !signature) return;
    setBusy(true);
    setStatus('KeeperHub is settling and verifying the evacuation.');
    try {
      const response = await fetch('/api/evacuation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, signature }) });
      const result = await response.json() as { stage?: string; executionId?: string; error?: string };
      if (!response.ok || result.stage !== 'verified') throw new Error(result.error ?? 'Evacuation could not be verified');
      setStatus(`Evacuation verified. KeeperHub execution ${result.executionId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Evacuation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panic-card" id="recovery-action" aria-labelledby="panic-title">
      <p className="eyebrow">Emergency recovery</p>
      <h2 id="panic-title">{alreadyEvacuated ? 'Assets already evacuated' : 'Think the owner wallet is compromised?'}</h2>
      <p>Prepare the typed-data payload here, sign it outside this browser with the separate recovery key, then let KeeperHub execute and verify the sweep.</p>
      <p className="mono">Destination: {shortAddress(safeVault)}</p>
      {!payload ? (
        <button className="panic-button" disabled={!ready} onClick={prepare}>{panicButtonCopy(ready, alreadyEvacuated)}</button>
      ) : (
        <div className="evacuation-form">
          <label>Typed data to sign</label>
          <pre>{JSON.stringify(typedPayload(payload), null, 2)}</pre>
          <label htmlFor="recovery-signature">Recovery-key signature</label>
          <textarea id="recovery-signature" rows={3} value={signature} onChange={(event) => setSignature(event.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} />
          <div className="confirm-actions"><button onClick={() => setPayload(undefined)}>Cancel</button><button disabled={!signature || busy} onClick={submit}>{busy ? 'Verifying' : 'Submit through KeeperHub'}</button></div>
        </div>
      )}
      <p className="panic-status" role="status" aria-live="polite">{status}</p>
    </section>
  );
}

function typedPayload(message: PreparedPayload) {
  return {
    domain: { name: 'LegacyKeeper', version: '1', chainId: sepolia.id, verifyingContract: LEGACY_KEEPER_ADDRESS },
    types: { Evacuate: [{ name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Evacuate',
    message,
  };
}

function panicButtonCopy(ready: boolean, evacuated: boolean): string {
  if (ready) return 'Prepare evacuation payload';
  if (evacuated) return 'Evacuated';
  return 'Configure recovery first';
}
