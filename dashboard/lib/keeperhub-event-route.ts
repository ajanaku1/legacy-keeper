import { timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import type { TelegramDeliveryStatus } from "./telegram-repository";
import type { TelegramNotificationEvent } from "./telegram-notification-service";

export interface KeeperHubTelegramEvent {
  eventId: string;
  eventType: string;
  chainId: number;
  owner: Address;
  plan: Address;
  transactionHash: `0x${string}`;
}

export interface KeeperHubTelegramEventDependencies {
  expectedSecret: string;
  readRegisteredPlan(owner: Address, chainId: number): Promise<Address>;
  verifyOnchainEvidence(event: KeeperHubTelegramEvent): Promise<boolean>;
  deliver(event: TelegramNotificationEvent): Promise<TelegramDeliveryStatus>;
}

class KeeperHubEventError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KeeperHubEventError";
  }
}

export async function handleKeeperHubTelegramEvent(
  rawEvent: unknown,
  providedSecret: string | null,
  deps: KeeperHubTelegramEventDependencies,
) {
  assertIntegrationSecret(providedSecret, deps.expectedSecret);
  const event = parseKeeperHubEvent(rawEvent);
  const registeredPlan = await deps.readRegisteredPlan(
    event.owner,
    event.chainId,
  );
  if (registeredPlan.toLowerCase() !== event.plan.toLowerCase()) {
    throw new KeeperHubEventError(
      "KEEPERHUB_EVENT_PLAN_MISMATCH",
      "Factory ownership does not match this KeeperHub event.",
    );
  }
  if (!(await deps.verifyOnchainEvidence(event))) {
    throw new KeeperHubEventError(
      "KEEPERHUB_EVENT_UNVERIFIED",
      "KeeperHub event receipt evidence could not be verified.",
    );
  }
  const delivery = await deps.deliver({
    idempotencyKey: event.eventId,
    source: "keeperhub",
    eventType: event.eventType,
    chainId: event.chainId,
    owner: event.owner,
    plan: event.plan,
    transactionHash: event.transactionHash,
  });
  return { accepted: true, delivery } as const;
}

function parseKeeperHubEvent(value: unknown): KeeperHubTelegramEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidEvent("Event body must be an object.");
  }
  const event = value as Record<string, unknown>;
  const fields = Object.keys(event).sort();
  const expected = [
    "chainId",
    "eventId",
    "eventType",
    "owner",
    "plan",
    "transactionHash",
  ];
  if (JSON.stringify(fields) !== JSON.stringify(expected)) {
    throw invalidEvent("Event fields do not match the integration contract.");
  }
  if (event.chainId !== 11_155_111) throw invalidEvent("Sepolia is required.");
  return {
    eventId: requiredIdentifier(event.eventId, "eventId"),
    eventType: requiredIdentifier(event.eventType, "eventType"),
    chainId: event.chainId,
    owner: requiredAddress(event.owner, "owner"),
    plan: requiredAddress(event.plan, "plan"),
    transactionHash: requiredTransactionHash(event.transactionHash),
  };
}

function assertIntegrationSecret(
  provided: string | null,
  expected: string,
): void {
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new KeeperHubEventError(
      "KEEPERHUB_EVENT_UNAUTHORIZED",
      "KeeperHub event authentication failed.",
    );
  }
}

function requiredAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw invalidEvent(`${field} must be an address.`);
  }
  return getAddress(value);
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) {
    throw invalidEvent(`${field} is invalid.`);
  }
  return value;
}

function requiredTransactionHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw invalidEvent("transactionHash is invalid.");
  }
  return value as `0x${string}`;
}

function invalidEvent(message: string): KeeperHubEventError {
  return new KeeperHubEventError("KEEPERHUB_EVENT_INVALID", message);
}
