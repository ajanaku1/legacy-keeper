import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import type {ComponentType} from 'react';
import {TRANSITION_FRAMES, sceneOrder, scenes, type SceneKey} from './constants';
import {Close} from './scenes/Close';
import {HeartbeatProof} from './scenes/HeartbeatProof';
import {Hook} from './scenes/Hook';
import {Positioning} from './scenes/Positioning';
import {Problem} from './scenes/Problem';
import {ProductReveal} from './scenes/ProductReveal';
import {RecoveryPaid} from './scenes/RecoveryPaid';

const components: Record<SceneKey, ComponentType> = {
  hook: Hook,
  problem: Problem,
  positioning: Positioning,
  product: ProductReveal,
  heartbeat: HeartbeatProof,
  recovery: RecoveryPaid,
  close: Close,
};

export const MainVideo = () => (
  <TransitionSeries>
    {sceneOrder.flatMap((key, index) => {
      const Scene = components[key];
      const sequence = (
        <TransitionSeries.Sequence key={key} durationInFrames={scenes[key].duration}>
          <Scene />
        </TransitionSeries.Sequence>
      );
      if (index === sceneOrder.length - 1) return [sequence];
      return [
        sequence,
        <TransitionSeries.Transition
          key={`${key}-transition`}
          presentation={fade()}
          timing={linearTiming({durationInFrames: TRANSITION_FRAMES})}
        />,
      ];
    })}
  </TransitionSeries>
);
