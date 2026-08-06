import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import type {
  PlanConfigRequest,
  PlanCreationRequest,
} from './plan-route';
import type { ConfigurationRequest } from './configuration-route';

export function hashPlanConfig(config: PlanConfigRequest): Hex {
  const beneficiariesHash = keccak256(
    encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint16[]' }],
      [config.beneficiaryWallets, config.beneficiaryShares]
    )
  );
  const tokensHash = keccak256(
    encodeAbiParameters([{ type: 'address[]' }], [config.trackedTokens])
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint64' },
        { type: 'uint64' },
        { type: 'uint64' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bool' },
      ],
      [
        BigInt(config.heartbeatInterval),
        BigInt(config.timeoutDuration),
        BigInt(config.gracePeriod),
        beneficiariesHash,
        config.recoveryKey,
        config.safeVault,
        tokensHash,
        config.allowSharedRecovery,
      ]
    )
  );
}

export function planCreationTypedData(
  request: PlanCreationRequest,
  factory: Address
) {
  return {
    domain: {
      name: 'LegacyKeeperFactory',
      version: '1',
      chainId: request.chainId,
      verifyingContract: factory,
    },
    types: {
      CreatePlan: [
        { name: 'owner', type: 'address' },
        { name: 'configHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'CreatePlan' as const,
    message: {
      owner: request.owner,
      configHash: hashPlanConfig(request.config),
      nonce: BigInt(request.nonce),
      deadline: BigInt(request.deadline),
    },
  } as const;
}

export function configurationTypedData(request: ConfigurationRequest) {
  const domain = {
    name: 'LegacyKeeper',
    version: '1',
    chainId: request.chainId,
    verifyingContract: request.plan,
  } as const;
  const authorization = {
    nonce: BigInt(request.nonce),
    deadline: BigInt(request.deadline),
  };
  const payload = request.payload;
  if ('wallets' in payload) {
    return {
      domain,
      types: {
        SetBeneficiaries: [
          { name: 'beneficiariesHash', type: 'bytes32' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'SetBeneficiaries' as const,
      message: {
        beneficiariesHash: keccak256(
          encodeAbiParameters(
            [{ type: 'address[]' }, { type: 'uint16[]' }],
            [payload.wallets, payload.shares]
          )
        ),
        ...authorization,
      },
    } as const;
  }
  if ('heartbeatInterval' in payload) {
    return {
      domain,
      types: {
        SetLivenessConfig: [
          { name: 'heartbeatInterval', type: 'uint64' },
          { name: 'timeoutDuration', type: 'uint64' },
          { name: 'gracePeriod', type: 'uint64' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'SetLivenessConfig' as const,
      message: {
        heartbeatInterval: BigInt(payload.heartbeatInterval),
        timeoutDuration: BigInt(payload.timeoutDuration),
        gracePeriod: BigInt(payload.gracePeriod),
        ...authorization,
      },
    } as const;
  }
  if ('recoveryKey' in payload) {
    return {
      domain,
      types: {
        SetRecoveryConfig: [
          { name: 'recoveryKey', type: 'address' },
          { name: 'safeVault', type: 'address' },
          { name: 'allowSharedRecovery', type: 'bool' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'SetRecoveryConfig' as const,
      message: { ...payload, ...authorization },
    } as const;
  }
  return {
    domain,
    types: {
      SetTrackedTokens: [
        { name: 'tokensHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'SetTrackedTokens' as const,
    message: {
      tokensHash: keccak256(
        encodeAbiParameters([{ type: 'address[]' }], [payload.tokens])
      ),
      ...authorization,
    },
  } as const;
}
