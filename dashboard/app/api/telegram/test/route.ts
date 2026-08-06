import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import {
  parseChainId,
  parseOwner,
  serverTelegramLinkService,
  serverTelegramNotificationService,
} from "@/lib/telegram-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const auth = {
      action: "test" as const,
      linkId: requiredText(body.linkId, "linkId"),
      owner: parseOwner(body.owner),
      chainId: parseChainId(body.chainId),
      nonce: requiredText(body.nonce, "nonce"),
      deadline: requiredText(body.deadline, "deadline"),
      signature: requiredText(body.signature, "signature") as Hex,
    };
    const link =
      await serverTelegramLinkService().authenticateDashboardAction(auth);
    const delivery = await serverTelegramNotificationService().deliver({
      idempotencyKey: `test:${link.id}:${auth.nonce}`,
      source: "test",
      eventType: "Test notification",
      chainId: link.chainId,
      owner: link.owner,
      plan: link.plan,
    });
    return NextResponse.json({ ok: delivery === "sent", delivery });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Test failed.",
      },
      { status: 422 },
    );
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`${field} is required.`);
  return value;
}
