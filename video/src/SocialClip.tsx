import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {evidence, palette} from './constants';
import {mono, sans} from './fonts';

export const SocialClip = () => {
  const frame = useCurrentFrame();
  const proof = interpolate(frame, [100, 150], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: palette.background, color: palette.text, fontFamily: sans, padding: 74, justifyContent: 'center'}}>
      <div style={{position: 'absolute', inset: 0, opacity: 0.25, backgroundImage: `linear-gradient(${palette.line}55 1px, transparent 1px), linear-gradient(90deg, ${palette.line}55 1px, transparent 1px)`, backgroundSize: '64px 64px'}} />
      <div style={{position: 'relative'}}>
        <div style={{color: palette.green, fontSize: 25, fontWeight: 800, letterSpacing: '0.15em'}}>LEGACYKEEPER</div>
        <div style={{fontSize: 104, fontWeight: 800, lineHeight: 0.98, letterSpacing: '-0.06em', marginTop: 46}}>Accepted is not executed.</div>
        <div style={{fontSize: 40, lineHeight: 1.3, color: palette.muted, marginTop: 54}}>Verify settlement, receipt, event, and state.</div>
        <div style={{opacity: proof, marginTop: 74, background: palette.surface, border: `1px solid ${palette.green}88`, borderRadius: 18, padding: 28}}>
          <div style={{color: palette.greenSoft, fontWeight: 800, fontSize: 27}}>✓ SPONSORED HEARTBEAT · STATUS 1</div>
          <div style={{fontFamily: mono, fontSize: 20, lineHeight: 1.5, overflowWrap: 'anywhere', marginTop: 20}}>{evidence.heartbeatTx}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
