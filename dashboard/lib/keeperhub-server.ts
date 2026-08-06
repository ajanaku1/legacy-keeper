import type { McpClient } from "../../agent/keeperhub/mcp-client";
import type {
  HeartbeatRequest,
  KeeperHubSettlement,
  KeeperHubSubmission,
} from "./heartbeat-route";

const TERMINAL_STATUSES = new Set([
  "success",
  "completed",
  "failed",
  "reverted",
  "cancelled",
]);

export async function submitHeartbeatWebhook(
  workflowId: string,
  apiKey: string,
  request: HeartbeatRequest,
  idempotencyKey?: string,
): Promise<KeeperHubSubmission> {
  return submitSignedWorkflowWebhook(
    workflowId,
    apiKey,
    request,
    idempotencyKey,
  );
}

export async function submitSignedWorkflowWebhook(
  workflowId: string,
  apiKey: string,
  request: object,
  idempotencyKey?: string,
): Promise<KeeperHubSubmission> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(
    `https://app.keeperhub.com/api/workflows/${workflowId}/webhook`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(`KeeperHub webhook failed: HTTP ${response.status}`);
  return { executionId: parseWebhookExecutionId(body) };
}

export async function waitForKeeperHubSettlement(
  client: McpClient,
  executionId: string,
): Promise<KeeperHubSettlement> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (attempt > 0) await pause(5_000);
    const raw = await client.callTool("get_execution", { executionId });
    const settlement = parseKeeperHubExecution(JSON.parse(raw) as unknown);
    if (!TERMINAL_STATUSES.has(settlement.status)) continue;
    const succeeded =
      settlement.status === "success" || settlement.status === "completed";
    if (!succeeded || settlement.txHash) return settlement;
  }
  throw new Error(`KeeperHub execution ${executionId} timed out`);
}

export function parseWebhookExecutionId(value: unknown): string {
  const executionId = stringValue(asObject(value).executionId);
  if (!executionId)
    throw new Error("KeeperHub webhook returned no execution ID");
  return executionId;
}

export function parseKeeperHubExecution(value: unknown): KeeperHubSettlement {
  const root = asObject(value);
  const logs = asObject(root.logs);
  const execution = asObject(logs.execution);
  const output = asObject(execution.output);
  const stepOutput = successfulTransactionOutput(logs.logs);
  const hashes = Array.isArray(execution.transactionHashes)
    ? execution.transactionHashes
    : [];
  return {
    status: stringValue(execution.status) ?? "unknown",
    txHash:
      transactionHash(hashes[0]) ??
      transactionHash(output.transactionHash) ??
      transactionHash(stepOutput.transactionHash),
    sponsored:
      execution.sponsored === true ||
      output.sponsored === true ||
      stepOutput.sponsored === true,
  };
}

function successfulTransactionOutput(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  const log = value.find((entry) => {
    const candidate = asObject(entry);
    const output = asObject(candidate.output);
    return (
      candidate.status === "success" && transactionHash(output.transactionHash)
    );
  });
  return asObject(asObject(log).output);
}

function transactionHash(value: unknown): `0x${string}` | undefined {
  const hash = stringValue(value) ?? stringValue(asObject(value).hash);
  return hash?.startsWith("0x") ? (hash as `0x${string}`) : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
