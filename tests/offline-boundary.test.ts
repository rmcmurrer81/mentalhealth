import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|css|html)$/.test(entry.name) ? [full] : [];
  });
}

describe("offline production boundary", () => {
  it("does not import remote fonts, styles, scripts, or media", () => {
    const sources = [...sourceFiles(`${root}src`), `${root}index.html`];
    for (const path of sources) {
      const content = readFileSync(path, "utf8");
      expect(content, path).not.toMatch(/(?:@import\s+url|<script[^>]+src|<link[^>]+href|<(?:img|audio|video)[^>]+src)\s*=?\s*["']https?:/i);
    }
  });

  it("keeps network-capable application APIs out of the deterministic core", () => {
    const sources = sourceFiles(`${root}src`);
    for (const path of sources) {
      const content = readFileSync(path, "utf8");
      expect(content, path).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
      expect(content, path).not.toMatch(/\bnavigator\.sendBeacon\s*\(/);
    }
  });
});
