import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard information hierarchy", () => {
  it("places check-in and its verification route before plan readiness", () => {
    const page = readFileSync(
      new URL("../app/(application)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );
    const heartbeat = page.indexOf("<HeartbeatPanel");
    const readiness = page.indexOf("<PlanReadiness");

    expect(heartbeat).toBeGreaterThan(-1);
    expect(readiness).toBeGreaterThan(-1);
    expect(heartbeat).toBeLessThan(readiness);
  });
});
