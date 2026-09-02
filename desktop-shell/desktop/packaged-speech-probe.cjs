'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createLocalSpeechProvider } = require('./local-speech.cjs');

const RECEIPT_SCHEMA = 'wellbeing.packaged-local-speech-probe.v1';
const FIXED_AUDIO_SHA256 = 'C3E3682817476212C990969901028758FBBDE1EB4EB8C97153EF878B3939B33A';
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

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReady(provider, timeoutMilliseconds = 60_000) {
  const startedAt = Date.now();
  let status = await provider.status();
  while (!status.ready && Date.now() - startedAt < timeoutMilliseconds) {
    await wait(500);
    status = await provider.status();
  }
  if (!status.ready || !status.localOnly || !status.cacheOnly || status.rawAudioPersisted !== false) {
    throw new Error('The exact packaged cache-only speech provider did not become ready inside the bounded offline window.');
  }
  return { status, readyMilliseconds: Date.now() - startedAt };
}

function safeFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z]:\\[^\r\n]*/g, '[local path removed]').slice(0, 300);
}

async function runProbe({ setupSha256 }) {
  const appRoot = path.resolve(__dirname, '..');
  const buildReceiptPath = path.resolve(appRoot, '..', '..', 'BUILD-RECEIPT.json');
  const packageJsonPath = path.join(appRoot, 'package.json');
  const bridgePath = path.join(__dirname, 'local-speech.cjs');
  const hostPath = path.join(__dirname, 'local-speech-host.py');
  const fixedAudioPath = path.join(appRoot, 'web', 'voice-previews', 'calm-female-approved.wav');
  for (const requiredFile of [buildReceiptPath, packageJsonPath, bridgePath, hostPath, fixedAudioPath]) {
    if (!fs.existsSync(requiredFile) || !fs.statSync(requiredFile).isFile()) {
      throw new Error('The exact package is missing a required receipt or fixed local-speech probe asset.');
    }
  }
  if (sha256(fixedAudioPath) !== FIXED_AUDIO_SHA256) {
    throw new Error('The fixed synthetic speech probe audio does not match its reviewed checksum.');
  }
  const packageJson = readJsonFile(packageJsonPath);
  const buildReceipt = readJsonFile(buildReceiptPath);
  if (buildReceipt.packageVersion !== packageJson.version) {
    throw new Error('The packaged version and build receipt do not agree.');
  }

  const provider = createLocalSpeechProvider();
  try {
    const readiness = await waitForReady(provider);
    const startedAt = Date.now();
    const result = await provider.transcribe({
      requestId: 'packaged-fixed-synthetic-speech-1',
      mimeType: 'audio/wav',
      audio: fs.readFileSync(fixedAudioPath),
    });
    if (result.status !== 'completed'
      || result.rawAudioPersisted !== false
      || result.language !== 'en'
      || result.text.length < 40
      || !/glad/i.test(result.text)
      || !/one step/i.test(result.text)) {
      throw new Error('The exact packaged recognizer did not return the expected bounded fixed-synthetic transcription evidence.');
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
        cacheOnly: true,
        fixedSyntheticPackagedAudioOnly: true,
        externalDownloadAllowed: false,
        modelCacheExternal: true,
      },
      readiness: {
        ready: readiness.status.ready,
        readyMilliseconds: readiness.readyMilliseconds,
      },
      transcription: {
        requestStatus: result.status,
        language: result.language,
        transcriptCharacters: result.text.length,
        transcriptSha256: sha256Bytes(Buffer.from(result.text, 'utf8')),
        rawAudioPersisted: result.rawAudioPersisted,
        elapsedMilliseconds: Date.now() - startedAt,
      },
      exactPackagedAssets: [
        { path: 'BUILD-RECEIPT.json', sha256: sha256(buildReceiptPath) },
        { path: 'resources/app/desktop/local-speech.cjs', sha256: sha256(bridgePath) },
        { path: 'resources/app/desktop/local-speech-host.py', sha256: sha256(hostPath) },
        { path: 'resources/app/web/voice-previews/calm-female-approved.wav', sha256: sha256(fixedAudioPath) },
      ],
      privacy: {
        microphoneOpened: false,
        personalProfileRead: false,
        transcriptHistoryRead: false,
        transcriptTextRetainedInReceipt: false,
        rawAudioPersisted: false,
        resultContainsLocalPaths: false,
      },
    };
  } finally {
    provider.dispose();
  }
}

async function main() {
  const resultPath = exactAbsolutePath('result');
  const setupSha256 = findArgument('setup-sha256').toUpperCase();
  if (!HEX_SHA256.test(setupSha256)) throw new Error('--setup-sha256 must be an exact SHA-256 digest.');
  if (fs.existsSync(resultPath)) throw new Error('The probe result path already exists.');
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const receipt = await runProbe({ setupSha256 });
  fs.writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`WELLBEING_PACKAGED_LOCAL_SPEECH_PROBE_OK ${JSON.stringify({ status: receipt.status, packageVersion: receipt.packageVersion })}\n`);
}

main().catch((error) => {
  process.stderr.write(`WELLBEING_PACKAGED_LOCAL_SPEECH_PROBE_FAILED ${safeFailureMessage(error)}\n`);
  process.exitCode = 1;
});
