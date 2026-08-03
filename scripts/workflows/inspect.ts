/** Read-only KeeperHub workflow and capability inventory. */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider } from "ethers";
import { McpClient } from "../../agent/keeperhub/mcp-client";
import { redactKeeperHubOutput } from "./inspection-utils";

interface ManifestEntry {
  key: string;
  name: string;
  workflowId: string;
  triggers: string[];
}

interface Manifest {
  contract: string;
  workflows: ManifestEntry[];
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    readFileSync("workflows/manifest.json", "utf8"),
  ) as Manifest;
  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
    apiKey: required("KEEPERHUB_API_KEY"),
  });

  const server = await mcp.connect();
  const toolDefinitions = await mcp.listToolDefinitions();
  const tools = toolDefinitions.map((tool) => tool.name);
  console.log(`server: ${server.name} v${server.version}`);
  console.log(`tools (${tools.length}): ${tools.join(", ")}`);
  await printChainState(manifest.contract);

  const requestedTool = argumentValue("--tool");
  if (requestedTool) {
    const definition = toolDefinitions.find(
      (tool) => tool.name === requestedTool,
    );
    if (!definition)
      throw new Error(`KeeperHub tool not found: ${requestedTool}`);
    console.log(`tool definition: ${JSON.stringify(definition, null, 2)}`);
  }

  const executionId = argumentValue("--execution");
  if (executionId) {
    const execution = await mcp.callTool("get_execution", {
      executionId,
      truncateData: 2000,
    });
    console.log(
      `execution ${executionId}: ${redactKeeperHubOutput(execution)}`,
    );
  }

  const pluginType = argumentValue("--plugin");
  if (pluginType) {
    const plugin = await mcp.callTool("get_plugin", { pluginType });
    console.log(`plugin ${pluginType}: ${plugin}`);
  }

  for (const entry of manifest.workflows) {
    const raw = await mcp.callTool("get_workflow", {
      workflowId: entry.workflowId,
    });
    const workflow = parseObject(raw);
    console.log(
      JSON.stringify({
        key: entry.key,
        workflowId: entry.workflowId,
        name: workflow.name ?? entry.name,
        enabled: workflow.enabled ?? null,
        triggers: entry.triggers,
        updatedAt: workflow.updatedAt ?? null,
      }),
    );
  }

  if (tools.includes("list_integrations")) {
    const integrations = await mcp.callTool("list_integrations", {});
    console.log(`integrations: ${integrations}`);
  }

  if (process.argv.includes("--schemas")) {
    const raw = await mcp.callTool("list_action_schemas", {});
    const schemas: unknown = JSON.parse(raw);
    const terms = [
      "notification",
      "telegram",
      "discord",
      "email",
      "sponsor",
      "private",
      "gas",
    ];
    const matches = findSchemaMatches(schemas, terms);
    console.log(`schema matches (${matches.length}):`);
    for (const match of matches.slice(0, 100)) console.log(match);
    console.log("matching schema excerpts:");
    for (const excerpt of findNamedSchemaExcerpts(schemas, terms)) {
      console.log(excerpt);
    }
  }
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("KeeperHub returned a non-object workflow");
  }
  return value as Record<string, unknown>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function printChainState(address: string): Promise<void> {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) return;
  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(
    address,
    [
      "function owner() view returns (address)",
      "function inheritanceExecuted() view returns (bool)",
      "function evacuationExecuted() view returns (bool)",
      "function getLivenessStatus() view returns (uint64,uint64,bool,bool)",
    ],
    provider,
  );
  const [owner, inherited, evacuated, liveness] = await Promise.all([
    contract.owner(),
    contract.inheritanceExecuted(),
    contract.evacuationExecuted(),
    contract.getLivenessStatus(),
  ]);
  console.log(
    `chain: ${JSON.stringify({
      contract: address,
      owner,
      inheritanceExecuted: inherited,
      evacuationExecuted: evacuated,
      lastHeartbeat: String(liveness[0]),
      timeSinceHeartbeat: String(liveness[1]),
      active: liveness[2],
      expired: liveness[3],
    })}`,
  );
}

function argumentValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function findSchemaMatches(value: unknown, terms: string[]): string[] {
  const matches = new Set<string>();
  visit(value, terms, matches);
  return [...matches].sort();
}

function visit(value: unknown, terms: string[], matches: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, terms, matches);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const object = value as Record<string, unknown>;
  const text = JSON.stringify(object).toLowerCase();
  if (terms.some((term) => text.includes(term))) {
    const action = object.actionType ?? object.type ?? object.name ?? object.id;
    if (typeof action === "string") matches.add(action);
  }
  for (const child of Object.values(object)) visit(child, terms, matches);
}

function findNamedSchemaExcerpts(value: unknown, terms: string[]): string[] {
  const excerpts = new Set<string>();
  collectNamedSchemas(value, terms, excerpts);
  return [...excerpts].sort();
}

function collectNamedSchemas(
  value: unknown,
  terms: string[],
  excerpts: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedSchemas(item, terms, excerpts);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const object = value as Record<string, unknown>;
  const labels = [
    object.actionType,
    object.type,
    object.name,
    object.id,
  ].filter((label): label is string => typeof label === "string");
  if (
    labels.some((label) =>
      terms.some((term) => label.toLowerCase().includes(term)),
    )
  ) {
    excerpts.add(JSON.stringify(object).slice(0, 3000));
  }
  for (const child of Object.values(object)) {
    collectNamedSchemas(child, terms, excerpts);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
