/**
 * Discover automatic KeeperHub runs and write phase-2 evidence only when all
 * required trigger types have a successful, non-manual execution.
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { McpClient } from "../../agent/keeperhub/mcp-client";
import { keeperHubRunId } from "./evidence-utils";

type JsonObject = Record<string, unknown>;

interface ManifestEntry {
  key: string;
  workflowId: string;
  triggers: string[];
}

interface Manifest {
  contract: string;
  workflows: ManifestEntry[];
}

interface RunEvidence {
  key: string;
  workflowId: string;
  trigger: string;
  enabled: boolean;
  executionId: string;
  runId: string;
  triggerSource: string;
  status: string;
  txHash?: string;
  startedAt?: string;
}

const REQUIRED_TRIGGERS = ["Schedule", "Webhook", "Event", "Block"];

async function main(): Promise<void> {
  const manifest = JSON.parse(
    readFileSync("workflows/manifest.json", "utf8"),
  ) as Manifest;
  const mcp = new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
    apiKey: required("KEEPERHUB_API_KEY"),
  });
  await mcp.connect();

  const evidence = await collectEvidence(manifest, mcp);
  const observed = new Set(evidence.map((run) => run.trigger));
  const missing = REQUIRED_TRIGGERS.filter((trigger) => !observed.has(trigger));
  console.log(JSON.stringify({ workflows: evidence, missing }, null, 2));
  if (missing.length)
    throw new Error(`missing automatic runs: ${missing.join(", ")}`);
  if (!process.argv.includes("--write")) return;

  writeFileSync(
    "reports/live-workflow-evidence.json",
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        contract: manifest.contract,
        workflows: evidence,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function collectEvidence(
  manifest: Manifest,
  mcp: McpClient,
): Promise<RunEvidence[]> {
  const results: RunEvidence[] = [];
  for (const entry of manifest.workflows) {
    const workflow = parseObject(
      await mcp.callTool("get_workflow", { workflowId: entry.workflowId }),
    );
    if (workflow.enabled !== true) continue;
    const runs = await listRuns(entry.workflowId);
    const evidence = await latestAutomaticRun(entry, runs, mcp);
    if (evidence) results.push(evidence);
  }
  return results;
}

async function listRuns(workflowId: string): Promise<JsonObject[]> {
  const response = await fetch(
    `https://app.keeperhub.com/api/workflows/${workflowId}/executions`,
    {
      headers: { Authorization: `Bearer ${required("KEEPERHUB_API_KEY")}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(`execution list failed: HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (Array.isArray(body)) return body.map(parseValueObject);
  const data = parseValueObject(body).data;
  return Array.isArray(data) ? data.map(parseValueObject) : [];
}

async function latestAutomaticRun(
  entry: ManifestEntry,
  runs: JsonObject[],
  mcp: McpClient,
): Promise<RunEvidence | undefined> {
  for (const run of runs) {
    const executionId = stringField(run, "id");
    if (!executionId || stringField(run, "status") !== "success") continue;
    const detail = parseObject(
      await mcp.callTool("get_execution", { executionId, truncateData: 1000 }),
    );
    const execution = nestedObject(detail, ["logs", "execution"]);
    const source = stringField(execution, "triggerSource") ?? "";
    const trigger = entry.triggers.find((candidate) =>
      source.toLowerCase().includes(candidate.toLowerCase()),
    );
    const runId = keeperHubRunId(execution);
    if (!trigger || !runId || source === "manual") continue;
    return runEvidence(entry, execution, executionId, trigger, source, runId);
  }
  return undefined;
}

function runEvidence(
  entry: ManifestEntry,
  execution: JsonObject,
  executionId: string,
  trigger: string,
  triggerSource: string,
  runId: string,
): RunEvidence {
  return {
    key: entry.key,
    workflowId: entry.workflowId,
    trigger,
    enabled: true,
    executionId,
    runId,
    triggerSource,
    status: stringField(execution, "status") ?? "unknown",
    txHash: firstTransactionHash(execution),
    startedAt: stringField(execution, "startedAt"),
  };
}

function firstTransactionHash(execution: JsonObject): string | undefined {
  const hashes = execution.transactionHashes;
  if (!Array.isArray(hashes)) return undefined;
  return stringField(parseValueObject(hashes[0]), "hash");
}

function nestedObject(object: JsonObject, path: string[]): JsonObject {
  return path.reduce((current, key) => parseValueObject(current[key]), object);
}

function parseObject(text: string): JsonObject {
  return parseValueObject(JSON.parse(text));
}

function parseValueObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringField(object: JsonObject, key: string): string | undefined {
  return typeof object[key] === "string" ? object[key] : undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
