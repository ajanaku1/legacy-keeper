import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";

export const TELEGRAM_SESSION_COOKIE = "legacykeeper_telegram_session";
export const TELEGRAM_SESSION_SECONDS = 7 * 24 * 60 * 60;

export interface TelegramWalletSession {
  owner: Address;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
}

export function createTelegramWalletSession(
  wallet: { owner: Address; chainId: number },
  secret: string,
  now = new Date(),
): string {
  assertStrongSecret(secret);
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const claims: TelegramWalletSession = {
    owner: normalizeOwner(wallet.owner),
    chainId: wallet.chainId,
    issuedAt,
    expiresAt: issuedAt + TELEGRAM_SESSION_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signed = `v1.${payload}`;
  return `${signed}.${signature(signed, secret)}`;
}

export function readTelegramWalletSession(
  token: string | undefined,
  secret: string,
  now = new Date(),
): TelegramWalletSession | undefined {
  if (!token || Buffer.byteLength(secret) < 32) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return undefined;
  const signed = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2] ?? "", signature(signed, secret))) return undefined;
  return parseClaims(parts[1] ?? "", now);
}

export function telegramSessionCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: TELEGRAM_SESSION_SECONDS,
  };
}

function parseClaims(
  encoded: string,
  now: Date,
): TelegramWalletSession | undefined {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!isSessionClaims(value)) return undefined;
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (value.expiresAt <= nowSeconds || value.issuedAt > nowSeconds + 60) {
      return undefined;
    }
    if (value.expiresAt - value.issuedAt !== TELEGRAM_SESSION_SECONDS) {
      return undefined;
    }
    return { ...value, owner: normalizeOwner(value.owner) };
  } catch {
    return undefined;
  }
}

function isSessionClaims(value: unknown): value is TelegramWalletSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.owner === "string" &&
    isAddress(claims.owner) &&
    Number.isInteger(claims.chainId) &&
    Number(claims.chainId) > 0 &&
    Number.isInteger(claims.issuedAt) &&
    Number.isInteger(claims.expiresAt)
  );
}

function normalizeOwner(owner: Address): Address {
  return getAddress(owner).toLowerCase() as Address;
}

function signature(value: string, secret: string): string {
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

function assertStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("Telegram session secret must contain at least 32 bytes.");
  }
}
