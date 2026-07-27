/**
 * Prove the workflow spine drives the contract.
 *
 * Signs an EIP-712 heartbeat with the owner key, then hands it to the
 * KeeperHub *workflow* — not a direct execute_contract_call. The workflow's
 * webhook trigger feeds the signature into a web3/write-contract node.
 *
 *   npx tsx scripts/workflows/run-heartbeat.ts
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { McpClient } from '../../agent/keeperhub/mcp-client';

const CHAIN_ID = 11155111;

async function main() {
  const contract = req('LEGACY_KEEPER_ADDRESS');
  const manifest = JSON.parse(readFileSync('workflows/manifest.json', 'utf8'));
  const wf = manifest.workflows.find((w: any) => w.key === 'heartbeat-relay');
  if (!wf) throw new Error('heartbeat-relay not in manifest — run deploy.ts first');

  const provider = new JsonRpcProvider(req('SEPOLIA_RPC_URL'));
  const owner = new Wallet(req('DEPLOYER_PRIVATE_KEY'), provider);

  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await owner.signTypedData(
    { name: 'LegacyKeeper', version: '1', chainId: CHAIN_ID, verifyingContract: contract },
    { Heartbeat: [{ name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    { nonce, deadline }
  );

  const before = await readHeartbeat(provider, contract);
  console.log(`workflow: ${wf.workflowId} (${wf.name})`);
  console.log(`owner:    ${owner.address}`);
  console.log(`nonce:    ${nonce}`);
  console.log(`last heartbeat before: ${before}\n`);

  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: req('KEEPERHUB_API_KEY'),
  });
  await mcp.connect();

  console.log('── executing workflow ──');
  const result = await mcp.callTool('execute_workflow', {
    workflowId: wf.workflowId,
    input: { nonce: String(nonce), deadline: String(deadline), signature },
  });
  console.log(result.slice(0, 400));

  const executionId = result.match(/"executionId"\s*:\s*"([^"]+)"/)?.[1];
  if (executionId) {
    console.log(`\nexecution: ${executionId}`);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const status = await mcp.callTool('get_execution', { executionId });
      const state = status.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
      process.stdout.write(`  ${state ?? '?'}\r`);
      if (state && !['running', 'pending', 'queued'].includes(state)) {
        console.log(`\n${status.slice(0, 900)}`);
        break;
      }
    }
  }

  const after = await readHeartbeat(provider, contract);
  console.log(`\nlast heartbeat after: ${after}`);
  console.log(after > before ? 'WORKFLOW DROVE THE CONTRACT' : 'no change onchain');
  process.exit(after > before ? 0 : 1);
}

async function readHeartbeat(provider: JsonRpcProvider, address: string): Promise<number> {
  const c = new Contract(address, ['function getLivenessStatus() view returns (uint64,uint64,bool,bool)'], provider);
  return Number((await c.getLivenessStatus())[0]);
}

function req(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`${n} is required`);
  return v;
}

main().catch((e) => { console.error(e); process.exit(1); });
