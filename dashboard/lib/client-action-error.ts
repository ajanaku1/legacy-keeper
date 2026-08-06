import type { ActionErrorCode } from "./action-error";

const REMEDIES: Record<ActionErrorCode, string> = {
  INVALID_REQUEST: "Review the entered details and sign a new attempt.",
  WRONG_NETWORK: "Switch to Sepolia, review the request, and try again.",
  SIGNATURE_EXPIRED: "The approval expired. Review and sign a new attempt.",
  HEARTBEAT_COOLDOWN:
    "A plan can check in only once every 24 hours. Wait for the next window.",
  PLAN_ALREADY_EXISTS: "This wallet already has a plan. Reload the dashboard.",
  PLAN_NOT_FOUND: "Finish plan setup before trying this action.",
  PLAN_MISMATCH: "Reload the plan from the factory registry and try again.",
  WRONG_OWNER: "Reconnect the wallet that owns this plan.",
  WRONG_SIGNER: "Use the required signing wallet and create a new signature.",
  KEEPERHUB_REJECTED:
    "KeeperHub did not accept this attempt. Nothing was trusted as complete.",
  KEEPERHUB_UNSETTLED:
    "KeeperHub did not settle this attempt. Check Activity before retrying.",
  UNVERIFIED_RESULT:
    "The on-chain proof did not agree. Check Activity before retrying.",
};

export function userFacingActionError(
  value: unknown,
  fallback: string,
): string {
  if (!value || typeof value !== "object") return fallback;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" && code in REMEDIES
    ? REMEDIES[code as ActionErrorCode]
    : fallback;
}
