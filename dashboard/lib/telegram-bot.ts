import { timingSafeEqual } from "node:crypto";
import type { TelegramWalletLinkRecord } from "./telegram-repository";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: {
      id: number;
      username?: string;
      first_name?: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number; type: string } };
  };
}

export interface TelegramMessageOptions {
  reply_markup?: {
    inline_keyboard: Array<
      Array<{ text: string; callback_data?: string; url?: string }>
    >;
  };
}

export interface TelegramPlanStatus {
  lastHeartbeat: number;
  timeoutExceeded: boolean;
  graceElapsed: boolean;
}

export interface TelegramBotDependencies {
  attachTelegramIdentity(input: {
    token: string;
    chatType: string;
    telegramUserId: string;
    privateChatId: string;
    username?: string;
    firstName?: string;
  }): Promise<unknown>;
  listWallets(telegramUserId: string): Promise<TelegramWalletLinkRecord[]>;
  readPlanStatus(link: TelegramWalletLinkRecord): Promise<TelegramPlanStatus>;
  unlinkWallet(input: {
    telegramUserId: string;
    owner: TelegramWalletLinkRecord["owner"];
    chainId: number;
  }): Promise<unknown>;
  createEvacuationEntry(
    telegramUserId: string,
    link: TelegramWalletLinkRecord,
  ): Promise<string>;
  createUnlinkAction(
    telegramUserId: string,
    link: TelegramWalletLinkRecord,
  ): Promise<string>;
  consumeUnlinkAction(
    telegramUserId: string,
    actionId: string,
  ): Promise<TelegramWalletLinkRecord>;
  sendMessage(
    chatId: number,
    text: string,
    options?: TelegramMessageOptions,
  ): Promise<void>;
}

const HELP_TEXT = [
  "LegacyKeeper security commands:",
  "/wallets — linked wallets and notification state",
  "/status — plan monitoring status",
  "/evacuate — open secure recovery authorization",
  "/unlink — stop monitoring a wallet",
  "/help — show this security boundary",
  "LegacyKeeper never asks for a private key or seed phrase.",
].join("\n");

export function assertTelegramWebhookSecret(
  provided: string | null,
  expected: string,
): void {
  const providedBytes = Buffer.from(provided ?? "");
  const expectedBytes = Buffer.from(expected);
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new Error("Invalid Telegram webhook secret.");
  }
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  deps: TelegramBotDependencies,
): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query, deps);
    return;
  }
  const message = update.message;
  if (!message?.text || !message.from) return;
  if (message.chat.type !== "private") {
    await deps.sendMessage(
      message.chat.id,
      "For your security, link wallets only in a private chat with this bot.",
      undefined,
    );
    return;
  }
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const userId = String(message.from.id);
  if (command === "/start" && argument) {
    await attachStartToken(message, argument, deps);
    return;
  }
  await handleCommand(command ?? "", userId, message.chat.id, deps);
}

async function attachStartToken(
  message: NonNullable<TelegramUpdate["message"]>,
  token: string,
  deps: TelegramBotDependencies,
): Promise<void> {
  const from = message.from;
  if (!from) return;
  await deps.attachTelegramIdentity({
    token,
    chatType: message.chat.type,
    telegramUserId: String(from.id),
    privateChatId: String(message.chat.id),
    ...(from.username ? { username: from.username } : {}),
    ...(from.first_name ? { firstName: from.first_name } : {}),
  });
  await deps.sendMessage(
    message.chat.id,
    "Telegram detected. Return to LegacyKeeper and sign with the wallet you are linking.",
    undefined,
  );
}

async function handleCommand(
  command: string,
  userId: string,
  chatId: number,
  deps: TelegramBotDependencies,
): Promise<void> {
  if (command === "/help" || command === "/start") {
    await deps.sendMessage(chatId, HELP_TEXT, {});
    return;
  }
  const links = await deps.listWallets(userId);
  if (command === "/wallets") {
    await deps.sendMessage(chatId, walletsText(links), {});
    return;
  }
  if (command === "/status") {
    await sendPlanStatus(chatId, links, deps);
    return;
  }
  if (command === "/evacuate") {
    await sendEvacuationMenu(chatId, userId, links, deps);
    return;
  }
  if (command === "/unlink") {
    await sendUnlinkMenu(chatId, userId, links, deps);
    return;
  }
  await deps.sendMessage(chatId, HELP_TEXT, {});
}

async function sendEvacuationMenu(
  chatId: number,
  userId: string,
  links: TelegramWalletLinkRecord[],
  deps: TelegramBotDependencies,
): Promise<void> {
  const rows = await Promise.all(
    links.map(async (link) => [
      {
        text: `Authorize recovery · ${shortWallet(link.owner)}`,
        url: await deps.createEvacuationEntry(userId, link),
      },
    ]),
  );
  await deps.sendMessage(
    chatId,
    links.length
      ? "Choose a wallet. Telegram only opens the request; the registered recovery wallet must sign."
      : "No linked wallets are available for recovery.",
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function sendUnlinkMenu(
  chatId: number,
  userId: string,
  links: TelegramWalletLinkRecord[],
  deps: TelegramBotDependencies,
): Promise<void> {
  const rows = await Promise.all(
    links.map(async (link) => [
      {
        text: `Unlink ${shortWallet(link.owner)}`,
        callback_data: `unlink:${await deps.createUnlinkAction(userId, link)}`,
      },
    ]),
  );
  await deps.sendMessage(
    chatId,
    links.length
      ? "Choose a wallet to stop monitoring. This does not change the on-chain plan."
      : "No linked wallets to unlink.",
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function handleCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  deps: TelegramBotDependencies,
): Promise<void> {
  const chat = callback.message?.chat;
  if (
    !chat ||
    chat.type !== "private" ||
    !callback.data?.startsWith("unlink:")
  ) {
    return;
  }
  const telegramUserId = String(callback.from.id);
  const link = await consumeUnlinkCallback(
    telegramUserId,
    callback.data.slice("unlink:".length),
    chat.id,
    deps,
  );
  if (!link) return;
  await deps.unlinkWallet({
    telegramUserId,
    owner: link.owner,
    chainId: link.chainId,
  });
  await deps.sendMessage(
    chat.id,
    `Notifications stopped for ${shortWallet(link.owner)}.`,
    {},
  );
}

async function consumeUnlinkCallback(
  telegramUserId: string,
  actionId: string,
  chatId: number,
  deps: TelegramBotDependencies,
): Promise<TelegramWalletLinkRecord | undefined> {
  try {
    return await deps.consumeUnlinkAction(telegramUserId, actionId);
  } catch {
    await deps.sendMessage(
      chatId,
      "This unlink action expired or was already used. Run /unlink for a new one.",
      {},
    );
    return undefined;
  }
}

function walletsText(links: TelegramWalletLinkRecord[]): string {
  if (!links.length) return "No wallets are linked to this Telegram account.";
  return [
    `Monitoring ${links.length} of 2 wallets:`,
    ...links.map((link) => `• ${link.owner} · Sepolia`),
  ].join("\n");
}

async function sendPlanStatus(
  chatId: number,
  links: TelegramWalletLinkRecord[],
  deps: TelegramBotDependencies,
): Promise<void> {
  if (!links.length) {
    await deps.sendMessage(
      chatId,
      "No linked plans. Start linking from LegacyKeeper Settings.",
      {},
    );
    return;
  }
  const lines = await Promise.all(
    links.map(async (link) => statusLine(link, deps)),
  );
  await deps.sendMessage(
    chatId,
    ["LegacyKeeper onchain status:", ...lines].join("\n"),
    {},
  );
}

async function statusLine(
  link: TelegramWalletLinkRecord,
  deps: TelegramBotDependencies,
): Promise<string> {
  try {
    const status = await deps.readPlanStatus(link);
    const recovery = recoveryStatus(status);
    return `• ${shortWallet(link.owner)} · last check-in ${formatUnixTime(status.lastHeartbeat)} · ${recovery}`;
  } catch {
    return `• ${shortWallet(link.owner)} · onchain status temporarily unavailable`;
  }
}

function recoveryStatus(status: TelegramPlanStatus): string {
  if (status.graceElapsed) return "recovery eligible";
  if (status.timeoutExceeded) return "recovery grace active";
  return "recovery locked";
}

function formatUnixTime(seconds: number): string {
  if (!seconds) return "not recorded";
  return `${new Date(seconds * 1_000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}
