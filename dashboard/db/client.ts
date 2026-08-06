import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

let sqlClient: Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

export type TelegramDatabase = PostgresJsDatabase<typeof schema>;

export function getTelegramDatabase(): TelegramDatabase {
  if (database) return database;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured on the server.");
  }
  sqlClient = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  database = drizzle(sqlClient, { schema });
  return database;
}

export async function closeTelegramDatabase(): Promise<void> {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = undefined;
  database = undefined;
}
