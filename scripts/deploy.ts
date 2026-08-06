/** Deploy the wallet-scoped LegacyKeeperFactory on the selected network. */

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

  const factory = await ethers.deployContract('LegacyKeeperFactory');
  await factory.waitForDeployment();
  const address = await factory.getAddress();

  console.log(`\nLegacyKeeperFactory deployed: ${address}`);

  if (process.env.ETHERSCAN_API_KEY && network.name !== 'hardhat') {
    console.log('\nwaiting for block confirmations before verifying...');
    await factory.deploymentTransaction()?.wait(5);
    try {
      await run('verify:verify', {
        address,
        constructorArguments: [],
      });
      console.log('verified on Etherscan');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`verification skipped: ${message}`);
    }
  }

  console.log(
    `\nAdd to .env:\n  NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS=${address}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
