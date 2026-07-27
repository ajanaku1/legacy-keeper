/**
 * Phase 1 — the Goal.md predicates, tested behaviourally.
 *
 * The companion file (LegacyKeeper.bugs.test.ts) proves the nine inherited
 * bugs are fixed. This file proves the contract is actually correct: exact
 * distribution maths, real ERC-20 flows out of the owner's own wallet, and
 * the failure modes an estate contract has to survive.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const DAY = 24 * 60 * 60;
const TIMEOUT = 30 * DAY;
const GRACE = 7 * DAY;
const ONE_ETH = ethers.parseEther('1');
const TOKEN_SUPPLY = ethers.parseUnits('1000', 18);

async function setup() {
  const [owner, keeperBot, recovery, vault, b1, b2, attacker] =
    await ethers.getSigners();

  const keeper = await ethers.deployContract('LegacyKeeper');
  await keeper.waitForDeployment();

  const token = await ethers.deployContract('MockERC20', [TOKEN_SUPPLY]);
  await token.waitForDeployment();

  return { keeper, token, owner, keeperBot, recovery, vault, b1, b2, attacker };
}

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

const futureDeadline = async () => (await time.latest()) + 3600;

describe('LegacyKeeper — Goal.md predicates', () => {
  // ────────────────────────────────────────────────────────────
  describe('A3 · distribution is exact', () => {
    it('splits native ETH by shareBps with no rounding drift', async () => {
      const { keeper, owner, keeperBot, b1, b2 } = await setup();
      await keeper.addBeneficiary(b1.address, 6000);
      await keeper.addBeneficiary(b2.address, 4000);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });
      await time.increase(TIMEOUT + GRACE + 1);

      const before1 = await ethers.provider.getBalance(b1.address);
      const before2 = await ethers.provider.getBalance(b2.address);

      await keeper.connect(keeperBot).executeInheritance();

      expect((await ethers.provider.getBalance(b1.address)) - before1).to.equal(
        (ONE_ETH * 6000n) / 10000n
      );
      expect((await ethers.provider.getBalance(b2.address)) - before2).to.equal(
        (ONE_ETH * 4000n) / 10000n
      );
    });

    it('splits an ERC-20 pulled from the owner wallet, which never held escrow', async () => {
      const { keeper, token, owner, keeperBot, b1, b2 } = await setup();
      const keeperAddr = await keeper.getAddress();

      await keeper.addBeneficiary(b1.address, 7500);
      await keeper.addBeneficiary(b2.address, 2500);
      await keeper.setTrackedTokens([await token.getAddress()]);

      // The owner keeps custody; the contract only ever holds an allowance.
      await token.approve(keeperAddr, TOKEN_SUPPLY);
      expect(await token.balanceOf(keeperAddr)).to.equal(0n);

      await time.increase(TIMEOUT + GRACE + 1);
      await keeper.connect(keeperBot).executeInheritanceERC20(await token.getAddress());

      expect(await token.balanceOf(b1.address)).to.equal(
        (TOKEN_SUPPLY * 7500n) / 10000n
      );
      expect(await token.balanceOf(b2.address)).to.equal(
        (TOKEN_SUPPLY * 2500n) / 10000n
      );
      expect(await token.balanceOf(owner.address)).to.equal(0n);
      // Still never escrowed, even after execution.
      expect(await token.balanceOf(keeperAddr)).to.equal(0n);
    });

    it('pulls only what the allowance permits, not the whole wallet', async () => {
      const { keeper, token, owner, keeperBot, b1 } = await setup();
      const partial = ethers.parseUnits('100', 18);

      await keeper.addBeneficiary(b1.address, 10000);
      await keeper.setTrackedTokens([await token.getAddress()]);
      await token.approve(await keeper.getAddress(), partial);

      await time.increase(TIMEOUT + GRACE + 1);
      await keeper.connect(keeperBot).executeInheritanceERC20(await token.getAddress());

      expect(await token.balanceOf(b1.address)).to.equal(partial);
      expect(await token.balanceOf(owner.address)).to.equal(
        TOKEN_SUPPLY - partial
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  describe('A6 · execution is idempotent under keeper retries', () => {
    it('reverts on a second call so a retry storm cannot double-distribute', async () => {
      const { keeper, owner, keeperBot, b1 } = await setup();
      await keeper.addBeneficiary(b1.address, 10000);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });
      await time.increase(TIMEOUT + GRACE + 1);

      await keeper.connect(keeperBot).executeInheritance();
      await expect(
        keeper.connect(keeperBot).executeInheritance()
      ).to.be.revertedWith('LK: already executed');
    });
  });

  // ────────────────────────────────────────────────────────────
  describe('Liveness resets the clock', () => {
    it('a heartbeat inside the window prevents execution', async () => {
      const { keeper, owner, keeperBot, b1 } = await setup();
      await keeper.addBeneficiary(b1.address, 10000);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });

      await time.increase(TIMEOUT + GRACE - 100);
      await keeper.heartbeat();
      await time.increase(200);

      await expect(
        keeper.connect(keeperBot).executeInheritance()
      ).to.be.revertedWith('LK: not yet due');
    });

    it('a relayed heartbeat signature cannot be replayed', async () => {
      const { keeper, owner } = await setup();
      const deadline = await futureDeadline();
      const sig = await signAction(owner, keeper, 'Heartbeat', 7, deadline);

      await keeper.heartbeatBySig(7, deadline, sig);
      await expect(keeper.heartbeatBySig(7, deadline, sig)).to.be.revertedWith(
        'LK: nonce used'
      );
    });

    it('an expired signature is rejected', async () => {
      const { keeper, owner } = await setup();
      const deadline = (await time.latest()) + 60;
      const sig = await signAction(owner, keeper, 'Heartbeat', 8, deadline);

      await time.increase(120);
      await expect(keeper.heartbeatBySig(8, deadline, sig)).to.be.revertedWith(
        'LK: signature expired'
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  describe('B1/B2 · evacuation', () => {
    it('sweeps native ETH to the vault on a recovery-key signature alone', async () => {
      const { keeper, owner, recovery, vault, attacker } = await setup();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });

      const before = await ethers.provider.getBalance(vault.address);
      const deadline = await futureDeadline();
      const sig = await signAction(recovery, keeper, 'Evacuate', 1, deadline);

      // Submitted by a random relayer. The owner key signs nothing.
      await keeper.connect(attacker).evacuate(1, deadline, sig);

      expect((await ethers.provider.getBalance(vault.address)) - before).to.equal(
        ONE_ETH
      );
    });

    it('sweeps tracked ERC-20s out of the owner wallet to the vault', async () => {
      const { keeper, token, recovery, vault, attacker } = await setup();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await keeper.setTrackedTokens([await token.getAddress()]);
      await token.approve(await keeper.getAddress(), TOKEN_SUPPLY);

      const deadline = await futureDeadline();
      const sig = await signAction(recovery, keeper, 'Evacuate', 2, deadline);
      await keeper.connect(attacker).evacuate(2, deadline, sig);

      expect(await token.balanceOf(vault.address)).to.equal(TOKEN_SUPPLY);
    });

    it('rejects a signature from the owner key — only the recovery key authorizes', async () => {
      const { keeper, owner, recovery, vault } = await setup();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);

      const deadline = await futureDeadline();
      // A fully compromised wallet key must not be able to evacuate.
      const ownerSig = await signAction(owner, keeper, 'Evacuate', 3, deadline);

      await expect(
        keeper.evacuate(3, deadline, ownerSig)
      ).to.be.revertedWith('LK: invalid signature');
    });

    it('rejects a malleable signature', async () => {
      const { keeper, recovery, vault } = await setup();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);

      const deadline = await futureDeadline();
      const sig = await signAction(recovery, keeper, 'Evacuate', 4, deadline);

      // Flip s into the upper range and v accordingly — same signer, new bytes.
      const N = BigInt(
        '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
      );
      const r = ethers.dataSlice(sig, 0, 32);
      const s = BigInt(ethers.dataSlice(sig, 32, 64));
      const v = Number(ethers.dataSlice(sig, 64, 65));
      const flipped = ethers.concat([
        r,
        ethers.toBeHex(N - s, 32),
        ethers.toBeHex(v === 27 ? 28 : 27, 1),
      ]);

      await expect(
        keeper.evacuate(4, deadline, flipped)
      ).to.be.revertedWith('LK: malleable signature');
    });
  });

  // ────────────────────────────────────────────────────────────
  describe('B5 · the two modes are mutually exclusive', () => {
    it('evacuation blocks a later inheritance', async () => {
      const { keeper, owner, keeperBot, recovery, vault, b1 } = await setup();
      await keeper.addBeneficiary(b1.address, 10000);
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });

      const deadline = await futureDeadline();
      const sig = await signAction(recovery, keeper, 'Evacuate', 5, deadline);
      await keeper.evacuate(5, deadline, sig);

      await time.increase(TIMEOUT + GRACE + 1);
      await expect(
        keeper.connect(keeperBot).executeInheritance()
      ).to.be.revertedWith('LK: already evacuated');
    });

    it('inheritance blocks a later evacuation', async () => {
      const { keeper, owner, keeperBot, recovery, vault, b1 } = await setup();
      await keeper.addBeneficiary(b1.address, 10000);
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });
      await time.increase(TIMEOUT + GRACE + 1);
      await keeper.connect(keeperBot).executeInheritance();

      const deadline = await futureDeadline();
      const sig = await signAction(recovery, keeper, 'Evacuate', 6, deadline);

      // Nothing left to take, and the estate is already settled.
      await keeper.evacuate(6, deadline, sig);
      expect(await keeper.evacuationExecuted()).to.equal(true);
      expect(await ethers.provider.getBalance(await keeper.getAddress())).to.equal(
        0n
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  describe('Review findings — regressions', () => {
    it('a paused estate does not distribute (toggleLiveness is not decorative)', async () => {
      const { keeper, owner, keeperBot, b1 } = await setup();
      await keeper.addBeneficiary(b1.address, 10000);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });
      await keeper.toggleLiveness(false);
      await time.increase(TIMEOUT + GRACE + 1);

      await expect(
        keeper.connect(keeperBot).executeInheritance()
      ).to.be.revertedWith('LK: liveness inactive');
    });

    it('distributes a USDT-shaped token that returns no data', async () => {
      const { keeper, owner, keeperBot, b1, b2 } = await setup();
      const supply = ethers.parseUnits('5000', 6);
      const usdt = await ethers.deployContract('MockUSDT', [supply]);
      await usdt.waitForDeployment();

      await keeper.addBeneficiary(b1.address, 6000);
      await keeper.addBeneficiary(b2.address, 4000);
      await keeper.setTrackedTokens([await usdt.getAddress()]);
      await usdt.approve(await keeper.getAddress(), supply);

      await time.increase(TIMEOUT + GRACE + 1);
      await keeper
        .connect(keeperBot)
        .executeInheritanceERC20(await usdt.getAddress());

      expect(await usdt.balanceOf(b1.address)).to.equal((supply * 6000n) / 10000n);
      expect(await usdt.balanceOf(b2.address)).to.equal((supply * 4000n) / 10000n);
      expect(await usdt.balanceOf(owner.address)).to.equal(0n);
    });

    it('distributes each token only once, matching the native path', async () => {
      const { keeper, token, owner, keeperBot, b1 } = await setup();
      await keeper.addBeneficiary(b1.address, 10000);
      await keeper.setTrackedTokens([await token.getAddress()]);
      await token.approve(await keeper.getAddress(), TOKEN_SUPPLY);
      await time.increase(TIMEOUT + GRACE + 1);

      await keeper.connect(keeperBot).executeInheritanceERC20(await token.getAddress());

      // The owner receiving more of the same token later must not let anyone
      // re-run distribution against a settled estate.
      await token.connect(b1).transfer(owner.address, ethers.parseUnits('10', 18));
      await token.approve(await keeper.getAddress(), TOKEN_SUPPLY);

      await expect(
        keeper.connect(keeperBot).executeInheritanceERC20(await token.getAddress())
      ).to.be.revertedWith('LK: token already distributed');
    });

    it('evacuateToken sweeps a token the batch loop missed', async () => {
      const { keeper, token, recovery, vault, attacker } = await setup();
      await keeper.registerRecoveryKey(recovery.address);
      await keeper.setSafeVault(vault.address);
      await keeper.setTrackedTokens([await token.getAddress()]);

      // No allowance yet, so the sweep loop finds nothing to move.
      const deadline = await futureDeadline();
      const sig = await signAction(recovery, keeper, 'Evacuate', 9, deadline);
      await keeper.connect(attacker).evacuate(9, deadline, sig);
      expect(await token.balanceOf(vault.address)).to.equal(0n);

      // Granting it afterwards must still be recoverable.
      await token.approve(await keeper.getAddress(), TOKEN_SUPPLY);
      await keeper.connect(attacker).evacuateToken(await token.getAddress());

      expect(await token.balanceOf(vault.address)).to.equal(TOKEN_SUPPLY);
    });

    it('rejects a beneficiary share above 100% with a readable reason', async () => {
      const { keeper, b1 } = await setup();
      await expect(keeper.addBeneficiary(b1.address, 20000)).to.be.revertedWith(
        'LK: invalid share'
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  describe('One hostile beneficiary cannot brick the estate', () => {
    it('credits a pull balance when a push fails and pays everyone else', async () => {
      const { keeper, owner, keeperBot, b2 } = await setup();
      const hostile = await ethers.deployContract('RevertingReceiver');
      await hostile.waitForDeployment();
      const hostileAddr = await hostile.getAddress();

      await keeper.addBeneficiary(hostileAddr, 5000);
      await keeper.addBeneficiary(b2.address, 5000);
      await owner.sendTransaction({
        to: await keeper.getAddress(),
        value: ONE_ETH,
      });
      await time.increase(TIMEOUT + GRACE + 1);

      const before2 = await ethers.provider.getBalance(b2.address);
      await keeper.connect(keeperBot).executeInheritance();

      // The honest beneficiary is paid despite the hostile one reverting.
      expect((await ethers.provider.getBalance(b2.address)) - before2).to.equal(
        ONE_ETH / 2n
      );
      // The refused share is preserved, not lost or reverted.
      expect(await keeper.pendingWithdrawal(hostileAddr)).to.equal(ONE_ETH / 2n);
    });
  });
});
