import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { renderServiceWorker, RUNTIME_PUBLIC_ASSETS } from "./pwa-build.js";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  // Concept/model-sheet PNGs remain in source control, but production builds
  // receive only runtime assets explicitly used by the application.
  publicDir: command === "build" ? false : "public",
  plugins: [
    react(),
    {
      name: "emit-approved-runtime-public-assets",
      apply: "build",
      buildStart() {
        for (const relativePath of RUNTIME_PUBLIC_ASSETS) {
          this.emitFile({
            type: "asset",
            fileName: relativePath,
            source: readFileSync(`${projectRoot}public/${relativePath}`),
          });
        }
      },
    },
    {
      name: "emit-exact-offline-shell",
      apply: "build",
      generateBundle(_options, bundle) {
        const outputs = Object.values(bundle)
          .filter((output) => !output.fileName.endsWith(".map") && output.fileName !== "sw.js")
          .sort((left, right) => left.fileName.localeCompare(right.fileName));
        const digest = createHash("sha256");
        for (const output of outputs) {
          digest.update(output.fileName);
          digest.update("\0");
          digest.update(output.type === "chunk"
            ? output.code
            : typeof output.source === "string"
              ? output.source
              : output.source);
          digest.update("\0");
        }
        const buildVersion = digest.digest("hex").slice(0, 16);
        const precacheUrls = [...new Set([
          "/",
          "/index.html",
          ...outputs.map((output) => `/${output.fileName}`),
        ])].sort();
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: renderServiceWorker(precacheUrls, buildVersion),
        });
      },
    },
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
