'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_MODEL,
  OLLAMA_ORIGIN,
  createLocalModelBridge,
} = require('../desktop/local-model.cjs');

async function main() {
  const bridge = createLocalModelBridge({ fetchImpl: globalThis.fetch });
  const status = await bridge.status();
  assert.equal(status.endpoint, OLLAMA_ORIGIN);
  assert.equal(status.externalNetwork, false);
  assert.equal(status.available, true, 'No allowlisted local Ollama model is available.');
  assert.ok(status.installedAllowlistedModels.includes(DEFAULT_MODEL), `${DEFAULT_MODEL} is not installed.`);

  const result = await bridge.enhanceSteadyReply({
    requestId: 'fictional-smoke-request-00000001',
    userText: 'I finished a small watercolor of a fictional lighthouse and feel pleased.',
    deterministicReply: 'That sounds worth celebrating. Which part of your fictional lighthouse are you happiest with?',
    safetyLevel: 'steady',
    route: 'ordinary-support',
    recentContext: [
      { role: 'user', text: 'I enjoy small fictional art projects.' },
      { role: 'companion', text: 'Small projects can make progress easy to notice.' },
    ],
    model: DEFAULT_MODEL,
  });
  if (result.status !== 'enhanced') {
    process.stderr.write(`${JSON.stringify({
      status: result.status,
      fallbackCode: result.fallback?.code ?? 'unknown',
      endpoint: result.provenance?.endpoint ?? OLLAMA_ORIGIN,
      model: result.provenance?.model ?? DEFAULT_MODEL,
      externalNetwork: result.provenance?.externalNetwork ?? false,
      durationMs: result.provenance?.durationMs ?? null,
      promptOrReplyLogged: false,
    })}\n`);
    process.exitCode = 2;
    return;
  }
  assert.equal(result.status, 'enhanced');
  assert.equal(result.provenance.endpoint, OLLAMA_ORIGIN);
  assert.equal(result.provenance.externalNetwork, false);
  assert.equal(result.provenance.deterministicGate, 'steady-only');
  assert.equal(result.provenance.model, DEFAULT_MODEL);
  assert.equal(typeof result.candidateText, 'string');
  assert.ok(result.candidateText.length > 0 && result.candidateText.length <= 1_200);
  assert.doesNotMatch(result.candidateText, /https?:\/\/|\[[^\]]+\]\(/i);

  process.stdout.write(`${JSON.stringify({
    status: result.status,
    endpoint: result.provenance.endpoint,
    model: result.provenance.model,
    externalNetwork: result.provenance.externalNetwork,
    deterministicGate: result.provenance.deterministicGate,
    candidateCharacters: result.candidateText.length,
    durationMs: result.provenance.durationMs,
    promptOrReplyLogged: false,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: 'error',
    errorName: error instanceof Error ? error.name : 'UnknownError',
    promptOrReplyLogged: false,
  })}\n`);
  process.exitCode = 1;
});
