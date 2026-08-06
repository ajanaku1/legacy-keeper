import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import type { TelegramDatabase } from "../db/client";
import type { ActivityWriteEntry } from "../lib/activity-ledger";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";

describe("PostgreSQL activity repository", () => {
  it("atomically numbers attempts and returns five newest wallet entries", async () => {
    const module = await import(
      "../lib/postgres-activity-repository"
    ).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;

    const client = new PGlite();
    await client.exec(await migration("0001_telegram_identity.sql"));
    await client.exec(await migration("0002_activity_ledger.sql"));
    const database = drizzle(client, { schema });
    const repository = module.createPostgresActivityRepository(
      database as unknown as TelegramDatabase,
    );

    await repository.append(entry(OWNER_A, "shared", 1));
    await repository.append(entry(OWNER_A, "shared", 2));
    for (let day = 3; day <= 7; day += 1) {
      await repository.append(entry(OWNER_A, `event-${day}`, day));
    }
    await repository.append(entry(OWNER_B, "other-wallet", 8));

    const firstPage = await repository.listByOwner(OWNER_A, 1, 5);
    const secondPage = await repository.listByOwner(OWNER_A, 2, 5);

    expect(firstPage).toMatchObject({ page: 1, pageSize: 5, total: 7, totalPages: 2 });
    expect(firstPage.entries.map((item) => item.executionKey)).toEqual([
      `heartbeatBySig:${OWNER_A}:event-7`,
      `heartbeatBySig:${OWNER_A}:event-6`,
      `heartbeatBySig:${OWNER_A}:event-5`,
      `heartbeatBySig:${OWNER_A}:event-4`,
      `heartbeatBySig:${OWNER_A}:event-3`,
    ]);
    expect(secondPage.entries.map((item) => item.attempt)).toEqual([2, 1]);
    expect(JSON.stringify(firstPage)).not.toContain(OWNER_B);
    await client.close();
  });
});

function entry(owner: string, nonce: string, day: number): ActivityWriteEntry {
  return {
    executionKey: `heartbeatBySig:${owner}:${nonce}`,
    owner,
    timestamp: new Date(Date.UTC(2026, 7, day)),
    trigger: { type: "webhook", source: "dashboard" },
    action: "heartbeatBySig",
    outcome: "success",
    txHash: `0x${String(day).padStart(64, "0")}`,
  };
}

async function migration(name: string): Promise<string> {
  return readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
}
