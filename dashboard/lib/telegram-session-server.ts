import type { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { requiredEnv } from "./route-server";
import {
  createTelegramWalletSession,
  readTelegramWalletSession,
  TELEGRAM_SESSION_COOKIE,
  telegramSessionCookieOptions,
} from "./telegram-wallet-session";

export class TelegramSessionError extends Error {
  readonly code = "TELEGRAM_SESSION_REQUIRED";
}

export function setTelegramSessionCookie(
  response: NextResponse,
  wallet: { owner: Address; chainId: number },
): void {
  response.cookies.set({
    name: TELEGRAM_SESSION_COOKIE,
    value: createTelegramWalletSession(wallet, sessionSecret()),
    ...telegramSessionCookieOptions(process.env.NODE_ENV === "production"),
  });
}

export function readTelegramSessionCookie(
  request: NextRequest,
  wallet: { owner: Address; chainId: number },
): void {
  const token = request.cookies.get(TELEGRAM_SESSION_COOKIE)?.value;
  const session = readTelegramWalletSession(token, sessionSecret());
  if (
    !session ||
    session.owner !== wallet.owner.toLowerCase() ||
    session.chainId !== wallet.chainId
  ) {
    throw new TelegramSessionError("Verify wallet ownership to continue.");
  }
}

export function clearTelegramSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: TELEGRAM_SESSION_COOKIE,
    value: "",
    ...telegramSessionCookieOptions(process.env.NODE_ENV === "production"),
    maxAge: 0,
  });
}

function sessionSecret(): string {
  return (
    process.env.TELEGRAM_SESSION_SECRET ?? requiredEnv("TELEGRAM_ACTION_SECRET")
  );
}
