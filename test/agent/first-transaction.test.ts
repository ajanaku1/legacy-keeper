import { existsSync, readFileSync } from "node:fs";
import { Interface, Wallet, zeroPadValue } from "ethers";
import { describe, expect, it } from "vitest";
import {
  buildCreatePlanToolArguments,
  runFirstTransaction,
  numericNonce,
  optionalOverride,
  verifyPlanCreation,
} from "../../starter/first-transaction";

const FACTORY = "0xf434788C775a36736CF3Ce0D2e0368E22BF9c576";
const BENEFICIARY = "0x1111111111111111111111111111111111111111";
const RECOVERY = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";

describe("KeeperHub first-transaction quickstart", () => {
  it("is exposed as a repository command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["first-tx"]).toBe(
      "tsx starter/first-transaction.ts",
    );
    expect(packageJson.scripts?.["first-tx:dry-run"]).toBe(
      "tsx starter/first-transaction.ts --dry-run",
    );
    expect(existsSync("starter/first-transaction.ts")).toBe(true);
  });

  it("exposes a plan-creation request builder", async () => {
    const quickstart = await import("../../starter/first-transaction");

    expect(quickstart).toHaveProperty("buildCreatePlanToolArguments");
    expect(quickstart.buildCreatePlanToolArguments).toBeTypeOf("function");
    expect(quickstart).toHaveProperty("runFirstTransaction");
    expect(quickstart.runFirstTransaction).toBeTypeOf("function");
  });

  it("builds a naturally encoded owner-authorized createPlan call", async () => {
    const owner = new Wallet(`0x${"44".repeat(32)}`);

    const args = await buildCreatePlanToolArguments({
      factoryAddress: FACTORY,
      owner,
      beneficiary: BENEFICIARY,
      recoveryKey: RECOVERY,
      safeVault: VAULT,
      nonce: "42",
      deadline: "2000000000",
    });

    expect(args).toMatchObject({
      contract_address: FACTORY,
      chain_id: 11155111,
      function_name: "createPlan",
      gas_limit_multiplier: 1.2,
    });
    expect(Array.isArray(args.abi)).toBe(true);
    expect(Array.isArray(args.function_args)).toBe(true);

    const functionArgs = args.function_args as unknown[];
    expect(functionArgs.slice(0, 4)).toEqual([
      owner.address,
      {
        heartbeatInterval: 86400,
        timeoutDuration: 2592000,
        gracePeriod: 604800,
        beneficiaryWallets: [BENEFICIARY],
        beneficiaryShares: [10000],
        recoveryKey: RECOVERY,
        safeVault: VAULT,
        trackedTokens: [],
        allowSharedRecovery: false,
      },
      "42",
      "2000000000",
    ]);
    expect(functionArgs[4]).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(args.idempotency_key).toBe(
      `legacykeeper-first-tx:${owner.address}:42`,
    );
  });

  it("converts random hexadecimal identifiers into uint256 decimal nonces", () => {
    expect(numericNonce("181d6d368aca44a8a1616907b6c25b18")).toBe(
      BigInt("0x181d6d368aca44a8a1616907b6c25b18").toString(),
    );
  });

  it("ignores untouched example values when selecting optional overrides", () => {
    expect(
      optionalOverride("https://example.test/your_key_here", "fallback"),
    ).toBe("fallback");
    expect(optionalOverride("", "fallback")).toBe("fallback");
    expect(optionalOverride("https://rpc.example/real-value", "fallback")).toBe(
      "https://rpc.example/real-value",
    );
  });

  it("retains a sanitized live first-transaction benchmark", () => {
    const benchmark = JSON.parse(
      readFileSync("reports/first-transaction-benchmark.json", "utf8"),
    ) as Record<string, unknown>;

    expect(benchmark).toMatchObject({
      proof: "KEEPERHUB_FIRST_TRANSACTION_VERIFIED",
      sponsored: true,
      elapsedMs: 74289,
      transactionHash: `0x2f39e73bb20e3cea728da830708e2a2a9f98e590fb0638307ec5afee8025bbca`,
    });
    expect(JSON.stringify(benchmark)).not.toMatch(
      /kh_[a-z0-9]|0x[0-9a-f]{64}\"\s*,?\s*\"private|authorization\"\s*:|session.?id/i,
    );
  });

  it("exposes an RPC-only verifier for the retained live benchmark", () => {
    const verifier = readFileSync("verify.sh", "utf8");

    expect(verifier).toContain("live-first-transaction");
    expect(verifier).toContain("verify_live_first_transaction");
  });

  it("submits once and returns independently verified timed evidence", async () => {
    const owner = new Wallet(`0x${"55".repeat(32)}`);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      connect: async () => ({ name: "keeperhub", version: "1.2.0" }),
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "execute_contract_call") {
          return JSON.stringify({ executionId: "execution-1" });
        }
        return JSON.stringify({
          status: "completed",
          result: { success: true, sponsored: true },
          transactionHash: `0x${"ab".repeat(32)}`,
        });
      },
    };
    let now = 1_000;

    const result = await runFirstTransaction({
      client,
      factoryAddress: FACTORY,
      owner,
      beneficiary: BENEFICIARY,
      recoveryKey: RECOVERY,
      safeVault: VAULT,
      nonce: "42",
      deadline: "2000000000",
      now: () => {
        now += 750;
        return now;
      },
      pause: async () => undefined,
      verify: async () => ({
        planAddress: "0x6666666666666666666666666666666666666666",
        blockNumber: 123,
      }),
    });

    expect(calls.map((call) => call.name)).toEqual([
      "execute_contract_call",
      "get_direct_execution_status",
    ]);
    expect(result).toMatchObject({
      proof: "KEEPERHUB_FIRST_TRANSACTION_VERIFIED",
      keeperHubExecutionId: "execution-1",
      transactionHash: `0x${"ab".repeat(32)}`,
      sponsored: true,
      elapsedMs: 750,
      blockNumber: 123,
    });
  });

  it("verifies the receipt event, factory registry, bytecode, owner, and initialization", async () => {
    const owner = new Wallet(`0x${"77".repeat(32)}`).address;
    const plan = "0x8888888888888888888888888888888888888888";
    const txHash = `0x${"cd".repeat(32)}`;
    const factoryInterface = new Interface([
      "event PlanCreated(address indexed owner,address indexed plan,uint256 indexed nonce)",
      "function planOf(address) view returns (address)",
    ]);
    const planInterface = new Interface([
      "function owner() view returns (address)",
      "function initialized() view returns (bool)",
    ]);
    const encodedEvent = factoryInterface.encodeEventLog(
      factoryInterface.getEvent("PlanCreated")!,
      [owner, plan, 42n],
    );
    const calls: string[] = [];

    const result = await verifyPlanCreation(
      {
        waitForReceipt: async () => ({
          status: 1,
          blockNumber: 123,
          logs: [{ address: FACTORY, ...encodedEvent }],
        }),
        getCode: async (address: string) => {
          expect(address).toBe(plan);
          return "0x6000";
        },
        call: async (address: string, data: string) => {
          calls.push(data);
          if (address === FACTORY) {
            return factoryInterface.encodeFunctionResult("planOf", [plan]);
          }
          if (data === planInterface.encodeFunctionData("owner")) {
            return planInterface.encodeFunctionResult("owner", [owner]);
          }
          return zeroPadValue("0x01", 32);
        },
      },
      FACTORY,
      txHash,
      owner,
    );

    expect(result).toEqual({ planAddress: plan, blockNumber: 123 });
    expect(calls).toHaveLength(3);
  });
});
