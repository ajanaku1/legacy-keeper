/**
 * Phase 1 — security review, red first.
 *
 * The threat model that matters: the owner's wallet key is compromised and the
 * attacker has full use of it. Mode B claims to survive that. These tests ask
 * whether it actually does.
 *
 * Findings map:
 *   S1 recovery-key rotation by a compromised owner
 *   S2 single-step ownership transfer
 *   S3 malformed ERC-20 return data
 *   S4 one blocked beneficiary bricks token distribution
 *   S5 unbounded beneficiary array
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const DAY = 24 * 60 * 60;
const TIMEOUT = 30 * DAY;
const GRACE = 7 * DAY;
const SUPPLY = ethers.parseUnits('1000', 18);

async function setup() {
  const [owner, keeperBot, recovery, vault, b1, b2, attacker] =
    await ethers.getSigners();
  const keeper: any = await ethers.deployContract('LegacyKeeper');
  await keeper.waitForDeployment();
  return { keeper, owner, keeperBot, recovery, vault, b1, b2, attacker };
}

async function signAction(
  signer: any, keeper: any,
  primaryType: 'Evacuate' | 'RotateRecoveryKey' | 'SetSafeVault',
  fields: Record<string, unknown>,
  types: { name: string; type: string }[]
) {
  return signer.signTypedData(
    {
      name: 'LegacyKeeper',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await keeper.getAddress(),
    },
    { [primaryType]: types },
    fields
  );
}

const deadline = async () => (await time.latest()) + 3600;

describe('LegacyKeeper — security review', () => {
  describe('S1 · a compromised owner key must not defeat Mode B', () => {
    it('cannot re-point the recovery key once one is registered', async () => {
      const { keeper, recovery, attacker } = await setup();
      await keeper.registerRecoveryKey(recovery.address);

      // The attacker holds the owner key. If they can simply overwrite the
      // recovery key with their own, the entire emergency path is theatre.
      await expect(
        keeper.registerRecoveryKey(attacker.address)
      ).to.be.reverted;
    });

    it('cannot re-point the safe vault once a recovery key is registered', async () => {
      const { keeper, recovery, vault, attacker } = await setup();
      await keeper.setSafeVault(vault.address);
      await keeper.registerRecoveryKey(recovery.address);

      // Redirecting the vault is equivalent to stealing: evacuation would
      // sweep straight to the attacker.
      await expect(keeper.setSafeVault(attacker.address)).to.be.reverted;
    });

    it('allows the legitimate holder to rotate using the current recovery key', async () => {
      const { keeper, recovery, b1 } = await setup();
      await keeper.registerRecoveryKey(recovery.address);

      const dl = await deadline();
      const sig = await signAction(
        recovery, keeper, 'RotateRecoveryKey',
        { newKey: b1.address, nonce: 101, deadline: dl },
        [{ name: 'newKey', type: 'address' },
         { name: 'nonce', type: 'uint256' },
         { name: 'deadline', type: 'uint256' }]
      );

      await expect(keeper.rotateRecoveryKey(b1.address, 101, dl, sig)).to.not.be
        .reverted;
      const v = await keeper.vault();
      expect(v[1]).to.equal(b1.address);
    });
  });

  describe('S2 · ownership transfer is two-step', () => {
    it('does not hand over ownership in a single call', async () => {
      const { keeper, attacker } = await setup();
      await keeper.transferOwnership(attacker.address);

      // A stolen key should not be able to lock the real owner out instantly;
      // and ERC-20 allowances point at the old owner, so an unacknowledged
      // handover silently breaks token distribution too.
      expect(await keeper.owner()).to.not.equal(attacker.address);
    });

    it('completes only when the new owner accepts', async () => {
      const { keeper, b1 } = await setup();
      await keeper.transferOwnership(b1.address);
      await keeper.connect(b1).acceptOwnership();
      expect(await keeper.owner()).to.equal(b1.address);
    });
  });

  describe('S3 · malformed ERC-20 return data', () => {
    it('treats a 4-byte return as failure rather than reverting the batch', async () => {
      const { keeper, owner, keeperBot, b1 } = await setup();
      const token: any = await ethers.deployContract('MockMalformedToken', [SUPPLY]);
      await token.waitForDeployment();

      await keeper.addBeneficiary(b1.address, 10000);
      await keeper.setTrackedTokens([await token.getAddress()]);
      await token.approve(await keeper.getAddress(), SUPPLY);
      await time.increase(TIMEOUT + GRACE + 1);

      // abi.decode(4 bytes, (bool)) reverts. A weird token must not be able to
      // take the whole distribution with it.
      await expect(
        keeper.connect(keeperBot).executeInheritanceERC20(await token.getAddress())
      ).to.not.be.reverted;
    });
  });

  describe('S4 · one blocked beneficiary must not brick the estate', () => {
    it('pays everyone else and records the blocked share as claimable', async () => {
      const { keeper, owner, keeperBot, b1, b2 } = await setup();
      const token: any = await ethers.deployContract('MockBlacklistToken', [
        SUPPLY, b1.address,
      ]);
      await token.waitForDeployment();

      await keeper.addBeneficiary(b1.address, 4000); // blocked by the token
      await keeper.addBeneficiary(b2.address, 6000);
      await keeper.setTrackedTokens([await token.getAddress()]);
      await token.approve(await keeper.getAddress(), SUPPLY);
      await time.increase(TIMEOUT + GRACE + 1);

      await keeper.connect(keeperBot).executeInheritanceERC20(await token.getAddress());

      expect(await token.balanceOf(b2.address)).to.equal((SUPPLY * 6000n) / 10000n);
      expect(
        await keeper.pendingTokenWithdrawal(await token.getAddress(), b1.address)
      ).to.equal((SUPPLY * 4000n) / 10000n);
    });
  });

  describe('S5 · distribution gas stays bounded', () => {
    it('caps the beneficiary list', async () => {
      const { keeper } = await setup();
      const cap = Number(await keeper.MAX_BENEFICIARIES());

      for (let i = 0; i < cap; i++) {
        const addr = ethers.getAddress(
          '0x' + (i + 1).toString(16).padStart(40, '0')
        );
        await keeper.addBeneficiary(addr, 1);
      }
      const overflow = ethers.getAddress(
        '0x' + (cap + 1).toString(16).padStart(40, '0')
      );
      await expect(keeper.addBeneficiary(overflow, 1)).to.be.revertedWith(
        'LK: too many beneficiaries'
      );
    });
  });
});
