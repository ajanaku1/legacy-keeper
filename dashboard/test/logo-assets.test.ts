import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

function publicAsset(name: string): URL {
  return new URL(`../public/${name}`, import.meta.url);
}

describe("transparent LegacyKeeper mark", () => {
  it.each(["legacykeeper-mark.svg", "favicon.svg"])(
    "%s contains no full-canvas background",
    (name) => {
      const svg = readFileSync(publicAsset(name), "utf8");

      expect(svg).not.toContain('d="M0 0h512v512H0z"');
      expect(svg).toContain('d="M224 216h64v64h-64z"');
    },
  );

  it("keeps the exported PNG corners transparent", async () => {
    const { data } = await sharp(
      fileURLToPath(publicAsset("legacykeeper-mark.png")),
    )
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(data[3]).toBe(0);
  });

  it("versions browser icon metadata for the transparent export", () => {
    const layout = readFileSync(
      new URL("../app/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(layout).toContain("transparent-mark-20260805");
    expect(layout).not.toContain("split-shield-20260803");
  });
});
