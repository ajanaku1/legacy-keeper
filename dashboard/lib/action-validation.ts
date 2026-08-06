import { isAddress, zeroAddress, type Address } from 'viem';
import { ActionError } from './action-error';
import type { KeeperHubSettlement } from './heartbeat-route';

export const SEPOLIA_CHAIN_ID = 11155111;
export const MAX_SIGNING_WINDOW_SECONDS = 600;

export function assertSepolia(chainId: number): void {
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new ActionError('WRONG_NETWORK', 'Switch to Sepolia and review again.');
  }
}

export function assertSigningDeadline(raw: string, now: number): void {
  const deadline = Number(raw);
  if (
    !Number.isSafeInteger(deadline) ||
    deadline <= now ||
    deadline > now + MAX_SIGNING_WINDOW_SECONDS
  ) {
    throw new ActionError(
      'SIGNATURE_EXPIRED',
      'The signature expired. Review and sign a new attempt.'
    );
  }
}

export function assertSigner(signer: string, expected: string): void {
  if (!sameAddress(signer, expected)) {
    throw new ActionError(
      'WRONG_SIGNER',
      'The signature does not match the required signing authority.'
    );
  }
}

export function assertSettlement(
  settlement: KeeperHubSettlement
): asserts settlement is KeeperHubSettlement & {
  status: 'success';
  txHash: `0x${string}`;
  sponsored: true;
} {
  if (settlement.status !== 'success') {
    throw new ActionError(
      'KEEPERHUB_UNSETTLED',
      `KeeperHub execution ended with status ${settlement.status}.`
    );
  }
  if (!settlement.txHash || settlement.sponsored !== true) {
    throw new ActionError(
      'KEEPERHUB_UNSETTLED',
      'KeeperHub settlement is missing transaction or sponsorship evidence.'
    );
  }
}

export function requiredAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value) || value === zeroAddress) {
    throw new ActionError('INVALID_REQUEST', `${field} must be a nonzero address.`);
  }
  return value;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ActionError('INVALID_REQUEST', `${field} must be a non-empty string.`);
  }
  return value;
}

export function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ActionError('INVALID_REQUEST', `${field} must be a positive integer.`);
  }
  return value;
}

export function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ActionError('INVALID_REQUEST', `${field} must be a boolean.`);
  }
  return value;
}

export function assertUniqueAddresses(
  addresses: readonly Address[],
  label: string
): void {
  const normalized = addresses.map((address) => address.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new ActionError('INVALID_REQUEST', `Duplicate ${label} addresses are not allowed.`);
  }
}

export function exactObject(
  value: unknown,
  fields: readonly string[],
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionError('INVALID_REQUEST', `${label} must be an object.`);
  }
  const object = value as Record<string, unknown>;
  const unexpected = Object.keys(object).find((key) => !fields.includes(key));
  if (unexpected) {
    throw new ActionError('INVALID_REQUEST', `Unexpected field: ${unexpected}`);
  }
  const missing = fields.find((field) => !(field in object));
  if (missing) {
    throw new ActionError('INVALID_REQUEST', `${label} requires ${missing}.`);
  }
  return object;
}

export function sameAddress(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}
