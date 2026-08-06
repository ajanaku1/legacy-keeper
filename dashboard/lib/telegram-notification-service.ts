import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type {
  TelegramDeliveryRecord,
  TelegramDeliveryStatus,
  TelegramRecipientRecord,
  TelegramRepository,
} from "./telegram-repository";

export type TelegramNotificationSource = "dashboard" | "keeperhub" | "test";

export interface TelegramNotificationEvent {
  idempotencyKey: string;
  source: TelegramNotificationSource;
  eventType: string;
  chainId: number;
  owner: Address;
  plan: Address;
  transactionHash?: `0x${string}`;
}

type TelegramFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status">>;

export interface TelegramNotificationDependencies {
  repository: TelegramRepository;
  botToken: string;
  fetcher: TelegramFetch;
  now: () => Date;
}

export function createTelegramNotificationService(
  dependencies: TelegramNotificationDependencies,
) {
  return {
    deliver: (event: TelegramNotificationEvent) => deliver(event, dependencies),
    retry: (idempotencyKey: string) => retry(idempotencyKey, dependencies),
  };
}

async function deliver(
  event: TelegramNotificationEvent,
  deps: TelegramNotificationDependencies,
): Promise<TelegramDeliveryStatus> {
  const now = deps.now();
  const reserved = await deps.repository.reserveDelivery({
    id: randomUUID(),
    ...event,
    attemptCount: 0,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  if (!reserved.created) {
    return retryIsDue(reserved.delivery, now)
      ? attemptDelivery(reserved.delivery, deps)
      : reserved.delivery.status;
  }
  return attemptDelivery(reserved.delivery, deps);
}

function retryIsDue(delivery: TelegramDeliveryRecord, now: Date): boolean {
  return (
    delivery.status === "failed" &&
    delivery.nextAttemptAt !== undefined &&
    delivery.nextAttemptAt.getTime() <= now.getTime()
  );
}

async function retry(
  idempotencyKey: string,
  deps: TelegramNotificationDependencies,
): Promise<TelegramDeliveryStatus> {
  const delivery = await deps.repository.findDelivery(idempotencyKey);
  if (!delivery) throw new Error("Telegram delivery was not found.");
  if (delivery.status !== "failed") return delivery.status;
  return attemptDelivery(delivery, deps);
}

async function attemptDelivery(
  delivery: TelegramDeliveryRecord,
  deps: TelegramNotificationDependencies,
): Promise<TelegramDeliveryStatus> {
  const recipient = await deps.repository.findActiveRecipient(
    delivery.owner,
    delivery.chainId,
  );
  if (!recipient) {
    await suppressDelivery(delivery, deps);
    return "suppressed";
  }
  const attemptCount = delivery.attemptCount + 1;
  const result = await sendTelegram(delivery, recipient, deps);
  if (result.ok) {
    await deps.repository.updateDelivery(delivery.idempotencyKey, {
      status: "sent",
      attemptCount,
      telegramUserId: recipient.link.telegramUserId,
      privateChatId: recipient.privateChatId,
      updatedAt: deps.now(),
      deliveredAt: deps.now(),
    });
    return "sent";
  }
  await deps.repository.updateDelivery(delivery.idempotencyKey, {
    status: "failed",
    attemptCount,
    telegramUserId: recipient.link.telegramUserId,
    privateChatId: recipient.privateChatId,
    updatedAt: deps.now(),
    nextAttemptAt: nextAttempt(deps.now(), attemptCount),
    lastError: result.error,
  });
  return "failed";
}

async function suppressDelivery(
  delivery: TelegramDeliveryRecord,
  deps: TelegramNotificationDependencies,
): Promise<void> {
  await deps.repository.updateDelivery(delivery.idempotencyKey, {
    status: "suppressed",
    attemptCount: delivery.attemptCount,
    updatedAt: deps.now(),
    lastError: "No active Telegram recipient.",
  });
}

async function sendTelegram(
  delivery: TelegramDeliveryRecord,
  recipient: TelegramRecipientRecord,
  deps: TelegramNotificationDependencies,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await deps.fetcher(
      `https://api.telegram.org/bot${deps.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: recipient.privateChatId,
          text: notificationText(delivery),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return response.ok
      ? { ok: true }
      : { ok: false, error: `Telegram HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message.slice(0, 160)
          : "Telegram request failed",
    };
  }
}

function notificationText(delivery: TelegramDeliveryRecord): string {
  const lines = [
    `✅ LegacyKeeper · ${delivery.eventType}`,
    `Wallet: ${delivery.owner}`,
    `Plan: ${delivery.plan}`,
  ];
  if (delivery.transactionHash) {
    lines.push(
      `Sepolia transaction: https://sepolia.etherscan.io/tx/${delivery.transactionHash}`,
    );
  }
  return lines.join("\n");
}

function nextAttempt(now: Date, attemptCount: number): Date | undefined {
  if (attemptCount >= 5) return undefined;
  const delaySeconds = Math.min(3_600, 60 * 2 ** (attemptCount - 1));
  return new Date(now.getTime() + delaySeconds * 1_000);
}
