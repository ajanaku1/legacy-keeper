import { describe, expect, it } from "vitest";
import {
  filterEntriesForOwner,
  paginateActivityEntries,
  parseAuditLedger,
  toPublicActivityEntries,
} from "../lib/activity-ledger";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";

describe("wallet-scoped activity", () => {
  it("returns only entries belonging to the requested wallet", () => {
    const entries = parseAuditLedger(
      [
        JSON.stringify({
          executionKey: `heartbeatBySig:${OWNER_A}:1`,
          owner: OWNER_A,
        }),
        JSON.stringify({
          executionKey: `createPlan:${OWNER_B}:2`,
          owner: OWNER_B,
        }),
        JSON.stringify({ executionKey: `configurePlan:${OWNER_A}:3` }),
      ].join("\n"),
    );

    expect(filterEntriesForOwner(entries, OWNER_A)).toHaveLength(2);
    expect(filterEntriesForOwner(entries, OWNER_B)).toHaveLength(1);
  });

  it("drops malformed and ownerless entries instead of leaking them", () => {
    const entries = parseAuditLedger(
      [
        "{bad json",
        JSON.stringify({ action: "heartbeatBySig" }),
        JSON.stringify({ executionKey: "heartbeatBySig:unknown-owner:1" }),
      ].join("\n"),
    );

    expect(filterEntriesForOwner(entries, OWNER_A)).toEqual([]);
  });

  it("redacts server errors while retaining public KeeperHub evidence", () => {
    const entries = parseAuditLedger(
      JSON.stringify({
        executionKey: `createPlan:${OWNER_A}:4`,
        owner: OWNER_A,
        action: "createPlan",
        outcome: "failed",
        errorCode: "KEEPERHUB_REJECTED",
        error: "KEEPERHUB_API_KEY is not configured on the server.",
        keeperhubExecutionId: "95ivak6zbksfiw8w3yhad",
      }),
    );

    const exposed = JSON.stringify(toPublicActivityEntries(entries));
    expect(exposed).not.toContain("KEEPERHUB_API_KEY");
    expect(exposed).toContain("95ivak6zbksfiw8w3yhad");
    expect(exposed).toContain("KEEPERHUB_REJECTED");
  });

  it("returns five newest wallet activities per page", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      executionKey: `heartbeatBySig:${OWNER_A}:${index}`,
      owner: OWNER_A,
      timestamp: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
    })).reverse();

    const first = paginateActivityEntries(entries, 1);
    const second = paginateActivityEntries(entries, 2);
    const last = paginateActivityEntries(entries, 99);

    expect(first.entries).toHaveLength(5);
    expect(first.entries.map((entry) => entry.executionKey)).toEqual([
      `heartbeatBySig:${OWNER_A}:11`,
      `heartbeatBySig:${OWNER_A}:10`,
      `heartbeatBySig:${OWNER_A}:9`,
      `heartbeatBySig:${OWNER_A}:8`,
      `heartbeatBySig:${OWNER_A}:7`,
    ]);
    expect(second.entries).toHaveLength(5);
    expect(last).toMatchObject({
      page: 3,
      pageSize: 5,
      total: 12,
      totalPages: 3,
    });
    expect(last.entries).toHaveLength(2);
  });
});
