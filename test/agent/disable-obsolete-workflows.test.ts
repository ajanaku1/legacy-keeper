import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('obsolete workflow shutdown', () => {
  it('targets only the three approved workflow IDs and reads back each state', () => {
    const source = readFileSync(
      'scripts/workflows/disable-obsolete.ts',
      'utf8'
    );

    expect(source).toContain('n6h03seyd2178mvj0p9nm');
    expect(source).toContain('sux1hhjj0u6an7p6vddp2');
    expect(source).toContain('5w133r3gajq3haixv1nhl');
    expect(source.match(/enabled: false/g)).toHaveLength(1);
    expect(source).toContain("callTool('get_workflow'");
    expect(source).toContain("enabled !== false");
  });
});
