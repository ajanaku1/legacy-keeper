import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import {
  parseChainId,
  parseOwner,
  serverTelegramLinkService,
} from "@/lib/telegram-server";
import { clearTelegramSessionCookie } from "@/lib/telegram-session-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await serverTelegramLinkService().unlinkFromDashboard({
      linkId: requiredText(body.linkId, "linkId"),
      owner: parseOwner(body.owner),
      chainId: parseChainId(body.chainId),
      nonce: requiredText(body.nonce, "nonce"),
      deadline: requiredText(body.deadline, "deadline"),
      signature: requiredText(body.signature, "signature") as Hex,
    });
    const response = NextResponse.json(result);
    clearTelegramSessionCookie(response);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unlink failed.",
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
