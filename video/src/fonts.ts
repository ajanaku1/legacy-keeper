import {loadFont as loadManrope} from '@remotion/google-fonts/Manrope';
import {loadFont as loadDmMono} from '@remotion/google-fonts/DMMono';

export const {fontFamily: sans} = loadManrope('normal', {
  weights: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
});

export const {fontFamily: mono} = loadDmMono('normal', {
  weights: ['400', '500'],
  subsets: ['latin'],
});
