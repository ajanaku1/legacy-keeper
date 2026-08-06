import type { Address } from "viem";

export type TelegramSessionState =
  "pending" | "detected" | "consumed" | "expired" | "cancelled";

export interface TelegramAccountRecord {
  telegramUserId: string;
  privateChatId: string;
  username?: string;
  firstName?: string;
  updatedAt: Date;
}

export interface TelegramLinkSessionRecord {
  id: string;
  botTokenHash: string;
  browserTokenHash: string;
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
  expiresAt: Date;
  state: TelegramSessionState;
  telegramUserId?: string;
  createdAt: Date;
}

export interface TelegramWalletLinkRecord {
  id: string;
  owner: Address;
  chainId: number;
  telegramUserId: string;
  plan: Address;
  linkedAt: Date;
  revokedAt?: Date;
}

export interface TelegramRecipientRecord {
  link: TelegramWalletLinkRecord;
  privateChatId: string;
}

export type TelegramDeliveryStatus =
  "pending" | "sent" | "failed" | "suppressed";

export interface TelegramDeliveryRecord {
  id: string;
  idempotencyKey: string;
  source: string;
  eventType: string;
  chainId: number;
  owner: Address;
  plan: Address;
  transactionHash?: `0x${string}`;
  telegramUserId?: string;
  privateChatId?: string;
  attemptCount: number;
  status: TelegramDeliveryStatus;
  nextAttemptAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt?: Date;
}

export interface TelegramDeliveryUpdate {
  status: TelegramDeliveryStatus;
  attemptCount: number;
  updatedAt: Date;
  telegramUserId?: string;
  privateChatId?: string;
  nextAttemptAt?: Date;
  lastError?: string;
  deliveredAt?: Date;
}

export interface ActivateTelegramLinkInput {
  sessionId: string;
  telegramUserId: string;
  plan: Address;
  now: Date;
  walletLimit: number;
}

export type ActivateTelegramLinkResult =
  | { status: "linked"; link: TelegramWalletLinkRecord }
  | { status: "already-linked"; link: TelegramWalletLinkRecord }
  | { status: "session-consumed" }
  | { status: "wallet-linked-elsewhere" }
  | { status: "wallet-limit" };

export interface TelegramRepository {
  createLinkSession(session: TelegramLinkSessionRecord): Promise<void>;
  findLinkSessionById(
    id: string,
  ): Promise<TelegramLinkSessionRecord | undefined>;
  findLinkSessionByBotTokenHash(
    tokenHash: string,
  ): Promise<TelegramLinkSessionRecord | undefined>;
  detectTelegramAccount(
    sessionId: string,
    account: TelegramAccountRecord,
  ): Promise<TelegramLinkSessionRecord | undefined>;
  activateLink(
    input: ActivateTelegramLinkInput,
  ): Promise<ActivateTelegramLinkResult>;
  listActiveLinks(telegramUserId: string): Promise<TelegramWalletLinkRecord[]>;
  findActiveLink(
    owner: Address,
    chainId: number,
  ): Promise<TelegramWalletLinkRecord | undefined>;
  findActiveRecipient(
    owner: Address,
    chainId: number,
  ): Promise<TelegramRecipientRecord | undefined>;
  revokeLink(input: {
    owner: Address;
    chainId: number;
    telegramUserId?: string;
    now: Date;
  }): Promise<boolean>;
  reserveDelivery(
    delivery: TelegramDeliveryRecord,
  ): Promise<{ created: boolean; delivery: TelegramDeliveryRecord }>;
  findDelivery(
    idempotencyKey: string,
  ): Promise<TelegramDeliveryRecord | undefined>;
  findLatestSentDelivery(
    owner: Address,
    chainId: number,
  ): Promise<TelegramDeliveryRecord | undefined>;
  updateDelivery(
    idempotencyKey: string,
    update: TelegramDeliveryUpdate,
  ): Promise<TelegramDeliveryRecord>;
}

export function createInMemoryTelegramRepository(): TelegramRepository {
  const sessions = new Map<string, TelegramLinkSessionRecord>();
  const accounts = new Map<string, TelegramAccountRecord>();
  const links: TelegramWalletLinkRecord[] = [];
  const deliveries = new Map<string, TelegramDeliveryRecord>();

  return {
    async createLinkSession(session) {
      sessions.set(session.id, { ...session });
    },
    async findLinkSessionById(id) {
      return copySession(sessions.get(id));
    },
    async findLinkSessionByBotTokenHash(tokenHash) {
      return copySession(
        [...sessions.values()].find(
          (session) => session.botTokenHash === tokenHash,
        ),
      );
    },
    async detectTelegramAccount(sessionId, account) {
      const session = sessions.get(sessionId);
      if (!session || session.state !== "pending") return undefined;
      accounts.set(account.telegramUserId, { ...account });
      const detected: TelegramLinkSessionRecord = {
        ...session,
        state: "detected",
        telegramUserId: account.telegramUserId,
      };
      sessions.set(sessionId, detected);
      return copySession(detected);
    },
    async activateLink(input) {
      const session = sessions.get(input.sessionId);
      if (!session || session.state === "consumed") {
        return { status: "session-consumed" };
      }
      const activeForWallet = links.find(
        (link) =>
          !link.revokedAt &&
          link.owner === session.owner &&
          link.chainId === session.chainId,
      );
      if (activeForWallet?.telegramUserId === input.telegramUserId) {
        sessions.set(session.id, { ...session, state: "consumed" });
        return { status: "already-linked", link: { ...activeForWallet } };
      }
      if (activeForWallet) return { status: "wallet-linked-elsewhere" };
      const activeCount = links.filter(
        (link) =>
          !link.revokedAt && link.telegramUserId === input.telegramUserId,
      ).length;
      if (activeCount >= input.walletLimit) return { status: "wallet-limit" };
      const link: TelegramWalletLinkRecord = {
        id: session.id,
        owner: session.owner,
        chainId: session.chainId,
        telegramUserId: input.telegramUserId,
        plan: input.plan,
        linkedAt: input.now,
      };
      links.push(link);
      sessions.set(session.id, { ...session, state: "consumed" });
      return { status: "linked", link: { ...link } };
    },
    async listActiveLinks(telegramUserId) {
      return links
        .filter(
          (link) => !link.revokedAt && link.telegramUserId === telegramUserId,
        )
        .map((link) => ({ ...link }));
    },
    async findActiveLink(owner, chainId) {
      const link = links.find(
        (item) =>
          !item.revokedAt && item.owner === owner && item.chainId === chainId,
      );
      return link ? { ...link } : undefined;
    },
    async findActiveRecipient(owner, chainId) {
      const link = links.find(
        (item) =>
          !item.revokedAt && item.owner === owner && item.chainId === chainId,
      );
      if (!link) return undefined;
      const account = accounts.get(link.telegramUserId);
      if (!account) return undefined;
      return { link: { ...link }, privateChatId: account.privateChatId };
    },
    async revokeLink(input) {
      const link = links.find(
        (item) =>
          !item.revokedAt &&
          item.owner === input.owner &&
          item.chainId === input.chainId &&
          (!input.telegramUserId ||
            item.telegramUserId === input.telegramUserId),
      );
      if (!link) return false;
      link.revokedAt = input.now;
      return true;
    },
    async reserveDelivery(delivery) {
      const existing = deliveries.get(delivery.idempotencyKey);
      if (existing) return { created: false, delivery: { ...existing } };
      deliveries.set(delivery.idempotencyKey, { ...delivery });
      return { created: true, delivery: { ...delivery } };
    },
    async findDelivery(idempotencyKey) {
      const delivery = deliveries.get(idempotencyKey);
      return delivery ? { ...delivery } : undefined;
    },
    async findLatestSentDelivery(owner, chainId) {
      const sent = [...deliveries.values()]
        .filter(
          (delivery) =>
            delivery.owner === owner &&
            delivery.chainId === chainId &&
            delivery.status === "sent",
        )
        .sort(
          (left, right) =>
            (right.deliveredAt?.getTime() ?? 0) -
            (left.deliveredAt?.getTime() ?? 0),
        );
      return sent[0] ? { ...sent[0] } : undefined;
    },
    async updateDelivery(idempotencyKey, update) {
      const delivery = deliveries.get(idempotencyKey);
      if (!delivery) throw new Error("Telegram delivery does not exist.");
      const updated = { ...delivery, ...update };
      deliveries.set(idempotencyKey, updated);
      return { ...updated };
    },
  };
}

function copySession(
  session?: TelegramLinkSessionRecord,
): TelegramLinkSessionRecord | undefined {
  return session ? { ...session } : undefined;
}
