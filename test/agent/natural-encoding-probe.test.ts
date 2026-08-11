import {describe, expect, it} from 'vitest';
import {
  assessNaturalEncodingFailure,
  buildNaturalEncodingEvidence,
  naturalEncodingProbeArguments,
  selectEncodingSchemaProperties,
} from '../../agent/keeperhub/natural-encoding-probe';

describe('KeeperHub natural-encoding regression probe', () => {
  it('uses natural JSON values while making transaction broadcast impossible', () => {
    const args = naturalEncodingProbeArguments();

    expect(args).toMatchObject({
      contract_address: 'intentionally-invalid-address',
      chain_id: 11155111,
      function_args: [],
      gas_limit_multiplier: 1.2,
    });
    expect(typeof args.chain_id).toBe('number');
    expect(Array.isArray(args.function_args)).toBe(true);
    expect(typeof args.gas_limit_multiplier).toBe('number');
  });

  it('fails when the hosted tool still rejects any natural encoding', () => {
    const result = assessNaturalEncodingFailure(
      'Input validation error: chain_id expected string, received number',
    );

    expect(result.passed).toBe(false);
    expect(result.rejectedFields).toEqual(['chain_id']);
  });

  it('passes only when validation advances to the intentionally invalid address', () => {
    const result = assessNaturalEncodingFailure(
      'Contract call failed: invalid contract address intentionally-invalid-address',
    );

    expect(result).toEqual({
      passed: true,
      downstreamFailureObserved: true,
      rejectedFields: [],
    });
  });

  it('builds a sanitized evidence record without credentials or session data', () => {
    const evidence = buildNaturalEncodingEvidence({
      checkedAt: '2026-08-11T04:00:00.000Z',
      endpoint: 'https://app.keeperhub.com/mcp',
      server: {name: 'keeperhub', version: '1.2.0'},
      toolDescription: 'Example: chain_id 11155111 and function_args as an array.',
      schemaProperties: {chain_id: {}, function_args: {}, gas_limit_multiplier: {}},
      observedError: 'Contract call failed: invalid contract address intentionally-invalid-address',
    });

    expect(evidence.result.passed).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/api.?key|authorization|session.?id/i);
    expect(evidence.requestEncoding).toEqual({
      chain_id: {type: 'number', value: 11155111},
      function_args: {type: 'array', value: []},
      gas_limit_multiplier: {type: 'number', value: 1.2},
    });
  });

  it('preserves only the three affected live schema properties', () => {
    expect(
      selectEncodingSchemaProperties({
        contract_address: {type: 'string'},
        chain_id: {anyOf: [{type: 'string'}, {type: 'number'}]},
        function_args: {},
        gas_limit_multiplier: {},
      }),
    ).toEqual({
      chain_id: {anyOf: [{type: 'string'}, {type: 'number'}]},
      function_args: {},
      gas_limit_multiplier: {},
    });
  });
});
