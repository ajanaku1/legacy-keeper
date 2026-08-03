/**
 * Gasless heartbeat relayed through KeeperHub, plus the C3 reliability proof.
 *
 * The owner signs EIP-712 typed data offline and never pays gas; KeeperHub
 * submits. That is the honest version of "gas sponsorship" — the owner proves
 * liveness with a signature, not a funded wallet.
 *
 * With --induce-failure this first submits with a deliberately starved gas
 * limit so the transaction fails on-chain, then retries at normal gas. Both
 * attempts land in the audit ledger under one execution key, which is the
 * evidence for predicate C3. A build that only ever shows the happy path has
 * not demonstrated it understands failure.
 *
 *   npx tsx scripts/demo/relay-heartbeat.ts [--induce-failure]
 */

import 'dotenv/config';
import { Wallet } from 'ethers';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import { KeeperHubExecutor } from '../../agent/executor/keeperhub';
import { AuditLedger } from '../../agent/audit/ledger';
import { OnchainExecutionVerifier } from '../../agent/executor/onchain-verifier';

const CHAIN_ID = 11155111;

async function main() {
  const induceFailure = process.argv.includes('--induce-failure');

  const contractAddress = requireEnv('LEGACY_KEEPER_ADDRESS');
  const apiKey = requireEnv('KEEPERHUB_API_KEY');
  const mcpUrl = process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp';
  const ownerKey = requireEnv('DEPLOYER_PRIVATE_KEY');

  const owner = new Wallet(ownerKey);
  const mcp = new McpClient({ url: mcpUrl, apiKey });
  const ledger = new AuditLedger();
  const executor = new KeeperHubExecutor(
    mcp,
    ledger,
    CHAIN_ID,
    contractAddress,
    new OnchainExecutionVerifier(requireEnv('SEPOLIA_RPC_URL'), contractAddress)
  );

  const server = await mcp.connect();
  console.log(`connected: ${server.name} v${server.version}`);
  console.log(`contract:  ${contractAddress}`);
  console.log(`owner:     ${owner.address}\n`);

  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await owner.signTypedData(
    {
      name: 'LegacyKeeper',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: contractAddress,
    },
    {
      Heartbeat: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    { nonce, deadline }
  );
  console.log(`signed heartbeat  nonce=${nonce}  deadline=${deadline}`);

  // One logical action either way. With --induce-failure the first attempt
  // is starved of gas so it fails on-chain; the executor then retries the
  // same nonce at estimator-sized gas. Both attempts share an execution key,
  // which is what makes the recovery visible in the ledger.
  const gasHint = Number(
    process.argv.find((a) => a.startsWith('--gas='))?.split('=')[1] ?? '0.02'
  );

  console.log(
    induceFailure
      ? `\n── submitting (attempt 1 starved at ${gasHint}x, retries use estimator) ──`
      : '\n── submitting ──'
  );

  const result = await executor.heartbeatBySigWithOptions(
    { nonce, deadline, signature },
    { type: 'manual', source: 'demo', detail: 'relayed heartbeat' },
    induceFailure ? { gasLimitMultiplier: gasHint, maxAttempts: 3 } : {}
  );

  console.log(`  success:  ${result.success}`);
  console.log(`  attempts: ${result.attempts}`);
  if (result.txHash) {
    console.log(`  tx:       https://sepolia.etherscan.io/tx/${result.txHash}`);
    console.log(`  gasUsed:  ${result.gasUsed ?? 'n/a'}`);
  }
  if (result.error) console.log(`  error:    ${result.error}`);

  const summary = ledger.summary();
  console.log(
    `\nledger: ${summary.total} entries, ${summary.success} ok, ` +
      `${summary.failed} failed, ${summary.recovered} recovered-after-failure`
  );
  const recovered = ledger.recoveredAfterFailure();
  if (recovered.length) console.log(`C3 evidence: ${recovered.join(', ')}`);

  process.exit(result.success ? 0 : 1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
