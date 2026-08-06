import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { TelegramDatabase } from "../db/client";
import {
  telegramAccounts,
  telegramDeliveries,
  telegramLinkSessions,
  telegramWalletLinks,
  type TelegramLinkSessionRow,
  type TelegramDeliveryRow,
  type TelegramWalletLinkRow,
} from "../db/schema";
import type {
  ActivateTelegramLinkInput,
  ActivateTelegramLinkResult,
  TelegramAccountRecord,
  TelegramDeliveryRecord,
  TelegramDeliveryUpdate,
  TelegramLinkSessionRecord,
  TelegramRepository,
  TelegramWalletLinkRecord,
} from "./telegram-repository";

export function createPostgresTelegramRepository(
  database: TelegramDatabase,
): TelegramRepository {
  return {
    createLinkSession: (session) => createLinkSession(database, session),
    findLinkSessionById: (id) => findSessionById(database, id),
    findLinkSessionByBotTokenHash: (hash) =>
      findSessionByBotHash(database, hash),
    detectTelegramAccount: (sessionId, account) =>
      detectTelegramAccount(database, sessionId, account),
    activateLink: (input) => activateLink(database, input),
    listActiveLinks: (telegramUserId) =>
      listActiveLinks(database, telegramUserId),
    findActiveLink: (owner, chainId) =>
      findActiveLink(database, owner, chainId),
    findActiveRecipient: (owner, chainId) =>
      findActiveRecipient(database, owner, chainId),
    revokeLink: (input) => revokeLink(database, input),
    reserveDelivery: (delivery) => reserveDelivery(database, delivery),
    findDelivery: (idempotencyKey) => findDelivery(database, idempotencyKey),
    findLatestSentDelivery: (owner, chainId) =>
      findLatestSentDelivery(database, owner, chainId),
    updateDelivery: (idempotencyKey, update) =>
      updateDelivery(database, idempotencyKey, update),
  };
}

async function createLinkSession(
  database: TelegramDatabase,
  session: TelegramLinkSessionRecord,
): Promise<void> {
  await database.insert(telegramLinkSessions).values({
    id: session.id,
    botTokenHash: session.botTokenHash,
    browserTokenHash: session.browserTokenHash,
    chainId: session.chainId,
    owner: session.owner,
    nonce: session.nonce,
    deadline: session.deadline,
    state: session.state,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
  });
}

async function findSessionById(
  database: TelegramDatabase,
  id: string,
): Promise<TelegramLinkSessionRecord | undefined> {
  const [row] = await database
    .select()
    .from(telegramLinkSessions)
    .where(eq(telegramLinkSessions.id, id))
    .limit(1);
  return row ? sessionRecord(row) : undefined;
}

async function findSessionByBotHash(
  database: TelegramDatabase,
  botTokenHash: string,
): Promise<TelegramLinkSessionRecord | undefined> {
  const [row] = await database
    .select()
    .from(telegramLinkSessions)
    .where(eq(telegramLinkSessions.botTokenHash, botTokenHash))
    .limit(1);
  return row ? sessionRecord(row) : undefined;
}

async function detectTelegramAccount(
  database: TelegramDatabase,
  sessionId: string,
  account: TelegramAccountRecord,
): Promise<TelegramLinkSessionRecord | undefined> {
  return database.transaction(async (transaction) => {
    await transaction
      .insert(telegramAccounts)
      .values({
        telegramUserId: account.telegramUserId,
        privateChatId: account.privateChatId,
        username: account.username,
        firstName: account.firstName,
        updatedAt: account.updatedAt,
      })
      .onConflictDoUpdate({
        target: telegramAccounts.telegramUserId,
        set: {
          privateChatId: account.privateChatId,
          username: account.username,
          firstName: account.firstName,
          updatedAt: account.updatedAt,
        },
      });
    const [updated] = await transaction
      .update(telegramLinkSessions)
      .set({
        telegramUserId: account.telegramUserId,
        state: "detected",
        updatedAt: account.updatedAt,
      })
      .where(
        and(
          eq(telegramLinkSessions.id, sessionId),
          eq(telegramLinkSessions.state, "pending"),
        ),
      )
      .returning();
    return updated ? sessionRecord(updated) : undefined;
  });
}

async function activateLink(
  database: TelegramDatabase,
  input: ActivateTelegramLinkInput,
): Promise<ActivateTelegramLinkResult> {
  try {
    return await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select telegram_user_id from telegram_accounts where telegram_user_id = ${input.telegramUserId} for update`,
      );
      const [session] = await transaction
        .select()
        .from(telegramLinkSessions)
        .where(eq(telegramLinkSessions.id, input.sessionId))
        .limit(1);
      if (!session || session.state === "consumed") {
        return { status: "session-consumed" };
      }
      const existing = await activeLinkForWallet(
        transaction,
        session.owner as Address,
        session.chainId,
      );
      if (existing?.telegramUserId === input.telegramUserId) {
        await consumeSession(transaction, session.id, input.now);
        return { status: "already-linked", link: walletLinkRecord(existing) };
      }
      if (existing) return { status: "wallet-linked-elsewhere" };
      const [{ value: activeCount }] = await transaction
        .select({ value: count() })
        .from(telegramWalletLinks)
        .where(
          and(
            eq(telegramWalletLinks.telegramUserId, input.telegramUserId),
            isNull(telegramWalletLinks.revokedAt),
          ),
        );
      if (activeCount >= input.walletLimit) return { status: "wallet-limit" };
      const [created] = await transaction
        .insert(telegramWalletLinks)
        .values({
          id: session.id,
          chainId: session.chainId,
          owner: session.owner,
          plan: input.plan,
          telegramUserId: input.telegramUserId,
          linkedAt: input.now,
        })
        .returning();
      await consumeSession(transaction, session.id, input.now);
      return { status: "linked", link: walletLinkRecord(created) };
    });
  } catch (error) {
    if (databaseErrorCode(error) === "23505") {
      return { status: "wallet-linked-elsewhere" };
    }
    throw error;
  }
}

async function listActiveLinks(
  database: TelegramDatabase,
  telegramUserId: string,
): Promise<TelegramWalletLinkRecord[]> {
  const rows = await database
    .select()
    .from(telegramWalletLinks)
    .where(
      and(
        eq(telegramWalletLinks.telegramUserId, telegramUserId),
        isNull(telegramWalletLinks.revokedAt),
      ),
    );
  return rows.map(walletLinkRecord);
}

async function findActiveLink(
  database: TelegramDatabase,
  owner: Address,
  chainId: number,
): Promise<TelegramWalletLinkRecord | undefined> {
  const row = await activeLinkForWallet(database, owner, chainId);
  return row ? walletLinkRecord(row) : undefined;
}

async function revokeLink(
  database: TelegramDatabase,
  input: {
    owner: Address;
    chainId: number;
    telegramUserId?: string;
    now: Date;
  },
): Promise<boolean> {
  const filters = [
    eq(telegramWalletLinks.owner, input.owner),
    eq(telegramWalletLinks.chainId, input.chainId),
    isNull(telegramWalletLinks.revokedAt),
  ];
  if (input.telegramUserId) {
    filters.push(eq(telegramWalletLinks.telegramUserId, input.telegramUserId));
  }
  const rows = await database
    .update(telegramWalletLinks)
    .set({ revokedAt: input.now })
    .where(and(...filters))
    .returning({ id: telegramWalletLinks.id });
  return rows.length === 1;
}

async function findActiveRecipient(
  database: TelegramDatabase,
  owner: Address,
  chainId: number,
) {
  const [row] = await database
    .select({
      link: telegramWalletLinks,
      privateChatId: telegramAccounts.privateChatId,
    })
    .from(telegramWalletLinks)
    .innerJoin(
      telegramAccounts,
      eq(telegramWalletLinks.telegramUserId, telegramAccounts.telegramUserId),
    )
    .where(
      and(
        eq(telegramWalletLinks.owner, owner),
        eq(telegramWalletLinks.chainId, chainId),
        isNull(telegramWalletLinks.revokedAt),
      ),
    )
    .limit(1);
  return row
    ? { link: walletLinkRecord(row.link), privateChatId: row.privateChatId }
    : undefined;
}

async function reserveDelivery(
  database: TelegramDatabase,
  delivery: TelegramDeliveryRecord,
) {
  const [created] = await database
    .insert(telegramDeliveries)
    .values(deliveryValues(delivery))
    .onConflictDoNothing({ target: telegramDeliveries.idempotencyKey })
    .returning();
  if (created) return { created: true, delivery: deliveryRecord(created) };
  const existing = await findDelivery(database, delivery.idempotencyKey);
  if (!existing) throw new Error("Telegram delivery reservation failed.");
  return { created: false, delivery: existing };
}

async function findDelivery(
  database: TelegramDatabase,
  idempotencyKey: string,
): Promise<TelegramDeliveryRecord | undefined> {
  const [row] = await database
    .select()
    .from(telegramDeliveries)
    .where(eq(telegramDeliveries.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ? deliveryRecord(row) : undefined;
}

async function findLatestSentDelivery(
  database: TelegramDatabase,
  owner: Address,
  chainId: number,
): Promise<TelegramDeliveryRecord | undefined> {
  const [row] = await database
    .select()
    .from(telegramDeliveries)
    .where(
      and(
        eq(telegramDeliveries.owner, owner),
        eq(telegramDeliveries.chainId, chainId),
        eq(telegramDeliveries.status, "sent"),
      ),
    )
    .orderBy(desc(telegramDeliveries.deliveredAt))
    .limit(1);
  return row ? deliveryRecord(row) : undefined;
}

async function updateDelivery(
  database: TelegramDatabase,
  idempotencyKey: string,
  update: TelegramDeliveryUpdate,
): Promise<TelegramDeliveryRecord> {
  const [row] = await database
    .update(telegramDeliveries)
    .set(update)
    .where(eq(telegramDeliveries.idempotencyKey, idempotencyKey))
    .returning();
  if (!row) throw new Error("Telegram delivery does not exist.");
  return deliveryRecord(row);
}

type DatabaseExecutor = Pick<TelegramDatabase, "select" | "update">;

async function activeLinkForWallet(
  database: DatabaseExecutor,
  owner: Address,
  chainId: number,
): Promise<TelegramWalletLinkRow | undefined> {
  const [row] = await database
    .select()
    .from(telegramWalletLinks)
    .where(
      and(
        eq(telegramWalletLinks.owner, owner),
        eq(telegramWalletLinks.chainId, chainId),
        isNull(telegramWalletLinks.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

async function consumeSession(
  database: DatabaseExecutor,
  sessionId: string,
  now: Date,
): Promise<void> {
  await database
    .update(telegramLinkSessions)
    .set({ state: "consumed", consumedAt: now, updatedAt: now })
    .where(eq(telegramLinkSessions.id, sessionId));
}

function sessionRecord(row: TelegramLinkSessionRow): TelegramLinkSessionRecord {
  return {
    id: row.id,
    botTokenHash: row.botTokenHash,
    browserTokenHash: row.browserTokenHash,
    owner: row.owner as Address,
    chainId: row.chainId,
    nonce: row.nonce,
    deadline: row.deadline,
    expiresAt: row.expiresAt,
    state: row.state as TelegramLinkSessionRecord["state"],
    ...(row.telegramUserId ? { telegramUserId: row.telegramUserId } : {}),
    createdAt: row.createdAt,
  };
}

function walletLinkRecord(
  row: TelegramWalletLinkRow,
): TelegramWalletLinkRecord {
  return {
    id: row.id,
    owner: row.owner as Address,
    chainId: row.chainId,
    telegramUserId: row.telegramUserId,
    plan: row.plan as Address,
    linkedAt: row.linkedAt,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
}

function deliveryValues(delivery: TelegramDeliveryRecord) {
  return {
    id: delivery.id,
    idempotencyKey: delivery.idempotencyKey,
    source: delivery.source,
    eventType: delivery.eventType,
    chainId: delivery.chainId,
    owner: delivery.owner,
    plan: delivery.plan,
    transactionHash: delivery.transactionHash,
    telegramUserId: delivery.telegramUserId,
    privateChatId: delivery.privateChatId,
    attemptCount: delivery.attemptCount,
    status: delivery.status,
    nextAttemptAt: delivery.nextAttemptAt,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    deliveredAt: delivery.deliveredAt,
  };
}

function deliveryRecord(row: TelegramDeliveryRow): TelegramDeliveryRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    source: row.source,
    eventType: row.eventType,
    chainId: row.chainId,
    owner: row.owner as Address,
    plan: row.plan as Address,
    ...(row.transactionHash
      ? { transactionHash: row.transactionHash as `0x${string}` }
      : {}),
    ...(row.telegramUserId ? { telegramUserId: row.telegramUserId } : {}),
    ...(row.privateChatId ? { privateChatId: row.privateChatId } : {}),
    attemptCount: row.attemptCount,
    status: row.status as TelegramDeliveryRecord["status"],
    ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.deliveredAt ? { deliveredAt: row.deliveredAt } : {}),
  };
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}
