import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  TelegramRepository,
  TelegramWalletLinkRecord,
} from "./telegram-repository";

interface CreateTelegramEvacuationEntryInput {
  telegramUserId: string;
  link: TelegramWalletLinkRecord;
  secret: string;
  now: Date;
  appUrl: string;
}

interface VerifyTelegramEvacuationEntryDependencies {
  repository: TelegramRepository;
  secret: string;
  now: () => Date;
}

interface EntryPayload {
  telegramUserId: string;
  linkId: string;
  expires: number;
}

export function createTelegramEvacuationEntry(
  input: CreateTelegramEvacuationEntryInput,
) {
  const payload: EntryPayload = {
    telegramUserId: input.telegramUserId,
    linkId: input.link.id,
    expires: Math.floor(input.now.getTime() / 1_000) + 300,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encoded}.${sign(encoded, input.secret)}`;
  return {
    token,
    url: `${input.appUrl.replace(/\/$/, "")}/recovery/telegram?entry=${encodeURIComponent(token)}`,
  };
}

export async function verifyTelegramEvacuationEntry(
  token: string,
  deps: VerifyTelegramEvacuationEntryDependencies,
): Promise<TelegramWalletLinkRecord> {
  const [encoded, signature, extra] = token.split(".");
  if (
    !encoded ||
    !signature ||
    extra ||
    !safeEqual(signature, sign(encoded, deps.secret))
  ) {
    throw new Error("Telegram recovery entry is invalid.");
  }
  const payload = parsePayload(encoded);
  if (payload.expires < Math.floor(deps.now().getTime() / 1_000)) {
    throw new Error("Telegram recovery entry has expired.");
  }
  const links = await deps.repository.listActiveLinks(payload.telegramUserId);
  const link = links.find((candidate) => candidate.id === payload.linkId);
  if (!link) throw new Error("Telegram recovery link is no longer active.");
  return link;
}

function parsePayload(encoded: string): EntryPayload {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const payload = value as Record<string, unknown>;
    if (
      typeof payload.telegramUserId !== "string" ||
      typeof payload.linkId !== "string" ||
      typeof payload.expires !== "number" ||
      !Number.isInteger(payload.expires)
    ) {
      throw new Error();
    }
    return {
      telegramUserId: payload.telegramUserId,
      linkId: payload.linkId,
      expires: payload.expires,
    };
  } catch {
    throw new Error("Telegram recovery entry is invalid.");
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
