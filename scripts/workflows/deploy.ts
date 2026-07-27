/**
 * Create or update the LegacyKeeper workflow set on KeeperHub, then export
 * what the platform actually stored back to workflows/exported/.
 *
 * The export is a round-trip, not a copy of what we sent: it is the only way
 * to know the definition survived intact, and it is what the starter kit
 * reproduces.
 *
 * Workflows are created DISABLED. Non-manual triggers stay dormant until
 * explicitly enabled, so creating the set fires nothing.
 *
 *   npx tsx scripts/workflows/deploy.ts [--validate-only]
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import { buildWorkflows } from '../../workflows/definitions';

const OUT_DIR = 'workflows/exported';

async function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const contract = req('LEGACY_KEEPER_ADDRESS');
  const chatId = process.env.TELEGRAM_CHAT_ID || '000000000';

  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? 'https://app.keeperhub.com/mcp',
    apiKey: req('KEEPERHUB_API_KEY'),
  });
  const server = await mcp.connect();
  console.log(`connected: ${server.name} v${server.version}`);
  console.log(`contract:  ${contract}\n`);

  const defs = buildWorkflows(contract, chatId);
  const existing = await listExisting(mcp);
  const manifest: Record<string, unknown>[] = [];

  mkdirSync(OUT_DIR, { recursive: true });

  for (const def of defs) {
    process.stdout.write(`${def.name}\n`);

    // validate_workflow takes a workflowId, so there is no dry-run for a
    // candidate definition — validation only happens after the workflow
    // exists. See reports/friction-log.md #08.
    if (validateOnly) {
      console.log('  (no pre-create validation available; skipping)');
      continue;
    }

    const prior = existing.find((w) => w.name === def.name);
    let id: string;

    if (prior) {
      await mcp.callTool('update_workflow', {
        workflowId: prior.id, name: def.name, description: def.description,
        nodes: def.nodes, edges: def.edges,
      });
      id = prior.id;
      console.log(`  updated:  ${id}`);
    } else {
      const created = await mcp.callTool('create_workflow', {
        name: def.name, description: def.description,
        nodes: def.nodes, edges: def.edges,
        enabled: false,
        idempotency_key: `lk-${def.key}-v1`,
      });
      id = extractId(created) ?? '';
      console.log(`  created:  ${id || created.slice(0, 160)}`);
    }
    if (!id) continue;

    const validation = await mcp.callTool('validate_workflow', { workflowId: id })
      .catch((e) => `validation error: ${e.message}`);
    const valid = /"valid"\s*:\s*true/.test(validation) || !/error|invalid/i.test(validation);
    console.log(`  validate: ${valid ? 'ok' : 'ISSUES'} ${valid ? '' : validation.slice(0, 300)}`);

    // Round-trip: export what KeeperHub stored, not what we sent.
    const stored = await mcp.callTool('get_workflow', { workflowId: id });
    writeFileSync(`${OUT_DIR}/${def.key}.json`, prettify(stored) + '\n', 'utf8');
    console.log(`  exported: ${OUT_DIR}/${def.key}.json`);

    manifest.push({ key: def.key, name: def.name, workflowId: id, triggers: triggerTypes(def) });
  }

  if (!validateOnly && manifest.length) {
    writeFileSync(
      'workflows/manifest.json',
      JSON.stringify({ contract, generatedAt: new Date().toISOString(), workflows: manifest }, null, 2) + '\n',
      'utf8'
    );
    console.log(`\nmanifest: workflows/manifest.json (${manifest.length} workflows)`);
  }
}

async function listExisting(mcp: McpClient): Promise<{ id: string; name: string }[]> {
  try {
    const text = await mcp.callTool('list_workflows', {});
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    return items.map((w: any) => ({ id: w.id, name: w.name }));
  } catch {
    return [];
  }
}

function extractId(text: string): string | undefined {
  try {
    const j = JSON.parse(text);
    return j.id ?? j.workflowId ?? j.workflow?.id;
  } catch {
    return text.match(/"(?:id|workflowId)"\s*:\s*"([^"]+)"/)?.[1];
  }
}

function prettify(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function triggerTypes(def: { nodes: any[] }): string[] {
  return def.nodes
    .filter((n) => n.type === 'trigger')
    .map((n) => n.data?.config?.triggerType ?? 'unknown');
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

main().catch((e) => { console.error(e); process.exit(1); });
