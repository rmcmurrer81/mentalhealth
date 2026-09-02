import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["evaluation/conversation-quality-benchmark.test.ts"],
    environment: "node",
  },
});
