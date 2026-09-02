'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  LOCAL_VOICE_REQUEST_SCHEMA,
  PROVIDER_REQUEST_SCHEMA,
  createLocalVoiceBridge,
} = require('./local-voice.cjs');
const {
  PROVIDER_ID,
  createChatterboxLocalVoiceProvider,
} = require('./chatterbox-local-voice.cjs');

const RECEIPT_SCHEMA = 'wellbeing.packaged-local-voice-probe.v1';
const CANCEL_RESULT_SCHEMA = 'wellbeing.local-voice.cancel-result.v1';
const HEX_SHA256 = /^[A-Fa-f0-9]{64}$/;

function findArgument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`The required --${name} argument is missing.`);
  return value;
}

function exactAbsolutePath(name) {
  const value = findArgument(name);
  if (!path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`--${name} must be a normalized absolute path.`);
  }
  return value;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReady(bridge, timeoutMilliseconds = 60_000) {
  const startedAt = Date.now();
  let status = await bridge.status();
  while (!status.ready && Date.now() - startedAt < timeoutMilliseconds) {
    await wait(500);
    status = await bridge.status();
  }
  if (!status.ready || !status.localOnly || !status.supportedProfiles.includes('soft-feminine')) {
    throw new Error('The exact packaged local voice did not become ready inside the bounded offline window.');
  }
  return { status, readyMilliseconds: Date.now() - startedAt };
}

function safeFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z]:\\[^\r\n]*/g, '[local path removed]').slice(0, 300);
}

async function runProbe({ runtimeRoot, setupSha256 }) {
  const appRoot = path.resolve(__dirname, '..');
  const buildReceiptPath = path.resolve(appRoot, '..', '..', 'BUILD-RECEIPT.json');
  const packageJsonPath = path.join(appRoot, 'package.json');
  const voiceHostPath = path.join(__dirname, 'chatterbox-voice-host.py');
  const femaleReferencePath = path.join(appRoot, 'web', 'voice-previews', 'calm-female-approved.wav');
  const requiredFiles = [buildReceiptPath, packageJsonPath, voiceHostPath, femaleReferencePath];
  for (const requiredFile of requiredFiles) {
    if (!fs.existsSync(requiredFile) || !fs.statSync(requiredFile).isFile()) {
      throw new Error('The exact package is missing a required receipt or local-voice asset.');
    }
  }

  const packageJson = readJsonFile(packageJsonPath);
  const buildReceipt = readJsonFile(buildReceiptPath);
  if (buildReceipt.packageVersion !== packageJson.version) {
    throw new Error('The packaged version and build receipt do not agree.');
  }

  const provider = createChatterboxLocalVoiceProvider({ runtimeRoot });
  const playbackEvents = new Map();
  const playbackWaiters = new Map();
  const playbackUnsubscribe = provider.onPlaybackStart((event) => {
    playbackEvents.set(event.requestId, event);
    playbackWaiters.get(event.requestId)?.(event);
    playbackWaiters.delete(event.requestId);
  });
  const waitForPlayback = (requestId, timeoutMilliseconds = 75_000) => {
    if (playbackEvents.has(requestId)) return Promise.resolve(playbackEvents.get(requestId));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        playbackWaiters.delete(requestId);
        reject(new Error('The exact package did not report a bounded actual-playback timing event.'));
      }, timeoutMilliseconds);
      playbackWaiters.set(requestId, (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  };
  const bridge = createLocalVoiceBridge({
    provider,
    approvedProviderId: PROVIDER_ID,
    speakTimeoutMs: 75_000,
  });
  try {
    const readiness = await waitForReady(bridge);
    const playbackStartedAt = Date.now();
    const playbackRequestId = 'packaged-playback-1';
    const playbackPromise = bridge.speak({
      schema: LOCAL_VOICE_REQUEST_SCHEMA,
      requestId: playbackRequestId,
      text: 'The installed local voice path is working.',
      profile: 'soft-feminine',
      locale: 'en-US',
    });
    const playbackEvent = await waitForPlayback(playbackRequestId);
    const playback = await playbackPromise;
    if (playback.status !== 'completed') {
      throw new Error(`The exact package did not confirm local playback (${playback.status}).`);
    }
    if (playbackEvent.requestId !== playbackRequestId
      || playbackEvent.timingBasis !== 'generated-waveform-amplitude-plus-text-class-heuristic'
      || playbackEvent.amplitudeFrames.length < 1
      || playbackEvent.visemeCues.length < 1
      || Object.hasOwn(playbackEvent, 'text')
      || Object.hasOwn(playbackEvent, 'path')
      || Object.hasOwn(playbackEvent, 'audio')) {
      throw new Error('The exact packaged playback timing event was missing or exceeded its output-only boundary.');
    }

    const muteRequestId = 'packaged-mute-1';
    const mutePlaybackPromise = waitForPlayback(muteRequestId);
    const mutedSpeech = provider.speak({
      schema: PROVIDER_REQUEST_SCHEMA,
      requestId: muteRequestId,
      text: 'This second local sentence is intentionally cancelled before it can continue speaking after mute.',
      profile: 'soft-feminine',
      selectorId: 'calm-female.owner-approved.v1',
      locale: 'en-US',
    });
    const mutePlaybackEvent = await mutePlaybackPromise;
    const cancelResponse = await provider.cancel(muteRequestId);
    if (!cancelResponse?.ok
      || cancelResponse.value?.schema !== CANCEL_RESULT_SCHEMA
      || cancelResponse.value?.requestId !== muteRequestId
      || cancelResponse.value?.status !== 'cancelled'
      || cancelResponse.value?.activePhase !== 'playing'
      || mutePlaybackEvent.requestId !== muteRequestId) {
      throw new Error('The exact packaged host did not acknowledge the mute cancellation.');
    }
    const muteResult = await mutedSpeech;
    if (muteResult.status !== 'failed' || muteResult.playbackConfirmed !== false) {
      throw new Error('The cancelled packaged request incorrectly claimed completed playback.');
    }

    return {
      schema: RECEIPT_SCHEMA,
      status: 'PASS',
      packageVersion: packageJson.version,
      setupZipSha256: setupSha256,
      testedAtUtc: new Date().toISOString(),
      execution: {
        source: 'Exact checksum-verified setup ZIP payload; no installer executed',
        electronRunAsNode: true,
        localOnly: true,
        modelBundled: false,
        externalDownloadAllowed: false,
      },
      readiness: {
        ready: readiness.status.ready,
        supportedProfiles: readiness.status.supportedProfiles,
        readyMilliseconds: readiness.readyMilliseconds,
      },
      playback: {
        profile: 'soft-feminine',
        requestStatus: playback.status,
        playbackConfirmed: true,
        actualPlaybackEventObserved: true,
        timingBasis: playbackEvent.timingBasis,
        amplitudeFrameCount: playbackEvent.amplitudeFrames.length,
        visemeCueCount: playbackEvent.visemeCues.length,
        elapsedMilliseconds: Date.now() - playbackStartedAt,
      },
      mute: {
        cancellationAcknowledged: true,
        actualPlaybackEventObservedBeforeMute: true,
        cancelledPhase: cancelResponse.value.activePhase,
        requestStatus: muteResult.status,
        playbackConfirmed: muteResult.playbackConfirmed,
        lateCompletionAccepted: false,
      },
      exactPackagedAssets: [
        { path: 'BUILD-RECEIPT.json', sha256: sha256(buildReceiptPath) },
        { path: 'resources/app/desktop/chatterbox-local-voice.cjs', sha256: sha256(path.join(__dirname, 'chatterbox-local-voice.cjs')) },
        { path: 'resources/app/desktop/chatterbox-voice-host.py', sha256: sha256(voiceHostPath) },
        { path: 'resources/app/web/voice-previews/calm-female-approved.wav', sha256: sha256(femaleReferencePath) },
      ],
      privacy: {
        fixedSyntheticProbeTextOnly: true,
        personalProfileRead: false,
        transcriptRead: false,
        generatedAudioRetained: false,
        resultContainsLocalPaths: false,
      },
    };
  } finally {
    playbackUnsubscribe();
    bridge.dispose();
  }
}

async function main() {
  const resultPath = exactAbsolutePath('result');
  const runtimeRoot = exactAbsolutePath('runtime-root');
  const setupSha256 = findArgument('setup-sha256').toUpperCase();
  if (!HEX_SHA256.test(setupSha256)) throw new Error('--setup-sha256 must be an exact SHA-256 digest.');
  if (fs.existsSync(resultPath)) throw new Error('The probe result path already exists.');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const receipt = await runProbe({ runtimeRoot, setupSha256 });
  fs.writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`WELLBEING_PACKAGED_LOCAL_VOICE_PROBE_OK ${JSON.stringify({ status: receipt.status, packageVersion: receipt.packageVersion })}\n`);
}

main().catch((error) => {
  process.stderr.write(`WELLBEING_PACKAGED_LOCAL_VOICE_PROBE_FAILED ${safeFailureMessage(error)}\n`);
  process.exitCode = 1;
});
