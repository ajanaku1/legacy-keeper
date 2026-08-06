/**
 * Create or update the LegacyKeeper workflow set on KeeperHub, then export
 * what the platform actually stored back to workflows/exported/.
 *
 * The export is a round-trip, not a copy of what we sent: it is the only way
 * to know the definition survived intact, and it is what the starter kit
 * reproduces.
 *
 * Workflows remain disabled unless --enable is explicit. Enabling starts
 * schedule, event, block, and webhook trigger processing immediately.
 *
 *   npx tsx scripts/workflows/deploy.ts [--validate-only] [--enable]
 *   npx tsx scripts/workflows/deploy.ts --wallet-scoped [--enable]
 */

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { McpClient } from "../../agent/keeperhub/mcp-client";
import { buildWorkflows, WorkflowDef } from "../../workflows/definitions";
import { buildWalletScopedWorkflows } from "../../workflows/wallet-scoped-definitions";

const OUT_DIR = "workflows/exported";
type JsonObject = Record<string, unknown>;

interface StoredManifest {
  contract?: string;
  workflows?: Array<{ key: string; workflowId: string }>;
}

interface ExistingWorkflow {
  id: string;
  name: string;
  enabled: boolean;
}

interface DeployedWorkflow {
  definition: WorkflowDef;
  id: string;
  wasEnabled: boolean;
}

async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const enable = process.argv.includes("--enable");
  const walletScoped = process.argv.includes("--wallet-scoped");
  const storedManifest = readStoredManifest();
  const contract = walletScoped
    ? req("NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS")
    : process.env.LEGACY_KEEPER_ADDRESS || storedManifest.contract;
  if (!contract) throw new Error("LEGACY_KEEPER_ADDRESS is required");
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (enable && !walletScoped && !chatId) {
    throw new Error(
      "TELEGRAM_CHAT_ID is required before enabling notifications",
    );
  }
  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
    apiKey: req("KEEPERHUB_API_KEY"),
  });
  const server = await mcp.connect();
  console.log(`connected: ${server.name} v${server.version}`);
  console.log(`contract:  ${contract}\n`);

  const telegramIntegrationId = walletScoped
    ? undefined
    : await resolveTelegramIntegration(mcp);
  if (enable && !walletScoped && !telegramIntegrationId) {
    throw new Error(
      "A KeeperHub Telegram integration is required before enabling",
    );
  }
  const defs = walletScoped
    ? buildWalletScopedWorkflows(contract)
    : buildWorkflows(contract, chatId || "000000000", telegramIntegrationId);
  const existing = await listExisting(mcp);
  if (validateOnly) {
    await validateExisting(defs, existing, storedManifest, mcp);
    return;
  }

  const deployed = await deployDefinitions(
    defs,
    existing,
    storedManifest,
    mcp,
    walletScoped,
  );
  if (enable) await enableWithRollback(deployed, mcp);
  await exportDefinitions(contract, deployed, mcp);
}

async function deployDefinitions(
  definitions: WorkflowDef[],
  existing: ExistingWorkflow[],
  manifest: StoredManifest,
  mcp: McpClient,
  walletScoped: boolean,
): Promise<DeployedWorkflow[]> {
  const deployed: DeployedWorkflow[] = [];
  for (const definition of definitions) {
    console.log(definition.name);
    const prior = findPrior(definition, existing, manifest);
    const id = await upsertDefinition(definition, prior, mcp);
    if (walletScoped) {
      await mcp.callTool("update_workflow_listing", {
        workflowId: id,
        workflowType: "write",
      });
    }
    await assertValid(id, mcp);
    deployed.push({ definition, id, wasEnabled: prior?.enabled === true });
  }
  return deployed;
}

async function upsertDefinition(
  definition: WorkflowDef,
  prior: ExistingWorkflow | undefined,
  mcp: McpClient,
): Promise<string> {
  if (prior) {
    await mcp.callTool("update_workflow", {
      workflowId: prior.id,
      name: definition.name,
      description: definition.description,
      nodes: definition.nodes,
      edges: definition.edges,
    });
    console.log(`  updated: ${prior.id}`);
    return prior.id;
  }
  const created = await mcp.callTool("create_workflow", {
    name: definition.name,
    description: definition.description,
    nodes: definition.nodes,
    edges: definition.edges,
    enabled: false,
    idempotency_key: `lk-${definition.key}-v1`,
  });
  const id = extractId(created);
  if (!id)
    throw new Error(`create_workflow returned no id: ${created.slice(0, 160)}`);
  console.log(`  created: ${id}`);
  return id;
}

async function enableWithRollback(
  deployed: DeployedWorkflow[],
  mcp: McpClient,
): Promise<void> {
  const enabled: string[] = [];
  try {
    for (const workflow of deployed) {
      if (workflow.wasEnabled) continue;
      await mcp.callTool("update_workflow", {
        workflowId: workflow.id,
        enabled: true,
      });
      enabled.push(workflow.id);
      console.log(`  enabled: ${workflow.id}`);
    }
  } catch (error) {
    const rollback = await Promise.allSettled(
      enabled.map((workflowId) =>
        mcp.callTool("update_workflow", { workflowId, enabled: false }),
      ),
    );
    const rollbackFailures = rollback.filter(
      (result) => result.status === "rejected",
    ).length;
    if (rollbackFailures) {
      throw new Error(
        `${errorMessage(error)}; ${rollbackFailures} enable rollback(s) failed`,
      );
    }
    throw error;
  }
}

async function exportDefinitions(
  contract: string,
  deployed: DeployedWorkflow[],
  mcp: McpClient,
): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const workflows: Record<string, unknown>[] = [];
  for (const { definition, id } of deployed) {
    const stored = await mcp.callTool("get_workflow", { workflowId: id });
    writeFileSync(
      `${OUT_DIR}/${definition.key}.json`,
      `${prettify(stored)}\n`,
      "utf8",
    );
    workflows.push({
      key: definition.key,
      name: definition.name,
      workflowId: id,
      triggers: triggerTypes(definition),
    });
  }
  writeFileSync(
    "workflows/manifest.json",
    `${JSON.stringify({ contract, generatedAt: new Date().toISOString(), workflows }, null, 2)}\n`,
    "utf8",
  );
}

async function validateExisting(
  definitions: WorkflowDef[],
  existing: ExistingWorkflow[],
  manifest: StoredManifest,
  mcp: McpClient,
): Promise<void> {
  for (const definition of definitions) {
    console.log(definition.name);
    const prior = findPrior(definition, existing, manifest);
    if (!prior) {
      console.log("  no stored workflow to validate");
      continue;
    }
    await assertValid(prior.id, mcp, true);
  }
}

function findPrior(
  definition: WorkflowDef,
  existing: ExistingWorkflow[],
  manifest: StoredManifest,
): ExistingWorkflow | undefined {
  const storedId = manifest.workflows?.find(
    (workflow) => workflow.key === definition.key,
  )?.workflowId;
  return existing.find(
    (workflow) => workflow.id === storedId || workflow.name === definition.name,
  );
}

async function assertValid(
  workflowId: string,
  mcp: McpClient,
  deepCheck = false,
): Promise<void> {
  const raw = await mcp.callTool("validate_workflow", {
    workflowId,
    deepCheck,
  });
  const envelope = asObject(JSON.parse(raw));
  const result = asObject(envelope.result);
  if (result.valid !== true) {
    throw new Error(
      `workflow ${workflowId} failed validation: ${raw.slice(0, 600)}`,
    );
  }
  console.log(`  valid${deepCheck ? " (deep)" : ""}: ${raw.slice(0, 600)}`);
}

function readStoredManifest(): StoredManifest {
  try {
    return JSON.parse(
      readFileSync("workflows/manifest.json", "utf8"),
    ) as StoredManifest;
  } catch {
    return {};
  }
}

async function listExisting(mcp: McpClient): Promise<ExistingWorkflow[]> {
  const text = await mcp.callTool("list_workflows", {});
  const parsed: unknown = JSON.parse(text);
  const object = asObject(parsed);
  let items: unknown[] = [];
  if (Array.isArray(parsed)) items = parsed;
  else if (Array.isArray(object.items)) items = object.items;

  return items.flatMap((item) => {
    const workflow = asObject(item);
    const id = stringField(workflow, "id");
    const name = stringField(workflow, "name");
    return id && name ? [{ id, name, enabled: workflow.enabled === true }] : [];
  });
}

async function resolveTelegramIntegration(
  mcp: McpClient,
): Promise<string | undefined> {
  const text = await mcp.callTool("list_integrations", {});
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return undefined;
  for (const item of parsed) {
    const integration = asObject(item);
    if (stringField(integration, "type") === "telegram") {
      return stringField(integration, "id");
    }
  }
  return undefined;
}

function extractId(text: string): string | undefined {
  try {
    const parsed = asObject(JSON.parse(text));
    const workflow = asObject(parsed.workflow);
    return (
      stringField(parsed, "id") ??
      stringField(parsed, "workflowId") ??
      stringField(workflow, "id")
    );
  } catch {
    return text.match(/"(?:id|workflowId)"\s*:\s*"([^"]+)"/)?.[1];
  }
}

function prettify(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function triggerTypes(def: { nodes: unknown[] }): string[] {
  return def.nodes
    .map(asObject)
    .filter((node) => node.type === "trigger")
    .map((node) => {
      const data = asObject(node.data);
      const config = asObject(data.config);
      return stringField(config, "triggerType") ?? "unknown";
    });
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringField(object: JsonObject, key: string): string | undefined {
  return typeof object[key] === "string" ? object[key] : undefined;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
