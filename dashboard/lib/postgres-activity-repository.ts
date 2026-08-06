import { count, desc, eq, sql } from "drizzle-orm";
import type { TelegramDatabase } from "../db/client";
import {
  activityAttemptCounters,
  activityEntries,
  type ActivityEntryRow,
} from "../db/schema";
import type {
  ActivityPage,
  ActivityRepository,
  ActivityWriteEntry,
} from "./activity-ledger";

export function createPostgresActivityRepository(
  database: TelegramDatabase,
): ActivityRepository {
  return {
    async append(entry) {
      await database.transaction(async (transaction) => {
        if (entry.id) {
          const existing = await transaction
            .select({ id: activityEntries.id })
            .from(activityEntries)
            .where(eq(activityEntries.id, entry.id))
            .limit(1);
          if (existing.length > 0) return;
        }

        const counters = await transaction
          .insert(activityAttemptCounters)
          .values({
            executionKey: entry.executionKey,
            attemptCount: 1,
            updatedAt: entry.timestamp,
          })
          .onConflictDoUpdate({
            target: activityAttemptCounters.executionKey,
            set: {
              attemptCount: sql`${activityAttemptCounters.attemptCount} + 1`,
              updatedAt: entry.timestamp,
            },
          })
          .returning({ attempt: activityAttemptCounters.attemptCount });
        const attempt = counters[0]?.attempt;
        if (!attempt) throw new Error("Unable to allocate activity attempt.");

        await transaction.insert(activityEntries).values(toRow(entry, attempt));
      });
    },

    async listByOwner(owner, requestedPage, requestedPageSize = 5) {
      const normalizedOwner = owner.toLowerCase();
      const pageSize = positiveInteger(requestedPageSize, 5);
      const totals = await database
        .select({ value: count() })
        .from(activityEntries)
        .where(eq(activityEntries.owner, normalizedOwner));
      const total = totals[0]?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(totalPages, positiveInteger(requestedPage, 1));
      const rows = await database
        .select()
        .from(activityEntries)
        .where(eq(activityEntries.owner, normalizedOwner))
        .orderBy(desc(activityEntries.occurredAt), desc(activityEntries.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        entries: rows.map(toActivityEntry),
        page,
        pageSize,
        total,
        totalPages,
      };
    },
  };
}

function toRow(entry: ActivityWriteEntry, attempt: number) {
  return {
    id: entry.id ?? crypto.randomUUID(),
    executionKey: entry.executionKey,
    owner: entry.owner.toLowerCase(),
    attempt,
    occurredAt: entry.timestamp,
    triggerType: entry.trigger.type,
    triggerSource: entry.trigger.source,
    triggerDetail: entry.trigger.detail,
    action: entry.action,
    keeperhubExecutionId: entry.keeperhubExecutionId,
    transactionHash: entry.txHash,
    gasUsed: entry.gasUsed,
    outcome: entry.outcome,
    error: entry.error,
    errorCode: entry.errorCode,
  };
}

function toActivityEntry(row: ActivityEntryRow) {
  return {
    executionKey: row.executionKey,
    owner: row.owner,
    attempt: row.attempt,
    timestamp: row.occurredAt.toISOString(),
    trigger: {
      type: row.triggerType,
      source: row.triggerSource,
      ...(row.triggerDetail ? { detail: row.triggerDetail } : {}),
    },
    action: row.action,
    ...(row.keeperhubExecutionId
      ? { keeperhubExecutionId: row.keeperhubExecutionId }
      : {}),
    ...(row.transactionHash ? { txHash: row.transactionHash } : {}),
    ...(row.gasUsed ? { gasUsed: row.gasUsed } : {}),
    outcome: row.outcome,
    ...(row.error ? { error: row.error } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
