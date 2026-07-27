/**
 * Deploy LegacyKeeper.
 *
 * Deployment goes direct via Hardhat rather than through KeeperHub — that is
 * a one-off setup step by a present, funded operator, not agent execution.
 * Everything the *agent* does still routes through KeeperHub (gate G4).
 *
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *
 * Optional demo timing, so the whole Mode A lifecycle is filmable:
 *   DEMO_TIMEOUT_SECONDS=300 DEMO_GRACE_SECONDS=120 npx hardhat run ...
 */

import { ethers, run, network } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`network:  ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`balance:  ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error(
      `${deployer.address} has no ETH on ${network.name}. Fund it before deploying.`
    );
  }

  const keeper = await ethers.deployContract('LegacyKeeper');
  await keeper.waitForDeployment();
  const address = await keeper.getAddress();

  console.log(`\nLegacyKeeper deployed: ${address}`);

  // Short timings make the timeout → grace → distribution path demonstrable
  // in minutes instead of 37 days.
  const timeout = process.env.DEMO_TIMEOUT_SECONDS;
  const grace = process.env.DEMO_GRACE_SECONDS;
  if (timeout && grace) {
    const tx = await (keeper as any).setLivenessConfig(
      60,
      Number(timeout),
      Number(grace)
    );
    await tx.wait();
    console.log(`demo timings set: timeout ${timeout}s, grace ${grace}s`);
  }

  if (process.env.ETHERSCAN_API_KEY && network.name !== 'hardhat') {
    console.log('\nwaiting for block confirmations before verifying...');
    await keeper.deploymentTransaction()?.wait(5);
    try {
      await run('verify:verify', { address, constructorArguments: [] });
      console.log('verified on Etherscan');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`verification skipped: ${message}`);
    }
  }

  console.log(`\nAdd to .env:\n  LEGACY_KEEPER_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
