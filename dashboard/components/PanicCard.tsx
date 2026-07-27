'use client';

import { useEffect, useState } from 'react';
import { shortAddress } from '@/lib/format';

interface Props {
  safeVault?: string;
  recoveryKeyRegistered: boolean;
  alreadyEvacuated: boolean;
}

/**
 * Evacuation is authorised by the recovery key, which by design is NOT the key
 * connected to this browser. So the dashboard cannot submit it — it prepares
 * the request and hands off. Pretending otherwise would be the same class of
 * lie as a fake transaction hash.
 */
export function PanicCard({ safeVault, recoveryKeyRegistered, alreadyEvacuated }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('No action has been requested.');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const vaultReady =
    safeVault && safeVault !== '0x0000000000000000000000000000000000000000';
  const ready = Boolean(vaultReady && recoveryKeyRegistered) && !alreadyEvacuated;

  return (
    <section className="panic-card" aria-labelledby="panic-title">
      <p className="eyebrow warn">Emergency plan</p>
      <h2 id="panic-title">
        {alreadyEvacuated ? 'Assets already evacuated' : 'Think your wallet is compromised?'}
      </h2>
      <p>
        {alreadyEvacuated
          ? 'This plan has already swept to its safe vault. Evacuation cannot run twice.'
          : 'Review the destination and authorisation before opening an evacuation route.'}
      </p>

      <button
        className="panic-button"
        disabled={!ready}
        aria-expanded={open}
        aria-controls="confirm-panel"
        onClick={() => setOpen(true)}
      >
        {alreadyEvacuated ? 'Evacuated' : ready ? 'Review evacuation' : 'Configure vault first'}
      </button>

      {open && (
        <div className="confirm-panel" id="confirm-panel">
          <strong>Confirm before you sign</strong>
          <ul>
            <li>Safe vault {shortAddress(safeVault)}</li>
            <li>Signed by your recovery key, not this wallet</li>
            <li>Inheritance is permanently disabled</li>
            <li>This cannot be undone</li>
          </ul>
          <div className="confirm-actions">
            <button className="cancel" onClick={() => setOpen(false)}>Not now</button>
            <button
              onClick={() => {
                setOpen(false);
                setStatus(
                  'Request prepared. Sign with your recovery key to execute — this browser holds your wallet key, not your recovery key.'
                );
              }}
            >
              Prepare request
            </button>
          </div>
        </div>
      )}

      <p className="panic-status">{status}</p>
    </section>
  );
}
