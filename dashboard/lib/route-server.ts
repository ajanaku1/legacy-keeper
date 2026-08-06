import { createPublicClient, http, type Address } from 'viem';
import { loadProjectServerEnvironment } from './server-environment';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import {
  LEGACY_KEEPER_FACTORY_ADDRESS,
  legacyKeeperAbi,
  legacyKeeperFactoryAbi,
} from './contract';
import { sepolia } from './sepolia';

loadProjectServerEnvironment();

export type RoutePublicClient = ReturnType<typeof createSepoliaClient>;

export function createSepoliaClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(requiredRpcUrl()),
  });
}

export function createKeeperHubClient(apiKey: string): McpClient {
  return new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey,
  });
}

export function requiredFactory(): Address {
  if (!LEGACY_KEEPER_FACTORY_ADDRESS) {
    throw new Error(
      'NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS is not configured.'
    );
  }
  return LEGACY_KEEPER_FACTORY_ADDRESS;
}

export function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

export function readRegisteredPlan(
  client: RoutePublicClient,
  factory: Address,
  owner: Address
) {
  return client.readContract({
    address: factory,
    abi: legacyKeeperFactoryAbi,
    functionName: 'planOf',
    args: [owner],
  });
}

export function readPlanOwner(client: RoutePublicClient, plan: Address) {
  return client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'owner',
  });
}

function requiredRpcUrl(): string {
  return requiredEnv('SEPOLIA_RPC_URL', process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL);
}
