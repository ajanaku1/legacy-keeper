import {Audio} from '@remotion/media';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {captionFor, palette, scenes, type SceneKey} from '../constants';

export const SceneAudio = ({scene}: {scene: SceneKey}) => {
  const frame = useCurrentFrame();
  const item = scenes[scene];
  const caption = captionFor(scene)[0];
  const captionVisible = frame < item.audioFrames;
  const captionOpacity = interpolate(frame, [0, 10, item.audioFrames - 10, item.audioFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      <Audio src={staticFile(item.audio)} />
      {captionVisible ? (
        <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 54, pointerEvents: 'none'}}>
          <div
            style={{
              maxWidth: 1320,
              borderRadius: 12,
              background: '#05090fd9',
              border: `1px solid ${palette.line}`,
              color: palette.text,
              padding: '14px 22px',
              fontSize: 25,
              lineHeight: 1.35,
              opacity: captionOpacity,
              textAlign: 'center',
            }}
          >
            {caption.text}
          </div>
        </AbsoluteFill>
      ) : null}
    </>
  );
};
