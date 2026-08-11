import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

interface NaturalEncodingEvidence {
  endpoint: string;
  server: {name: string; version: string};
  requestEncoding: Record<string, {type: string; value: unknown}>;
  observedError: string;
  result: {passed: boolean; rejectedFields: string[]};
}

const evidence = JSON.parse(
  readFileSync('reports/keeperhub-natural-encoding-evidence.json', 'utf8'),
) as NaturalEncodingEvidence;

describe('KeeperHub #1841 bounty evidence', () => {
  it('preserves a passing hosted MCP retest of all three natural encodings', () => {
    expect(evidence.endpoint).toBe('https://app.keeperhub.com/mcp');
    expect(evidence.server).toEqual({name: 'keeperhub', version: '1.2.0'});
    expect(evidence.requestEncoding).toMatchObject({
      chain_id: {type: 'number', value: 11155111},
      function_args: {type: 'array', value: []},
      gas_limit_multiplier: {type: 'number', value: 1.2},
    });
    expect(evidence.result).toEqual({
      passed: true,
      downstreamFailureObserved: true,
      rejectedFields: [],
    });
    expect(evidence.observedError).toMatch(/ABI is required/i);
    expect(evidence.observedError).not.toMatch(/expected string|received number|received array/i);
  });

  it('links the live artifact from both bounty evidence narratives', () => {
    const frictionLog = readFileSync('reports/friction-log.md', 'utf8');
    const teardown = readFileSync('reports/keeperhub-onboarding-teardown.md', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    const evidenceLink = 'keeperhub-natural-encoding-evidence.json';

    expect(frictionLog).toContain('**Status:** FIXED UPSTREAM; LIVE RETEST PASSED');
    expect(frictionLog).toContain(evidenceLink);
    expect(teardown).toContain(evidenceLink);
    expect(readme).toContain(`reports/${evidenceLink}`);
  });
});
