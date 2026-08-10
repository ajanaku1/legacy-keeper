import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import {
  parseDirectKeeperHubExecution,
  submitDirectInheritance,
  type KeeperHubToolClient,
} from "../lib/keeperhub-server";

const PLAN = "0x00000000000000000000000000000000000000a2" as Address;
const TX_HASH = `0x${"2".repeat(64)}` as Hex;

describe("KeeperHub direct inheritance execution", () => {
  it("submits the child contract ABI and caller-supplied idempotency key", async () => {
    const callTool = vi.fn(async () =>
      JSON.stringify({ execution_id: "kh-1" }),
    );
    const client: KeeperHubToolClient = { callTool };

    await expect(
      submitDirectInheritance(client, PLAN, "plan:heartbeat:run"),
    ).resolves.toEqual({ executionId: "kh-1" });

    expect(callTool).toHaveBeenCalledWith("execute_contract_call", {
      contract_address: PLAN,
      chain_id: "11155111",
      function_name: "executeInheritance",
      function_args: "[]",
      idempotency_key: "plan:heartbeat:run",
      abi: JSON.stringify([
        {
          name: "executeInheritance",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [],
          outputs: [],
        },
      ]),
    });
  });

  it("requires explicit success and extracts direct execution evidence", () => {
    expect(
      parseDirectKeeperHubExecution({
        status: "completed",
        result: {
          success: true,
          transactionHash: TX_HASH,
          sponsored: true,
        },
      }),
    ).toEqual({ status: "completed", txHash: TX_HASH, sponsored: true });
  });

  it("fails closed when completed has no explicit success signal", () => {
    expect(() =>
      parseDirectKeeperHubExecution({ status: "completed", txHash: TX_HASH }),
    ).toThrow(/explicit success/i);
  });
});
