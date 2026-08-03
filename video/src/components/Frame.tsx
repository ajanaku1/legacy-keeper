import type {ReactNode} from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {palette} from '../constants';
import {sans} from '../fonts';

type FrameProps = {
  children: ReactNode;
  eyebrow?: string;
  compact?: boolean;
};

export const Frame = ({children, eyebrow, compact = false}: FrameProps) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 180, stiffness: 120}});
  const gridOpacity = interpolate(frame, [0, 30], [0, 0.28], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: palette.background,
        color: palette.text,
        fontFamily: sans,
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          opacity: gridOpacity,
          backgroundImage: `linear-gradient(${palette.line}55 1px, transparent 1px), linear-gradient(90deg, ${palette.line}55 1px, transparent 1px)`,
          backgroundSize: '72px 72px',
          maskImage: 'linear-gradient(to bottom, black, transparent 88%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 620,
          height: 620,
          right: -260,
          top: -300,
          borderRadius: '50%',
          background: palette.green,
          filter: 'blur(190px)',
          opacity: 0.1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: compact ? 54 : 72,
          display: 'flex',
          flexDirection: 'column',
          transform: `translateY(${(1 - enter) * 28}px)`,
          opacity: enter,
        }}
      >
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
            <div style={{width: 11, height: 34, borderRadius: 8, background: palette.green}} />
            <span style={{fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em'}}>LegacyKeeper</span>
          </div>
          {eyebrow ? (
            <span style={{color: palette.greenSoft, fontSize: 16, fontWeight: 700, letterSpacing: '0.16em'}}>
              {eyebrow}
            </span>
          ) : null}
        </div>
        <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
