import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const productionAssets = [
  "companion-warm-plum-v2-solid.png",
  "companion-warm-plum-concerned-v2-solid.png",
  "companion-warm-plum-happy-v2-solid.png",
  "companion-warm-plum-wave-v2-solid.png",
  "companion-light-blue-v2-solid.png",
  "companion-light-blue-concerned-v2-solid.png",
  "companion-light-blue-happy-v2-solid.png",
  "companion-light-blue-wave-v2-solid.png",
];

describe("production mascot assets", () => {
  it.each(productionAssets)("ships a real high-resolution PNG: %s", (name) => {
    const bytes = readFileSync(`${root}public/${name}`);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeGreaterThan(1_000_000);
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(1_024);
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(1_024);
  });

  it("references only the solid-background v2 mascot set in the application", () => {
    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    for (const name of productionAssets) expect(app).toContain(`/${name}`);
    expect(app).not.toMatch(/companion-(?:warm-plum|light-blue)(?:-(?:concerned|happy|wave))?-v1\.png/);
  });
});
