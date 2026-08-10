import type { Address, Hex } from "viem";
import type { McpClient } from "../../agent/keeperhub/mcp-client";
import type { InheritanceSettlement } from "./inheritance-monitor";
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

const DIRECT_INHERITANCE_ABI = JSON.stringify([
  {
    name: "executeInheritance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
]);

export interface KeeperHubToolClient {
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

export async function submitDirectInheritance(
  client: KeeperHubToolClient,
  plan: Address,
  idempotencyKey: string,
): Promise<{ executionId: string }> {
  const raw = await client.callTool("execute_contract_call", {
    contract_address: plan,
    chain_id: "11155111",
    function_name: "executeInheritance",
    function_args: "[]",
    idempotency_key: idempotencyKey,
    abi: DIRECT_INHERITANCE_ABI,
  });
  const response = asObject(parseJson(raw));
  const executionId = firstStringField(response, [
    "execution_id",
    "executionId",
    "id",
  ]);
  if (!executionId)
    throw new Error("KeeperHub returned no direct execution ID");
  return { executionId };
}

export async function waitForDirectKeeperHubSettlement(
  client: KeeperHubToolClient,
  executionId: string,
): Promise<InheritanceSettlement> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (attempt > 0) await pause(5_000);
    const raw = await client.callTool("get_direct_execution_status", {
      execution_id: executionId,
    });
    const settlement = parseDirectKeeperHubExecution(parseJson(raw));
    if (TERMINAL_STATUSES.has(settlement.status)) return settlement;
  }
  throw new Error(`KeeperHub direct execution ${executionId} timed out`);
}

export function parseDirectKeeperHubExecution(
  value: unknown,
): InheritanceSettlement {
  const root = asObject(value);
  const output = asObject(root.result);
  const status = (stringValue(root.status) ?? "unknown").toLowerCase();
  const explicitSuccess =
    status === "success" || (status === "completed" && output.success === true);
  if (status === "completed" && !explicitSuccess) {
    throw new Error(
      "Completed direct execution has no explicit success signal",
    );
  }
  if (!explicitSuccess) return { status };
  const txHash = directTransactionHash(root, output);
  if (!txHash)
    throw new Error("KeeperHub direct execution has no transaction hash");
  return {
    status,
    txHash,
    sponsored: output.sponsored === true || root.sponsored === true,
  };
}

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

function directTransactionHash(
  root: Record<string, unknown>,
  output: Record<string, unknown>,
): Hex | undefined {
  return (
    transactionHash(root.transactionHash) ??
    transactionHash(root.txHash) ??
    transactionHash(output.transactionHash) ??
    transactionHash(output.txHash)
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("KeeperHub returned malformed JSON");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstStringField(
  value: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const item = stringValue(value[field]);
    if (item) return item;
  }
  return undefined;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
