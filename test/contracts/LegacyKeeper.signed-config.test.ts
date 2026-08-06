import { expect } from 'chai';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, TypedDataDomain } from 'ethers';
import { ethers } from 'hardhat';

const DAY = 24n * 60n * 60n;
const coder = ethers.AbiCoder.defaultAbiCoder();
const RECOVERY_FIELDS = [
  { name: 'recoveryKey', type: 'address' },
  { name: 'safeVault', type: 'address' },
  { name: 'allowSharedRecovery', type: 'bool' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

async function planDomain(plan: Contract): Promise<TypedDataDomain> {
  return {
    name: 'LegacyKeeper',
    version: '1',
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await plan.getAddress(),
  };
}

async function signAction(
  signer: Signer,
  plan: Contract,
  primaryType: string,
  fields: Array<{ name: string; type: string }>,
  value: Record<string, unknown>,
  domainOverride?: TypedDataDomain
): Promise<string> {
  return signer.signTypedData(
    domainOverride ?? (await planDomain(plan)),
    { [primaryType]: fields },
    value
  );
}

async function fixture() {
  const [owner, relayer, recovery, vault, beneficiary, second, other] =
    await ethers.getSigners();
  const plan = (await ethers.deployContract('LegacyKeeper', [
    owner.address,
  ])) as Contract;
  await plan.waitForDeployment();
  return { plan, owner, relayer, recovery, vault, beneficiary, second, other };
}

async function futureDeadline(): Promise<bigint> {
  return BigInt((await time.latest()) + 3_600);
}

function asRelayer(contract: Contract, signer: Signer): Contract {
  return contract.connect(signer) as Contract;
}

function beneficiaryHash(wallets: string[], shares: number[]): string {
  return ethers.keccak256(
    coder.encode(['address[]', 'uint16[]'], [wallets, shares])
  );
}

function tokenHash(tokens: string[]): string {
  return ethers.keccak256(coder.encode(['address[]'], [tokens]));
}

describe('LegacyKeeper signed configuration', () => {
  it('atomically replaces beneficiaries when the owner signs an exact 100% allocation', async () => {
    const { plan, owner, relayer, beneficiary, second } = await fixture();
    const wallets = [beneficiary.address, second.address];
    const shares = [6_000, 4_000];
    const nonce = 1n;
    const deadline = await futureDeadline();
    const signature = await signAction(
      owner,
      plan,
      'SetBeneficiaries',
      [
        { name: 'beneficiariesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      { beneficiariesHash: beneficiaryHash(wallets, shares), nonce, deadline }
    );

    await asRelayer(plan, relayer).setBeneficiariesBySig(
      wallets,
      shares,
      nonce,
      deadline,
      signature
    );

    expect(await plan.totalShareBps()).to.equal(10_000n);
    expect(await plan.beneficiaryCount()).to.equal(2n);
  });

  it('rejects an incomplete beneficiary allocation', async () => {
    const { plan, owner, beneficiary } = await fixture();
    const wallets = [beneficiary.address];
    const shares = [9_000];
    const nonce = 2n;
    const deadline = await futureDeadline();
    const signature = await signAction(
      owner,
      plan,
      'SetBeneficiaries',
      [
        { name: 'beneficiariesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      { beneficiariesHash: beneficiaryHash(wallets, shares), nonce, deadline }
    );

    await expect(
      plan.setBeneficiariesBySig(wallets, shares, nonce, deadline, signature)
    ).to.be.revertedWith('LK: shares incomplete');
  });

  it('rejects replay within one action nonce space', async () => {
    const { plan, owner, beneficiary } = await fixture();
    const wallets = [beneficiary.address];
    const shares = [10_000];
    const nonce = 3n;
    const deadline = await futureDeadline();
    const signature = await signAction(
      owner,
      plan,
      'SetBeneficiaries',
      [
        { name: 'beneficiariesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      { beneficiariesHash: beneficiaryHash(wallets, shares), nonce, deadline }
    );

    await plan.setBeneficiariesBySig(
      wallets,
      shares,
      nonce,
      deadline,
      signature
    );
    await expect(
      plan.setBeneficiariesBySig(wallets, shares, nonce, deadline, signature)
    ).to.be.revertedWith('LK: action nonce used');
  });

  it('allows the same nonce in a different action space', async () => {
    const { plan, owner, beneficiary } = await fixture();
    const nonce = 4n;
    const deadline = await futureDeadline();
    const wallets = [beneficiary.address];
    const shares = [10_000];
    const beneficiarySignature = await signAction(
      owner,
      plan,
      'SetBeneficiaries',
      [
        { name: 'beneficiariesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      { beneficiariesHash: beneficiaryHash(wallets, shares), nonce, deadline }
    );
    const livenessValue = {
      heartbeatInterval: DAY,
      timeoutDuration: 90n * DAY,
      gracePeriod: 7n * DAY,
      nonce,
      deadline,
    };
    const livenessSignature = await signAction(
      owner,
      plan,
      'SetLivenessConfig',
      [
        { name: 'heartbeatInterval', type: 'uint64' },
        { name: 'timeoutDuration', type: 'uint64' },
        { name: 'gracePeriod', type: 'uint64' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      livenessValue
    );

    await plan.setBeneficiariesBySig(
      wallets,
      shares,
      nonce,
      deadline,
      beneficiarySignature
    );
    await plan.setLivenessConfigBySig(
      livenessValue.heartbeatInterval,
      livenessValue.timeoutDuration,
      livenessValue.gracePeriod,
      nonce,
      deadline,
      livenessSignature
    );

    expect((await plan.liveness()).timeoutDuration).to.equal(90n * DAY);
  });

  it('rejects a cross-action replay of a beneficiary signature', async () => {
    const { plan, owner, beneficiary } = await fixture();
    const nonce = 5n;
    const deadline = await futureDeadline();
    const signature = await signAction(
      owner,
      plan,
      'SetBeneficiaries',
      [
        { name: 'beneficiariesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      {
        beneficiariesHash: beneficiaryHash([beneficiary.address], [10_000]),
        nonce,
        deadline,
      }
    );

    await expect(
      plan.setLivenessConfigBySig(
        DAY,
        60n * DAY,
        7n * DAY,
        nonce,
        deadline,
        signature
      )
    ).to.be.revertedWith('LK: invalid signature');
  });

  it('rejects a configuration signature bound to another plan', async () => {
    const { plan, owner, beneficiary } = await fixture();
    const secondPlan = (await ethers.deployContract('LegacyKeeper', [
      owner.address,
    ])) as Contract;
    await secondPlan.waitForDeployment();
    const wallets = [beneficiary.address];
    const shares = [10_000];
    const nonce = 8n;
    const deadline = await futureDeadline();
    const signature = await signAction(
      owner,
      plan,
      'SetBeneficiaries',
      [
        { name: 'beneficiariesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      { beneficiariesHash: beneficiaryHash(wallets, shares), nonce, deadline }
    );

    await expect(
      secondPlan.setBeneficiariesBySig(
        wallets,
        shares,
        nonce,
        deadline,
        signature
      )
    ).to.be.revertedWith('LK: invalid signature');
  });

  it('requires signed acknowledgement before sharing recovery addresses', async () => {
    const { plan, owner, recovery } = await fixture();
    const nonce = 6n;
    const deadline = await futureDeadline();
    const value = {
      recoveryKey: recovery.address,
      safeVault: recovery.address,
      allowSharedRecovery: false,
      nonce,
      deadline,
    };
    const signature = await signAction(
      owner,
      plan,
      'SetRecoveryConfig',
      RECOVERY_FIELDS,
      value
    );

    await expect(
      plan.setRecoveryConfigBySig(
        value.recoveryKey,
        value.safeVault,
        value.allowSharedRecovery,
        nonce,
        deadline,
        signature
      )
    ).to.be.revertedWith('LK: shared recovery not acknowledged');
  });

  it('requires the current recovery key for later recovery changes', async () => {
    const { plan, owner, recovery, vault, other } = await fixture();
    const deadline = await futureDeadline();
    const initial = {
      recoveryKey: recovery.address,
      safeVault: vault.address,
      allowSharedRecovery: false,
      nonce: 9n,
      deadline,
    };
    const initialSignature = await signAction(
      owner,
      plan,
      'SetRecoveryConfig',
      RECOVERY_FIELDS,
      initial
    );
    await plan.setRecoveryConfigBySig(
      initial.recoveryKey,
      initial.safeVault,
      initial.allowSharedRecovery,
      initial.nonce,
      deadline,
      initialSignature
    );

    const changed = { ...initial, recoveryKey: other.address, nonce: 10n };
    const ownerSignature = await signAction(
      owner,
      plan,
      'SetRecoveryConfig',
      RECOVERY_FIELDS,
      changed
    );
    await expect(
      plan.setRecoveryConfigBySig(
        changed.recoveryKey,
        changed.safeVault,
        changed.allowSharedRecovery,
        changed.nonce,
        deadline,
        ownerSignature
      )
    ).to.be.revertedWith('LK: invalid signature');

    const recoverySignature = await signAction(
      recovery,
      plan,
      'SetRecoveryConfig',
      RECOVERY_FIELDS,
      changed
    );
    await plan.setRecoveryConfigBySig(
      changed.recoveryKey,
      changed.safeVault,
      changed.allowSharedRecovery,
      changed.nonce,
      deadline,
      recoverySignature
    );
    expect((await plan.vault()).recoveryKeyAddress).to.equal(other.address);
  });

  it('sets recovery and tracked tokens through distinct signed actions', async () => {
    const { plan, owner, recovery, vault, other } = await fixture();
    const deadline = await futureDeadline();
    const recoveryValue = {
      recoveryKey: recovery.address,
      safeVault: vault.address,
      allowSharedRecovery: false,
      nonce: 7n,
      deadline,
    };
    const recoverySignature = await signAction(
      owner,
      plan,
      'SetRecoveryConfig',
      RECOVERY_FIELDS,
      recoveryValue
    );
    const tokens = [other.address];
    const tokenValue = { tokensHash: tokenHash(tokens), nonce: 7n, deadline };
    const tokenSignature = await signAction(
      owner,
      plan,
      'SetTrackedTokens',
      [
        { name: 'tokensHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      tokenValue
    );

    await plan.setRecoveryConfigBySig(
      recoveryValue.recoveryKey,
      recoveryValue.safeVault,
      recoveryValue.allowSharedRecovery,
      recoveryValue.nonce,
      deadline,
      recoverySignature
    );
    await plan.setTrackedTokensBySig(
      tokens,
      tokenValue.nonce,
      deadline,
      tokenSignature
    );

    expect((await plan.vault()).safeVault).to.equal(vault.address);
    expect(await plan.isTrackedToken(other.address)).to.equal(true);
  });
});
