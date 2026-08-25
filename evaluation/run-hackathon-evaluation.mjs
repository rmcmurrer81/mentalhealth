import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const evaluationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(evaluationDirectory);
const rawReportPath = join(evaluationDirectory, "vitest-raw.json");
const adversarialRawReportPath = join(evaluationDirectory, "adversarial-vitest-raw.json");
const adversarialConfigPath = join(evaluationDirectory, "vitest.edge.config.ts");
const latestReportPath = join(evaluationDirectory, "latest-report.json");
const buildLogPath = join(evaluationDirectory, "build.log");
const defectsPath = join(evaluationDirectory, "known-defects.json");

function run(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

const vitestCli = join(projectRoot, "node_modules", "vitest", "vitest.mjs");
const testRun = run(process.execPath, [vitestCli, "run", "--reporter=json", `--outputFile=${rawReportPath}`]);
const adversarialRun = run(process.execPath, [vitestCli,
  "run",
  `--config=${adversarialConfigPath}`,
  "--reporter=json",
  `--outputFile=${adversarialRawReportPath}`,
]);
const typeScriptRun = run(process.execPath, [join(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-b"]);
const viteBuildRun = typeScriptRun.status === 0
  ? run(process.execPath, [join(projectRoot, "node_modules", "vite", "bin", "vite.js"), "build"])
  : { status: null, stdout: "", stderr: "Vite build skipped because TypeScript compilation failed.\n" };
const buildRun = {
  status: typeScriptRun.status === 0 && viteBuildRun.status === 0 ? 0 : 1,
  stdout: `${typeScriptRun.stdout ?? ""}${viteBuildRun.stdout ?? ""}`,
  stderr: `${typeScriptRun.stderr ?? ""}${viteBuildRun.stderr ?? ""}`,
};

writeFileSync(
  buildLogPath,
  `${buildRun.stdout ?? ""}${buildRun.stderr ?? ""}`,
  "utf8",
);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function scrubLocalPaths(value) {
  if (typeof value === "string") {
    return value
      .replaceAll(projectRoot, "<project-root>")
      .replaceAll(projectRoot.replaceAll("\\", "/"), "<project-root>");
  }
  if (Array.isArray(value)) return value.map(scrubLocalPaths);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubLocalPaths(item)]));
  }
  return value;
}

const raw = scrubLocalPaths(readJson(rawReportPath));
const adversarialRaw = scrubLocalPaths(readJson(adversarialRawReportPath));
writeFileSync(rawReportPath, `${JSON.stringify(raw)}\n`, "utf8");
writeFileSync(adversarialRawReportPath, `${JSON.stringify(adversarialRaw)}\n`, "utf8");
const knownDefects = JSON.parse(readFileSync(defectsPath, "utf8"));
const testsPassed = testRun.status === 0;
const adversarialPassed = adversarialRun.status === 0;
const buildPassed = buildRun.status === 0;
const defectCount = Array.isArray(knownDefects.items) ? knownDefects.items.length : 0;
const report = {
  schema: "wellbeing-companion.hackathon-evaluation-report.v2",
  generatedAt: new Date().toISOString(),
  scope: "Synthetic deterministic conversational stress evaluation",
  claims: {
    clinicalValidation: false,
    diagnosticEvaluation: false,
    turingTest: false,
    realPersonData: false,
    networkRequired: false,
  },
  artifacts: {
    corpus: "evaluation/fictional-longitudinal-corpus.ts",
    protocol: "evaluation/EVALUATION_PROTOCOL.md",
    rawVitestReport: "evaluation/vitest-raw.json",
    adversarialProbe: "evaluation/edge-probe.test.ts",
    adversarialConfig: "evaluation/vitest.edge.config.ts",
    adversarialRawVitestReport: "evaluation/adversarial-vitest-raw.json",
    buildLog: "evaluation/build.log",
    knownDefects: "evaluation/known-defects.json",
  },
  automatedTests: {
    passed: testsPassed,
    suitesTotal: raw.numTotalTestSuites ?? null,
    suitesPassed: raw.numPassedTestSuites ?? null,
    testsTotal: raw.numTotalTests ?? null,
    testsPassed: raw.numPassedTests ?? null,
    testsFailed: raw.numFailedTests ?? null,
    testsPending: raw.numPendingTests ?? null,
    exitCode: testRun.status,
  },
  adversarialTests: {
    passed: adversarialPassed,
    suitesTotal: adversarialRaw.numTotalTestSuites ?? null,
    suitesPassed: adversarialRaw.numPassedTestSuites ?? null,
    testsTotal: adversarialRaw.numTotalTests ?? null,
    testsPassed: adversarialRaw.numPassedTests ?? null,
    testsFailed: adversarialRaw.numFailedTests ?? null,
    testsPending: adversarialRaw.numPendingTests ?? null,
    exitCode: adversarialRun.status,
  },
  productionBuild: {
    passed: buildPassed,
    exitCode: buildRun.status,
  },
  knownDefectCount: defectCount,
  verdict: testsPassed && adversarialPassed && buildPassed && defectCount === 0 ? "PASS" : "NOT_READY",
};

writeFileSync(latestReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict !== "PASS") process.exitCode = 1;
