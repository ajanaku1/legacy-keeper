import { NextRequest, NextResponse } from "next/server";
import {
  handleKeeperHubTelegramEvent,
  type KeeperHubTelegramEvent,
} from "@/lib/keeperhub-event-route";
import { sameAddress } from "@/lib/action-validation";
import {
  createSepoliaClient,
  readRegisteredPlan,
  requiredEnv,
  requiredFactory,
} from "@/lib/route-server";
import { serverTelegramNotificationService } from "@/lib/telegram-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const client = createSepoliaClient();
    const result = await handleKeeperHubTelegramEvent(
      await request.json(),
      request.headers.get("x-legacykeeper-keeperhub-secret"),
      {
        expectedSecret: requiredEnv("KEEPERHUB_EVENTS_SECRET"),
        readRegisteredPlan: (owner) =>
          readRegisteredPlan(client, requiredFactory(), owner),
        verifyOnchainEvidence: (event) => verifyReceipt(client, event),
        deliver: serverTelegramNotificationService().deliver,
      },
    );
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "KEEPERHUB_EVENT_FAILED";
    return NextResponse.json(
      { accepted: false, code },
      { status: code === "KEEPERHUB_EVENT_UNAUTHORIZED" ? 401 : 422 },
    );
  }
}

async function verifyReceipt(
  client: ReturnType<typeof createSepoliaClient>,
  event: KeeperHubTelegramEvent,
): Promise<boolean> {
  const receipt = await client.waitForTransactionReceipt({
    hash: event.transactionHash,
    confirmations: 1,
    timeout: 60_000,
  });
  return (
    receipt.status === "success" &&
    receipt.to !== null &&
    sameAddress(receipt.to, event.plan) &&
    receipt.logs.some((log) => sameAddress(log.address, event.plan))
  );
}
