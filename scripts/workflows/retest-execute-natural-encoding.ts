import 'dotenv/config';
import {writeFileSync} from 'node:fs';
import {McpClient, McpError} from '../../agent/keeperhub/mcp-client';
import {
  buildNaturalEncodingEvidence,
  naturalEncodingProbeArguments,
  selectEncodingSchemaProperties,
} from '../../agent/keeperhub/natural-encoding-probe';

const endpoint = process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp';

async function observeProbeFailure(client: McpClient): Promise<string> {
  try {
    await client.callTool('execute_contract_call', naturalEncodingProbeArguments());
    throw new Error('safety invariant failed: invalid contract address was accepted');
  } catch (error) {
    if (!(error instanceof McpError)) throw error;
    return error.message;
  }
}

async function main(): Promise<void> {
  const client = new McpClient({
    url: endpoint,
    apiKey: requireApiKey(),
    maxAttempts: 1,
  });
  const server = await client.connect();
  const tool = (await client.listToolDefinitions()).find(
    (definition) => definition.name === 'execute_contract_call',
  );
  if (!tool) throw new Error('execute_contract_call is missing from tools/list');

  const evidence = buildNaturalEncodingEvidence({
    checkedAt: new Date().toISOString(),
    endpoint,
    server,
    toolDescription: tool.description ?? '',
    schemaProperties: selectEncodingSchemaProperties(tool.inputSchema?.properties),
    observedError: await observeProbeFailure(client),
  });
  if (!evidence.result.passed) {
    throw new Error(`natural encoding regression: ${JSON.stringify(evidence.result)}`);
  }

  const output = `${JSON.stringify(evidence, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    writeFileSync('reports/keeperhub-natural-encoding-evidence.json', output, 'utf8');
  }
  process.stdout.write(output);
}

function requireApiKey(): string {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) throw new Error('KEEPERHUB_API_KEY is required');
  return apiKey;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
