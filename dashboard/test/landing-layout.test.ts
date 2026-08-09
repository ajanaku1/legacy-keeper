import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const landingCss = readFileSync(
  new URL("../app/landing.css", import.meta.url),
  "utf8",
);

describe("landing section layout", () => {
  it("places the architecture register left and its write-up right on desktop", () => {
    expect(landingCss).toContain('grid-template-areas: "register heading";');
    expect(landingCss).toContain(".architecture-register {\n  grid-area: register;");
    expect(landingCss).toContain(
      ".architecture-section .landing-section-heading {\n  grid-area: heading;",
    );
  });

  it("places the private-alert write-up left and Telegram panel right on desktop", () => {
    expect(landingCss).toContain('grid-template-areas: "heading proof";');
    expect(landingCss).toContain(".telegram-proof-panel {\n  grid-area: proof;");
    expect(landingCss).toContain(
      ".telegram-section .landing-section-heading {\n  grid-area: heading;",
    );
  });

  it("keeps each write-up before its detail block on narrow screens", () => {
    expect(landingCss).toContain('grid-template-areas:\n      "heading"\n      "register";');
    expect(landingCss).toContain('grid-template-areas:\n      "heading"\n      "proof";');
  });
});
