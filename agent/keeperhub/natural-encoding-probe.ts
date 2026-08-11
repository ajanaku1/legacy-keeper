const ENCODING_FIELDS = [
  'chain_id',
  'function_args',
  'gas_limit_multiplier',
] as const;

export interface NaturalEncodingProbeArguments extends Record<string, unknown> {
  contract_address: string;
  chain_id: number;
  function_name: string;
  function_args: unknown[];
  gas_limit_multiplier: number;
}

export interface ProbeAssessment {
  passed: boolean;
  downstreamFailureObserved: boolean;
  rejectedFields: string[];
}

interface EvidenceInput {
  checkedAt: string;
  endpoint: string;
  server: {name: string; version: string};
  toolDescription: string;
  schemaProperties: Record<string, unknown>;
  observedError: string;
}

export interface NaturalEncodingEvidence {
  evidenceVersion: number;
  checkedAt: string;
  endpoint: string;
  server: {name: string; version: string};
  upstream: {issue: string; pullRequest: string; fixCommit: string};
  mutationSafety: string;
  requestEncoding: {
    chain_id: {type: 'number'; value: number};
    function_args: {type: 'array'; value: unknown[]};
    gas_limit_multiplier: {type: 'number'; value: number};
  };
  schemaProperties: Record<string, unknown>;
  toolDescription: string;
  observedError: string;
  result: ProbeAssessment;
}

export function naturalEncodingProbeArguments(): NaturalEncodingProbeArguments {
  return {
    contract_address: 'intentionally-invalid-address',
    chain_id: 11155111,
    function_name: 'naturalEncodingProbe',
    function_args: [],
    gas_limit_multiplier: 1.2,
  };
}

export function selectEncodingSchemaProperties(
  value: unknown,
): Record<string, unknown> {
  const properties = asObject(value);
  return Object.fromEntries(
    ENCODING_FIELDS.map((field) => [field, properties[field] ?? null]),
  );
}

export function assessNaturalEncodingFailure(message: string): ProbeAssessment {
  const rejectedFields = ENCODING_FIELDS.filter((field) =>
    fieldHasTypeFailure(message, field),
  );
  const downstreamFailureObserved =
    /intentionally-invalid-address/i.test(message) && /address|contract/i.test(message);
  return {
    passed: downstreamFailureObserved && rejectedFields.length === 0,
    downstreamFailureObserved,
    rejectedFields,
  };
}

export function buildNaturalEncodingEvidence(
  input: EvidenceInput,
): NaturalEncodingEvidence {
  const args = naturalEncodingProbeArguments();
  return {
    evidenceVersion: 1,
    checkedAt: input.checkedAt,
    endpoint: input.endpoint,
    server: input.server,
    upstream: {
      issue: 'https://github.com/KeeperHub/keeperhub/issues/1841',
      pullRequest: 'https://github.com/KeeperHub/keeperhub/pull/1848',
      fixCommit: '97be79e6ff10e504c5387909244ba4a3467ad536',
    },
    mutationSafety:
      'The deliberately invalid contract address forces failure before simulation or broadcast.',
    requestEncoding: {
      chain_id: {type: 'number', value: args.chain_id},
      function_args: {type: 'array', value: args.function_args},
      gas_limit_multiplier: {type: 'number', value: args.gas_limit_multiplier},
    },
    schemaProperties: input.schemaProperties,
    toolDescription: input.toolDescription,
    observedError: input.observedError,
    result: assessNaturalEncodingFailure(input.observedError),
  };
}

function fieldHasTypeFailure(message: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const typeFailure = '(?:expected string|received (?:number|array)|invalid[_ ]type)';
  return (
    new RegExp(`${escaped}[\\s\\S]{0,120}${typeFailure}`, 'i').test(message) ||
    new RegExp(`${typeFailure}[\\s\\S]{0,120}${escaped}`, 'i').test(message)
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
