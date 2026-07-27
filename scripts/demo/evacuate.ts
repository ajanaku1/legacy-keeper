/**
 * Mode B — emergency evacuation executed through KeeperHub.
 *
 * The scenario: the owner's wallet key is compromised. A separate recovery
 * key — which the attacker does not have — authorizes a sweep to a safe
 * vault. The owner key signs nothing here, and the transaction is submitted
 * by KeeperHub, not by the owner.
 *
 * The recovery key is generated in memory and never written to disk. Testnet
 * burner keys are still keys; nothing in this repo persists one.
 *
 *   LEGACY_KEEPER_ADDRESS=0x... npx tsx scripts/demo/evacuate.ts
 */

import 'dotenv/config';
import { JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import { Contract } from 'ethers';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import { KeeperHubExecutor } from '../../agent/executor/keeperhub';
import { AuditLedger } from '../../agent/audit/ledger';

const CHAIN_ID = 11155111;
const SWEEP_AMOUNT = parseEther('0.005');

const OWNER_ABI = [
  'function registerRecoveryKey(address) external',
  'function setSafeVault(address) external',
  'function evacuationExecuted() view returns (bool)',
  'function vault() view returns (address,address,bool,bool)',
];

async function main() {
  const contractAddress = req('LEGACY_KEEPER_ADDRESS');
  const provider = new JsonRpcProvider(req('SEPOLIA_RPC_URL'));
  const owner = new Wallet(req('DEPLOYER_PRIVATE_KEY'), provider);

  // Ephemeral, in-memory only.
  const recoveryKey = Wallet.createRandom();
  const safeVault = Wallet.createRandom();

  console.log(`contract:     ${contractAddress}`);
  console.log(`owner:        ${owner.address}`);
  console.log(`recovery key: ${recoveryKey.address}  (ephemeral)`);
  console.log(`safe vault:   ${safeVault.address}  (fresh, so the delta is clean)\n`);

  const keeper = new Contract(contractAddress, OWNER_ABI, owner);

  // ── Owner-side setup. Direct, because this is the user configuring their
  //    own contract from the dashboard — not agent execution.
  const v = await keeper.vault();
  if (v[1].toLowerCase() !== recoveryKey.address.toLowerCase()) {
    await (await keeper.registerRecoveryKey(recoveryKey.address)).wait();
    console.log('registered recovery key');
  }
  await (await keeper.setSafeVault(safeVault.address)).wait();
  console.log('set safe vault');

  await (
    await owner.sendTransaction({ to: contractAddress, value: SWEEP_AMOUNT })
  ).wait();
  console.log(`funded ${formatEther(SWEEP_AMOUNT)} ETH\n`);

  // ── The recovery key authorizes. The owner key is not involved.
  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await recoveryKey.signTypedData(
    {
      name: 'LegacyKeeper',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: contractAddress,
    },
    {
      Evacuate: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    { nonce, deadline }
  );
  console.log(`recovery key signed Evacuate  nonce=${nonce}`);

  // ── KeeperHub executes.
  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: req('KEEPERHUB_API_KEY'),
  });
  const ledger = new AuditLedger();
  const executor = new KeeperHubExecutor(mcp, ledger, CHAIN_ID, contractAddress);

  const server = await mcp.connect();
  console.log(`\nconnected: ${server.name} v${server.version}`);
  console.log('── executing evacuate() through KeeperHub ──');

  const before = await provider.getBalance(safeVault.address);
  const result = await executor.executeEvacuation(
    { nonce, deadline, signature },
    { type: 'panic', source: 'demo', detail: 'wallet key compromised' }
  );

  console.log(`  success:  ${result.success}`);
  console.log(`  attempts: ${result.attempts}`);
  if (result.txHash) {
    console.log(`  tx:       https://sepolia.etherscan.io/tx/${result.txHash}`);
    console.log(`  gasUsed:  ${result.gasUsed ?? 'n/a'}`);
  }
  if (result.error) console.log(`  error:    ${result.error}`);

  // ── Verify on-chain rather than trusting the reported status.
  const after = await provider.getBalance(safeVault.address);
  const swept = after - before;
  console.log(`\nvault delta:         ${formatEther(swept)} ETH`);
  console.log(`evacuationExecuted:  ${await keeper.evacuationExecuted()}`);
  console.log(`contract balance:    ${formatEther(await provider.getBalance(contractAddress))} ETH`);

  const ok = result.success && swept > 0n;
  console.log(`\n${ok ? 'MODE B VERIFIED ONCHAIN' : 'FAILED'}`);
  process.exit(ok ? 0 : 1);
}

function req(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
