import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import {
  parseChainId,
  parseOwner,
  serverTelegramLinkService,
} from "@/lib/telegram-server";
import {
  readTelegramSessionCookie,
  setTelegramSessionCookie,
  TelegramSessionError,
} from "@/lib/telegram-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const owner = parseOwner(request.nextUrl.searchParams.get("owner"));
    const chainId = parseChainId(
      Number(request.nextUrl.searchParams.get("chainId")),
    );
    readTelegramSessionCookie(request, { owner, chainId });
    const service = serverTelegramLinkService();
    const link = await service.restoreWalletAccess({ owner, chainId });
    return linkResponse(service, link, false);
  } catch (error) {
    if (error instanceof TelegramSessionError) {
      return privateJson(
        { ok: false, code: error.code, message: error.message },
        401,
      );
    }
    return routeError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const service = serverTelegramLinkService();
    const link = await service.linkWallet({
      sessionId: requiredText(body.sessionId, "sessionId"),
      owner: parseOwner(body.owner),
      chainId: parseChainId(body.chainId),
      telegramUserId: requiredText(body.telegramUserId, "telegramUserId"),
      nonce: requiredText(body.nonce, "nonce"),
      deadline: requiredText(body.deadline, "deadline"),
      signature: requiredText(body.signature, "signature") as Hex,
    });
    return linkResponse(service, link);
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const service = serverTelegramLinkService();
    const link = await service.authenticateWalletAccess({
      owner: parseOwner(body.owner),
      chainId: parseChainId(body.chainId),
      nonce: requiredText(body.nonce, "nonce"),
      deadline: requiredText(body.deadline, "deadline"),
      signature: requiredText(body.signature, "signature") as Hex,
    });
    return linkResponse(service, link);
  } catch (error) {
    return routeError(error);
  }
}

async function linkResponse(
  service: ReturnType<typeof serverTelegramLinkService>,
  link: Awaited<
    ReturnType<ReturnType<typeof serverTelegramLinkService>["linkWallet"]>
  >,
  issueSession = true,
) {
  const [links, lastDelivery] = await Promise.all([
    service.listWallets(link.telegramUserId),
    service.latestDeliveryForWallet(link.owner, link.chainId),
  ]);
  const response = privateJson({
    ok: true,
    link,
    activeCount: links.length,
    limit: 2,
    lastDelivery,
  });
  if (issueSession) setTelegramSessionCookie(response, link);
  return response;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`${field} is required.`);
  return value;
}

function routeError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "TELEGRAM_INVALID_REQUEST";
  return privateJson(
    {
      ok: false,
      code,
      message: error instanceof Error ? error.message : "Link failed.",
    },
    422,
  );
}

function privateJson(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
