import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbi, parseEventLogs, recoverTypedDataAddress } from 'viem';
import { McpClient } from '../../../../agent/keeperhub/mcp-client';
import { LEGACY_KEEPER_ADDRESS, legacyKeeperAbi } from '@/lib/contract';
import { sepolia } from '@/lib/sepolia';
import { executeSignedEvacuation, type EvacuationDependencies } from '@/lib/evacuation-route';
import { parseHeartbeatRequest, type HeartbeatRequest } from '@/lib/heartbeat-route';
import { submitSignedWorkflowWebhook, waitForKeeperHubSettlement } from '@/lib/keeperhub-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const WORKFLOW_ID = process.env.KEEPERHUB_PANIC_WORKFLOW_ID ?? 'pm22qhfnox30w0mnngw01';
const EVENT_ABI = parseAbi(['event EvacuationTriggered(address indexed executedBy, uint64 timestamp)']);

export async function POST(request: NextRequest) {
  try {
    const payload = parseHeartbeatRequest(await request.json());
    const evidence = await executeSignedEvacuation(payload, createDependencies(payload));
    return NextResponse.json(evidence);
  } catch (error) {
    return NextResponse.json({ stage: 'failed', error: message(error) }, { status: 422 });
  }
}

function createDependencies(request: HeartbeatRequest): EvacuationDependencies {
  const rpcUrl = requiredEnv('SEPOLIA_RPC_URL');
  const keeperHubKey = requiredEnv('KEEPERHUB_API_KEY');
  const webhookKey = process.env.KEEPERHUB_WEBHOOK_API_KEY ?? keeperHubKey;
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const mcp = new McpClient({ url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp', apiKey: keeperHubKey });
  return {
    nowSeconds: () => Math.floor(Date.now() / 1_000),
    readRecoveryState: async () => {
      const [vault, evacuated] = await Promise.all([
        client.readContract({ address: LEGACY_KEEPER_ADDRESS, abi: legacyKeeperAbi, functionName: 'vault' }),
        client.readContract({ address: LEGACY_KEEPER_ADDRESS, abi: legacyKeeperAbi, functionName: 'evacuationExecuted' }),
      ]);
      return { recoveryKey: vault[1], registered: vault[2], evacuated };
    },
    recoverSigner: async () => recoverEvacuationSigner(request),
    submitToKeeperHub: async (payload) => submitSignedWorkflowWebhook(WORKFLOW_ID, webhookKey, payload),
    awaitSettlement: async (id) => { await mcp.connect(); return waitForKeeperHubSettlement(mcp, id); },
    verifyOnchain: async (txHash) => {
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 60_000 });
      const logs = parseEventLogs({ abi: EVENT_ABI, logs: receipt.logs, eventName: 'EvacuationTriggered' });
      const evacuated = await client.readContract({ address: LEGACY_KEEPER_ADDRESS, abi: legacyKeeperAbi, functionName: 'evacuationExecuted' });
      return { receiptStatus: receipt.status, event: logs.length ? 'EvacuationTriggered' : undefined, evacuated };
    },
  };
}

function recoverEvacuationSigner(request: HeartbeatRequest) {
  return recoverTypedDataAddress({
    domain: { name: 'LegacyKeeper', version: '1', chainId: sepolia.id, verifyingContract: LEGACY_KEEPER_ADDRESS },
    types: { Evacuate: [{ name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Evacuate',
    message: { nonce: BigInt(request.nonce), deadline: BigInt(request.deadline) },
    signature: request.signature as `0x${string}`,
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured on the server`);
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Evacuation failed';
}
