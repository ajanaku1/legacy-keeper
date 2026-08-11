import { NextRequest, NextResponse } from "next/server";
import { legacyKeeperAbi } from "@/lib/contract";
import { verifyTelegramEvacuationEntry } from "@/lib/telegram-evacuation";
import {
  createSepoliaClient,
  readRegisteredPlanAcrossFactories,
  requiredEnv,
  requiredFactories,
} from "@/lib/route-server";
import { serverTelegramRepository } from "@/lib/telegram-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("entry") ?? "";
    const link = await verifyTelegramEvacuationEntry(token, {
      repository: serverTelegramRepository(),
      secret: requiredEnv("TELEGRAM_ACTION_SECRET"),
      now: () => new Date(),
    });
    const client = createSepoliaClient();
    const registeredPlan = await readRegisteredPlanAcrossFactories(
      client,
      requiredFactories(),
      link.owner,
    );
    if (registeredPlan.toLowerCase() !== link.plan.toLowerCase()) {
      throw new Error(
        "Factory ownership no longer matches this recovery entry.",
      );
    }
    const [vault, evacuationExecuted] = await Promise.all([
      client.readContract({
        address: link.plan,
        abi: legacyKeeperAbi,
        functionName: "vault",
      }),
      client.readContract({
        address: link.plan,
        abi: legacyKeeperAbi,
        functionName: "evacuationExecuted",
      }),
    ]);
    return NextResponse.json({
      owner: link.owner,
      plan: link.plan,
      chainId: link.chainId,
      safeVault: vault[0],
      recoveryKey: vault[1],
      recoveryKeyRegistered: vault[2],
      evacuationExecuted,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Recovery entry is unavailable.",
      },
      { status: 422 },
    );
  }
}
