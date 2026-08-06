import { createHash } from "node:crypto";
import {
  getAddress,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type {
  TelegramAccountRecord,
  TelegramLinkSessionRecord,
  TelegramRepository,
  TelegramWalletLinkRecord,
} from "./telegram-repository";
import {
  telegramActionTypedData,
  telegramLinkTypedData,
  telegramUnlinkTypedData,
  telegramWalletAccessTypedData,
  type LinkTelegramMessage,
  type TelegramActionMessage,
  type TelegramWalletAccessMessage,
  type UnlinkTelegramMessage,
} from "./telegram-typed-data";

export {
  telegramActionTypedData,
  telegramLinkTypedData,
  telegramUnlinkTypedData,
  telegramWalletAccessTypedData,
} from "./telegram-typed-data";

const SESSION_LIFETIME_SECONDS = 300;
const WALLET_LIMIT = 2;

export function walletLimitForTelegramUser(): number {
  return WALLET_LIMIT;
}

export class TelegramLinkError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TelegramLinkError";
  }
}

export interface TelegramLinkServiceDependencies {
  repository: TelegramRepository;
  now: () => Date;
  randomToken: () => string;
  readRegisteredPlan: (owner: Address, chainId: number) => Promise<Address>;
}

export interface LinkTelegramRequest {
  sessionId: string;
  owner: Address;
  chainId: number;
  telegramUserId: string;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface UnlinkTelegramRequest {
  linkId: string;
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface TelegramActionRequest {
  action: "status" | "test";
  linkId: string;
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export interface TelegramWalletAccessRequest {
  owner: Address;
  chainId: number;
  nonce: string;
  deadline: string;
  signature: Hex;
}

export function createTelegramLinkService(
  dependencies: TelegramLinkServiceDependencies,
) {
  return {
    createLinkSession: (input: { owner: Address; chainId: number }) =>
      createLinkSession(input, dependencies),
    attachTelegramIdentity: (input: AttachTelegramIdentityInput) =>
      attachTelegramIdentity(input, dependencies),
    getLinkSession: (sessionId: string, browserToken: string) =>
      getLinkSession(sessionId, browserToken, dependencies),
    linkWallet: (request: LinkTelegramRequest) =>
      linkWallet(request, dependencies),
    listWallets: (telegramUserId: string) =>
      dependencies.repository.listActiveLinks(telegramUserId),
    latestDeliveryForWallet: (owner: Address, chainId: number) =>
      dependencies.repository.findLatestSentDelivery(
        normalizeAddress(owner),
        chainId,
      ),
    unlinkFromTelegram: (input: UnlinkFromTelegramInput) =>
      unlinkFromTelegram(input, dependencies),
    unlinkFromDashboard: (request: UnlinkTelegramRequest) =>
      unlinkFromDashboard(request, dependencies),
    authenticateDashboardAction: (request: TelegramActionRequest) =>
      authenticateDashboardAction(request, dependencies),
    authenticateWalletAccess: (request: TelegramWalletAccessRequest) =>
      authenticateWalletAccess(request, dependencies),
    restoreWalletAccess: (input: { owner: Address; chainId: number }) =>
      registeredWalletLink(input.owner, input.chainId, dependencies),
  };
}

interface AttachTelegramIdentityInput {
  token: string;
  chatType: string;
  telegramUserId: string;
  privateChatId: string;
  username?: string;
  firstName?: string;
}

interface UnlinkFromTelegramInput {
  telegramUserId: string;
  owner: Address;
  chainId: number;
}

async function createLinkSession(
  input: { owner: Address; chainId: number },
  deps: TelegramLinkServiceDependencies,
) {
  const now = deps.now();
  const id = deps.randomToken();
  const botToken = deps.randomToken();
  const browserToken = deps.randomToken();
  const nonce = deps.randomToken();
  const deadline = String(
    Math.floor(now.getTime() / 1_000) + SESSION_LIFETIME_SECONDS,
  );
  const session: TelegramLinkSessionRecord = {
    id,
    botTokenHash: hashToken(botToken),
    browserTokenHash: hashToken(browserToken),
    owner: normalizeAddress(input.owner),
    chainId: input.chainId,
    nonce,
    deadline,
    expiresAt: new Date(Number(deadline) * 1_000),
    state: "pending",
    createdAt: now,
  };
  await deps.repository.createLinkSession(session);
  return { sessionId: id, botToken, browserToken, nonce, deadline };
}

async function attachTelegramIdentity(
  input: AttachTelegramIdentityInput,
  deps: TelegramLinkServiceDependencies,
) {
  if (input.chatType !== "private") {
    throw new TelegramLinkError(
      "TELEGRAM_PRIVATE_CHAT_REQUIRED",
      "Wallet linking is available only in a private Telegram chat.",
    );
  }
  const session = await deps.repository.findLinkSessionByBotTokenHash(
    hashToken(input.token),
  );
  assertUsableSession(session, deps.now(), true);
  if (session.state === "detected") {
    if (session.telegramUserId === input.telegramUserId) return session;
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_UNAVAILABLE",
      "This Telegram link session is no longer available.",
    );
  }
  const account: TelegramAccountRecord = {
    telegramUserId: input.telegramUserId,
    privateChatId: input.privateChatId,
    ...(input.username ? { username: input.username } : {}),
    ...(input.firstName ? { firstName: input.firstName } : {}),
    updatedAt: deps.now(),
  };
  const detected = await deps.repository.detectTelegramAccount(
    session.id,
    account,
  );
  if (!detected) {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_UNAVAILABLE",
      "This Telegram link session is no longer available.",
    );
  }
  return detected;
}

async function getLinkSession(
  sessionId: string,
  browserToken: string,
  deps: TelegramLinkServiceDependencies,
) {
  const session = await deps.repository.findLinkSessionById(sessionId);
  if (!session || session.browserTokenHash !== hashToken(browserToken)) {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_NOT_FOUND",
      "Telegram link session was not found.",
    );
  }
  assertUsableSession(session, deps.now(), true);
  return session;
}

async function linkWallet(
  request: LinkTelegramRequest,
  deps: TelegramLinkServiceDependencies,
): Promise<TelegramWalletLinkRecord> {
  const session = await deps.repository.findLinkSessionById(request.sessionId);
  assertLinkRequestMatchesSession(request, session, deps.now());
  const signer = await recoverTypedDataAddress({
    ...telegramLinkTypedData(request),
    signature: request.signature,
  });
  if (signer.toLowerCase() !== request.owner.toLowerCase()) {
    throw new TelegramLinkError(
      "TELEGRAM_WRONG_SIGNER",
      "The signature does not match the wallet being linked.",
    );
  }
  const plan = await deps.readRegisteredPlan(request.owner, request.chainId);
  if (plan === zeroAddress) {
    throw new TelegramLinkError(
      "TELEGRAM_PLAN_NOT_FOUND",
      "This wallet does not have a registered LegacyKeeper plan.",
    );
  }
  const activated = await deps.repository.activateLink({
    sessionId: request.sessionId,
    telegramUserId: request.telegramUserId,
    plan: normalizeAddress(plan),
    now: deps.now(),
    walletLimit: walletLimitForTelegramUser(),
  });
  if (activated.status === "linked" || activated.status === "already-linked") {
    return activated.link;
  }
  throw activationError(activated.status);
}

async function unlinkFromTelegram(
  input: UnlinkFromTelegramInput,
  deps: TelegramLinkServiceDependencies,
) {
  const revoked = await deps.repository.revokeLink({
    owner: normalizeAddress(input.owner),
    chainId: input.chainId,
    telegramUserId: input.telegramUserId,
    now: deps.now(),
  });
  if (!revoked) {
    throw new TelegramLinkError(
      "TELEGRAM_LINK_NOT_FOUND",
      "No active Telegram link exists for this wallet.",
    );
  }
  return { unlinked: true } as const;
}

async function unlinkFromDashboard(
  request: UnlinkTelegramRequest,
  deps: TelegramLinkServiceDependencies,
) {
  assertFutureDeadline(request.deadline, deps.now());
  const owner = normalizeAddress(request.owner);
  const link = await deps.repository.findActiveLink(owner, request.chainId);
  if (!link || link.id !== request.linkId) {
    throw new TelegramLinkError(
      "TELEGRAM_LINK_NOT_FOUND",
      "No active Telegram link exists for this wallet.",
    );
  }
  const registeredPlan = await deps.readRegisteredPlan(owner, request.chainId);
  if (registeredPlan.toLowerCase() !== link.plan.toLowerCase()) {
    throw new TelegramLinkError(
      "TELEGRAM_PLAN_MISMATCH",
      "The factory no longer maps this wallet to the linked plan.",
    );
  }
  const signer = await recoverTypedDataAddress({
    ...telegramUnlinkTypedData(request),
    signature: request.signature,
  });
  if (signer.toLowerCase() !== owner) {
    throw new TelegramLinkError(
      "TELEGRAM_WRONG_SIGNER",
      "The signature does not match the linked wallet.",
    );
  }
  const revoked = await deps.repository.revokeLink({
    owner,
    chainId: request.chainId,
    now: deps.now(),
  });
  if (!revoked) {
    throw new TelegramLinkError(
      "TELEGRAM_LINK_NOT_FOUND",
      "No active Telegram link exists for this wallet.",
    );
  }
  return { unlinked: true } as const;
}

async function authenticateDashboardAction(
  request: TelegramActionRequest,
  deps: TelegramLinkServiceDependencies,
): Promise<TelegramWalletLinkRecord> {
  assertFutureDeadline(request.deadline, deps.now());
  const owner = normalizeAddress(request.owner);
  const link = await deps.repository.findActiveLink(owner, request.chainId);
  if (!link || link.id !== request.linkId) {
    throw new TelegramLinkError(
      "TELEGRAM_LINK_NOT_FOUND",
      "No active Telegram link exists for this wallet.",
    );
  }
  const registeredPlan = await deps.readRegisteredPlan(owner, request.chainId);
  if (registeredPlan.toLowerCase() !== link.plan.toLowerCase()) {
    throw new TelegramLinkError(
      "TELEGRAM_PLAN_MISMATCH",
      "The factory no longer maps this wallet to the linked plan.",
    );
  }
  const signer = await recoverTypedDataAddress({
    ...telegramActionTypedData(request),
    signature: request.signature,
  });
  if (signer.toLowerCase() !== owner) {
    throw new TelegramLinkError(
      "TELEGRAM_WRONG_SIGNER",
      "The signature does not match the linked wallet.",
    );
  }
  return link;
}

async function authenticateWalletAccess(
  request: TelegramWalletAccessRequest,
  deps: TelegramLinkServiceDependencies,
): Promise<TelegramWalletLinkRecord> {
  assertFutureDeadline(request.deadline, deps.now());
  const owner = normalizeAddress(request.owner);
  const signer = await recoverTypedDataAddress({
    ...telegramWalletAccessTypedData(request),
    signature: request.signature,
  });
  if (signer.toLowerCase() !== owner) {
    throw new TelegramLinkError(
      "TELEGRAM_WRONG_SIGNER",
      "The signature does not match this wallet.",
    );
  }
  return registeredWalletLink(owner, request.chainId, deps);
}

async function registeredWalletLink(
  ownerInput: Address,
  chainId: number,
  deps: TelegramLinkServiceDependencies,
): Promise<TelegramWalletLinkRecord> {
  const owner = normalizeAddress(ownerInput);
  const registeredPlan = await deps.readRegisteredPlan(owner, chainId);
  if (registeredPlan === zeroAddress) {
    throw new TelegramLinkError(
      "TELEGRAM_PLAN_NOT_FOUND",
      "This wallet does not have a registered LegacyKeeper plan.",
    );
  }
  const link = await deps.repository.findActiveLink(owner, chainId);
  if (!link) {
    throw new TelegramLinkError(
      "TELEGRAM_LINK_NOT_FOUND",
      "No active Telegram link exists for this wallet.",
    );
  }
  if (link.plan.toLowerCase() !== registeredPlan.toLowerCase()) {
    throw new TelegramLinkError(
      "TELEGRAM_PLAN_MISMATCH",
      "The linked plan no longer matches the factory registry.",
    );
  }
  return link;
}

function assertLinkRequestMatchesSession(
  request: LinkTelegramRequest,
  session: TelegramLinkSessionRecord | undefined,
  now: Date,
): asserts session is TelegramLinkSessionRecord {
  assertUsableSession(session, now, true);
  if (session.state === "consumed") {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_CONSUMED",
      "This Telegram link session has already been used.",
    );
  }
  const matches =
    session.state === "detected" &&
    session.owner === request.owner.toLowerCase() &&
    session.chainId === request.chainId &&
    session.telegramUserId === request.telegramUserId &&
    session.nonce === request.nonce &&
    session.deadline === request.deadline;
  if (!matches) {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_MISMATCH",
      "The signed Telegram identity does not match this link session.",
    );
  }
}

function assertUsableSession(
  session: TelegramLinkSessionRecord | undefined,
  now: Date,
  allowDetected = false,
): asserts session is TelegramLinkSessionRecord {
  if (!session) {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_NOT_FOUND",
      "Telegram link session was not found.",
    );
  }
  if (session.state === "consumed") {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_CONSUMED",
      "This Telegram link session has already been used.",
    );
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_EXPIRED",
      "This Telegram link session has expired.",
    );
  }
  if (!allowDetected && session.state !== "pending") {
    throw new TelegramLinkError(
      "TELEGRAM_SESSION_UNAVAILABLE",
      "This Telegram link session is no longer available.",
    );
  }
}

function activationError(status: string): TelegramLinkError {
  if (status === "wallet-limit") {
    return new TelegramLinkError(
      "TELEGRAM_WALLET_LIMIT",
      "This Telegram account already monitors the maximum of two wallets.",
    );
  }
  if (status === "wallet-linked-elsewhere") {
    return new TelegramLinkError(
      "TELEGRAM_WALLET_ALREADY_LINKED",
      "This wallet is already linked to another Telegram account.",
    );
  }
  return new TelegramLinkError(
    "TELEGRAM_SESSION_CONSUMED",
    "This Telegram link session has already been used.",
  );
}

function assertFutureDeadline(deadline: string, now: Date): void {
  if (
    !/^\d+$/.test(deadline) ||
    BigInt(deadline) < BigInt(Math.floor(now.getTime() / 1_000))
  ) {
    throw new TelegramLinkError(
      "TELEGRAM_SIGNATURE_EXPIRED",
      "This Telegram authorization has expired.",
    );
  }
}

function normalizeAddress(address: Address): Address {
  return getAddress(address).toLowerCase() as Address;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
