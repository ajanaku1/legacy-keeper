import {Frame} from '../components/Frame';
import {EvidenceCard} from '../components/EvidenceCard';
import {SceneAudio} from '../components/SceneAudio';
import {palette, scenes} from '../constants';

const checks = [
  ['01', 'Settled execution', 'KeeperHub returns a final execution result'],
  ['02', 'Successful receipt', 'status = 1 on the expected Sepolia chain'],
  ['03', 'Expected event', 'Heartbeat or evacuation event decoded'],
  ['04', 'Confirmed state', 'Contract state matches the requested outcome'],
] as const;

export const Problem = () => (
  <Frame eyebrow={scenes.problem.eyebrow}>
    <h1 style={{fontSize: 64, margin: '0 0 42px', letterSpacing: '-0.045em'}}>{scenes.problem.title}</h1>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
      {checks.map(([number, title, description]) => (
        <EvidenceCard
          key={number}
          label={`${number} · REQUIRED`}
          value={<><strong style={{fontFamily: 'inherit', color: palette.text}}>{title}</strong><br/><span style={{fontFamily: 'inherit', color: palette.muted, fontSize: 17}}>{description}</span></>}
        />
      ))}
    </div>
    <SceneAudio scene="problem" />
  </Frame>
);
