import { NextRequest, NextResponse } from "next/server";
import {
  parseChainId,
  parseOwner,
  serverTelegramLinkService,
  telegramDeepLink,
} from "@/lib/telegram-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const session = await serverTelegramLinkService().createLinkSession({
      owner: parseOwner(body.owner),
      chainId: parseChainId(body.chainId),
    });
    return NextResponse.json({
      sessionId: session.sessionId,
      browserToken: session.browserToken,
      nonce: session.nonce,
      deadline: session.deadline,
      telegramUrl: telegramDeepLink(session.botToken),
    });
  } catch (error) {
    return telegramRouteError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
    const browserToken = bearerToken(request);
    const session = await serverTelegramLinkService().getLinkSession(
      sessionId,
      browserToken,
    );
    return NextResponse.json({
      sessionId: session.id,
      state: session.state,
      telegramUserId: session.telegramUserId,
      owner: session.owner,
      chainId: session.chainId,
      nonce: session.nonce,
      deadline: session.deadline,
    });
  } catch (error) {
    return telegramRouteError(error);
  }
}

function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    throw new Error("Session access denied.");
  return authorization.slice("Bearer ".length);
}

function telegramRouteError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "TELEGRAM_INVALID_REQUEST";
  const message =
    error instanceof Error ? error.message : "Telegram request failed.";
  return NextResponse.json({ ok: false, code, message }, { status: 422 });
}
