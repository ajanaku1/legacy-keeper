import { ethers } from 'hardhat';

async function main() {
  console.log('Deploying LegacyKeeper contract...');

  const LegacyKeeper = await ethers.getContractFactory('LegacyKeeper');
  const contract = await LegacyKeeper.deploy();

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const owner = await contract.owner();

  console.log(`\n✅ LegacyKeeper deployed to: ${address}`);
  console.log(`   Owner: ${owner}`);
  console.log(`   Network: ${(await ethers.provider.getNetwork()).name}`);
  console.log(`   Block: ${await ethers.provider.getBlockNumber()}`);

  // Verify contract on Etherscan (if API key is configured)
  if (process.env.ETHERSCAN_API_KEY) {
    console.log('\nVerifying contract on Etherscan...');
    try {
      await run('verify:verify', {
        address,
        constructorArguments: [],
      });
      console.log('✅ Contract verified');
    } catch (error) {
      console.log('Verification skipped or failed:', error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
