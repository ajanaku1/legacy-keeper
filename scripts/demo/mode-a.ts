/**
 * Mode A end to end, including the C3 reliability evidence.
 *
 * A scheduled keeper does not know the exact second a grace period expires —
 * it wakes on a cron, checks, and fires. Firing marginally early is the most
 * realistic failure this system has: the call reverts with "LK: not yet due",
 * and the keeper has to recover on its own rather than give up on an estate.
 *
 * This script deliberately starts before the deadline so the first attempts
 * revert and a later one lands. Every attempt shares one execution key, so
 * the ledger shows the whole story — which is predicate C3.
 *
 *   LEGACY_KEEPER_ADDRESS=0x... npx tsx scripts/demo/mode-a.ts
 */

import 'dotenv/config';
import { JsonRpcProvider, Contract, Wallet, formatEther } from 'ethers';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import { KeeperHubExecutor } from '../../agent/executor/keeperhub';
import { AuditLedger } from '../../agent/audit/ledger';

const CHAIN_ID = 11155111;

const ABI = [
  'function getTimeoutStatus() view returns (bool,bool)',
  'function inheritanceExecuted() view returns (bool)',
  'function getBeneficiaries() view returns (tuple(address wallet, uint16 shareBps)[])',
  'function heartbeat() external',
];

async function main() {
  const contractAddress = req('LEGACY_KEEPER_ADDRESS');
  const provider = new JsonRpcProvider(req('SEPOLIA_RPC_URL'));
  const keeper = new Contract(contractAddress, ABI, provider);

  const beneficiaries = await keeper.getBeneficiaries();
  const startBalances = new Map<string, bigint>();
  for (const b of beneficiaries) {
    startBalances.set(b.wallet, await provider.getBalance(b.wallet));
  }

  // Deploy + config takes minutes on a public testnet, which would burn the
  // whole demo window before the keeper even starts. A final check-in resets
  // the clock so the countdown begins here — which is also the honest story:
  // the owner proves liveness, then goes silent.
  if (process.argv.includes('--reset-clock')) {
    const owner = new Wallet(req('DEPLOYER_PRIVATE_KEY'), provider);
    const tx = await (keeper.connect(owner) as any).heartbeat();
    await tx.wait();
    console.log(`owner checked in — clock reset (${tx.hash})\n`);
  }

  const pot = await provider.getBalance(contractAddress);
  const [, graceElapsed] = await keeper.getTimeoutStatus();

  console.log(`contract:  ${contractAddress}`);
  console.log(`pot:       ${formatEther(pot)} ETH`);
  console.log(`due now:   ${graceElapsed}`);
  for (const b of beneficiaries) {
    console.log(`  ${b.wallet}  ${Number(b.shareBps) / 100}%`);
  }

  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: req('KEEPERHUB_API_KEY'),
  });
  const ledger = new AuditLedger();
  const executor = new KeeperHubExecutor(mcp, ledger, CHAIN_ID, contractAddress);

  const server = await mcp.connect();
  console.log(`\nconnected: ${server.name} v${server.version}`);
  console.log('── keeper firing (early on purpose; will retry through the revert) ──\n');

  const result = await executor.executeInheritance(
    { type: 'scheduled', source: 'cron', detail: 'liveness timeout reached' },
    {
      maxAttempts: Number(process.env.DEMO_MAX_ATTEMPTS ?? 4),
      retryBaseDelayMs: Number(process.env.DEMO_RETRY_MS ?? 45_000),
    }
  );

  console.log(`\n  success:  ${result.success}`);
  console.log(`  attempts: ${result.attempts}`);
  if (result.txHash) {
    console.log(`  tx:       https://sepolia.etherscan.io/tx/${result.txHash}`);
    console.log(`  gasUsed:  ${result.gasUsed ?? 'n/a'}`);
  }

  // ── Verify against the chain, not the reported status.
  console.log('\n── onchain verification ──');
  console.log(`  inheritanceExecuted: ${await keeper.inheritanceExecuted()}`);
  console.log(`  contract balance:    ${formatEther(await provider.getBalance(contractAddress))} ETH`);

  let allExact = true;
  for (const b of beneficiaries) {
    const delta =
      (await provider.getBalance(b.wallet)) - (startBalances.get(b.wallet) ?? 0n);
    const expected = (pot * BigInt(b.shareBps)) / 10000n;
    const exact = delta === expected;
    allExact &&= exact;
    console.log(
      `  ${b.wallet}  ${formatEther(delta)} ETH  expected ${formatEther(expected)}  ${exact ? 'exact' : 'MISMATCH'}`
    );
  }

  // ── C3 evidence
  const summary = ledger.summary();
  const recovered = ledger.recoveredAfterFailure();
  console.log('\n── audit ledger ──');
  console.log(`  entries: ${summary.total}  ok: ${summary.success}  failed: ${summary.failed}`);
  console.log(`  recovered-after-failure: ${summary.recovered}`);

  for (const key of recovered) {
    console.log(`\n  C3 evidence — ${key}`);
    for (const e of ledger.byKey(key)) {
      console.log(
        `    attempt ${e.attempt}  ${e.outcome.padEnd(8)}  gas ${e.gasUsed ?? '—'}  ${e.error ?? ''}`
      );
    }
  }

  const ok = result.success && allExact && recovered.length > 0;
  console.log(`\n${ok ? 'MODE A + C3 VERIFIED' : result.success ? 'executed, but no failure/recovery pair recorded' : 'FAILED'}`);
  process.exit(result.success ? 0 : 1);
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
