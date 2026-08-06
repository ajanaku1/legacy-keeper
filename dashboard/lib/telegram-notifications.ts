import type { Address } from "viem";
import { serverTelegramNotificationService } from "./telegram-server";
import type {
  TelegramNotificationEvent,
} from "./telegram-notification-service";
import type { TelegramDeliveryStatus } from "./telegram-repository";

export type TelegramDelivery = "sent" | "failed" | "skipped";
export type VerifiedDashboardAction =
  | "createPlan"
  | "configurePlan"
  | "heartbeatBySig"
  | "evacuate";
export type ConfigurationNotificationAction =
  | "beneficiaries"
  | "liveness"
  | "recovery"
  | "trackedTokens";

export interface VerifiedActionNotification {
  action: VerifiedDashboardAction;
  configurationAction?: ConfigurationNotificationAction;
  owner: Address;
  plan: Address;
  txHash: `0x${string}`;
}

interface TelegramNotifier {
  deliver(event: TelegramNotificationEvent): Promise<TelegramDeliveryStatus>;
}

export async function notifyVerifiedAction(
  notification: VerifiedActionNotification,
  notifier?: TelegramNotifier,
): Promise<TelegramDelivery> {
  try {
    const service = notifier ?? serverTelegramNotificationService();
    const status = await service.deliver({
      idempotencyKey: `dashboard:${notification.action}:${notification.txHash}`,
      source: "dashboard",
      eventType: notificationTitle(notification),
      chainId: 11_155_111,
      owner: notification.owner,
      plan: notification.plan,
      transactionHash: notification.txHash,
    });
    if (status === "sent") return "sent";
    if (status === "failed") return "failed";
    return "skipped";
  } catch (error) {
    console.error(
      "[telegram] delivery failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return "failed";
  }
}

function notificationTitle(notification: VerifiedActionNotification): string {
  if (notification.action === "createPlan") return "Continuity plan created";
  if (notification.action === "heartbeatBySig") return "Check-in recorded";
  if (notification.action === "evacuate") return "Emergency evacuation executed";
  return `${configurationTitle(notification.configurationAction)} updated`;
}

function configurationTitle(
  action?: ConfigurationNotificationAction,
): string {
  if (action === "beneficiaries") return "Beneficiaries";
  if (action === "liveness") return "Timing";
  if (action === "recovery") return "Recovery";
  if (action === "trackedTokens") return "Tracked assets";
  return "Plan configuration";
}
