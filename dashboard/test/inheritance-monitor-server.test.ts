import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

const FACTORY = "0x00000000000000000000000000000000000000f1" as Address;

interface EventRequest {
  fromBlock: bigint;
  toBlock: bigint | "latest";
}

const mocks = vi.hoisted(() => ({
  client: {
    getBlockNumber: vi.fn(async () => 122n),
    getContractEvents: vi.fn(async (_request: EventRequest) => []),
  },
  logsClient: {
    getBlockNumber: vi.fn(async () => 122n),
    getContractEvents: vi.fn(async (_request: EventRequest) => []),
  },
  keeperHub: {
    connect: vi.fn(async () => undefined),
  },
  createSepoliaLogsClient: vi.fn(),
  logBlockRange: "10",
}));

vi.mock("../lib/route-server", () => ({
  createKeeperHubClient: vi.fn(() => mocks.keeperHub),
  createSepoliaClient: vi.fn(() => mocks.client),
  createSepoliaLogsClient: mocks.createSepoliaLogsClient,
  readRegisteredPlanAcrossFactories: vi.fn(),
  requiredEnv: vi.fn((name: string) => {
    if (name === "SEPOLIA_LOGS_BLOCK_RANGE") return mocks.logBlockRange;
    return name.includes("DEPLOYMENT_BLOCK") ? "100" : "test-api-key";
  }),
  requiredFactories: vi.fn(() => [FACTORY]),
}));

import { createInheritanceMonitorDependencies } from "../lib/inheritance-monitor-server";

describe("inheritance monitor server dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSepoliaLogsClient.mockReturnValue(mocks.logsClient);
    mocks.logBlockRange = "10";
  });

  it("uses the dedicated batched client for historical event discovery", async () => {
    const dependencies = await createInheritanceMonitorDependencies();

    await dependencies.listRegisteredPlans();

    expect(mocks.createSepoliaLogsClient).toHaveBeenCalledOnce();
    expect(mocks.logsClient.getContractEvents).toHaveBeenCalled();
    expect(mocks.client.getContractEvents).not.toHaveBeenCalled();
  });

  it("uses the configured inclusive block range for historical logs", async () => {
    mocks.logBlockRange = "50000";
    mocks.logsClient.getBlockNumber.mockResolvedValueOnce(50_102n);
    const dependencies = await createInheritanceMonitorDependencies();

    await dependencies.listRegisteredPlans();

    expect(
      mocks.logsClient.getContractEvents.mock.calls.map(([request]) => [
        request.fromBlock,
        request.toBlock,
      ]),
    ).toEqual([
      [100n, 50_099n],
      [50_100n, 50_102n],
    ]);
  });
});
