import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createVaultTiltController } from "../components/landing/landing-motion.js";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("landing continuity vault", () => {
  it("coalesces pointer tilt to animation frames and writes on the stack", () => {
    const page = source("../components/landing/LandingPage.tsx");

    expect(page).toContain("useVaultTilt");
    expect(page).toContain("stackRef");
    expect(page).not.toContain("event.currentTarget.style.setProperty");
  });

  it("applies hover movement only through compositor-safe transforms", () => {
    const css = source("../app/landing.css");

    expect(css).toMatch(/\.vault-stack\s*{[^}]*--vault-rotate-x:\s*0deg/s);
    expect(css).toMatch(/\.vault-stack\s*{[^}]*--vault-rotate-z:\s*0deg/s);
    expect(css).toMatch(
      /\.vault-stack\s*{[^}]*transform:[^}]*var\(--vault-rotate-x\)[^}]*var\(--vault-rotate-z\)/s,
    );
  });

  it("renders the current wallet, activity, settings, and Telegram feature set", () => {
    const page = source("../components/landing/LandingPage.tsx");

    expect(page).toContain('id="operations"');
    expect(page).toContain('id="telegram-alerts"');
    expect(page).toContain("Owner-configured check-in");
    expect(page).toContain("Wallet-scoped activity");
    expect(page).toContain("Signed plan updates");
    expect(page).toContain("Two monitored wallets");
    expect(page).toContain("Telegram never signs");
    expect(page).toContain("Recovery wallet required");
  });

  it("shows the authorized X account in the landing-page footer", () => {
    const page = source("../components/landing/LandingPage.tsx");
    const footer = page.slice(page.indexOf("function LandingFooter"));

    expect(footer).toContain('href="https://x.com/curioswhispers"');
    expect(footer).toContain("@curioswhispers");
  });

  it("keeps mobile vault geometry responsive without scaling the whole scene", () => {
    const css = source("../app/landing.css");

    expect(css).not.toMatch(/\.vault-scene\s*{[^}]*transform:\s*scale\(/s);
    expect(css).not.toMatch(/\.vault-scene\s*{[^}]*margin:\s*-\d/s);
    expect(css).toContain("--vault-scale");
  });

  it("preserves non-spatial feedback when reduced motion is requested", () => {
    const css = source("../app/globals.css");

    expect(css).toMatch(
      /prefers-reduced-motion:[^}]+transition-property:\s*color,\s*background-color,\s*border-color,\s*opacity/s,
    );
    expect(css).not.toContain("transition-duration: 0.01ms !important");
  });
});

describe("landing motion helpers", () => {
  it("coalesces rapid tilt updates and applies only the latest frame", () => {
    const properties = new Map<string, string>();
    const frames: FrameRequestCallback[] = [];
    const controller = createVaultTiltController(
      () => ({
        style: {
          setProperty: (name: string, value: string) =>
            properties.set(name, value),
        },
      }),
      (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      },
      () => undefined,
    );

    controller.queue(1, 2);
    controller.queue(3, 4);
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(properties).toEqual(
      new Map([
        ["--vault-rotate-x", "3.00deg"],
        ["--vault-rotate-z", "4.00deg"],
      ]),
    );
  });
});
