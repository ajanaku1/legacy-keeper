/**
 * Buy an independent check of the assumption our ERC-20 custody rests on.
 *
 * Without a funded wallet this stops at the 402 and prints the terms — which
 * is itself the evidence that the integration is wired correctly. With funds,
 * settle through @keeperhub/wallet or agentcash and pass --pay.
 *
 *   npx tsx scripts/demo/allowance-check.ts          # quote only
 *   npx tsx scripts/demo/allowance-check.ts --pay    # settle (spends USDC)
 */

import 'dotenv/config';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import { PaidWorkflowClient, PaymentRequired, formatAmount } from '../../agent/keeperhub/x402';

const SLUG = 'approval-risk-rescan';

async function main() {
  const pay = process.argv.includes('--pay');

  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: required('KEEPERHUB_API_KEY'),
  });
  const server = await mcp.connect();
  const client = new PaidWorkflowClient(mcp);

  console.log(`connected: ${server.name} v${server.version}`);
  console.log(`listing:   ${SLUG}\n`);
  console.log('Why this call exists:');
  console.log('  ERC-20 inheritance works only while the owner\'s allowance stands.');
  console.log('  Nothing in our own system notices a revoked approval, so we buy an');
  console.log('  independent read of it rather than assume.\n');

  try {
    const result = await client.call(SLUG, {});
    console.log('listing was free — result:');
    console.log(JSON.stringify(result.result, null, 2).slice(0, 600));
    return;
  } catch (error) {
    if (!(error instanceof PaymentRequired)) throw error;

    const req = error.challenge.accepts[0];
    console.log('── 402 Payment Required ──');
    console.log(`  x402 version : ${error.challenge.x402Version}`);
    console.log(`  scheme       : ${req.scheme}`);
    console.log(`  network      : ${req.network}`);
    console.log(`  asset        : ${req.asset}`);
    console.log(`  amount       : ${req.amount} atomic (${formatAmount(req)})`);
    console.log(`  payTo        : ${req.payTo}`);
    console.log(`  timeout      : ${req.maxTimeoutSeconds ?? '—'}s`);

    if (!pay) {
      console.log('\nQuote only — nothing was spent.');
      console.log('Settle with --pay once a wallet holds USDC on that network.');
      return;
    }

    // Deliberately not implemented as an automatic spend. Settlement requires
    // a funded signer, and the choice to move real money belongs to a human,
    // not to a script that happens to be running.
    console.log('\n--pay requested, but no payment signer is configured.');
    console.log('Fund the wallet, then settle with one of:');
    console.log(`  npx -p @keeperhub/wallet keeperhub-wallet add`);
    console.log(`  agentcash: mcp__agentcash__fetch against ${error.challenge.resourceUrl ?? 'the listing URL'}`);
    process.exitCode = 1;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((e) => { console.error(e); process.exit(1); });
