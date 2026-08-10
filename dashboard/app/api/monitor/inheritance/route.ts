import { NextRequest, NextResponse } from "next/server";
import { runInheritanceMonitor } from "@/lib/inheritance-monitor";
import { createInheritanceMonitorDependencies } from "@/lib/inheritance-monitor-server";
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
  try {
    const dependencies = await createInheritanceMonitorDependencies();
    const results = await runInheritanceMonitor(dependencies);
    return NextResponse.json(summarize(results));
  } catch (error) {
    console.error("Inheritance monitor run failed.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Monitor failed" },
      { status: 500 },
    );
  }
}

function summarize(results: Awaited<ReturnType<typeof runInheritanceMonitor>>) {
  return {
    scanned: results.length,
    executed: results.filter((item) => item.status === "executed").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    results,
  };
}
