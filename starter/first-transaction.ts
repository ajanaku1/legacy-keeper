import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  AbiCoder,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import { McpClient } from "../agent/keeperhub/mcp-client";

const CHAIN_ID = 11155111;
const DEFAULT_FACTORY = "0xf434788C775a36736CF3Ce0D2e0368E22BF9c576";
const DEFAULT_MCP_URL = "https://app.keeperhub.com/mcp";
const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const CREATE_PLAN_ABI = [
  {
    name: "createPlan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "heartbeatInterval", type: "uint64" },
          { name: "timeoutDuration", type: "uint64" },
          { name: "gracePeriod", type: "uint64" },
          { name: "beneficiaryWallets", type: "address[]" },
          { name: "beneficiaryShares", type: "uint16[]" },
          { name: "recoveryKey", type: "address" },
          { name: "safeVault", type: "address" },
          { name: "trackedTokens", type: "address[]" },
          { name: "allowSharedRecovery", type: "bool" },
        ],
      },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "planAddress", type: "address" }],
  },
];
const FACTORY_INTERFACE = new Interface([
  "event PlanCreated(address indexed owner,address indexed plan,uint256 indexed nonce)",
  "function planOf(address) view returns (address)",
]);
const PLAN_INTERFACE = new Interface([
  "function owner() view returns (address)",
  "function initialized() view returns (bool)",
]);

export interface PlanConfig {
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

interface IntentSigner {
  address: string;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

export interface CreatePlanToolOptions {
  factoryAddress: string;
  owner: IntentSigner;
  beneficiary: string;
  recoveryKey: string;
  safeVault: string;
  nonce: string;
  deadline: string;
}

interface QuickstartClient {
  connect(): Promise<{ name: string; version: string }>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

interface VerifiedCreation {
  planAddress: string;
  blockNumber: number;
}

export interface ChainReader {
  waitForReceipt(transactionHash: string): Promise<{
    status: number | null;
    blockNumber: number;
    logs: readonly {
      address: string;
      topics: readonly string[];
      data: string;
    }[];
  } | null>;
  getCode(address: string): Promise<string>;
  call(address: string, data: string): Promise<string>;
}

export interface FirstTransactionOptions extends CreatePlanToolOptions {
  client: QuickstartClient;
  now?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
  verify(
    transactionHash: string,
    ownerAddress: string,
  ): Promise<VerifiedCreation>;
}

export interface FirstTransactionEvidence extends VerifiedCreation {
  proof: "KEEPERHUB_FIRST_TRANSACTION_VERIFIED";
  keeperHubExecutionId: string;
  transactionHash: string;
  sponsored: boolean;
  elapsedMs: number;
}

export async function buildCreatePlanToolArguments(
  options: CreatePlanToolOptions,
): Promise<Record<string, unknown>> {
  const config = defaultPlanConfig(options);
  const signature = await signCreatePlan(options, config);
  return {
    contract_address: options.factoryAddress,
    chain_id: CHAIN_ID,
    function_name: "createPlan",
    function_args: [
      options.owner.address,
      config,
      options.nonce,
      options.deadline,
      signature,
    ],
    abi: CREATE_PLAN_ABI,
    gas_limit_multiplier: 1.2,
    idempotency_key: `legacykeeper-first-tx:${options.owner.address}:${options.nonce}`,
  };
}

export async function runFirstTransaction(
  options: FirstTransactionOptions,
): Promise<FirstTransactionEvidence> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  await options.client.connect();
  const executionId = await submitCreatePlan(options);
  const settlement = await waitForSettlement(options, executionId);
  const verified = await options.verify(
    settlement.transactionHash,
    options.owner.address,
  );
  return {
    proof: "KEEPERHUB_FIRST_TRANSACTION_VERIFIED",
    keeperHubExecutionId: executionId,
    transactionHash: settlement.transactionHash,
    sponsored: settlement.sponsored,
    elapsedMs: now() - startedAt,
    ...verified,
  };
}

async function submitCreatePlan(
  options: FirstTransactionOptions,
): Promise<string> {
  const response = await options.client.callTool(
    "execute_contract_call",
    await buildCreatePlanToolArguments(options),
  );
  return requiredString(parseJsonObject(response), [
    "executionId",
    "execution_id",
    "id",
  ]);
}

export async function verifyPlanCreation(
  reader: ChainReader,
  factoryAddress: string,
  transactionHash: string,
  ownerAddress: string,
): Promise<VerifiedCreation> {
  const receipt = await reader.waitForReceipt(transactionHash);
  if (!receipt || receipt.status !== 1) {
    throw new Error("transaction receipt is not successful");
  }
  const planAddress = planFromReceipt(
    receipt.logs,
    factoryAddress,
    ownerAddress,
  );
  await verifyRegisteredPlan(reader, factoryAddress, ownerAddress, planAddress);
  await verifyPlanContract(reader, planAddress, ownerAddress);
  return { planAddress, blockNumber: receipt.blockNumber };
}

async function verifyRegisteredPlan(
  reader: ChainReader,
  factoryAddress: string,
  ownerAddress: string,
  planAddress: string,
): Promise<void> {
  const registeredPlan = decodeAddress(
    FACTORY_INTERFACE,
    "planOf",
    await reader.call(
      factoryAddress,
      FACTORY_INTERFACE.encodeFunctionData("planOf", [ownerAddress]),
    ),
  );
  if (registeredPlan !== planAddress)
    throw new Error("PlanCreated and planOf disagree");
}

async function verifyPlanContract(
  reader: ChainReader,
  planAddress: string,
  ownerAddress: string,
): Promise<void> {
  if ((await reader.getCode(planAddress)) === "0x")
    throw new Error("created plan has no bytecode");
  const planOwner = decodeAddress(
    PLAN_INTERFACE,
    "owner",
    await reader.call(planAddress, PLAN_INTERFACE.encodeFunctionData("owner")),
  );
  const initialized = Boolean(
    PLAN_INTERFACE.decodeFunctionResult(
      "initialized",
      await reader.call(
        planAddress,
        PLAN_INTERFACE.encodeFunctionData("initialized"),
      ),
    )[0],
  );
  if (planOwner !== getAddress(ownerAddress) || !initialized) {
    throw new Error("created plan owner or initialization is invalid");
  }
}

function planFromReceipt(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  factoryAddress: string,
  ownerAddress: string,
): string {
  for (const log of logs) {
    if (getAddress(log.address) !== getAddress(factoryAddress)) continue;
    const event = FACTORY_INTERFACE.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (event?.name !== "PlanCreated") continue;
    if (getAddress(String(event.args.owner)) !== getAddress(ownerAddress)) {
      throw new Error("PlanCreated owner does not match the signer");
    }
    return getAddress(String(event.args.plan));
  }
  throw new Error("receipt is missing PlanCreated");
}

function decodeAddress(
  contractInterface: Interface,
  name: string,
  result: string,
): string {
  return getAddress(
    String(contractInterface.decodeFunctionResult(name, result)[0]),
  );
}

async function waitForSettlement(
  options: FirstTransactionOptions,
  executionId: string,
): Promise<{ transactionHash: string; sponsored: boolean }> {
  const pause = options.pause ?? defaultPause;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    if (attempt > 0) await pause(5_000);
    const status = parseJsonObject(
      await options.client.callTool("get_direct_execution_status", {
        execution_id: executionId,
      }),
    );
    const state = optionalString(status, ["status", "state"])?.toLowerCase();
    if (
      !state ||
      ["pending", "queued", "running", "processing"].includes(state)
    )
      continue;
    return successfulSettlement(status, state);
  }
  throw new Error(
    `KeeperHub execution ${executionId} did not settle within three minutes`,
  );
}

function successfulSettlement(
  settlement: Record<string, unknown>,
  status: string,
): { transactionHash: string; sponsored: boolean } {
  const result = objectValue(settlement.result);
  const succeeded =
    status === "success" || (status === "completed" && result.success === true);
  if (!succeeded) {
    throw new Error(`KeeperHub execution settled without success: ${status}`);
  }
  return {
    transactionHash:
      optionalString(settlement, ["transactionHash", "txHash", "tx_hash"]) ??
      requiredString(result, ["transactionHash", "txHash", "tx_hash"]),
    sponsored: result.sponsored === true || settlement.sponsored === true,
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("KeeperHub returned a non-object response");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(
  object: Record<string, unknown>,
  keys: string[],
): string {
  const value = optionalString(object, keys);
  if (!value) throw new Error(`KeeperHub response missing ${keys[0]}`);
  return value;
}

function optionalString(
  object: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function defaultPause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type CliOptions = CreatePlanToolOptions;

async function main(): Promise<void> {
  const callOptions = createCliOptions();
  if (process.argv.includes("--dry-run")) {
    await printDryRun(callOptions);
    return;
  }
  await executeLiveQuickstart(callOptions);
}

function createCliOptions(): CliOptions {
  const factoryAddress = optionalOverride(
    process.env.NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS,
    DEFAULT_FACTORY,
  );
  const owner = Wallet.createRandom();
  const beneficiary = Wallet.createRandom().address;
  const recoveryKey = Wallet.createRandom().address;
  const safeVault = Wallet.createRandom().address;
  const nonce = numericNonce(randomUUID().replaceAll("-", ""));
  const deadline = String(Math.floor(Date.now() / 1000) + 3_600);
  return {
    factoryAddress,
    owner,
    beneficiary,
    recoveryKey,
    safeVault,
    nonce,
    deadline,
  };
}

async function printDryRun(options: CliOptions): Promise<void> {
  const request = await buildCreatePlanToolArguments(options);
  printJson({
    ready: true,
    network: "Sepolia",
    owner: options.owner.address,
    factoryAddress: options.factoryAddress,
    requiredEnvironment: ["KEEPERHUB_API_KEY"],
    request: {
      ...request,
      function_args: "[owner-authorized createPlan arguments]",
    },
  });
}

async function executeLiveQuickstart(options: CliOptions): Promise<void> {
  const apiKey = requireEnvironment("KEEPERHUB_API_KEY");
  const provider = new JsonRpcProvider(
    optionalOverride(process.env.SEPOLIA_RPC_URL, DEFAULT_RPC_URL),
  );
  const client = new McpClient({
    url: optionalOverride(process.env.KEEPERHUB_MCP_URL, DEFAULT_MCP_URL),
    apiKey,
  });
  const evidence = await runFirstTransaction({
    ...options,
    client,
    verify: (transactionHash, ownerAddress) =>
      verifyPlanCreation(
        chainReader(provider),
        options.factoryAddress,
        transactionHash,
        ownerAddress,
      ),
  });
  printJson({
    ...evidence,
    network: "Sepolia",
    owner: options.owner.address,
    factoryAddress: options.factoryAddress,
    elapsedSeconds: Number((evidence.elapsedMs / 1_000).toFixed(1)),
    explorer: `https://sepolia.etherscan.io/tx/${evidence.transactionHash}`,
  });
}

function chainReader(provider: JsonRpcProvider): ChainReader {
  return {
    waitForReceipt: (transactionHash) =>
      provider.waitForTransaction(transactionHash, 1, 60_000),
    getCode: (address) => provider.getCode(address),
    call: (address, data) => provider.call({ to: address, data }),
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is required; copy .env.example to .env and add the key`,
    );
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function numericNonce(hexadecimal: string): string {
  return BigInt(`0x${hexadecimal}`).toString();
}

export function optionalOverride(
  value: string | undefined,
  fallback: string,
): string {
  if (!value || /your[_-](key|value)|^0x\.\.\.$/i.test(value)) return fallback;
  return value;
}

if (process.argv[1]?.endsWith("starter/first-transaction.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function defaultPlanConfig(options: CreatePlanToolOptions): PlanConfig {
  return {
    heartbeatInterval: 86_400,
    timeoutDuration: 2_592_000,
    gracePeriod: 604_800,
    beneficiaryWallets: [options.beneficiary],
    beneficiaryShares: [10_000],
    recoveryKey: options.recoveryKey,
    safeVault: options.safeVault,
    trackedTokens: [],
    allowSharedRecovery: false,
  };
}

async function signCreatePlan(
  options: CreatePlanToolOptions,
  config: PlanConfig,
): Promise<string> {
  return options.owner.signTypedData(
    factoryDomain(options.factoryAddress),
    createPlanTypes(),
    {
      owner: options.owner.address,
      configHash: hashPlanConfig(config),
      nonce: options.nonce,
      deadline: options.deadline,
    },
  );
}

function factoryDomain(factoryAddress: string): TypedDataDomain {
  return {
    name: "LegacyKeeperFactory",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: factoryAddress,
  };
}

function createPlanTypes(): Record<string, TypedDataField[]> {
  return {
    CreatePlan: [
      { name: "owner", type: "address" },
      { name: "configHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
}

function hashPlanConfig(config: PlanConfig): string {
  const coder = AbiCoder.defaultAbiCoder();
  const dynamicHashes = hashDynamicConfig(coder, config);
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
        dynamicHashes.beneficiaries,
        config.recoveryKey,
        config.safeVault,
        dynamicHashes.tokens,
        config.allowSharedRecovery,
      ],
    ),
  );
}

function hashDynamicConfig(
  coder: AbiCoder,
  config: PlanConfig,
): { beneficiaries: string; tokens: string } {
  return {
    beneficiaries: keccak256(
      coder.encode(
        ["address[]", "uint16[]"],
        [config.beneficiaryWallets, config.beneficiaryShares],
      ),
    ),
    tokens: keccak256(coder.encode(["address[]"], [config.trackedTokens])),
  };
}
