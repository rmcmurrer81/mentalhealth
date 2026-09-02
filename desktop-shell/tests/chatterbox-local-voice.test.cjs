'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PROVIDER_ID,
  PLAYBACK_PREFIX,
  PLAYBACK_SCHEMA,
  READY_PREFIX,
  READY_SCHEMA,
  createChatterboxLocalVoiceProvider,
  providerState,
  safePlaybackMessage,
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

function playback(overrides = {}) {
  return `${PLAYBACK_PREFIX}${JSON.stringify({
    schema: PLAYBACK_SCHEMA,
    requestId: 'voice-event-1',
    durationMs: 640,
    timingBasis: 'generated-waveform-amplitude-plus-text-class-heuristic',
    amplitudeFrames: [{ startMs: 0, level: 0.1 }, { startMs: 80, level: 0.55 }],
    visemeCues: [{ startMs: 0, endMs: 320, viseme: 'jaw-open' }, { startMs: 320, endMs: 640, viseme: 'rounded' }],
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

test('playback timing accepts only bounded waveform-amplitude and text-class heuristic events', () => {
  assert.deepEqual(safePlaybackMessage(playback()), {
    schema: PLAYBACK_SCHEMA,
    requestId: 'voice-event-1',
    durationMs: 640,
    timingBasis: 'generated-waveform-amplitude-plus-text-class-heuristic',
    amplitudeFrames: [{ startMs: 0, level: 0.1 }, { startMs: 80, level: 0.55 }],
    visemeCues: [{ startMs: 0, endMs: 320, viseme: 'jaw-open' }, { startMs: 320, endMs: 640, viseme: 'rounded' }],
  });
  for (const candidate of [
    playback({ requestId: '../escape' }),
    playback({ durationMs: 99 }),
    playback({ timingBasis: 'phoneme-alignment' }),
    playback({ amplitudeFrames: [{ startMs: 0, level: 2 }] }),
    playback({ amplitudeFrames: [{ startMs: 80, level: 0.2 }, { startMs: 20, level: 0.3 }] }),
    playback({ visemeCues: [{ startMs: 0, endMs: 700, viseme: 'rounded' }] }),
    playback({ visemeCues: [{ startMs: 0, endMs: 100, viseme: 'raw-audio-path' }] }),
    playback({ text: 'must never cross the event boundary' }),
  ]) assert.equal(safePlaybackMessage(candidate), null);
});

test('provider emits sanitized timing only for its live request and unsubscribes cleanly', async () => {
  const child = fakeChild();
  let finishPost;
  const provider = createChatterboxLocalVoiceProvider({
    platform: 'win32',
    runtimeRoot: __dirname,
    referenceRoot: path.resolve(__dirname, '..', '..', 'public', 'voice-previews'),
    spawnImpl: () => child,
    postJsonImpl: () => new Promise((resolve) => { finishPost = resolve; }),
  });
  child.stdout.emit('data', Buffer.from(`${ready()}\n`));
  const received = [];
  const unsubscribe = provider.onPlaybackStart((event) => received.push(event));
  child.stdout.emit('data', Buffer.from(`${playback({ requestId: 'not-active' })}\n`));
  assert.equal(received.length, 0);

  const speaking = provider.speak({ requestId: 'voice-event-1' });
  child.stdout.emit('data', Buffer.from(`${playback()}\n`));
  assert.equal(received.length, 1);
  assert.equal(received[0].requestId, 'voice-event-1');
  assert.equal(Object.hasOwn(received[0], 'text'), false);
  assert.equal(Object.hasOwn(received[0], 'audio'), false);
  assert.equal(Object.hasOwn(received[0], 'path'), false);
  finishPost({ ok: true, value: {
    schema: 'wellbeing.local-voice.provider-result.v1',
    requestId: 'voice-event-1',
    status: 'completed',
    playbackConfirmed: true,
  } });
  assert.equal((await speaking).status, 'completed');

  unsubscribe();
  provider.dispose();
  assert.equal(child.killed, true);
});

test('the Windows host makes playback asynchronously cancellable and acknowledges the active phase', () => {
  const host = fs.readFileSync(path.resolve(__dirname, '..', 'desktop', 'chatterbox-voice-host.py'), 'utf8');
  assert.match(host, /winsound\.SND_FILENAME \| winsound\.SND_ASYNC \| winsound\.SND_NODEFAULT/);
  assert.match(host, /winsound\.PlaySound\(None, flags\)/);
  assert.match(host, /request_generation != self\.generation\(\)/);
  assert.match(host, /self\.set_phase\(request_id, "generating"\)/);
  assert.match(host, /self\.set_phase\(request_id, "playing"\)/);
  assert.match(host, /CANCEL_RESULT_SCHEMA = "wellbeing\.local-voice\.cancel-result\.v1"/);
  assert.match(host, /"status": "cancelled" if accepted else "not-active"/);
  assert.doesNotMatch(host, /winsound\.PlaySound\(str\(output\), winsound\.SND_FILENAME\)\s*$/m);
  const playingLifecycle = host.slice(host.indexOf('duration_seconds ='), host.indexOf('deadline =', host.indexOf('duration_seconds =')));
  const playbackCall = playingLifecycle.indexOf('winsound.PlaySound(');
  const cancellationRecheck = playingLifecycle.indexOf('if request_generation != self.generation():', playbackCall);
  const timingNotification = playingLifecycle.indexOf('print(PLAYBACK_PREFIX', cancellationRecheck);
  assert.ok(playbackCall >= 0, 'the asynchronous Windows playback call must exist');
  assert.ok(cancellationRecheck > playbackCall, 'cancellation must be rechecked after Windows accepts playback');
  assert.ok(timingNotification > cancellationRecheck, 'mouth timing must not be announced until playback starts and cancellation is rechecked');
});

test('the shipped exact-package probe proves one playback and one suppression without profile data', () => {
  const probe = fs.readFileSync(path.resolve(__dirname, '..', 'desktop', 'packaged-voice-probe.cjs'), 'utf8');
  assert.match(probe, /createLocalVoiceBridge/);
  assert.match(probe, /createChatterboxLocalVoiceProvider/);
  assert.match(probe, /Exact checksum-verified setup ZIP payload; no installer executed/);
  assert.match(probe, /requestStatus: playback\.status/);
  assert.match(probe, /playbackConfirmed: true/);
  assert.match(probe, /actualPlaybackEventObserved: true/);
  assert.match(probe, /timingBasis: playbackEvent\.timingBasis/);
  assert.match(probe, /cancellationAcknowledged: true/);
  assert.match(probe, /actualPlaybackEventObservedBeforeMute: true/);
  assert.match(probe, /cancelResponse\.value\?\.activePhase !== 'playing'/);
  assert.match(probe, /playbackConfirmed: muteResult\.playbackConfirmed/);
  assert.match(probe, /personalProfileRead: false/);
  assert.match(probe, /transcriptRead: false/);
  assert.match(probe, /generatedAudioRetained: false/);
  assert.match(probe, /replace\(\/\^\\uFEFF\/u, ''\)/);
  assert.doesNotMatch(probe, /localStorage|AppData|Documents|Users\\/);
});
