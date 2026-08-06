import { expect } from 'chai';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, TypedDataDomain } from 'ethers';
import { ethers } from 'hardhat';

const DAY = 24n * 60n * 60n;
const coder = ethers.AbiCoder.defaultAbiCoder();
type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

interface PlanConfig {
  heartbeatInterval: bigint;
  timeoutDuration: bigint;
  gracePeriod: bigint;
  beneficiaryWallets: string[];
  beneficiaryShares: number[];
  recoveryKey: string;
  safeVault: string;
  trackedTokens: string[];
  allowSharedRecovery: boolean;
}

function hashConfig(config: PlanConfig): string {
  const beneficiariesHash = ethers.keccak256(
    coder.encode(
      ['address[]', 'uint16[]'],
      [config.beneficiaryWallets, config.beneficiaryShares]
    )
  );
  const tokensHash = ethers.keccak256(
    coder.encode(['address[]'], [config.trackedTokens])
  );

  return ethers.keccak256(
    coder.encode(
      [
        'uint64',
        'uint64',
        'uint64',
        'bytes32',
        'address',
        'address',
        'bytes32',
        'bool',
      ],
      [
        config.heartbeatInterval,
        config.timeoutDuration,
        config.gracePeriod,
        beneficiariesHash,
        config.recoveryKey,
        config.safeVault,
        tokensHash,
        config.allowSharedRecovery,
      ]
    )
  );
}

async function factoryDomain(factory: Contract): Promise<TypedDataDomain> {
  return {
    name: 'LegacyKeeperFactory',
    version: '1',
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await factory.getAddress(),
  };
}

async function signCreation(
  signer: Signer,
  factory: Contract,
  config: PlanConfig,
  nonce: bigint,
  deadline: bigint,
  domainOverride?: TypedDataDomain
): Promise<string> {
  const domain = domainOverride ?? (await factoryDomain(factory));
  return signer.signTypedData(
    domain,
    {
      CreatePlan: [
        { name: 'owner', type: 'address' },
        { name: 'configHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    {
      owner: signer.address,
      configHash: hashConfig(config),
      nonce,
      deadline,
    }
  );
}

async function fixture() {
  const [owner, relayer, recovery, vault, beneficiary, other] =
    await ethers.getSigners();
  const factory = (await ethers.deployContract(
    'LegacyKeeperFactory'
  )) as Contract;
  await factory.waitForDeployment();
  const config: PlanConfig = {
    heartbeatInterval: DAY,
    timeoutDuration: 60n * DAY,
    gracePeriod: 7n * DAY,
    beneficiaryWallets: [beneficiary.address],
    beneficiaryShares: [10_000],
    recoveryKey: recovery.address,
    safeVault: vault.address,
    trackedTokens: [],
    allowSharedRecovery: false,
  };
  return {
    factory,
    config,
    owner,
    relayer,
    recovery,
    vault,
    beneficiary,
    other,
  };
}

async function futureDeadline(): Promise<bigint> {
  return BigInt((await time.latest()) + 3_600);
}

function asRelayer(contract: Contract, signer: Signer): Contract {
  return contract.connect(signer) as Contract;
}

describe('LegacyKeeperFactory', () => {
  it('creates and registers one configured plan from an owner signature', async () => {
    const { factory, config, owner, relayer } = await fixture();
    const deadline = await futureDeadline();
    const signature = await signCreation(owner, factory, config, 1n, deadline);

    await expect(
      asRelayer(factory, relayer).createPlan(
        owner.address,
        config,
        1n,
        deadline,
        signature
      )
    ).to.emit(factory, 'PlanCreated');

    const planAddress = await factory.planOf(owner.address);
    expect(planAddress).not.to.equal(ethers.ZeroAddress);
    const plan = (await ethers.getContractAt(
      'LegacyKeeper',
      planAddress
    )) as Contract;
    expect(await plan.owner()).to.equal(owner.address);
    expect(await plan.totalShareBps()).to.equal(10_000n);
    expect((await plan.vault()).recoveryKeyAddress).to.equal(
      config.recoveryKey
    );
  });

  it('rejects a second plan for the same owner', async () => {
    const { factory, config, owner } = await fixture();
    const deadline = await futureDeadline();
    const first = await signCreation(owner, factory, config, 2n, deadline);
    await factory.createPlan(owner.address, config, 2n, deadline, first);
    const second = await signCreation(owner, factory, config, 3n, deadline);

    await expect(
      factory.createPlan(owner.address, config, 3n, deadline, second)
    ).to.be.revertedWith('LKF: plan exists');
  });

  it('rejects an expired creation signature', async () => {
    const { factory, config, owner } = await fixture();
    const deadline = BigInt((await time.latest()) + 30);
    const signature = await signCreation(owner, factory, config, 4n, deadline);
    await time.increase(31);

    await expect(
      factory.createPlan(owner.address, config, 4n, deadline, signature)
    ).to.be.revertedWith('LKF: signature expired');
  });

  it('rejects a signature replayed against another factory', async () => {
    const { factory, config, owner } = await fixture();
    const secondFactory = (await ethers.deployContract(
      'LegacyKeeperFactory'
    )) as Contract;
    await secondFactory.waitForDeployment();
    const deadline = await futureDeadline();
    const signature = await signCreation(owner, factory, config, 5n, deadline);

    await expect(
      secondFactory.createPlan(owner.address, config, 5n, deadline, signature)
    ).to.be.revertedWith('LKF: invalid signature');
  });

  it('rejects a creation signature bound to another chain', async () => {
    const { factory, config, owner } = await fixture();
    const deadline = await futureDeadline();
    const domain = await factoryDomain(factory);
    const signature = await signCreation(owner, factory, config, 8n, deadline, {
      ...domain,
      chainId: BigInt(domain.chainId as bigint) + 1n,
    });

    await expect(
      factory.createPlan(owner.address, config, 8n, deadline, signature)
    ).to.be.revertedWith('LKF: invalid signature');
  });

  it('rejects a config changed after the owner signed it', async () => {
    const { factory, config, owner, other } = await fixture();
    const deadline = await futureDeadline();
    const signature = await signCreation(owner, factory, config, 6n, deadline);
    const changed = { ...config, safeVault: other.address };

    await expect(
      factory.createPlan(owner.address, changed, 6n, deadline, signature)
    ).to.be.revertedWith('LKF: invalid signature');
  });

  it('requires explicit acknowledgement when recovery addresses match', async () => {
    const { factory, config, owner, recovery } = await fixture();
    const deadline = await futureDeadline();
    const shared = {
      ...config,
      safeVault: recovery.address,
      allowSharedRecovery: false,
    };
    const signature = await signCreation(owner, factory, shared, 7n, deadline);

    await expect(
      factory.createPlan(owner.address, shared, 7n, deadline, signature)
    ).to.be.revertedWith('LK: shared recovery not acknowledged');
  });
});
