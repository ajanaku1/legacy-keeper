import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  http,
  parseAbi,
  parseEventLogs,
  recoverTypedDataAddress,
} from 'viem';
import { McpClient } from '../../../../agent/keeperhub/mcp-client';
import { LEGACY_KEEPER_ADDRESS, legacyKeeperAbi } from '@/lib/contract';
import { sepolia } from '@/lib/sepolia';
import {
  executeSignedHeartbeat,
  parseHeartbeatRequest,
  type HeartbeatDependencies,
  type HeartbeatRequest,
} from '@/lib/heartbeat-route';
import {
  submitHeartbeatWebhook,
  waitForKeeperHubSettlement,
} from '@/lib/keeperhub-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const HEARTBEAT_WORKFLOW_ID =
  process.env.KEEPERHUB_HEARTBEAT_WORKFLOW_ID ?? 'ryd34r3ayrg2u8o29fmrk'; // heartbeat-relay
const HEARTBEAT_EVENT_ABI = parseAbi([
  'event HeartbeatRecorded(address indexed sender, uint64 timestamp)',
]);

export async function POST(request: NextRequest) {
  try {
    const heartbeat = parseHeartbeatRequest(await request.json());
    const evidence = await executeSignedHeartbeat(
      heartbeat,
      createDependencies(heartbeat)
    );
    return NextResponse.json(evidence);
  } catch (error) {
    return NextResponse.json(
      { stage: 'failed', error: errorMessage(error) },
      { status: 422 }
    );
  }
}

function createDependencies(request: HeartbeatRequest): HeartbeatDependencies {
  const rpcUrl = requiredEnv('SEPOLIA_RPC_URL');
  const KEEPERHUB_API_KEY = requiredEnv('KEEPERHUB_API_KEY');
  const webhookApiKey =
    process.env.KEEPERHUB_WEBHOOK_API_KEY ?? KEEPERHUB_API_KEY;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: KEEPERHUB_API_KEY,
  });

  return {
    nowSeconds: () => Math.floor(Date.now() / 1_000),
    readOwner: async () =>
      publicClient.readContract({
        address: LEGACY_KEEPER_ADDRESS,
        abi: legacyKeeperAbi,
        functionName: 'owner',
      }),
    readLastHeartbeat: async () => {
      const status = await readLiveness(publicClient);
      return status[0];
    },
    recoverSigner: async () => recoverHeartbeatSigner(request),
    submitToKeeperHub: async (payload) =>
      submitHeartbeatWebhook(HEARTBEAT_WORKFLOW_ID, webhookApiKey, payload),
    awaitSettlement: async (executionId) => {
      await mcp.connect();
      return waitForKeeperHubSettlement(mcp, executionId);
    },
    verifyOnchain: async (txHash) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 60_000,
      });
      const events = parseEventLogs({
        abi: HEARTBEAT_EVENT_ABI,
        logs: receipt.logs,
        eventName: 'HeartbeatRecorded',
      });
      const status = await readLiveness(publicClient);
      return {
        receiptStatus: receipt.status,
        event: events.length > 0 ? 'HeartbeatRecorded' : undefined,
        lastHeartbeat: status[0],
      };
    },
  };
}

async function recoverHeartbeatSigner(
  request: HeartbeatRequest
): Promise<string> {
  return recoverTypedDataAddress({
    domain: {
      name: 'LegacyKeeper',
      version: '1',
      chainId: sepolia.id,
      verifyingContract: LEGACY_KEEPER_ADDRESS,
    },
    types: {
      Heartbeat: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Heartbeat',
    message: {
      nonce: BigInt(request.nonce),
      deadline: BigInt(request.deadline),
    },
    signature: request.signature as `0x${string}`,
  });
}

async function readLiveness(
  client: ReturnType<typeof createPublicClient>
): Promise<readonly [bigint, bigint, boolean, boolean]> {
  return client.readContract({
    address: LEGACY_KEEPER_ADDRESS,
    abi: legacyKeeperAbi,
    functionName: 'getLivenessStatus',
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured on the server`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Heartbeat failed';
}
