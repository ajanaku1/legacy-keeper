import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scheduled inheritance entry point", () => {
  it("ships an authenticated monitor route and five-minute scheduler", () => {
    const routeUrl = new URL(
      "../app/api/monitor/inheritance/route.ts",
      import.meta.url,
    );
    const workflowUrl = new URL(
      "../../.github/workflows/inheritance-monitor.yml",
      import.meta.url,
    );

    expect(existsSync(routeUrl)).toBe(true);
    expect(existsSync(workflowUrl)).toBe(true);

    const route = readFileSync(routeUrl, "utf8");
    const workflow = readFileSync(workflowUrl, "utf8");
    expect(route).toContain("authorizeInheritanceMonitor");
    expect(route).toContain("runTokenInheritanceMonitor");
    expect(route).toContain('request.headers.get("authorization")');
    expect(workflow).toMatch(/cron:\s*["']2-57\/5 \* \* \* \*["']/);
    expect(workflow).toContain("/api/monitor/inheritance");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  });

  it("uses a non-executing authentication check for manual dispatch", () => {
    const route = readFileSync(
      new URL("../app/api/monitor/inheritance/route.ts", import.meta.url),
      "utf8",
    );
    const workflow = readFileSync(
      new URL(
        "../../.github/workflows/inheritance-monitor.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(route).toContain('request.nextUrl.searchParams.get("authOnly")');
    expect(workflow).toContain("GITHUB_EVENT_NAME");
    expect(workflow).toContain("?authOnly=1");
  });

  it("ships an immediate registry-validated trigger for an eligible open dashboard", () => {
    const route = readFileSync(
      new URL("../app/api/inheritance/route.ts", import.meta.url),
      "utf8",
    );
    const dashboard = readFileSync(
      new URL("../app/(application)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );

    expect(route).toContain("runInheritanceTrigger");
    expect(route).toContain("createInheritanceMonitorDependencies");
    expect(dashboard).toContain("<AutomaticInheritanceTrigger");
    expect(dashboard).toContain("graceElapsed: keeper.graceElapsed");
  });

  it("does not present a hardcoded KeeperHub health claim", () => {
    const sidebar = readFileSync(
      new URL("../components/shell/Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(sidebar).not.toContain("KeeperHub online");
    expect(sidebar).toContain("KeeperHub configured");
  });
});
