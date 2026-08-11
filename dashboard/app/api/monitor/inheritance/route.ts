import { NextRequest, NextResponse } from "next/server";
import { runInheritanceMonitor } from "@/lib/inheritance-monitor";
import { runTokenInheritanceMonitor } from "@/lib/token-inheritance-monitor";
import {
  createInheritanceMonitorDependencies,
  createTokenInheritanceMonitorDependencies,
} from "@/lib/inheritance-monitor-server";
import { authorizeInheritanceMonitor } from "@/lib/monitor-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authorized = await authorizeInheritanceMonitor(
    request.headers.get("authorization"),
  );
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("authOnly") === "1") {
    return NextResponse.json({ authorized: true });
  }
  try {
    const [dependencies, tokenDependencies] = await Promise.all([
      createInheritanceMonitorDependencies(),
      createTokenInheritanceMonitorDependencies(),
    ]);
    const [results, tokenResults] = await Promise.all([
      runInheritanceMonitor(dependencies),
      runTokenInheritanceMonitor(tokenDependencies),
    ]);
    return NextResponse.json({
      native: summarize(results),
      tokens: summarize(tokenResults),
    });
  } catch (error) {
    console.error("Inheritance monitor run failed.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Monitor failed" },
      { status: 500 },
    );
  }
}

function summarize(
  results: readonly { status: "skipped" | "executed" | "failed" }[],
) {
  return {
    scanned: results.length,
    executed: results.filter((item) => item.status === "executed").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    results,
  };
}
