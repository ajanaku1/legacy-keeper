import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import { getTelegramDatabase } from "../db/client";
import { createPostgresTelegramRepository } from "./postgres-telegram-repository";
import { createTelegramLinkService } from "./telegram-link-service";
import { createTelegramNotificationService } from "./telegram-notification-service";
import type {
  TelegramBotDependencies,
  TelegramMessageOptions,
} from "./telegram-bot";
import { legacyKeeperAbi } from "./contract";
import type { TelegramWalletLinkRecord } from "./telegram-repository";
import { createTelegramEvacuationEntry } from "./telegram-evacuation";
import {
  createSepoliaClient,
  readRegisteredPlanAcrossFactories,
  requiredEnv,
  requiredFactories,
} from "./route-server";

export function serverTelegramRepository() {
  return createPostgresTelegramRepository(getTelegramDatabase());
}

export function serverTelegramLinkService() {
  const repository = serverTelegramRepository();
  return createTelegramLinkService({
    repository,
    now: () => new Date(),
    randomToken: () => randomBytes(32).toString("base64url"),
    readRegisteredPlan: async (owner, chainId) => {
      if (chainId !== 11_155_111)
        return "0x0000000000000000000000000000000000000000";
      return readRegisteredPlanAcrossFactories(
        createSepoliaClient(),
        requiredFactories(),
        owner,
      );
    },
  });
}

export function serverTelegramNotificationService() {
  return createTelegramNotificationService({
    repository: serverTelegramRepository(),
    botToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
    fetcher: fetch,
    now: () => new Date(),
  });
}

export function serverTelegramBotDependencies(): TelegramBotDependencies {
  const linkService = serverTelegramLinkService();
  const secret = requiredEnv("TELEGRAM_ACTION_SECRET");
  return {
    attachTelegramIdentity: linkService.attachTelegramIdentity,
    listWallets: linkService.listWallets,
    readPlanStatus: (link) => readTelegramPlanStatus(link),
    unlinkWallet: linkService.unlinkFromTelegram,
    createEvacuationEntry: (userId, link) =>
      Promise.resolve(
        createTelegramEvacuationEntry({
          telegramUserId: userId,
          link,
          secret,
          now: new Date(),
          appUrl: requiredEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000"),
        }).url,
      ),
    createUnlinkAction: (userId, link) =>
      Promise.resolve(unlinkActionId(userId, link, secret, new Date())),
    consumeUnlinkAction: (userId, actionId) =>
      resolveUnlinkAction(userId, actionId, secret, linkService.listWallets),
    sendMessage: (chatId, text, options) =>
      sendTelegramMessage(chatId, text, options),
  };
}

async function readTelegramPlanStatus(link: TelegramWalletLinkRecord) {
  const client = createSepoliaClient();
  const [liveness, timeout] = await Promise.all([
    client.readContract({
      address: link.plan,
      abi: legacyKeeperAbi,
      functionName: "getLivenessStatus",
    }),
    client.readContract({
      address: link.plan,
      abi: legacyKeeperAbi,
      functionName: "getTimeoutStatus",
    }),
  ]);
  return {
    lastHeartbeat: Number(liveness[0]),
    timeoutExceeded: timeout[0],
    graceElapsed: timeout[1],
  };
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: TelegramMessageOptions,
): Promise<void> {
  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new Error(`Telegram send failed with HTTP ${response.status}.`);
}

async function resolveUnlinkAction(
  telegramUserId: string,
  actionId: string,
  secret: string,
  listWallets: (userId: string) => Promise<TelegramWalletLinkRecord[]>,
): Promise<TelegramWalletLinkRecord> {
  const links = await listWallets(telegramUserId);
  const now = new Date();
  const link = links.find((candidate) =>
    [0, -1].some((offset) =>
      safeEqual(
        actionId,
        unlinkActionId(telegramUserId, candidate, secret, now, offset),
      ),
    ),
  );
  if (!link)
    throw new Error("This Telegram unlink action expired or was already used.");
  return link;
}

function unlinkActionId(
  telegramUserId: string,
  link: TelegramWalletLinkRecord,
  secret: string,
  now: Date,
  bucketOffset = 0,
): string {
  const bucket = Math.floor(now.getTime() / 600_000) + bucketOffset;
  return createHmac("sha256", secret)
    .update(`${telegramUserId}:${link.id}:${bucket}`)
    .digest("base64url")
    .slice(0, 24);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function parseOwner(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error("A valid owner wallet is required.");
  }
  return getAddress(value);
}

export function parseChainId(value: unknown): number {
  if (value !== 11_155_111) throw new Error("Sepolia chain ID is required.");
  return value;
}

export function telegramDeepLink(botToken: string): string {
  const username = requiredEnv("TELEGRAM_BOT_USERNAME").replace(/^@/, "");
  return `https://t.me/${username}?start=${encodeURIComponent(botToken)}`;
}
