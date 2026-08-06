import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Sepolia deployment boundary', () => {
  it('deploys the wallet-scoped factory instead of an operator-owned plan', () => {
    const source = readFileSync('scripts/deploy.ts', 'utf8');

    expect(source).toContain("deployContract('LegacyKeeperFactory')");
    expect(source).toContain('NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS');
    expect(source).not.toContain("deployContract('LegacyKeeper',");
    expect(source).not.toContain('DEMO_TIMEOUT_SECONDS');
  });
});
