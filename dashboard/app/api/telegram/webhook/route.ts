import { NextRequest, NextResponse } from "next/server";
import {
  assertTelegramWebhookSecret,
  handleTelegramUpdate,
  type TelegramUpdate,
} from "@/lib/telegram-bot";
import { requiredEnv } from "@/lib/route-server";
import { serverTelegramBotDependencies } from "@/lib/telegram-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertTelegramWebhookSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      requiredEnv("TELEGRAM_WEBHOOK_SECRET"),
    );
    const update = (await request.json()) as TelegramUpdate;
    await handleTelegramUpdate(update, serverTelegramBotDependencies());
    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = error instanceof Error && /webhook secret/i.test(error.message);
    return NextResponse.json(
      { ok: false, error: unauthorized ? "Invalid webhook secret." : "Update rejected." },
      { status: unauthorized ? 401 : 422 },
    );
  }
}
