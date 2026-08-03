import type {Caption} from '@remotion/captions';
import captionData from '../public/captions.json';

export const FPS = 30;
export const TRANSITION_FRAMES = 18;

export const palette = {
  background: '#0b1220',
  surface: '#121c2c',
  surfaceStrong: '#172439',
  line: '#263852',
  muted: '#91a0b6',
  text: '#f4f7fb',
  green: '#09fd67',
  greenSoft: '#86ffb4',
  amber: '#ffca63',
  red: '#ff7474',
} as const;

export const evidence = {
  repository: 'github.com/ajanaku1/legacy-keeper',
  workflowCount: '5 enabled workflows',
  triggerCount: '4 automatic trigger types',
  testCount: '102 passing tests',
  executionId: '9ysdci63m7ritc73lendt',
  workflowId: 'ryd34r3ayrg2u8o29fmrk',
  runId: 'wrun_01KYZZR8GH2X2FACPB8C59DX7G',
  heartbeatTx: '0x291b792438560979465254499a4eac55708ee2bc47d44c457ad33e6d83f9c2c3',
  paymentTx: '0x033760975981b88c5f22755529eec4273bc0a873cfb41589158bdd33141113f5',
  payment: '$0.003 USDC · Base',
} as const;

export type SceneKey =
  | 'hook'
  | 'problem'
  | 'positioning'
  | 'product'
  | 'heartbeat'
  | 'recovery'
  | 'close';

const captions = captionData as Record<SceneKey, Caption[]>;

type SceneContent = {
  duration: number;
  audioFrames: number;
  audio: string;
  eyebrow: string;
  title: string;
  narration: string;
};

export const scenes: Record<SceneKey, SceneContent> = {
  hook: {
    duration: 192,
    audioFrames: 162,
    audio: 'audio/hook.mp3',
    eyebrow: 'THE LAST MILE',
    title: 'Accepted is not executed.',
    narration: captions.hook[0].text,
  },
  problem: {
    duration: 237,
    audioFrames: 207,
    audio: 'audio/problem.mp3',
    eyebrow: 'VERIFICATION CONTRACT',
    title: 'Four facts after acceptance.',
    narration: captions.problem[0].text,
  },
  positioning: {
    duration: 242,
    audioFrames: 212,
    audio: 'audio/positioning.mp3',
    eyebrow: 'OWNER-SIGNED · SPONSORED',
    title: 'One signature. Independent proof.',
    narration: captions.positioning[0].text,
  },
  product: {
    duration: 217,
    audioFrames: 187,
    audio: 'audio/product.mp3',
    eyebrow: 'LIVE PRODUCT',
    title: 'The estate, not a mock.',
    narration: captions.product[0].text,
  },
  heartbeat: {
    duration: 230,
    audioFrames: 200,
    audio: 'audio/heartbeat.mp3',
    eyebrow: 'SPONSORED CHECK-IN',
    title: 'The browser never submits the transaction.',
    narration: captions.heartbeat[0].text,
  },
  recovery: {
    duration: 227,
    audioFrames: 197,
    audio: 'audio/recovery.mp3',
    eyebrow: 'RECOVERY + PAID RAIL',
    title: 'Failures remain evidence.',
    narration: captions.recovery[0].text,
  },
  close: {
    duration: 267,
    audioFrames: 207,
    audio: 'audio/close.mp3',
    eyebrow: 'VERIFIED SYSTEM',
    title: 'LegacyKeeper proves the last mile.',
    narration: captions.close[0].text,
  },
};

export const sceneOrder: SceneKey[] = [
  'hook',
  'problem',
  'positioning',
  'product',
  'heartbeat',
  'recovery',
  'close',
];

export const MAIN_DURATION =
  sceneOrder.reduce((total, key) => total + scenes[key].duration, 0) -
  TRANSITION_FRAMES * (sceneOrder.length - 1);

export function captionFor(key: SceneKey): Caption[] {
  return captions[key];
}
