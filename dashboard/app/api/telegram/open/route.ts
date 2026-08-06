import { NextRequest, NextResponse } from "next/server";
import { loadProjectServerEnvironment } from "@/lib/server-environment";
import { resolveTelegramAccessUrl } from "@/lib/telegram-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  loadProjectServerEnvironment();
  const telegramUrl = await resolveTelegramAccessUrl();
  if (telegramUrl) return NextResponse.redirect(telegramUrl);

  return NextResponse.redirect(
    new URL("/settings?telegram=unavailable", request.url),
  );
}
