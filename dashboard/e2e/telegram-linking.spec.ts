import { expect, test, type Page, type Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Address,
  type Hex,
} from "viem";
import { legacyKeeperAbi, legacyKeeperFactoryAbi } from "../lib/contract";

const OWNER = "0x1000000000000000000000000000000000000001" as Address;
const BENEFICIARY = "0x2000000000000000000000000000000000000002" as Address;
const RECOVERY = "0x3000000000000000000000000000000000000003" as Address;
const VAULT = "0x4000000000000000000000000000000000000004" as Address;
const PLAN = "0x5000000000000000000000000000000000000005" as Address;
const SIGNATURE = `0x${"11".repeat(65)}` as Hex;
const MULTICALL_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;
const MULTICALL_BALANCE_ABI = [
  {
    type: "function",
    name: "getEthBalance",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

test("links, tests, and unlinks Telegram without sharing plan authority", async ({
  page,
}) => {
  await installWallet(page);
  await mockPlanReads(page);
  await mockTelegramApi(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Telegram alerts" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(page.getByText("Waiting for Telegram")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify wallet ownership" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify wallet ownership" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 2 wallets")).toBeVisible();

  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 2 wallets")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Manage existing link" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 2 wallets")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Manage existing link" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Send test alert" }).click();
  await expect(page.getByText(/Test alert delivered/)).toBeVisible();
  await page.getByRole("button", { name: "Unlink Telegram" }).click();
  await expect(page.getByText(/monitoring has been unlinked/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Telegram" }),
  ).toBeVisible();
});

async function installWallet(page: Page): Promise<void> {
  await page.addInitScript(
    ({ owner, signature }) => {
      const ethereum = {
        isMetaMask: true,
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [owner];
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "net_version") return "11155111";
          if (method === "wallet_requestPermissions")
            return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_signTypedData_v4") return signature;
          throw new Error(`Unsupported wallet method: ${method}`);
        },
        on: () => undefined,
        removeListener: () => undefined,
      };
      Object.defineProperty(window, "ethereum", {
        configurable: true,
        value: ethereum,
      });
      window.open = () => null;
    },
    { owner: OWNER, signature: SIGNATURE },
  );
}

async function mockTelegramApi(page: Page): Promise<void> {
  let linked = false;
  await page.route("**/api/telegram/link-sessions**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        json: {
          sessionId: "session-1",
          browserToken: "browser-secret",
          nonce: "nonce-1",
          deadline: "9999999999",
          telegramUrl: "https://t.me/LegacyKeeperBot?start=opaque",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        sessionId: "session-1",
        state: "detected",
        telegramUserId: "44112233",
        owner: OWNER,
        chainId: 11_155_111,
        nonce: "nonce-1",
        deadline: "9999999999",
      },
    });
  });
  await page.route("**/api/telegram/links**", async (route) => {
    if (route.request().method() === "GET" && !linked) {
      await route.fulfill({
        status: 401,
        json: { message: "Wallet session required." },
      });
      return;
    }
    linked = true;
    await route.fulfill({
      json: { ok: true, link: linkedWallet(), activeCount: 1, limit: 2 },
    });
  });
  await page.route("**/api/telegram/test", (route) =>
    route.fulfill({
      json: { ok: true, delivery: "sent" },
    }),
  );
  await page.route("**/api/telegram/unlink", (route) =>
    route.fulfill({
      json: { unlinked: true },
    }),
  );
}

function linkedWallet() {
  return {
    id: "link-1",
    owner: OWNER,
    chainId: 11_155_111,
    telegramUserId: "44112233",
    plan: PLAN,
  };
}

async function mockPlanReads(page: Page): Promise<void> {
  await page.route("https://11155111.rpc.thirdweb.com/**", fulfillRpc);
}

async function fulfillRpc(route: Route): Promise<void> {
  const request = route.request().postDataJSON() as RpcRequest | RpcRequest[];
  const response = Array.isArray(request)
    ? request.map(rpcResponse)
    : rpcResponse(request);
  await route.fulfill({ json: response });
}

interface RpcRequest {
  id: number;
  method: string;
  params?: unknown[];
}

function rpcResponse(request: RpcRequest) {
  return { jsonrpc: "2.0", id: request.id, result: rpcResult(request) };
}

function rpcResult(request: RpcRequest): unknown {
  if (request.method === "eth_chainId") return "0xaa36a7";
  if (request.method === "eth_blockNumber") return "0x100";
  if (request.method === "eth_getCode") return "0x60006000";
  if (request.method !== "eth_call") return "0x0";
  const call = request.params?.[0] as { data?: Hex } | undefined;
  if (!call?.data) return "0x";
  if (call.data.startsWith("0x94a78483")) return planResult();
  return multicallResult(call.data);
}

function multicallResult(data: Hex): Hex {
  const decoded = decodeFunctionData({ abi: MULTICALL_ABI, data });
  const result = decoded.args[0].map(({ callData }) => ({
    success: true,
    returnData: keeperReadResult(callData),
  }));
  return encodeFunctionResult({
    abi: MULTICALL_ABI,
    functionName: "aggregate3",
    result,
  });
}

function planResult(): Hex {
  return encodeFunctionResult({
    abi: legacyKeeperFactoryAbi,
    functionName: "planOf",
    result: PLAN,
  });
}

function keeperReadResult(data: Hex): Hex {
  if (data.startsWith("0x94a78483")) return planResult();
  if (data.startsWith("0x4d2301cc")) {
    return encodeFunctionResult({
      abi: MULTICALL_BALANCE_ABI,
      functionName: "getEthBalance",
      result: 0n,
    });
  }
  const decoded = decodeFunctionData({ abi: legacyKeeperAbi, data });
  const heartbeatAt = BigInt(Math.floor(Date.now() / 1_000) - 86_400);
  const values: Record<string, unknown> = {
    owner: OWNER,
    getLivenessStatus: [heartbeatAt, 30n, true, false],
    getTimeoutStatus: [false, false],
    liveness: [86_400n, 5_184_000n, 604_800n, heartbeatAt, true],
    vault: [VAULT, RECOVERY, true, false],
    getBeneficiaries: [{ wallet: BENEFICIARY, shareBps: 10_000 }],
    totalShareBps: 10_000,
    inheritanceExecuted: false,
    inheritanceTimestamp: 0n,
    evacuationExecuted: false,
    getTrackedTokens: [],
  };
  return encodeFunctionResult({
    abi: legacyKeeperAbi,
    functionName: decoded.functionName as never,
    result: values[decoded.functionName] as never,
  });
}
