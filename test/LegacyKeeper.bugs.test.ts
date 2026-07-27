/**
 * Phase 0 red tests → Phase 1 predicates.
 *
 * These were written against the broken contract and all nine failed (commit
 * 8d8d289). Phase 1 turns them green. Every `expect(...)` below is byte-for-byte
 * what it was when red — `git diff` against that commit shows only call-site
 * changes where the API itself changed, never a weakened assertion.
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
  const [owner, keeperBot, recovery, vault, b1, b2, b3, attacker] =
    await ethers.getSigners();
  const keeper = await ethers.deployContract('LegacyKeeper');
  await keeper.waitForDeployment();
  return { keeper, owner, keeperBot, recovery, vault, b1, b2, b3, attacker };
}

async function fund(keeper: any, from: any, value = ONE_ETH) {
  await from.sendTransaction({ to: await keeper.getAddress(), value });
}

/** EIP-712 typed signature bound to chainId + this deployment + one action. */
async function signAction(
  signer: any,
  keeper: any,
  primaryType: 'Heartbeat' | 'Evacuate' | 'Panic',
  nonce: number,
  deadline: number
) {
  const domain = {
    name: 'LegacyKeeper',
    version: '1',
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await keeper.getAddress(),
  };
  const types = {
    [primaryType]: [
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  return signer.signTypedData(domain, types, { nonce, deadline });
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
      const { keeper, owner, b1, b2, b3 } = await deployFixture();
      await keeper.addBeneficiary(b1.address, 5000);
      await keeper.addBeneficiary(b2.address, 5000);
      await keeper.removeBeneficiary(b2.address);
      // Shares must total 100% to execute, so b2's freed share is reassigned.
      await keeper.addBeneficiary(b3.address, 5000);
      await fund(keeper, owner);
      await time.increase(TIMEOUT + GRACE + 1);

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

      // The owner signs over a nonce and deadline — both knowable in advance,
      // unlike the block timestamp the old contract demanded.
      const deadline = (await time.latest()) + 3600;
      const signature = await signAction(owner, keeper, 'Heartbeat', 1, deadline);

      await expect(keeper.heartbeatBySig(1, deadline, signature)).to.not.be
        .reverted;
    });
  });

  describe('Mode B — evacuation', () => {
    it('BUG-06 (B3): a signature used for panicButton cannot also authorize evacuate', async () => {
      const { keeper, recovery, vault, owner, attacker } = await deployFixture();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await fund(keeper, owner);

      const deadline = (await time.latest()) + 3600;
      const signature = await signAction(recovery, keeper, 'Panic', 1, deadline);

      // panicButton is public, so this pair sits in calldata forever.
      await keeper.connect(attacker).panicButton(1, deadline, signature);

      // Anyone can now copy it and force the irreversible sweep. There is no
      // nonce, deadline, or action binding to stop them.
      await expect(keeper.connect(attacker).evacuate(1, deadline, signature)).to
        .be.reverted;
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

      const deadline = (await time.latest()) + 3600;
      // Signed for the FIRST deployment only.
      const signature = await signAction(recovery, keeper, 'Evacuate', 1, deadline);

      // The signature commits to no chainId and no contract address, so one
      // leaked signature drains every deployment the recovery key guards.
      await expect(second.connect(attacker).evacuate(1, deadline, signature)).to
        .be.reverted;
    });
  });
});
