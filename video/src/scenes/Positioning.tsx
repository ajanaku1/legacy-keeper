import {Frame} from '../components/Frame';
import {SceneAudio} from '../components/SceneAudio';
import {palette, scenes} from '../constants';

const nodes = [
  ['OWNER', 'EIP-712 signature'],
  ['KEEPERHUB', 'Sponsored workflow'],
  ['SEPOLIA', 'heartbeatBySig'],
  ['VERIFIER', 'Receipt + state'],
] as const;

export const Positioning = () => (
  <Frame eyebrow={scenes.positioning.eyebrow}>
    <h1 style={{fontSize: 64, margin: '0 0 52px', letterSpacing: '-0.045em'}}>{scenes.positioning.title}</h1>
    <div style={{display: 'flex', alignItems: 'stretch', gap: 12}}>
      {nodes.map(([name, detail], index) => (
        <div key={name} style={{display: 'flex', alignItems: 'center', gap: 12, flex: 1}}>
          <div style={{background: palette.surface, border: `1px solid ${index === 1 ? palette.green : palette.line}`, borderRadius: 16, padding: '30px 20px', flex: 1, minHeight: 128}}>
            <div style={{color: index === 1 ? palette.green : palette.text, fontWeight: 800, fontSize: 20, marginBottom: 14}}>{name}</div>
            <div style={{color: palette.muted, fontSize: 17, lineHeight: 1.35}}>{detail}</div>
          </div>
          {index < nodes.length - 1 ? <span style={{fontSize: 24, color: palette.green}}>→</span> : null}
        </div>
      ))}
    </div>
    <div style={{marginTop: 26, color: palette.greenSoft, fontSize: 21}}>The private key never enters KeeperHub.</div>
    <SceneAudio scene="positioning" />
  </Frame>
);
