import {Frame} from '../components/Frame';
import {EvidenceCard} from '../components/EvidenceCard';
import {SceneAudio} from '../components/SceneAudio';
import {evidence, palette, scenes} from '../constants';

export const RecoveryPaid = () => (
  <Frame eyebrow={scenes.recovery.eyebrow}>
    <h1 style={{fontSize: 64, margin: '0 0 36px', letterSpacing: '-0.045em'}}>{scenes.recovery.title}</h1>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
      <div style={{display: 'grid', gap: 12}}>
        <EvidenceCard label="Attempt 1" value="rejected · retained" status="failed" />
        <EvidenceCard label="Attempt 4" value="recovered · state confirmed" />
      </div>
      <div style={{display: 'grid', gap: 12}}>
        <EvidenceCard label="x402 payment" value={evidence.payment} />
        <EvidenceCard label="Payment transaction · status 1" value={evidence.paymentTx} />
      </div>
    </div>
    <div style={{marginTop: 24, color: palette.greenSoft, fontSize: 20}}>402 → paid retry → 200 · result consumed · coverage changed</div>
    <SceneAudio scene="recovery" />
  </Frame>
);
