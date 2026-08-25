import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["evaluation/edge-probe.test.ts"],
    environment: "node",
  },
});
