import { NextRequest, NextResponse } from "next/server";
import { ActionError } from "@/lib/action-error";
import {
  parseInheritanceTriggerRequest,
  runInheritanceTrigger,
} from "@/lib/inheritance-trigger";
import {
  createInheritanceMonitorDependencies,
  createTokenInheritanceMonitorDependencies,
} from "@/lib/inheritance-monitor-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const trigger = parseInheritanceTriggerRequest(await request.json());
    const [nativeDependencies, tokenDependencies] = await Promise.all([
      createInheritanceMonitorDependencies(),
      createTokenInheritanceMonitorDependencies(),
    ]);
    const result = await runInheritanceTrigger(
      trigger,
      nativeDependencies,
      tokenDependencies,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Immediate inheritance trigger failed.", error);
    const invalid = error instanceof ActionError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Trigger failed" },
      { status: invalid ? 400 : 500 },
    );
  }
}
