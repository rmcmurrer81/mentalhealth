'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_AUDIO_BYTES,
  READY_PREFIX,
  READY_SCHEMA,
  RESULT_SCHEMA,
  createLocalSpeechProvider,
  safeReadyMessage,
} = require('../desktop/local-speech.cjs');

function ready(overrides = {}) {
  return `${READY_PREFIX}${JSON.stringify({
    schema: READY_SCHEMA,
    port: 43124,
    localOnly: true,
    cacheOnly: true,
    rawAudioPersisted: false,
    ...overrides,
  })}`;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('local speech readiness accepts only the exact cache-only loopback contract', () => {
  assert.deepEqual(safeReadyMessage(ready()), { port: 43124 });
  for (const candidate of [
    ready({ port: 80 }),
    ready({ port: 70_000 }),
    ready({ localOnly: false }),
    ready({ cacheOnly: false }),
    ready({ rawAudioPersisted: true }),
    ready({ modelPath: 'C:\\private\\model' }),
    `${READY_PREFIX}{broken`,
    'noise',
  ]) assert.equal(safeReadyMessage(candidate), null);
});

test('local speech provider validates bounded audio and returns only a strict memory-only transcript', async () => {
  const child = fakeChild();
  const calls = [];
  const provider = createLocalSpeechProvider({
    platform: 'win32',
    scriptPath: path.resolve(__dirname, '..', 'desktop', 'local-speech-host.py'),
    spawnImpl: () => child,
    postAudioImpl: async (request) => {
      calls.push(request);
      return {
        schema: RESULT_SCHEMA,
        requestId: request.requestId,
        status: 'completed',
        text: 'A fixed synthetic phrase.',
        language: 'en',
        rawAudioPersisted: false,
      };
    },
  });
  child.stdout.emit('data', Buffer.from(`${ready()}\n`));
  assert.deepEqual(await provider.status(), {
    ready: true,
    localOnly: true,
    cacheOnly: true,
    rawAudioPersisted: false,
  });
  const audio = Buffer.from('fixed synthetic audio bytes');
  assert.deepEqual(await provider.transcribe({ requestId: 'speech-test-1', mimeType: 'audio/wav', audio }), {
    schema: RESULT_SCHEMA,
    requestId: 'speech-test-1',
    status: 'completed',
    text: 'A fixed synthetic phrase.',
    language: 'en',
    rawAudioPersisted: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].port, 43124);
  assert.equal(calls[0].mimeType, 'audio/wav');
  assert.equal(calls[0].audio, audio);
  assert.match(calls[0].token, /^[a-f0-9]{64}$/);

  for (const request of [
    { requestId: '../escape', mimeType: 'audio/wav', audio },
    { requestId: 'speech-test-2', mimeType: 'audio/mpeg', audio },
    { requestId: 'speech-test-3', mimeType: 'audio/wav', audio: new Uint8Array([1]) },
    { requestId: 'speech-test-4', mimeType: 'audio/wav', audio: Buffer.alloc(0) },
    { requestId: 'speech-test-5', mimeType: 'audio/wav', audio: Buffer.alloc(MAX_AUDIO_BYTES + 1) },
  ]) await assert.rejects(() => provider.transcribe(request), TypeError);

  provider.dispose();
  assert.equal(child.killed, true);
  assert.equal((await provider.status()).ready, false);
});

test('malformed or path-bearing speech responses fail closed without renderer-visible details', async () => {
  const child = fakeChild();
  const provider = createLocalSpeechProvider({
    platform: 'win32',
    scriptPath: path.resolve(__dirname, '..', 'desktop', 'local-speech-host.py'),
    spawnImpl: () => child,
    postAudioImpl: async () => ({
      schema: RESULT_SCHEMA,
      requestId: 'speech-test-6',
      status: 'completed',
      text: 'synthetic',
      language: 'en',
      rawAudioPersisted: false,
      modelPath: 'C:\\private\\model',
    }),
  });
  child.stdout.emit('data', Buffer.from(`${ready()}\n`));
  assert.deepEqual(await provider.transcribe({
    requestId: 'speech-test-6',
    mimeType: 'audio/wav',
    audio: Buffer.from('fixed bytes'),
  }), {
    schema: RESULT_SCHEMA,
    requestId: 'speech-test-6',
    status: 'unavailable',
    text: '',
    language: 'en',
    rawAudioPersisted: false,
  });
  provider.dispose();
});

test('speech host is offline, bearer-authenticated, bounded, and contains no persistence path', () => {
  const host = fs.readFileSync(path.resolve(__dirname, '..', 'desktop', 'local-speech-host.py'), 'utf8');
  const bridge = fs.readFileSync(path.resolve(__dirname, '..', 'desktop', 'local-speech.cjs'), 'utf8');
  assert.match(host, /ThreadingHTTPServer\(\("127\.0\.0\.1", 0\)/);
  assert.match(host, /hmac\.compare_digest/);
  assert.match(host, /io\.BytesIO\(audio\)/);
  assert.match(host, /audio = b""/);
  assert.match(host, /rawAudioPersisted": False/);
  assert.match(host, /MODEL_ID = "Systran\/faster-whisper-small\.en"/);
  assert.doesNotMatch(host, /NamedTemporaryFile|mkstemp|write_bytes|open\([^\n]*["']w/);
  assert.match(bridge, /HF_HUB_OFFLINE: '1'/);
  assert.match(bridge, /TRANSFORMERS_OFFLINE: '1'/);
  assert.match(bridge, /windowsHide: true, shell: false/);
  assert.match(bridge, /MAX_AUDIO_BYTES = 12 \* 1024 \* 1024/);
});

test('exact-package speech probe uses only the reviewed synthetic WAV and retains no transcript text', () => {
  const probe = fs.readFileSync(path.resolve(__dirname, '..', 'desktop', 'packaged-speech-probe.cjs'), 'utf8');
  const wrapper = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'Test-PackagedLocalSpeech.ps1'), 'utf8');
  assert.match(probe, /FIXED_AUDIO_SHA256 = 'C3E3682817476212C990969901028758FBBDE1EB4EB8C97153EF878B3939B33A'/);
  assert.match(probe, /fixedSyntheticPackagedAudioOnly: true/);
  assert.match(probe, /transcriptTextRetainedInReceipt: false/);
  assert.match(probe, /rawAudioPersisted: false/);
  assert.match(probe, /microphoneOpened: false/);
  assert.match(probe, /result\.text\.length < 40/);
  assert.match(probe, /replace\(\/\^\\uFEFF\/u, ''\)/);
  assert.match(wrapper, /Exact packaged local-speech probe/iu);
  assert.match(wrapper, /ELECTRON_RUN_AS_NODE/);
  assert.doesNotMatch(probe, /localStorage|AppData|Documents|Users\\/);
});
