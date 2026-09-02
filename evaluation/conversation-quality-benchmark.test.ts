import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  benchmarkCategories,
  benchmarkMetrics,
  conversationBenchmarkCases,
  renderConversationBenchmarkMarkdown,
  runConversationQualityBenchmark,
} from "./conversation-quality-benchmark";

const evaluationDirectory = dirname(fileURLToPath(import.meta.url));
const verificationDirectory = resolve(evaluationDirectory, "..", "verification");
const jsonReportPath = resolve(verificationDirectory, "CONVERSATION_QUALITY_BENCHMARK_LATEST.json");
const markdownReportPath = resolve(verificationDirectory, "CONVERSATION_QUALITY_BENCHMARK_LATEST.md");

describe("deterministic adversarial and situational conversation benchmark", () => {
  it("covers every required life-situation domain and the owner-reported conflict continuity case", () => {
    expect(conversationBenchmarkCases).toHaveLength(52);
    expect(new Set(conversationBenchmarkCases.map((scenario) => scenario.category))).toEqual(new Set(benchmarkCategories));
    for (const category of benchmarkCategories) {
      const expectedCases = category === "conflict" ? 4 : 3;
      expect(conversationBenchmarkCases.filter((scenario) => scenario.category === category), category).toHaveLength(expectedCases);
    }
  });

  it("scores every required quality metric and is byte-for-byte deterministic", () => {
    const first = runConversationQualityBenchmark();
    const second = runConversationQualityBenchmark();
    expect(second).toEqual(first);
    expect(first.totals.categories).toBe(17);
    expect(first.totals.cases).toBe(52);
    expect(first.totals.turns).toBe(57);
    for (const metric of benchmarkMetrics) {
      expect(first.byMetric[metric].checks, metric).toBeGreaterThan(0);
      expect(first.byMetric[metric].passed + first.byMetric[metric].failed, metric).toBe(first.byMetric[metric].checks);
    }
  });

  it("writes exact structured and human-readable baseline failure reports", () => {
    const report = runConversationQualityBenchmark();
    mkdirSync(verificationDirectory, { recursive: true });
    writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(markdownReportPath, renderConversationBenchmarkMarkdown(report), "utf8");
    expect(report.claims).toEqual({
      syntheticDataOnly: true,
      clinicalValidation: false,
      diagnosticEvaluation: false,
      networkRequired: false,
      responseImplementationChanged: false,
    });
    expect(report.failures.every((failure) => failure.reason.length > 0 && failure.response.length > 0)).toBe(true);
    process.stdout.write(`\nConversation benchmark: ${report.totals.passed}/${report.totals.checks} checks passed (${report.totals.scorePercent}%); ${report.totals.failed} failed checks.\n`);
    process.stdout.write(`Reports: ${jsonReportPath}\n${markdownReportPath}\n`);
  });
});
