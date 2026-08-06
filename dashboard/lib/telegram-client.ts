import type { Address, Hex } from "viem";

export interface TelegramLinkSessionClient {
  sessionId: string;
  browserToken: string;
  nonce: string;
  deadline: string;
  telegramUrl: string;
}

export interface TelegramDetectedSession {
  sessionId: string;
  state: "pending" | "detected" | "consumed";
  telegramUserId?: string;
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
}

export interface TelegramLinkedWallet {
  id: string;
  owner: Address;
  chainId: number;
  telegramUserId: string;
  plan: Address;
}

export interface TelegramLinkResult {
  link: TelegramLinkedWallet;
  activeCount: number;
  limit: number;
  lastDelivery?: {
    eventType: string;
    deliveredAt?: string;
  };
}

export class TelegramClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TelegramClientError";
  }
}

interface WalletAuth {
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export function createTelegramLinkSession(owner: Address, chainId: number) {
  return requestJson<TelegramLinkSessionClient>("/api/telegram/link-sessions", {
    method: "POST",
    body: JSON.stringify({ owner, chainId }),
  });
}

export function readTelegramLinkSession(
  sessionId: string,
  browserToken: string,
) {
  return requestJson<TelegramDetectedSession>(
    `/api/telegram/link-sessions?sessionId=${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${browserToken}` } },
  );
}

export function activateTelegramLink(
  session: TelegramDetectedSession,
  signature: Hex,
) {
  return requestJson<TelegramLinkResult>("/api/telegram/links", {
    method: "POST",
    body: JSON.stringify({ ...session, signature }),
  });
}

export function accessTelegramLink(auth: WalletAuth) {
  return requestJson<TelegramLinkResult>("/api/telegram/links", {
    method: "PUT",
    body: JSON.stringify(auth),
  });
}

export function restoreTelegramLink(owner: Address, chainId: number) {
  const query = new URLSearchParams({ owner, chainId: String(chainId) });
  return requestJson<TelegramLinkResult>(`/api/telegram/links?${query}`, {
    method: "GET",
  });
}

export function unlinkTelegramLink(auth: WalletAuth & { linkId: string }) {
  return requestJson<{ unlinked: true }>("/api/telegram/unlink", {
    method: "POST",
    body: JSON.stringify(auth),
  });
}

export function sendTelegramTest(
  auth: WalletAuth & { linkId: string; action: "test" },
) {
  return requestJson<{ ok: boolean; delivery: string }>("/api/telegram/test", {
    method: "POST",
    body: JSON.stringify(auth),
  });
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new TelegramClientError(errorMessage(body), response.status);
  }
  return body as T;
}

function errorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Telegram could not complete this request.";
}
