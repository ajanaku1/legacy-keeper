import {Frame} from '../components/Frame';
import {SceneAudio} from '../components/SceneAudio';
import {evidence, palette, scenes} from '../constants';

export const Close = () => (
  <Frame eyebrow={scenes.close.eyebrow}>
    <h1 style={{fontSize: 76, margin: 0, maxWidth: 1250, letterSpacing: '-0.055em', lineHeight: 1.02}}>
      LegacyKeeper proves <span style={{color: palette.green}}>the last mile.</span>
    </h1>
    <div style={{display: 'flex', gap: 16, marginTop: 50}}>
      {[evidence.workflowCount, evidence.triggerCount, evidence.testCount].map((stat) => (
        <div key={stat} style={{padding: '18px 24px', borderRadius: 12, background: palette.surface, border: `1px solid ${palette.line}`, color: palette.greenSoft, fontWeight: 700, fontSize: 21}}>{stat}</div>
      ))}
    </div>
    <div style={{marginTop: 52, color: palette.muted, fontSize: 23}}>{evidence.repository}</div>
    <SceneAudio scene="close" />
  </Frame>
);
