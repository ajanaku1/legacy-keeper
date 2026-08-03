/**
 * Prove the workflow spine drives the contract.
 *
 * Signs an EIP-712 heartbeat with the owner key, then submits it to the
 * KeeperHub workflow's real webhook endpoint. The workflow relays the signed
 * call through its sponsored web3/write-contract node.
 *
 *   npx tsx scripts/workflows/run-heartbeat.ts
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { McpClient } from "../../agent/keeperhub/mcp-client";
import { resolveHeartbeatContract, webhookUrl } from "./heartbeat-runner-utils";

const CHAIN_ID = 11155111;

interface WorkflowManifestEntry {
  key: string;
  workflowId: string;
  name: string;
}

interface WorkflowManifest {
  contract?: string;
  workflows: WorkflowManifestEntry[];
}

interface HeartbeatRequest {
  nonce: string;
  deadline: string;
  signature: string;
}

interface PreparedHeartbeat {
  before: number;
  ownerAddress: string;
  request: HeartbeatRequest;
}

async function main(): Promise<void> {
  const manifest = readManifest();
  const contract = resolveHeartbeatContract(
    process.env.LEGACY_KEEPER_ADDRESS,
    manifest.contract,
  );
  const workflow = heartbeatWorkflow(manifest);
  const provider = new JsonRpcProvider(req("SEPOLIA_RPC_URL"));
  const heartbeat = await prepareHeartbeat(provider, contract);
  printRequest(workflow, heartbeat);

  const mcp = keeperHubClient();
  await mcp.connect();
  await executeHeartbeat(workflow, heartbeat.request, mcp, provider);
  const after = await readHeartbeat(provider, contract);
  console.log(`\nlast heartbeat after: ${after}`);
  if (after <= heartbeat.before)
    throw new Error("heartbeat did not advance onchain");
  console.log("WORKFLOW DROVE THE CONTRACT");
}

interface ExecutionSummary {
  status: string;
  triggerSource: string;
  txHash?: string;
}

function readManifest(): WorkflowManifest {
  return JSON.parse(
    readFileSync("workflows/manifest.json", "utf8"),
  ) as WorkflowManifest;
}

function heartbeatWorkflow(manifest: WorkflowManifest): WorkflowManifestEntry {
  const workflow = manifest.workflows.find(
    (entry) => entry.key === "heartbeat-relay",
  );
  if (!workflow) {
    throw new Error("heartbeat-relay not in manifest — run deploy.ts first");
  }
  return workflow;
}

async function prepareHeartbeat(
  provider: JsonRpcProvider,
  contract: string,
): Promise<PreparedHeartbeat> {
  const owner = new Wallet(req("DEPLOYER_PRIVATE_KEY"), provider);
  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await owner.signTypedData(
    {
      name: "LegacyKeeper",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: contract,
    },
    {
      Heartbeat: [
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { nonce, deadline },
  );
  return {
    before: await readHeartbeat(provider, contract),
    ownerAddress: owner.address,
    request: { nonce: String(nonce), deadline: String(deadline), signature },
  };
}

function printRequest(
  workflow: WorkflowManifestEntry,
  heartbeat: PreparedHeartbeat,
): void {
  console.log(`workflow: ${workflow.workflowId} (${workflow.name})`);
  console.log(`owner:    ${heartbeat.ownerAddress}`);
  console.log(`nonce:    ${heartbeat.request.nonce}`);
  console.log(`last heartbeat before: ${heartbeat.before}\n`);
}

function keeperHubClient(): McpClient {
  return new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
    apiKey: req("KEEPERHUB_API_KEY"),
  });
}

async function executeHeartbeat(
  workflow: WorkflowManifestEntry,
  request: HeartbeatRequest,
  mcp: McpClient,
  provider: JsonRpcProvider,
): Promise<void> {
  console.log("── triggering KeeperHub webhook ──");
  const executionId = await triggerWebhook(workflow.workflowId, request);
  console.log(`execution: ${executionId}`);
  const execution = await waitForExecution(mcp, executionId);
  printExecution(execution);
  assertSuccessfulWebhook(execution);
  const receipt = await provider.waitForTransaction(
    execution.txHash,
    1,
    60_000,
  );
  if (!receipt || receipt.status !== 1)
    throw new Error("heartbeat tx was not confirmed");
}

function printExecution(execution: ExecutionSummary): void {
  console.log(`status:    ${execution.status}`);
  console.log(`source:    ${execution.triggerSource}`);
  console.log(`tx:        ${execution.txHash ?? "none"}`);
}

function assertSuccessfulWebhook(
  execution: ExecutionSummary,
): asserts execution is ExecutionSummary & { txHash: string } {
  if (execution.status !== "success" || execution.triggerSource !== "webhook") {
    throw new Error(`webhook execution did not succeed: ${execution.status}`);
  }
  if (!execution.txHash)
    throw new Error("KeeperHub execution returned no tx hash");
}

async function triggerWebhook(
  workflowId: string,
  input: HeartbeatRequest,
): Promise<string> {
  const response = await fetch(webhookUrl(workflowId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${req("KEEPERHUB_WEBHOOK_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json();
  const result = objectValue(body);
  if (!response.ok) {
    throw new Error(`KeeperHub webhook failed: HTTP ${response.status}`);
  }
  const executionId = stringValue(result.executionId);
  if (!executionId)
    throw new Error("KeeperHub webhook returned no executionId");
  return executionId;
}

async function waitForExecution(
  mcp: McpClient,
  executionId: string,
): Promise<ExecutionSummary> {
  for (let attempt = 0; attempt < 24; attempt++) {
    if (attempt > 0) await sleep(5000);
    const raw = await mcp.callTool("get_execution", { executionId });
    const detail = objectValue(JSON.parse(raw));
    const execution = objectValue(objectValue(detail.logs).execution);
    const status = stringValue(execution.status) ?? "unknown";
    if (!["running", "pending", "queued"].includes(status)) {
      const hashes = Array.isArray(execution.transactionHashes)
        ? execution.transactionHashes
        : [];
      return {
        status,
        triggerSource: stringValue(execution.triggerSource) ?? "unknown",
        txHash: stringValue(objectValue(hashes[0]).hash),
      };
    }
  }
  throw new Error(`KeeperHub execution ${executionId} timed out`);
}

async function readHeartbeat(
  provider: JsonRpcProvider,
  address: string,
): Promise<number> {
  const contract = new Contract(
    address,
    ["function getLivenessStatus() view returns (uint64,uint64,bool,bool)"],
    provider,
  );
  return Number((await contract.getLivenessStatus())[0]);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function req(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`${n} is required`);
  return v;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
