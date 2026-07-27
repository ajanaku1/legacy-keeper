/**
 * Configure a deployed LegacyKeeper for a Mode A demonstration.
 *
 * Owner configuration runs direct rather than through KeeperHub: this is the
 * user acting on their own contract from their own wallet, which is what the
 * dashboard will do. Only *agent* execution is required to route through
 * KeeperHub (gate G4).
 *
 *   LK_ADDRESS=0x... npx hardhat run scripts/configure-demo.ts --network sepolia
 */

import { ethers, network } from 'hardhat';

// Fixed demo beneficiaries — no keys needed, they only receive.
const BENEFICIARIES: Array<{ address: string; shareBps: number }> = [
  { address: '0x1111111111111111111111111111111111111111', shareBps: 6000 },
  { address: '0x2222222222222222222222222222222222222222', shareBps: 4000 },
];

const FUND_AMOUNT = ethers.parseEther('0.01');

async function main() {
  const address = process.env.LK_ADDRESS;
  if (!address) throw new Error('LK_ADDRESS is required');

  const [owner] = await ethers.getSigners();
  const keeper: any = await ethers.getContractAt('LegacyKeeper', address);

  console.log(`network:  ${network.name}`);
  console.log(`contract: ${address}`);
  console.log(`owner:    ${owner.address}\n`);

  const existing = Number(await keeper.totalShareBps());
  if (existing === 0) {
    for (const b of BENEFICIARIES) {
      const tx = await keeper.addBeneficiary(b.address, b.shareBps);
      await tx.wait();
      console.log(`beneficiary ${b.address} @ ${b.shareBps / 100}%  (${tx.hash})`);
    }
  } else {
    console.log(`beneficiaries already configured (${existing} bps total)`);
  }

  const balance = await ethers.provider.getBalance(address);
  if (balance < FUND_AMOUNT) {
    const tx = await owner.sendTransaction({ to: address, value: FUND_AMOUNT });
    await tx.wait();
    console.log(`funded ${ethers.formatEther(FUND_AMOUNT)} ETH  (${tx.hash})`);
  } else {
    console.log(`already funded: ${ethers.formatEther(balance)} ETH`);
  }

  const [timeoutExceeded, graceElapsed] = await keeper.getTimeoutStatus();
  const cfg = await keeper.liveness();
  const dueIn =
    Number(cfg[1]) + Number(cfg[2]) - Number((await keeper.getLivenessStatus())[1]);

  console.log(`\nshares total:     ${Number(await keeper.totalShareBps())} bps`);
  console.log(`timeout exceeded: ${timeoutExceeded}`);
  console.log(`grace elapsed:    ${graceElapsed}`);
  console.log(`executable in:    ${Math.max(0, dueIn)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
