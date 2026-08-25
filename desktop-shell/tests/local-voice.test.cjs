'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  IPC_CHANNELS,
  LOCAL_VOICE_REQUEST_SCHEMA,
  LOCAL_VOICE_RESULT_SCHEMA,
  LOCAL_VOICE_STATUS_SCHEMA,
  PROVIDER_RESULT_SCHEMA,
  PROVIDER_REQUEST_SCHEMA,
  PROVIDER_STATE_SCHEMA,
  PUBLIC_PROVIDER_ID,
  createLocalVoiceBridge,
  createUnavailableLocalVoiceProvider,
  registerLocalVoiceIpc,
  validateSpeakRequest,
} = require('../desktop/local-voice.cjs');

const request = (overrides = {}) => ({
  schema: LOCAL_VOICE_REQUEST_SCHEMA,
  requestId: 'voice-1-1',
  text: 'This reply stays visible while the local broker is checked.',
  profile: 'soft-feminine',
  locale: 'en-US',
  ...overrides,
});

const readyState = (overrides = {}) => ({
  schema: PROVIDER_STATE_SCHEMA,
  providerId: 'fixture.local',
  approved: true,
  active: true,
  ready: true,
  localOnly: true,
  playbackReady: true,
  supportedProfiles: ['soft-feminine', 'warm-neutral', 'calm-masculine'],
  supportedLocales: ['en-US'],
  ...overrides,
});

const completed = (requestId) => ({
  schema: PROVIDER_RESULT_SCHEMA,
  requestId,
  status: 'completed',
  playbackConfirmed: true,
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function providerFixture({ state = readyState(), speakImpl } = {}) {
  const calls = { status: 0, speak: [], cancel: [], dispose: 0 };
  const provider = {
    status: async () => {
      calls.status += 1;
      return typeof state === 'function' ? state() : state;
    },
    speak: async (input) => {
      calls.speak.push(input);
      return speakImpl ? speakImpl(input, calls.speak.length - 1) : completed(input.requestId);
    },
    cancel: (requestId) => { calls.cancel.push(requestId); },
    dispose: () => { calls.dispose += 1; },
  };
  return { calls, provider };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for the local-voice fixture.');
}

test('desktop wire schemas and profiles stay synchronized with the renderer contract', () => {
  const rendererContract = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'lib', 'local-voice-client.ts'), 'utf8');
  for (const value of [LOCAL_VOICE_STATUS_SCHEMA, LOCAL_VOICE_REQUEST_SCHEMA, LOCAL_VOICE_RESULT_SCHEMA]) {
    assert.match(rendererContract, new RegExp(value.replaceAll('.', '\\.')));
  }
  for (const profile of ['soft-feminine', 'warm-neutral', 'calm-masculine']) {
    assert.match(rendererContract, new RegExp(`"${profile}"`));
  }
});

test('the shipped provider is exact, inactive, and never claims playback', async () => {
  const bridge = createLocalVoiceBridge({
    provider: createUnavailableLocalVoiceProvider(),
    approvedProviderId: null,
  });
  assert.deepEqual(await bridge.status(), {
    schema: LOCAL_VOICE_STATUS_SCHEMA,
    providerId: PUBLIC_PROVIDER_ID,
    ready: false,
    localOnly: true,
    supportedProfiles: [],
    unavailableCode: 'not-configured',
  });
  assert.deepEqual(await bridge.speak(request()), {
    schema: LOCAL_VOICE_RESULT_SCHEMA,
    requestId: 'voice-1-1',
    status: 'unavailable',
  });
});

test('speak validation rejects malformed, extra, oversized, control-bearing, and unapproved fields', () => {
  const invalid = [
    null,
    { ...request(), token: 'renderer-secret' },
    request({ schema: 'wrong.schema' }),
    request({ requestId: '../voice' }),
    request({ text: 'x'.repeat(221) }),
    request({ text: 'line one\nline two' }),
    request({ text: 'safe\u202eunsafe' }),
    request({ profile: 'system-default' }),
    request({ locale: 'en_us' }),
  ];
  for (const candidate of invalid) assert.throws(() => validateSpeakRequest(candidate));
});

test('malformed, unapproved, inactive, nonlocal, and playback-unready states fail before synthesis', async () => {
  const cases = [
    [{ ...readyState(), token: 'must-not-cross-ipc' }, 'not-configured', true],
    [readyState({ approved: false }), 'not-configured', true],
    [readyState({ active: false }), 'not-ready', true],
    [readyState({ ready: false }), 'not-ready', true],
    [readyState({ localOnly: false }), 'not-ready', false],
    [readyState({ playbackReady: false }), 'not-ready', true],
    [readyState({ providerId: 'different.local' }), 'not-configured', true],
  ];
  for (const [state, expectedCode, expectedLocalOnly] of cases) {
    const fixture = providerFixture({ state });
    const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
    const status = await bridge.status();
    assert.equal(status.ready, false);
    assert.equal(status.localOnly, expectedLocalOnly);
    assert.equal(status.unavailableCode, expectedCode);
    assert.deepEqual(Object.keys(status).sort(), ['localOnly', 'providerId', 'ready', 'schema', 'supportedProfiles', 'unavailableCode']);
    assert.equal((await bridge.speak(request())).status, 'unavailable');
    assert.equal(fixture.calls.speak.length, 0);
    assert.equal(JSON.stringify(status).includes('token'), false);
  }
});

test('only an explicitly approved local playback test double can complete', async () => {
  const fixture = providerFixture();
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
  assert.deepEqual(await bridge.status(), {
    schema: LOCAL_VOICE_STATUS_SCHEMA,
    providerId: PUBLIC_PROVIDER_ID,
    ready: true,
    localOnly: true,
    supportedProfiles: ['soft-feminine', 'calm-masculine'],
  });
  const result = await bridge.speak(request());
  assert.deepEqual(result, {
    schema: LOCAL_VOICE_RESULT_SCHEMA,
    requestId: 'voice-1-1',
    status: 'completed',
  });
  assert.deepEqual(fixture.calls.speak[0], {
    schema: PROVIDER_REQUEST_SCHEMA,
    requestId: 'voice-1-1',
    text: 'This reply stays visible while the local broker is checked.',
    profile: 'soft-feminine',
    selectorId: 'calm-female.owner-approved.v1',
    locale: 'en-US',
  });
  assert.equal(JSON.stringify(fixture.calls.speak[0]).match(/token|model|outputPath/), null);
});

test('an unapproved future preset is filtered from status and never reaches the provider', async () => {
  const fixture = providerFixture();
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
  const status = await bridge.status();
  assert.deepEqual(status.supportedProfiles, ['soft-feminine', 'calm-masculine']);
  const result = await bridge.speak(request({ profile: 'warm-neutral' }));
  assert.equal(result.status, 'unavailable');
  assert.equal(fixture.calls.speak.length, 0);
});

test('unconfirmed, mismatched, and path-bearing provider results never become completed or cross IPC', async () => {
  const results = [
    { ...completed('voice-1-1'), playbackConfirmed: false },
    completed('voice-stale'),
    { ...completed('voice-1-1'), outputPath: 'C:\\private\\voice.wav' },
  ];
  for (const providerResult of results) {
    const fixture = providerFixture({ speakImpl: async () => providerResult });
    const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
    assert.equal((await bridge.status()).ready, true);
    const result = await bridge.speak(request());
    assert.deepEqual(result, {
      schema: LOCAL_VOICE_RESULT_SCHEMA,
      requestId: 'voice-1-1',
      status: 'failed',
    });
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.deepEqual(fixture.calls.cancel, ['voice-1-1']);
  }
});

test('validated failed and unavailable results still cancel possible residual playback', async () => {
  for (const status of ['failed', 'unavailable']) {
    const fixture = providerFixture({ speakImpl: async (input) => ({
      schema: PROVIDER_RESULT_SCHEMA,
      requestId: input.requestId,
      status,
      playbackConfirmed: false,
    }) });
    const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
    assert.equal((await bridge.status()).ready, true);
    assert.equal((await bridge.speak(request())).status, status);
    assert.deepEqual(fixture.calls.cancel, ['voice-1-1']);
  }
});

test('cancel settles immediately, calls provider cancellation once, and ignores late completion', async () => {
  const pending = deferred();
  const fixture = providerFixture({ speakImpl: () => pending.promise });
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
  assert.equal((await bridge.status()).ready, true);
  const speaking = bridge.speak(request());
  await waitFor(() => fixture.calls.speak.length === 1);

  bridge.cancel('voice-1-1');
  bridge.cancel('voice-1-1');
  assert.equal((await speaking).status, 'failed');
  assert.deepEqual(fixture.calls.cancel, ['voice-1-1']);

  pending.resolve(completed('voice-1-1'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.calls.cancel, ['voice-1-1']);
});

test('an old completion cannot settle a same-ID request started after cancellation', async () => {
  const operations = [];
  const fixture = providerFixture({ speakImpl: () => {
    const operation = deferred();
    operations.push(operation);
    return operation.promise;
  } });
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });

  assert.equal((await bridge.status()).ready, true);
  const first = bridge.speak(request());
  await waitFor(() => operations.length === 1);
  bridge.cancel('voice-1-1');
  assert.equal((await first).status, 'failed');

  assert.equal((await bridge.status()).ready, true);
  const second = bridge.speak(request());
  await waitFor(() => operations.length === 2);
  operations[0].resolve(completed('voice-1-1'));
  let secondSettled = false;
  void second.then(() => { secondSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondSettled, false);

  operations[1].resolve(completed('voice-1-1'));
  assert.equal((await second).status, 'completed');
});

test('cancelAll invalidates an in-flight status lease before hide/reopen can synthesize', async () => {
  const statusPending = deferred();
  const fixture = providerFixture({ state: () => statusPending.promise });
  fixture.provider.status = async () => {
    fixture.calls.status += 1;
    return statusPending.promise;
  };
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
  const readiness = bridge.status();
  await waitFor(() => fixture.calls.status === 1);
  bridge.cancelAll();
  statusPending.resolve(readyState());
  const staleStatus = await readiness;
  assert.equal(staleStatus.ready, false);
  assert.equal(staleStatus.unavailableCode, 'not-ready');
  assert.equal((await bridge.speak(request())).status, 'unavailable');
  assert.equal(fixture.calls.speak.length, 0);

  bridge.dispose();
  bridge.dispose();
  assert.equal((await bridge.status()).unavailableCode, 'not-ready');
  assert.equal((await bridge.speak(request({ requestId: 'voice-2-1' }))).status, 'unavailable');
  assert.equal(fixture.calls.status, 1);
  assert.equal(fixture.calls.dispose, 1);
});

test('only one distinct request can be active at a time', async () => {
  const pending = deferred();
  const fixture = providerFixture({ speakImpl: () => pending.promise });
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
  assert.equal((await bridge.status()).ready, true);
  const first = bridge.speak(request());
  await waitFor(() => fixture.calls.speak.length === 1);

  const second = await bridge.speak(request({ requestId: 'voice-2-1' }));
  assert.equal(second.status, 'failed');
  assert.equal(fixture.calls.speak.length, 1);

  bridge.cancel('voice-1-1');
  assert.equal((await first).status, 'failed');
  pending.resolve(completed('voice-1-1'));
});

test('bounded provider timeouts return unavailable or failed without leaking provider errors', async () => {
  const never = new Promise(() => undefined);
  const statusFixture = providerFixture();
  statusFixture.provider.status = () => never;
  const statusBridge = createLocalVoiceBridge({
    provider: statusFixture.provider,
    approvedProviderId: 'fixture.local',
    statusTimeoutMs: 5,
  });
  assert.equal((await statusBridge.status()).unavailableCode, 'not-configured');

  const speakFixture = providerFixture({ speakImpl: () => never });
  const speakBridge = createLocalVoiceBridge({
    provider: speakFixture.provider,
    approvedProviderId: 'fixture.local',
    speakTimeoutMs: 5,
  });
  assert.equal((await speakBridge.status()).ready, true);
  assert.equal((await speakBridge.speak(request())).status, 'failed');
  assert.deepEqual(speakFixture.calls.cancel, ['voice-1-1']);
});

test('IPC registers only status, speak, and cancel and rejects untrusted senders', async () => {
  const fixture = providerFixture();
  const bridge = createLocalVoiceBridge({ provider: fixture.provider, approvedProviderId: 'fixture.local' });
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  registerLocalVoiceIpc({
    ipcMain,
    bridge,
    isTrustedEvent: (event) => event?.trusted === true,
  });
  assert.deepEqual([...handlers.keys()].sort(), Object.values(IPC_CHANNELS).sort());

  const deniedStatus = await handlers.get(IPC_CHANNELS.status)({ trusted: false });
  assert.equal(deniedStatus.ready, false);
  assert.equal(fixture.calls.status, 0);
  assert.equal((await handlers.get(IPC_CHANNELS.speak)({ trusted: false }, request())).status, 'failed');
  handlers.get(IPC_CHANNELS.cancel)({ trusted: false }, 'voice-1-1');
  assert.deepEqual(fixture.calls.cancel, []);

  assert.equal((await handlers.get(IPC_CHANNELS.status)({ trusted: true })).ready, true);
  assert.equal((await handlers.get(IPC_CHANNELS.speak)({ trusted: true }, request())).status, 'completed');
  await assert.rejects(() => handlers.get(IPC_CHANNELS.speak)({ trusted: true }, { ...request(), model: 'hidden' }));
});
