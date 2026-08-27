'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  PROVIDER_ID,
  READY_PREFIX,
  READY_SCHEMA,
  createChatterboxLocalVoiceProvider,
  providerState,
  safeReadyMessage,
} = require('../desktop/chatterbox-local-voice.cjs');

function ready(overrides = {}) {
  return `${READY_PREFIX}${JSON.stringify({
    schema: READY_SCHEMA,
    port: 43123,
    profiles: ['soft-feminine', 'calm-masculine'],
    localOnly: true,
    modelBundled: false,
    ...overrides,
  })}`;
}

test('ready handshake accepts only the exact loopback-host contract', () => {
  assert.deepEqual(safeReadyMessage(ready()), { port: 43123 });
  for (const candidate of [
    ready({ port: 80 }),
    ready({ port: 70000 }),
    ready({ localOnly: false }),
    ready({ modelBundled: true }),
    ready({ profiles: ['soft-feminine'] }),
    ready({ endpoint: 'https://example.com' }),
    'noise',
    `${READY_PREFIX}{broken`,
  ]) assert.equal(safeReadyMessage(candidate), null);
});

test('provider status is truthful while the local host is warming or unavailable', async () => {
  assert.deepEqual(providerState(), {
    schema: 'wellbeing.local-voice.provider-state.v1',
    providerId: PROVIDER_ID,
    approved: true,
    active: false,
    ready: false,
    localOnly: true,
    playbackReady: false,
    supportedProfiles: [],
    supportedLocales: [],
  });
  const provider = createChatterboxLocalVoiceProvider({
    platform: 'not-windows',
    runtimeRoot: path.resolve(__dirname, 'unused-runtime'),
  });
  assert.equal((await provider.status()).ready, false);
  provider.dispose();
  assert.equal((await provider.status()).active, false);
});
