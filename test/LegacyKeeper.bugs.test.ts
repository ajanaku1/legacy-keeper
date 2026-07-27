/**
 * Phase 0 — red tests.
 *
 * These run against the CURRENT contract and are EXPECTED TO FAIL. Each one
 * asserts the behaviour the product requires, so a failure here is proof the
 * bug is real rather than an opinion in a review. Phase 1 turns them green
 * one at a time; the assertions do not change.
 *
 * Test → predicate map (see Goal.md):
 *   BUG-01 → A1   BUG-02 → A2   BUG-03 → A5   BUG-04 → A4
 *   BUG-05 → heartbeat usability   BUG-06 → B3   BUG-07 → B4
 *   BUG-08 → A3/B2 (ERC-20)        BUG-09 → custody model
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const DAY = 24 * 60 * 60;
const TIMEOUT = 30 * DAY;
const GRACE = 7 * DAY;
const ONE_ETH = ethers.parseEther('1');

async function deployFixture() {
  const [owner, keeperBot, recovery, vault, b1, b2, attacker] =
    await ethers.getSigners();
  const keeper = await ethers.deployContract('LegacyKeeper');
  await keeper.waitForDeployment();
  return { keeper, owner, keeperBot, recovery, vault, b1, b2, attacker };
}

async function fund(keeper: any, from: any, value = ONE_ETH) {
  await from.sendTransaction({ to: await keeper.getAddress(), value });
}

/** Rebuild the digest the contract expects for a heartbeat at `timestamp`. */
async function heartbeatDigest(keeper: any, timestamp: number) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const domainSeparator = ethers.keccak256(
    abi.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        ethers.keccak256(
          ethers.toUtf8Bytes(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
          )
        ),
        ethers.keccak256(ethers.toUtf8Bytes('LegacyKeeper')),
        ethers.keccak256(ethers.toUtf8Bytes('1')),
        chainId,
        await keeper.getAddress(),
      ]
    )
  );

  const structHash = ethers.keccak256(
    abi.encode(
      ['bytes32', 'uint256'],
      [
        ethers.keccak256(ethers.toUtf8Bytes('Heartbeat(uint256 timestamp)')),
        timestamp,
      ]
    )
  );

  return ethers.keccak256(
    ethers.concat(['0x1901', domainSeparator, structHash])
  );
}

function hasFunction(contract: any, name: string): boolean {
  return contract.interface.fragments.some(
    (f: any) => f.type === 'function' && f.name === name
  );
}

describe('LegacyKeeper — Phase 0 red tests', () => {
  describe('Mode A — inheritance', () => {
    it('BUG-01 (A1): a keeper that is not the owner can execute after grace elapses', async () => {
      const { keeper, owner, keeperBot, b1 } = await deployFixture();
      await keeper.addBeneficiary(b1.address, 10000);
      await fund(keeper, owner);
      await time.increase(TIMEOUT + GRACE + 1);

      // The whole premise is that the owner is dead, incapacitated, or locked
      // out. If only the owner can trigger distribution, the feature cannot
      // exist. KeeperHub's scheduled workflow is the caller in production.
      await expect(keeper.connect(keeperBot).executeInheritance()).to.not.be
        .reverted;
    });

    it('BUG-02 (A2): execution reverts before the grace period has elapsed', async () => {
      const { keeper, owner, b1 } = await deployFixture();
      await keeper.addBeneficiary(b1.address, 10000);
      await fund(keeper, owner);

      // No time has passed. Distributing an estate now would be catastrophic.
      await expect(keeper.executeInheritance()).to.be.reverted;
    });

    it('BUG-03 (A5): a removed beneficiary receives nothing', async () => {
      const { keeper, owner, b1, b2 } = await deployFixture();
      await keeper.addBeneficiary(b1.address, 5000);
      await keeper.addBeneficiary(b2.address, 5000);
      await keeper.removeBeneficiary(b2.address);
      await fund(keeper, owner);

      const before = await ethers.provider.getBalance(b2.address);
      await keeper.executeInheritance();
      const after = await ethers.provider.getBalance(b2.address);

      expect(after - before).to.equal(0n);
    });

    it('BUG-04 (A4): beneficiary shares that exceed 100% are rejected', async () => {
      const { keeper, b1, b2 } = await deployFixture();
      await keeper.addBeneficiary(b1.address, 8000);

      // 8000 + 8000 = 160%. Accepting this bricks distribution later:
      // the balance runs out mid-loop and the remainder math underflows.
      await expect(keeper.addBeneficiary(b2.address, 8000)).to.be.reverted;
    });

    it('BUG-08 (A3/B2): an ERC-20 distribution path exists', async () => {
      const { keeper } = await deployFixture();

      // Estates and stablecoin balances are tokens, not ether. The README
      // claims "native + ERC-20s"; the contract has no token code at all.
      expect(
        hasFunction(keeper, 'executeInheritanceERC20'),
        'contract exposes no ERC-20 inheritance path'
      ).to.equal(true);
    });

    it('BUG-09 (custody): assets are pulled by allowance, not escrowed', async () => {
      const { keeper } = await deployFixture();

      // Today distribution only moves address(this).balance, so the user must
      // first move everything into an unaudited contract — strictly riskier
      // than the problem being solved. Funds must stay in the wallet until
      // execution and be pulled via transferFrom.
      expect(
        hasFunction(keeper, 'setTrackedTokens') ||
          hasFunction(keeper, 'executeInheritanceERC20'),
        'contract has no allowance-based custody path'
      ).to.equal(true);
    });
  });

  describe('Liveness', () => {
    it('BUG-05: the owner can produce a heartbeat signature that verifies', async () => {
      const { keeper, owner } = await deployFixture();

      // The owner signs against the timestamp they can actually observe.
      const now = await time.latest();
      const digest = await heartbeatDigest(keeper, now);
      const signature = await owner.signMessage(ethers.getBytes(digest));

      // The contract hashes block.timestamp of the block this lands in, which
      // no signer can know in advance. The signature is unproducible in
      // practice, so liveness can never be refreshed.
      await expect(keeper.heartbeat(signature)).to.not.be.reverted;
    });
  });

  describe('Mode B — evacuation', () => {
    it('BUG-06 (B3): a signature used for panicButton cannot also authorize evacuate', async () => {
      const { keeper, recovery, vault, owner, attacker } = await deployFixture();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await fund(keeper, owner);

      const message = ethers.toUtf8Bytes('LegacyKeeper: emergency');
      const signature = await recovery.signMessage(
        ethers.getBytes(ethers.keccak256(message))
      );

      // panicButton is public, so this pair sits in calldata forever.
      await keeper.connect(attacker).panicButton(signature, message);

      // Anyone can now copy it and force the irreversible sweep. There is no
      // nonce, deadline, or action binding to stop them.
      await expect(keeper.connect(attacker).evacuate(signature, message)).to.be
        .reverted;
    });

    it('BUG-07 (B4): a signature is bound to one contract and cannot be replayed to another', async () => {
      const { keeper, recovery, vault, owner, attacker } = await deployFixture();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);

      const second = await ethers.deployContract('LegacyKeeper');
      await second.waitForDeployment();
      await second.registerRecoveryKey(recovery.address);
      await second.setSafeVault(vault.address);
      await fund(second, owner);

      const message = ethers.toUtf8Bytes('LegacyKeeper: emergency');
      const signature = await recovery.signMessage(
        ethers.getBytes(ethers.keccak256(message))
      );

      // The signature commits to no chainId and no contract address, so one
      // leaked signature drains every deployment the recovery key guards.
      await expect(second.connect(attacker).evacuate(signature, message)).to.be
        .reverted;
    });
  });
});
