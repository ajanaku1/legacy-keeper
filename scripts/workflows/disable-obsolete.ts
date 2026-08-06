/** Disable only the three user-approved workflows for the retired plan. */

import 'dotenv/config';
import { McpClient } from '../../agent/keeperhub/mcp-client';

const OBSOLETE = [
  ['n6h03seyd2178mvj0p9nm', 'LegacyKeeper — Liveness Monitor'],
  ['sux1hhjj0u6an7p6vddp2', 'LegacyKeeper — Heartbeat Event Watch'],
  ['5w133r3gajq3haixv1nhl', 'LegacyKeeper — Block Health Check'],
] as const;

async function main(): Promise<void> {
  const client = keeperHubClient();
  await client.connect();
  const changed: string[] = [];
  try {
    for (const [workflowId, name] of OBSOLETE) {
      await client.callTool('update_workflow', { workflowId, enabled: false });
      changed.push(workflowId);
      await assertDisabled(client, workflowId, name);
      console.log(`disabled: ${name}`);
    }
  } catch (error) {
    await rollback(client, changed);
    throw error;
  }
}

async function assertDisabled(
  client: McpClient,
  workflowId: string,
  name: string
): Promise<void> {
  const raw = await client.callTool('get_workflow', { workflowId });
  const workflow = asObject(JSON.parse(raw) as unknown);
  if (workflow.enabled !== false) throw new Error(`${name} did not disable`);
}

async function rollback(client: McpClient, workflowIds: string[]): Promise<void> {
  const results = await Promise.allSettled(
    workflowIds.map((workflowId) =>
      client.callTool('update_workflow', { workflowId, enabled: true })
    )
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(`${failures.length} obsolete-workflow rollback(s) failed`);
  }
}

function keeperHubClient(): McpClient {
  return new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: required('KEEPERHUB_API_KEY'),
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
