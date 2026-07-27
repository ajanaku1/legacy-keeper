import type { Abi } from 'viem';

export const LEGACY_KEEPER_ADDRESS =
  (process.env.NEXT_PUBLIC_LEGACY_KEEPER_ADDRESS as `0x${string}`) ?? '0x';

export const SEPOLIA_RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? '';

/** Only what the dashboard reads or writes. */
export const legacyKeeperAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function', name: 'getLivenessStatus', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'lastHeartbeat', type: 'uint64' },
      { name: 'timeSinceHeartbeat', type: 'uint64' },
      { name: 'active', type: 'bool' },
      { name: 'expired', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'getTimeoutStatus', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'timeoutExceeded', type: 'bool' },
      { name: 'graceElapsed', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'liveness', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'heartbeatInterval', type: 'uint64' },
      { name: 'timeoutDuration', type: 'uint64' },
      { name: 'gracePeriod', type: 'uint64' },
      { name: 'lastHeartbeat', type: 'uint64' },
      { name: 'livenessActive', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'vault', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'safeVault', type: 'address' },
      { name: 'recoveryKeyAddress', type: 'address' },
      { name: 'recoveryKeyRegistered', type: 'bool' },
      { name: 'privateRoutingEnabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'getBeneficiaries', stateMutability: 'view', inputs: [],
    outputs: [{
      type: 'tuple[]',
      components: [{ name: 'wallet', type: 'address' }, { name: 'shareBps', type: 'uint16' }],
    }],
  },
  { type: 'function', name: 'totalShareBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'inheritanceExecuted', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'evacuationExecuted', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'heartbeat', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const satisfies Abi;

export const EXPLORER = 'https://sepolia.etherscan.io';
