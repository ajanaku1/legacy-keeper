import {interpolate, useCurrentFrame} from 'remotion';
import {Frame} from '../components/Frame';
import {SceneAudio} from '../components/SceneAudio';
import {palette, scenes} from '../constants';

export const Hook = () => {
  const frame = useCurrentFrame();
  const split = interpolate(frame, [18, 60], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <Frame eyebrow={scenes.hook.eyebrow}>
      <div style={{fontSize: 88, fontWeight: 800, letterSpacing: '-0.055em', lineHeight: 1.02, maxWidth: 1200}}>
        Accepted is <span style={{color: palette.muted, textDecoration: 'line-through', textDecorationThickness: 5}}>not</span>{' '}
        <span style={{color: palette.green}}>executed.</span>
      </div>
      <div style={{display: 'flex', marginTop: 58, gap: 14, alignItems: 'center', opacity: split}}>
        {['API 202', 'SETTLEMENT', 'RECEIPT', 'STATE'].map((item, index) => (
          <div key={item} style={{display: 'flex', gap: 14, alignItems: 'center'}}>
            <div style={{padding: '13px 18px', borderRadius: 10, border: `1px solid ${index === 0 ? palette.amber : palette.line}`, color: index === 0 ? palette.amber : palette.text, fontSize: 17, fontWeight: 700}}>{item}</div>
            {index < 3 ? <div style={{color: palette.muted, fontSize: 22}}>→</div> : null}
          </div>
        ))}
      </div>
      <SceneAudio scene="hook" />
    </Frame>
  );
};
