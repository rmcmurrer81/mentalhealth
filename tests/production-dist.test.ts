import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const proofDist = mkdtempSync(join(tmpdir(), "health-companion-production-dist-"));

function allRelativeFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? allRelativeFiles(resolve(directory, entry.name), relative)
      : [relative.replaceAll("\\", "/")];
  });
}

beforeAll(async () => {
  await build({
    root,
    configFile: resolve(root, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir: proofDist, emptyOutDir: true },
  });
}, 30_000);

afterAll(() => {
  rmSync(proofDist, { recursive: true, force: true });
});

describe("production distribution boundary", () => {
  it("preserves every concept/model-sheet PNG in source control", () => {
    for (const name of [
      "companion-light-blue-concerned-v2-solid.png",
      "companion-light-blue-happy-v2-solid.png",
      "companion-light-blue-v2-solid.png",
      "companion-light-blue-wave-v2-solid.png",
      "companion-warm-plum-concerned-v2-solid.png",
      "companion-warm-plum-happy-v2-solid.png",
      "companion-warm-plum-v2-solid.png",
      "companion-warm-plum-wave-v2-solid.png",
    ]) expect(existsSync(resolve(root, "public", name)), name).toBe(true);
  });

  it("ships no companion PNG and only the two voice previews from public", () => {
    const files = allRelativeFiles(proofDist);
    expect(files.some((name) => /companion-.*\.png$/i.test(name))).toBe(false);
    expect(files).toContain("voice-previews/calm-female-approved.wav");
    expect(files).toContain("voice-previews/warm-male-approved.wav");
    expect(files).not.toContain("voice-previews/README.md");
    expect(files.filter((name) => name.startsWith("voice-previews/"))).toEqual([
      "voice-previews/calm-female-approved.wav",
      "voice-previews/warm-male-approved.wav",
    ]);
  });
});
