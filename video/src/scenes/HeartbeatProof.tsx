import {Frame} from '../components/Frame';
import {EvidenceCard} from '../components/EvidenceCard';
import {SceneAudio} from '../components/SceneAudio';
import {evidence, palette, scenes} from '../constants';

const stages = ['Signature', 'Webhook', 'Sponsored tx', 'Receipt', 'State'];

export const HeartbeatProof = () => (
  <Frame eyebrow={scenes.heartbeat.eyebrow}>
    <h1 style={{fontSize: 58, margin: '0 0 34px', maxWidth: 1200, letterSpacing: '-0.045em'}}>{scenes.heartbeat.title}</h1>
    <div style={{display: 'flex', gap: 10, marginBottom: 30}}>
      {stages.map((stage, index) => (
        <div key={stage} style={{display: 'flex', alignItems: 'center', gap: 10, flex: 1}}>
          <div style={{padding: '14px 12px', textAlign: 'center', width: '100%', borderRadius: 10, background: palette.surface, border: `1px solid ${palette.green}66`, color: palette.greenSoft, fontSize: 16, fontWeight: 700}}>✓ {stage}</div>
          {index < stages.length - 1 ? <span style={{color: palette.green}}>›</span> : null}
        </div>
      ))}
    </div>
    <div style={{display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 16}}>
      <EvidenceCard label="KeeperHub execution" value={evidence.executionId} />
      <EvidenceCard label="Sepolia transaction · status 1" value={evidence.heartbeatTx} />
    </div>
    <SceneAudio scene="heartbeat" />
  </Frame>
);
