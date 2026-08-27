import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export const RUNTIME_PUBLIC_ASSETS = [
  "voice-previews/calm-female-approved.wav",
  "voice-previews/warm-male-approved.wav",
] as const;

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
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
