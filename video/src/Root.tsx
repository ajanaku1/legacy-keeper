import {Composition} from 'remotion';
import {FPS, MAIN_DURATION} from './constants';
import {MainVideo} from './MainVideo';
import {SocialClip} from './SocialClip';

export const Root = () => (
  <>
    <Composition id="LegacyKeeper" component={MainVideo} durationInFrames={MAIN_DURATION} fps={FPS} width={1920} height={1080} />
    <Composition id="LegacyKeeperSocial" component={SocialClip} durationInFrames={300} fps={FPS} width={1080} height={1920} />
  </>
);
