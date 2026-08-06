import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const telegramAccounts = pgTable("telegram_accounts", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  privateChatId: text("private_chat_id").notNull(),
  username: text("username"),
  firstName: text("first_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const telegramWalletLinks = pgTable(
  "telegram_wallet_links",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    owner: text("owner").notNull(),
    plan: text("plan").notNull(),
    telegramUserId: text("telegram_user_id")
      .notNull()
      .references(() => telegramAccounts.telegramUserId),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("telegram_wallet_links_active_wallet_unique")
      .on(table.chainId, table.owner)
      .where(sql`${table.revokedAt} is null`),
    index("telegram_wallet_links_active_account_idx")
      .on(table.telegramUserId)
      .where(sql`${table.revokedAt} is null`),
    check(
      "telegram_wallet_links_owner_lowercase",
      sql`${table.owner} = lower(${table.owner})`,
    ),
  ],
);

export const telegramLinkSessions = pgTable(
  "telegram_link_sessions",
  {
    id: text("id").primaryKey(),
    botTokenHash: text("bot_token_hash").notNull().unique(),
    browserTokenHash: text("browser_token_hash").notNull().unique(),
    chainId: integer("chain_id").notNull(),
    owner: text("owner").notNull(),
    telegramUserId: text("telegram_user_id").references(
      () => telegramAccounts.telegramUserId,
    ),
    nonce: text("nonce").notNull(),
    deadline: text("deadline").notNull(),
    state: text("state").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "telegram_link_sessions_state_check",
      sql`${table.state} in ('pending', 'detected', 'consumed', 'expired', 'cancelled')`,
    ),
    check(
      "telegram_link_sessions_owner_lowercase",
      sql`${table.owner} = lower(${table.owner})`,
    ),
    index("telegram_link_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const telegramDeliveries = pgTable(
  "telegram_deliveries",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    chainId: integer("chain_id").notNull(),
    owner: text("owner").notNull(),
    plan: text("plan").notNull(),
    transactionHash: text("transaction_hash"),
    telegramUserId: text("telegram_user_id").references(
      () => telegramAccounts.telegramUserId,
    ),
    privateChatId: text("private_chat_id"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    status: text("status").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "telegram_deliveries_status_check",
      sql`${table.status} in ('pending', 'sent', 'failed', 'suppressed')`,
    ),
    check(
      "telegram_deliveries_attempt_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    index("telegram_deliveries_retry_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const activityAttemptCounters = pgTable(
  "activity_attempt_counters",
  {
    executionKey: text("execution_key").primaryKey(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "activity_attempt_counters_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const activityEntries = pgTable(
  "activity_entries",
  {
    id: text("id").primaryKey(),
    executionKey: text("execution_key")
      .notNull()
      .references(() => activityAttemptCounters.executionKey, {
        onDelete: "cascade",
      }),
    owner: text("owner").notNull(),
    attempt: integer("attempt").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    triggerType: text("trigger_type").notNull(),
    triggerSource: text("trigger_source").notNull(),
    triggerDetail: text("trigger_detail"),
    action: text("action").notNull(),
    keeperhubExecutionId: text("keeperhub_execution_id"),
    transactionHash: text("transaction_hash"),
    gasUsed: text("gas_used"),
    outcome: text("outcome").notNull(),
    error: text("error"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("activity_entries_execution_attempt_unique").on(
      table.executionKey,
      table.attempt,
    ),
    index("activity_entries_owner_time_idx").on(
      table.owner,
      table.occurredAt,
    ),
    check(
      "activity_entries_owner_lowercase",
      sql`${table.owner} = lower(${table.owner})`,
    ),
    check("activity_entries_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "activity_entries_outcome_check",
      sql`${table.outcome} in ('success', 'failed')`,
    ),
  ],
);

export type TelegramAccountRow = typeof telegramAccounts.$inferSelect;
export type TelegramWalletLinkRow = typeof telegramWalletLinks.$inferSelect;
export type TelegramLinkSessionRow = typeof telegramLinkSessions.$inferSelect;
export type TelegramDeliveryRow = typeof telegramDeliveries.$inferSelect;
export type ActivityEntryRow = typeof activityEntries.$inferSelect;
