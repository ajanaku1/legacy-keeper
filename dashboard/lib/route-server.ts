import { createPublicClient, http, zeroAddress, type Address } from 'viem';
import { loadProjectServerEnvironment } from './server-environment';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import {
  LEGACY_KEEPER_FACTORY_ADDRESS,
  LEGACY_KEEPER_FACTORY_ADDRESSES,
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

export function createSepoliaLogsClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(requiredLogsRpcUrl(), {
      batch: { batchSize: 50 },
    }),
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
      'NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS is not configured.',
    );
  }
  return LEGACY_KEEPER_FACTORY_ADDRESS;
}

export function requiredFactories(): readonly Address[] {
  if (LEGACY_KEEPER_FACTORY_ADDRESSES.length === 0) requiredFactory();
  return LEGACY_KEEPER_FACTORY_ADDRESSES;
}

export function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

export function readRegisteredPlan(
  client: RoutePublicClient,
  factory: Address,
  owner: Address,
) {
  return client.readContract({
    address: factory,
    abi: legacyKeeperFactoryAbi,
    functionName: 'planOf',
    args: [owner],
  });
}

export async function readRegisteredPlanAcrossFactories(
  client: RoutePublicClient,
  factories: readonly Address[],
  owner: Address,
): Promise<Address> {
  const plans = await Promise.all(
    factories.map((factory) => readRegisteredPlan(client, factory, owner)),
  );
  return plans.find((plan) => plan !== zeroAddress) ?? zeroAddress;
}

export function readPlanOwner(client: RoutePublicClient, plan: Address) {
  return client.readContract({
    address: plan,
    abi: legacyKeeperAbi,
    functionName: 'owner',
  });
}

function requiredRpcUrl(): string {
  return requiredEnv(
    'SEPOLIA_RPC_URL',
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  );
}

function requiredLogsRpcUrl(): string {
  return requiredEnv('SEPOLIA_LOGS_RPC_URL', requiredRpcUrl());
}
