import type { Address } from "viem";
import type {
  ConfigurationAction,
  ConfigurationPayload,
  ConfigurationRequest,
  VerifiedConfigurationEvidence,
} from "./configuration-route";
import { userFacingActionError } from "./client-action-error";
import type { TelegramDelivery } from "./telegram-notifications";

const SIGNING_WINDOW_SECONDS = 300;

export interface ConfigurationIntent {
  chainId: number;
  owner: Address;
  plan: Address;
  action: ConfigurationAction;
  payload: ConfigurationPayload;
}

export interface VerifiedConfigurationResponse
  extends VerifiedConfigurationEvidence {
  notification?: TelegramDelivery;
}

export function buildConfigurationRequest(
  intent: ConfigurationIntent,
  nonce: bigint,
  nowSeconds: number,
): ConfigurationRequest {
  return {
    ...intent,
    nonce: nonce.toString(),
    deadline: String(nowSeconds + SIGNING_WINDOW_SECONDS),
    signature: "0x",
  };
}

export async function submitConfiguration(
  request: ConfigurationRequest,
): Promise<VerifiedConfigurationResponse> {
  const response = await fetch("/api/configuration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isConfigurationEvidence(body, request)) {
    throw new Error(
      userFacingActionError(
        body,
        "KeeperHub could not verify this plan update.",
      ),
    );
  }
  return body;
}

function isConfigurationEvidence(
  value: unknown,
  request: ConfigurationRequest,
): value is VerifiedConfigurationResponse {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Record<string, unknown>;
  return (
    evidence.stage === "verified" &&
    evidence.action === request.action &&
    evidence.plan === request.plan &&
    evidence.receiptStatus === "success" &&
    evidence.sponsored === true &&
    validNotificationStatus(evidence.notification) &&
    typeof evidence.executionId === "string" &&
    typeof evidence.txHash === "string" &&
    typeof evidence.event === "string"
  );
}

function validNotificationStatus(value: unknown): boolean {
  return (
    value === undefined ||
    value === "sent" ||
    value === "failed" ||
    value === "skipped"
  );
}
