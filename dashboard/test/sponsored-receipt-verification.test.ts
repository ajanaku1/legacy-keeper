import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = [
  'app/api/plans/route.ts',
  'app/api/configuration/route.ts',
  'app/api/heartbeat/route.ts',
  'app/api/evacuation/route.ts',
];

describe('KeeperHub-sponsored receipt verification', () => {
  it.each(routes)('%s does not treat the wrapper receipt target as the action target', (file) => {
    const source = readFileSync(`dashboard/${file}`, 'utf8');

    expect(source).not.toContain('target: receipt.to');
    expect(source).toMatch(/event\.address|item\.address|log\.address/);
  });

  it('the live smoke proof follows contract events instead of receipt.to', () => {
    const source = readFileSync(
      'scripts/workflows/live-wallet-smoke.ts',
      'utf8'
    );

    expect(source).not.toContain('receipt.to');
    expect(source).toContain('getAddress(log.address)');
  });
});
