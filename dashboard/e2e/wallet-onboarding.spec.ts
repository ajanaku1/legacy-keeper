import { expect, test, type Page, type Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { legacyKeeperAbi, legacyKeeperFactoryAbi } from "../lib/contract";

const OWNER = "0x1000000000000000000000000000000000000001" as Address;
const BENEFICIARY = "0x2000000000000000000000000000000000000002" as Address;
const RECOVERY = "0x3000000000000000000000000000000000000003" as Address;
const VAULT = "0x4000000000000000000000000000000000000004" as Address;
const PLAN = "0x5000000000000000000000000000000000000005" as Address;
const TOKEN = "0x6000000000000000000000000000000000000006" as Address;
const TX_HASH = `0x${"ab".repeat(32)}` as Hex;
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

interface MockChainState {
  planCreated: boolean;
  heartbeatAt: bigint;
  inheritanceExecuted?: boolean;
  inheritanceTimestamp?: bigint;
  trackedTokens?: Address[];
  tokenDistributed?: boolean;
  pullableAmount?: bigint;
}

test("keeps disconnected visitors on public or locked surfaces", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /The continuity agent that acts when you cannot/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("KeeperHub", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/activity");
  await expect(
    page.getByRole("heading", { name: /Connect your wallet/i }),
  ).toBeVisible();
  await expect(page.getByText("Execution record")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("creates one wallet plan, navigates routes, and verifies a check-in", async ({
  page,
}) => {
  await installWallet(page);
  const state = {
    planCreated: false,
    heartbeatAt: BigInt(Math.floor(Date.now() / 1_000) - 86_400),
  };
  await mockApplicationNetwork(page, state);
  await page.goto("/dashboard");

  await completeOnboarding(page);
  await verifyConnectedReloadHasNoDisconnectedFlash(page);
  await verifyIndependentPageScroll(page);
  await verifyRouteNavigation(page);
  await verifyCheckIn(page);
  await verifyDisconnect(page);
});

test("shows tracked balances and replaces check-in after inheritance", async ({
  page,
}) => {
  await installWallet(page);
  const state: MockChainState = {
    planCreated: true,
    heartbeatAt: BigInt(Math.floor(Date.now() / 1_000) - 172_800),
    inheritanceExecuted: true,
    inheritanceTimestamp: BigInt(Math.floor(Date.now() / 1_000) - 60),
    trackedTokens: [TOKEN],
    tokenDistributed: true,
  };
  await mockApplicationNetwork(page, state);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();

  await expect(
    page.getByRole("heading", { name: "Inheritance executed" }),
  ).toBeVisible();
  await expect(page.getByText("1 of 1 complete")).toBeVisible();
  await expect(page.getByText("2.5 USDC")).toBeVisible();
  await expect(page.getByText("Finalized")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in now" })).toHaveCount(
    0,
  );
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "This plan is finalized" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop plan" })).toHaveCount(0);
  if (process.env.CAPTURE_ASSETS) {
    await page
      .getByRole("heading", { name: "Tracked assets" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/legacykeeper-inheritance-assets.png",
    });
  }
});

test("offers a bounded approval when an inherited token is not pullable", async ({
  page,
}) => {
  await installWallet(page);
  const state: MockChainState = {
    planCreated: true,
    heartbeatAt: BigInt(Math.floor(Date.now() / 1_000) - 172_800),
    inheritanceExecuted: true,
    trackedTokens: [TOKEN],
    tokenDistributed: false,
    pullableAmount: 0n,
  };
  await mockApplicationNetwork(page, state);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();

  await expect(
    page.getByRole("button", { name: "Approve current balance" }),
  ).toBeVisible();
  await expect(page.getByText("Allowance needed")).toBeVisible();
});

async function completeOnboarding(page: Page): Promise<void> {
  const heights: number[] = [];
  await connectAndOpenOnboarding(page);
  heights.push(await modalHeight(page));
  await completeTimingStep(page);
  heights.push(await modalHeight(page));
  await completeBeneficiaryStep(page);
  heights.push(await modalHeight(page));
  await completeRecoveryStep(page);
  heights.push(await modalHeight(page));
  await page.getByRole("button", { name: "Continue" }).click();
  await expectExactHeading(page, "Review & sign");
  heights.push(await modalHeight(page));
  await expectModalGeometry(page, heights);
  await page.getByRole("button", { name: "Sign and create plan" }).click();
  await expect(
    page.getByText("PlanCreated event", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open verified dashboard" }).click();
  await expect(page.getByText("● Plan loaded")).toBeVisible();
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Manage Telegram notifications" }),
  ).toHaveAttribute("href", "/settings#telegram-notifications");
}

async function verifyConnectedReloadHasNoDisconnectedFlash(
  page: Page,
): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__legacyKeeperSawDisconnectedGate", {
      configurable: true,
      writable: true,
      value: false,
    });
    const observer = new MutationObserver(() => {
      if (document.querySelector(".access-gate")) {
        window.__legacyKeeperSawDisconnectedGate = true;
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });

  await page.reload();
  await expect(
    page.getByRole("button", { name: /Wallet account/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__legacyKeeperSawDisconnectedGate),
  ).toBe(false);
}

async function verifyIndependentPageScroll(page: Page): Promise<void> {
  const result = await page.locator(".app-shell").evaluate(async (shell) => {
    const main = shell.querySelector<HTMLElement>(".main");
    const sidebar = shell.querySelector<HTMLElement>(".sidebar");
    if (!main || !sidebar) throw new Error("Application layout is incomplete");
    const spacer = document.createElement("div");
    spacer.style.height = "1600px";
    main.append(spacer);
    const before = sidebar.getBoundingClientRect().top;
    main.scrollTop = 400;
    await new Promise(requestAnimationFrame);
    const measurement = {
      mainScroll: main.scrollTop,
      sidebarShift: sidebar.getBoundingClientRect().top - before,
      windowScroll: window.scrollY,
    };
    spacer.remove();
    main.scrollTop = 0;
    return measurement;
  });

  expect(result.mainScroll).toBeGreaterThan(0);
  expect(result.sidebarShift).toBe(0);
  expect(result.windowScroll).toBe(0);
}

async function connectAndOpenOnboarding(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectExactHeading(page, "Welcome");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function completeTimingStep(page: Page): Promise<void> {
  await expectExactHeading(page, "Timing");
  await expect(page.getByLabel("Check-in interval")).toHaveCount(0);
  await page.getByRole("button", { name: /Advanced timing/ }).click();
  await expect(page.getByLabel("Inactivity hours")).toHaveValue("");
  await page.getByLabel("Inactivity days").fill("");
  await page.getByLabel("Inactivity minutes").fill("10");
  await page.getByLabel("Grace period days").fill("");
  await page.getByLabel("Grace period minutes").fill("5");
  await expect(
    page.getByText("15 minutes after the last check-in", { exact: false }),
  ).toBeVisible();
  if (process.env.CAPTURE_TIMING) {
    await page.screenshot({
      path: "/tmp/legacykeeper-advanced-timing.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: /Advanced timing/ }).click();
  await page.getByRole("button", { name: "60 days" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function completeBeneficiaryStep(page: Page): Promise<void> {
  await page.getByRole("button", { name: "+ Add beneficiary" }).click();
  await page.getByLabel("Beneficiary 1 address").fill(BENEFICIARY);
  await page.getByLabel("Share %").fill("100");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function completeRecoveryStep(page: Page): Promise<void> {
  await page.getByLabel("Recovery signer address").fill(RECOVERY);
  await page.getByLabel("Safe vault address").fill(VAULT);
  await page.getByRole("button", { name: "Continue" }).click();
  await expectExactHeading(page, "Assets");
  await expect(page.getByLabel("Search tokens")).toBeVisible();
  await page.getByLabel("Search tokens").fill("chainlink");
  await expect(page.getByRole("button", { name: /LINK/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /USDC/ })).toHaveCount(0);
  await page.getByLabel("Search tokens").fill("");
}

async function verifyRouteNavigation(page: Page): Promise<void> {
  await navigateTo(page, "Beneficiaries", /\/beneficiaries$/);
  await expect(page.getByLabel("Beneficiary 1")).toHaveText("1");
  await expect(
    page.getByRole("heading", { name: "Beneficiaries", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Allocation", { exact: true })).toBeVisible();
  await expect(
    page.getByText("1 of 10 addresses", { exact: true }),
  ).toBeVisible();
  await navigateTo(page, "Activity", /\/activity$/);
  await expect(page.getByText("0 activities", { exact: true })).toBeVisible();
  await navigateTo(page, "Settings", /\/settings$/);
  await expect(
    page.getByRole("heading", { name: "Plan settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Telegram alerts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Telegram", exact: true }),
  ).toBeVisible();
  if (process.env.CAPTURE_SETTINGS) {
    await page
      .getByRole("heading", { name: "Telegram alerts", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/legacykeeper-settings.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Edit Timing settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Timing" });
  await expect(dialog).toBeVisible();
  const height = (await dialog.boundingBox())?.height;
  await expect(page.getByLabel("Grace period (days)")).toHaveValue("7");
  expect((await dialog.boundingBox())?.height).toBe(height);
  await page.getByLabel("Grace period (days)").fill("0");
  await expect(
    dialog.getByText("Zero grace removes the final recovery window", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review & sign timing" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Timing updated successfully" }),
  ).toBeVisible();
  await expect(page.getByText("Telegram notification sent.")).toBeVisible();
  await page.getByRole("button", { name: "Review full plan" }).click();
  const review = page.getByRole("dialog", {
    name: "Review live configuration",
  });
  await expect(review).toBeVisible();
  await expect(
    review.getByText("Required signer", { exact: false }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await navigateTo(page, "Dashboard", /\/dashboard$/);
}

async function navigateTo(
  page: Page,
  name: string,
  destination: RegExp,
): Promise<void> {
  await Promise.all([
    page.waitForURL(destination, { timeout: 15_000 }),
    page.getByRole("link", { name, exact: true }).click(),
  ]);
}

async function verifyCheckIn(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Check in now" }).click();
  await expect(
    page.getByText("Check-in verified. On-chain liveness advanced."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View transaction proof ↗" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check in now" }),
  ).toBeDisabled();
  await expect(page.getByText(/Next check-in available in/)).toBeVisible();
}

async function verifyDisconnect(page: Page): Promise<void> {
  await page
    .getByRole("banner")
    .getByRole("button", { name: /Wallet account/ })
    .click();
  await page.getByRole("menuitem", { name: "Disconnect wallet" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your wallet." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeVisible();
}

async function modalHeight(page: Page): Promise<number> {
  const box = await page.getByRole("dialog").boundingBox();
  if (!box) throw new Error("Onboarding dialog has no visible geometry");
  return box.height;
}

async function expectModalGeometry(
  page: Page,
  heights: readonly number[],
): Promise<void> {
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  const overflow = await page
    .locator(".onboarding-body")
    .evaluate((element) => window.getComputedStyle(element).overflowY);
  expect(overflow).toBe("auto");
}

async function expectExactHeading(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function installWallet(page: Page): Promise<void> {
  await page.addInitScript(
    ({ owner, signature }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const ethereum = {
        isMetaMask: true,
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return [owner];
          }
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "net_version") return "11155111";
          if (method === "wallet_requestPermissions") {
            return [{ parentCapability: "eth_accounts" }];
          }
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_signTypedData_v4") return signature;
          throw new Error(`Unsupported wallet method: ${method}`);
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(listener);
          listeners.set(event, handlers);
        },
        removeListener: (
          event: string,
          listener: (...args: unknown[]) => void,
        ) => {
          listeners.get(event)?.delete(listener);
        },
      };
      Object.defineProperty(window, "ethereum", {
        configurable: true,
        value: ethereum,
      });
    },
    { owner: OWNER, signature: SIGNATURE },
  );
}

async function mockApplicationNetwork(
  page: Page,
  state: MockChainState,
): Promise<void> {
  await page.route("**/api/plans", async (route) => {
    state.planCreated = true;
    await route.fulfill({ json: verifiedPlanEvidence() });
  });
  await page.route("**/api/heartbeat", async (route) => {
    state.heartbeatAt = BigInt(Math.floor(Date.now() / 1_000));
    await route.fulfill({ json: verifiedHeartbeatEvidence(state.heartbeatAt) });
  });
  await page.route("**/api/configuration", async (route) => {
    await route.fulfill({ json: verifiedConfigurationEvidence() });
  });
  await page.route("**/api/audit**", async (route) => {
    await route.fulfill({
      json: { entries: [], page: 1, pageSize: 5, total: 0, totalPages: 1 },
    });
  });
  await page.route("**/api/telegram/links**", async (route) => {
    await route.fulfill({
      status: 401,
      json: { message: "Wallet session required." },
    });
  });
  await page.route("https://11155111.rpc.thirdweb.com/**", (route) =>
    fulfillRpc(route, state),
  );
}

async function fulfillRpc(route: Route, state: MockChainState): Promise<void> {
  const request = route.request().postDataJSON() as RpcRequest | RpcRequest[];
  const response = Array.isArray(request)
    ? request.map((item) => rpcResponse(item, state))
    : rpcResponse(request, state);
  await route.fulfill({ json: response });
}

interface RpcRequest {
  id: number;
  method: string;
  params?: unknown[];
}

function rpcResponse(request: RpcRequest, state: MockChainState) {
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: rpcResult(request, state),
  };
}

function rpcResult(request: RpcRequest, state: MockChainState): unknown {
  if (request.method === "eth_chainId") return "0xaa36a7";
  if (request.method === "eth_blockNumber") return "0x100";
  if (request.method === "eth_getCode") return "0x60006000";
  if (request.method === "eth_getBalance") return "0x0";
  if (request.method !== "eth_call") return "0x0";
  const call = request.params?.[0] as { data?: Hex } | undefined;
  if (!call?.data) return "0x";
  if (call.data.startsWith("0x94a78483")) return planOfResult(state);
  return multicallResult(call.data, state);
}

function multicallResult(data: Hex, state: MockChainState): Hex {
  const decoded = decodeFunctionData({ abi: MULTICALL_ABI, data });
  const calls = decoded.args[0];
  const result = calls.map(({ target, callData }) => ({
    success: true,
    returnData: contractReadResult(target, callData, state),
  }));
  return encodeFunctionResult({
    abi: MULTICALL_ABI,
    functionName: "aggregate3",
    result,
  });
}

function contractReadResult(
  target: Address,
  data: Hex,
  state: MockChainState,
): Hex {
  if (data.startsWith("0x94a78483")) return planOfResult(state);
  if (data.startsWith("0x4d2301cc")) {
    return encodeFunctionResult({
      abi: MULTICALL_BALANCE_ABI,
      functionName: "getEthBalance",
      result: 0n,
    });
  }
  if (target.toLowerCase() === TOKEN.toLowerCase())
    return tokenReadResult(data);
  return keeperReadResult(data, state);
}

function planOfResult(state: MockChainState): Hex {
  return encodeFunctionResult({
    abi: legacyKeeperFactoryAbi,
    functionName: "planOf",
    result: state.planCreated ? PLAN : zeroAddress,
  });
}

function keeperReadResult(data: Hex, state: MockChainState): Hex {
  const decoded = decodeFunctionData({ abi: legacyKeeperAbi, data });
  switch (decoded.functionName) {
    case "owner":
      return encodeKeeperResult("owner", OWNER);
    case "getLivenessStatus":
      return encodeKeeperResult("getLivenessStatus", [
        state.heartbeatAt,
        30n,
        true,
        false,
      ]);
    case "getTimeoutStatus":
      return encodeKeeperResult("getTimeoutStatus", [false, false]);
    case "liveness":
      return encodeKeeperResult("liveness", [
        86_400n,
        5_184_000n,
        604_800n,
        state.heartbeatAt,
        true,
      ]);
    case "vault":
      return encodeKeeperResult("vault", [VAULT, RECOVERY, true, false]);
    case "getBeneficiaries":
      return encodeKeeperResult("getBeneficiaries", [
        { wallet: BENEFICIARY, shareBps: 10_000 },
      ]);
    case "totalShareBps":
      return encodeKeeperResult("totalShareBps", 10_000);
    case "inheritanceExecuted":
      return encodeKeeperResult(
        "inheritanceExecuted",
        Boolean(state.inheritanceExecuted),
      );
    case "inheritanceTimestamp":
      return encodeKeeperResult(
        "inheritanceTimestamp",
        state.inheritanceTimestamp ?? 0n,
      );
    case "evacuationExecuted":
      return encodeKeeperResult("evacuationExecuted", false);
    case "getTrackedTokens":
      return encodeKeeperResult("getTrackedTokens", state.trackedTokens ?? []);
    case "pullableAmount":
      return encodeKeeperResult(
        "pullableAmount",
        state.pullableAmount ?? 1_000_000n,
      );
    case "tokenDistributed":
      return encodeKeeperResult(
        "tokenDistributed",
        Boolean(state.tokenDistributed),
      );
    default:
      throw new Error(`Unsupported keeper read: ${decoded.functionName}`);
  }
}

function tokenReadResult(data: Hex): Hex {
  const decoded = decodeFunctionData({ abi: erc20Abi, data });
  if (decoded.functionName === "symbol") {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: "symbol",
      result: "USDC",
    });
  }
  if (decoded.functionName === "decimals") {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: "decimals",
      result: 6,
    });
  }
  if (decoded.functionName === "balanceOf") {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: "balanceOf",
      result: 2_500_000n,
    });
  }
  throw new Error(`Unsupported token read: ${decoded.functionName}`);
}

function encodeKeeperResult(functionName: string, result: unknown): Hex {
  return encodeFunctionResult({
    abi: legacyKeeperAbi,
    functionName: functionName as never,
    result: result as never,
  });
}

function verifiedPlanEvidence() {
  return {
    stage: "verified",
    executionId: "keeperhub-plan-execution",
    txHash: TX_HASH,
    sponsored: true,
    receiptStatus: "success",
    event: "PlanCreated",
    owner: OWNER,
    plan: PLAN,
    initialized: true,
    routeConfidence: "unavailable",
  };
}

function verifiedHeartbeatEvidence(lastHeartbeat: bigint) {
  return {
    stage: "verified",
    executionId: "keeperhub-heartbeat-execution",
    txHash: TX_HASH,
    sponsored: true,
    receiptStatus: "success",
    event: "HeartbeatRecorded",
    plan: PLAN,
    lastHeartbeat: lastHeartbeat.toString(),
    routeConfidence: "unavailable",
  };
}

function verifiedConfigurationEvidence() {
  return {
    stage: "verified",
    action: "liveness",
    executionId: "keeperhub-configuration-execution",
    idempotencyKey: "configuration-attempt-1",
    txHash: TX_HASH,
    sponsored: true,
    receiptStatus: "success",
    event: "ConfigUpdated",
    plan: PLAN,
    notification: "sent",
  };
}
