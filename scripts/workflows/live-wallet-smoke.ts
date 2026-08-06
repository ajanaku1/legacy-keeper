/**
 * Live proof for the wallet-scoped KeeperHub path.
 *
 * Creates an ephemeral owner in memory, relays factory plan creation through
 * KeeperHub, then relays a signed heartbeat through KeeperHub. No generated
 * private key is read from the environment, printed, or written to disk.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  AbiCoder,
  Contract,
  HDNodeWallet,
  Interface,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  getAddress,
  keccak256,
  type TransactionReceipt,
} from "ethers";
import { McpClient } from "../../agent/keeperhub/mcp-client";

const CHAIN_ID = 11155111;
const TERMINAL = new Set([
  "success",
  "completed",
  "failed",
  "reverted",
  "cancelled",
]);

interface PlanConfig {
  heartbeatInterval: number;
  timeoutDuration: number;
  gracePeriod: number;
  beneficiaryWallets: string[];
  beneficiaryShares: number[];
  recoveryKey: string;
  safeVault: string;
  trackedTokens: string[];
  allowSharedRecovery: boolean;
}

interface Execution {
  executionId: string;
  status: string;
  txHash: string;
}

async function main(): Promise<void> {
  const provider = new JsonRpcProvider(required("SEPOLIA_RPC_URL"));
  const factoryAddress = getAddress(
    required("NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS"),
  );
  const owner = Wallet.createRandom();
  const config = smokeConfig();
  const client = keeperHubClient();
  await client.connect();

  const creation = await createPlan(owner, config, factoryAddress, client);
  const plan = await readRegisteredPlan(
    provider,
    factoryAddress,
    owner.address,
  );
  const heartbeat = await relayHeartbeat(owner, plan, client);
  const verifiedPlan = await verifyCreatedPlan(
    provider,
    factoryAddress,
    owner.address,
    creation,
  );
  if (verifiedPlan !== plan)
    throw new Error("verified plan changed after heartbeat");
  const lastHeartbeat = await verifyHeartbeat(provider, plan, heartbeat);

  printEvidence(owner.address, plan, creation, heartbeat, lastHeartbeat);
}

async function readRegisteredPlan(
  provider: JsonRpcProvider,
  factoryAddress: string,
  owner: string,
): Promise<string> {
  const factory = new Contract(
    factoryAddress,
    ["function planOf(address) view returns (address)"],
    provider,
  );
  const plan = getAddress(await factory.planOf(owner));
  if (plan === ZeroAddress)
    throw new Error("factory has not registered the plan");
  return plan;
}

function smokeConfig(): PlanConfig {
  return {
    heartbeatInterval: 86_400,
    timeoutDuration: 5_184_000,
    gracePeriod: 604_800,
    beneficiaryWallets: [freshAddress()],
    beneficiaryShares: [10_000],
    recoveryKey: freshAddress(),
    safeVault: freshAddress(),
    trackedTokens: [],
    allowSharedRecovery: false,
  };
}

async function createPlan(
  owner: HDNodeWallet,
  config: PlanConfig,
  factory: string,
  client: McpClient,
): Promise<Execution> {
  const nonce = Date.now().toString();
  const deadline = deadlineInOneHour();
  const signature = await owner.signTypedData(
    factoryDomain(factory),
    createPlanTypes(),
    { owner: owner.address, configHash: hashConfig(config), nonce, deadline },
  );
  const payload = createPlanPayload(
    owner.address,
    config,
    nonce,
    deadline,
    signature,
  );
  return executeWorkflow(
    required("KEEPERHUB_PLAN_WORKFLOW_ID"),
    payload,
    client,
  );
}

async function relayHeartbeat(
  owner: HDNodeWallet,
  plan: string,
  client: McpClient,
): Promise<Execution> {
  const nonce = (Date.now() + 1).toString();
  const deadline = deadlineInOneHour();
  const signature = await owner.signTypedData(
    planDomain(plan),
    heartbeatTypes(),
    { nonce, deadline },
  );
  const payload = heartbeatPayload(
    owner.address,
    plan,
    nonce,
    deadline,
    signature,
  );
  return executeWorkflow(
    required("KEEPERHUB_HEARTBEAT_WORKFLOW_ID"),
    payload,
    client,
  );
}

async function executeWorkflow(
  workflowId: string,
  payload: Record<string, string>,
  client: McpClient,
): Promise<Execution> {
  const executionId = await triggerWebhook(workflowId, payload);
  return waitForExecution(client, executionId);
}

async function triggerWebhook(
  workflowId: string,
  payload: Record<string, string>,
): Promise<string> {
  const response = await fetch(webhookUrl(workflowId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("KEEPERHUB_WEBHOOK_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const body = asObject(await response.json());
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
  return requiredField(body, "executionId");
}

async function waitForExecution(
  client: McpClient,
  executionId: string,
): Promise<Execution> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (attempt > 0) await pause(5_000);
    const raw = await client.callTool("get_execution", { executionId });
    const execution = executionObject(JSON.parse(raw) as unknown);
    const status = stringField(execution, "status") ?? "unknown";
    if (!TERMINAL.has(status)) continue;
    if (status !== "success" && status !== "completed") {
      throw new Error(`KeeperHub execution ${executionId} ${status}`);
    }
    const txHash = transactionHash(JSON.parse(raw) as unknown);
    if (txHash) return { executionId, status, txHash };
  }
  throw new Error(`KeeperHub execution ${executionId} timed out`);
}

async function verifyCreatedPlan(
  provider: JsonRpcProvider,
  factoryAddress: string,
  owner: string,
  execution: Execution,
): Promise<string> {
  const receipt = await confirmedReceipt(provider, execution.txHash);
  const eventPlan = planCreatedAddress(receipt, factoryAddress, owner);
  const factory = new Contract(
    factoryAddress,
    ["function planOf(address) view returns (address)"],
    provider,
  );
  const registered = getAddress(await factory.planOf(owner));
  if (registered !== eventPlan)
    throw new Error("PlanCreated and planOf disagree");
  const plan = new Contract(
    registered,
    [
      "function owner() view returns (address)",
      "function initialized() view returns (bool)",
    ],
    provider,
  );
  if (
    getAddress(await plan.owner()) !== getAddress(owner) ||
    !(await plan.initialized())
  ) {
    throw new Error("created plan is not initialized for its owner");
  }
  return registered;
}

async function verifyHeartbeat(
  provider: JsonRpcProvider,
  plan: string,
  execution: Execution,
): Promise<bigint> {
  const receipt = await confirmedReceipt(provider, execution.txHash);
  const event = findEvent(receipt, plan, [
    "event HeartbeatRecorded(address indexed sender,uint64 timestamp)",
  ]);
  if (event?.name !== "HeartbeatRecorded") {
    throw new Error("heartbeat receipt has no HeartbeatRecorded event");
  }
  const contract = new Contract(
    plan,
    ["function getLivenessStatus() view returns (uint64,uint64,bool,bool)"],
    provider,
  );
  const status = await contract.getLivenessStatus();
  const lastHeartbeat = BigInt(status[0]);
  if (lastHeartbeat !== BigInt(event.args.timestamp)) {
    throw new Error("heartbeat event and state disagree");
  }
  return lastHeartbeat;
}

function planCreatedAddress(
  receipt: TransactionReceipt,
  factory: string,
  owner: string,
): string {
  const event = findEvent(receipt, factory, [
    "event PlanCreated(address indexed owner,address indexed plan,uint256 indexed nonce)",
  ]);
  if (event?.name !== "PlanCreated")
    throw new Error("missing PlanCreated event");
  if (getAddress(event.args.owner) !== getAddress(owner)) {
    throw new Error("PlanCreated owner mismatch");
  }
  return getAddress(event.args.plan);
}

function findEvent(
  receipt: TransactionReceipt,
  address: string,
  fragments: string[],
) {
  const contractInterface = new Interface(fragments);
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(address)) continue;
    try {
      return contractInterface.parseLog(log);
    } catch {
      continue;
    }
  }
  return null;
}

async function confirmedReceipt(
  provider: JsonRpcProvider,
  txHash: string,
): Promise<TransactionReceipt> {
  const receipt = await provider.waitForTransaction(txHash, 1, 60_000);
  if (!receipt || receipt.status !== 1)
    throw new Error(`transaction failed: ${txHash}`);
  return receipt;
}

function createPlanPayload(
  owner: string,
  config: PlanConfig,
  nonce: string,
  deadline: string,
  signature: string,
): Record<string, string> {
  return {
    functionArgs: JSON.stringify([owner, config, nonce, deadline, signature]),
  };
}

function heartbeatPayload(
  owner: string,
  plan: string,
  nonce: string,
  deadline: string,
  signature: string,
): Record<string, string> {
  return {
    owner,
    plan,
    functionArgs: JSON.stringify([nonce, deadline, signature]),
  };
}

function hashConfig(config: PlanConfig): string {
  const coder = AbiCoder.defaultAbiCoder();
  const beneficiaries = keccak256(
    coder.encode(
      ["address[]", "uint16[]"],
      [config.beneficiaryWallets, config.beneficiaryShares],
    ),
  );
  const tokens = keccak256(coder.encode(["address[]"], [config.trackedTokens]));
  return keccak256(
    coder.encode(
      [
        "uint64",
        "uint64",
        "uint64",
        "bytes32",
        "address",
        "address",
        "bytes32",
        "bool",
      ],
      [
        config.heartbeatInterval,
        config.timeoutDuration,
        config.gracePeriod,
        beneficiaries,
        config.recoveryKey,
        config.safeVault,
        tokens,
        config.allowSharedRecovery,
      ],
    ),
  );
}

function factoryDomain(factory: string) {
  return {
    name: "LegacyKeeperFactory",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: factory,
  };
}

function planDomain(plan: string) {
  return {
    name: "LegacyKeeper",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: plan,
  };
}

function createPlanTypes() {
  return {
    CreatePlan: [
      { name: "owner", type: "address" },
      { name: "configHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
}

function heartbeatTypes() {
  return {
    Heartbeat: [
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
}

function keeperHubClient(): McpClient {
  return new McpClient({
    url: process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp",
    apiKey: required("KEEPERHUB_API_KEY"),
  });
}

function executionObject(value: unknown): Record<string, unknown> {
  return asObject(asObject(asObject(value).logs).execution);
}

function transactionHash(value: unknown): string | undefined {
  const logs = asObject(asObject(value).logs);
  const execution = asObject(logs.execution);
  const hashes = execution.transactionHashes;
  const first = Array.isArray(hashes) ? hashes[0] : undefined;
  const fromList = stringField(asObject(first), "hash") ?? stringValue(first);
  const fromOutput = stringField(asObject(execution.output), "transactionHash");
  return fromList ?? fromOutput ?? transactionHashFromSteps(logs.logs);
}

function transactionHashFromSteps(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    const log = asObject(entry);
    if (log.status !== "success") continue;
    const hash = stringField(asObject(log.output), "transactionHash");
    if (hash?.startsWith("0x")) return hash;
  }
  return undefined;
}

function printEvidence(
  owner: string,
  plan: string,
  creation: Execution,
  heartbeat: Execution,
  lastHeartbeat: bigint,
): void {
  console.log(
    JSON.stringify(
      {
        owner,
        plan,
        planExecutionId: creation.executionId,
        planTxHash: creation.txHash,
        heartbeatExecutionId: heartbeat.executionId,
        heartbeatTxHash: heartbeat.txHash,
        lastHeartbeat: lastHeartbeat.toString(),
        proof: "KEEPERHUB_WALLET_CHECKIN_VERIFIED",
      },
      null,
      2,
    ),
  );
}

function freshAddress(): string {
  return Wallet.createRandom().address;
}

function deadlineInOneHour(): string {
  return String(Math.floor(Date.now() / 1000) + 3_600);
}

function webhookUrl(workflowId: string): string {
  return `https://app.keeperhub.com/api/workflows/${workflowId}/webhook`;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(
  object: Record<string, unknown>,
  field: string,
): string | undefined {
  return typeof object[field] === "string" ? object[field] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredField(object: Record<string, unknown>, field: string): string {
  const value = stringField(object, field);
  if (!value) throw new Error(`${field} is missing`);
  return value;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
