import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  telegramAccounts,
  telegramDeliveries,
  telegramLinkSessions,
  telegramWalletLinks,
} from "../db/schema";

describe("Telegram PostgreSQL migration", () => {
  it("creates the four production tables and active-link constraints", async () => {
    const database = new PGlite();
    const migration = await readFile(
      new URL("../db/migrations/0001_telegram_identity.sql", import.meta.url),
      "utf8",
    );
    await database.exec(migration);

    const tables = await database.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "telegram_accounts",
        "telegram_deliveries",
        "telegram_link_sessions",
        "telegram_wallet_links",
      ]),
    );

    expect(telegramAccounts).toBeDefined();
    expect(telegramWalletLinks).toBeDefined();
    expect(telegramLinkSessions).toBeDefined();
    expect(telegramDeliveries).toBeDefined();
    await database.close();
  });

  it("adds durable wallet activity tables and query indexes", async () => {
    const migration = await readFile(
      new URL("../db/migrations/0002_activity_ledger.sql", import.meta.url),
      "utf8",
    ).catch(() => "");

    expect(migration).toContain('CREATE TABLE "activity_attempt_counters"');
    expect(migration).toContain('CREATE TABLE "activity_entries"');
    expect(migration).toContain('"owner" text NOT NULL');
    expect(migration).toContain("activity_entries_owner_time_idx");
    expect(migration).toContain("activity_entries_execution_attempt_unique");
  });
});
