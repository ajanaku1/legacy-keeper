import {Img, staticFile} from 'remotion';
import {Frame} from '../components/Frame';
import {SceneAudio} from '../components/SceneAudio';
import {palette, scenes} from '../constants';

export const ProductReveal = () => (
  <Frame eyebrow={scenes.product.eyebrow} compact>
    <div style={{display: 'grid', gridTemplateColumns: '0.72fr 1.28fr', gap: 34, alignItems: 'center'}}>
      <div>
        <h1 style={{fontSize: 62, lineHeight: 1.04, margin: 0, letterSpacing: '-0.045em'}}>{scenes.product.title}</h1>
        <p style={{fontSize: 23, color: palette.muted, lineHeight: 1.5, marginTop: 28}}>Public read access. Owner-only actions. Every attempt retained.</p>
      </div>
      <div style={{height: 700, overflow: 'hidden', borderRadius: 18, border: `1px solid ${palette.line}`, boxShadow: '0 28px 90px #0009'}}>
        <Img src={staticFile('assets/dashboard.png')} style={{width: '100%', transform: 'translateY(-3%)'}} />
      </div>
    </div>
    <SceneAudio scene="product" />
  </Frame>
);
