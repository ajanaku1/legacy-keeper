import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'app/providers.tsx',
  'components/HeartbeatPanel.tsx',
  'components/PanicCard.tsx',
  'app/api/heartbeat/route.ts',
  'app/api/evacuation/route.ts',
];

describe('dashboard production imports', () => {
  it('does not pull optional connector and chain barrels into the bundle', () => {
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source).not.toContain("from 'wagmi/connectors'");
      expect(source).not.toContain("from 'viem/chains'");
    }
  });

  it('keeps public chain evidence visible before wallet connection', () => {
    const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('if (!account.isConnected)');
  });
});
