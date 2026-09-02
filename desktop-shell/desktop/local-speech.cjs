'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const READY_SCHEMA = 'wellbeing.local-speech.host-ready.v1';
const RESULT_SCHEMA = 'wellbeing.local-speech.provider-result.v1';
const READY_PREFIX = 'WELLBEING_ASR_READY ';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024;
const STARTUP_TIMEOUT_MS = 45_000;
const TRANSCRIBE_TIMEOUT_MS = 75_000;
const ALLOWED_TYPES = Object.freeze(['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4']);
const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function safeReadyMessage(line) {
  if (typeof line !== 'string' || !line.startsWith(READY_PREFIX) || Buffer.byteLength(line, 'utf8') > 2_048) return null;
  try {
    const value = JSON.parse(line.slice(READY_PREFIX.length));
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).sort().join(',') !== 'cacheOnly,localOnly,port,rawAudioPersisted,schema'
      || value.schema !== READY_SCHEMA || value.localOnly !== true || value.cacheOnly !== true
      || value.rawAudioPersisted !== false || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) return null;
    return Object.freeze({ port: value.port });
  } catch {
    return null;
  }
}

function postAudio({ port, token, requestId, mimeType, audio, timeoutMs = TRANSCRIBE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const request = http.request({
      host: '127.0.0.1', port, path: '/transcribe', method: 'POST', agent: false,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
        'Content-Length': audio.length,
        'X-Wellbeing-Request-Id': requestId,
        Connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk); else request.destroy();
      });
      response.on('end', () => {
        if (bytes > MAX_RESPONSE_BYTES || response.statusCode !== 200) return finish(null);
        try { return finish(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { return finish(null); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('local speech timeout')));
    request.on('error', () => finish(null));
    request.end(audio);
  });
}

function unavailableResult(requestId) {
  return Object.freeze({ schema: RESULT_SCHEMA, requestId, status: 'unavailable', text: '', language: 'en', rawAudioPersisted: false });
}

function createLocalSpeechProvider({
  pythonLauncher = process.platform === 'win32' ? 'py.exe' : 'python3',
  scriptPath = path.join(__dirname, 'local-speech-host.py'),
  platform = process.platform,
  spawnImpl = spawn,
  postAudioImpl = postAudio,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
} = {}) {
  let active = true;
  let child = null;
  let ready = null;
  let busy = false;
  let startupTimer = null;
  let stdoutBuffer = '';
  const token = crypto.randomBytes(32).toString('hex');

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    ready = null;
    const running = child;
    child = null;
    if (running && !running.killed) { try { running.kill(); } catch { /* exited */ } }
  }

  if (platform === 'win32' && fs.existsSync(scriptPath)) {
    try {
      child = spawnImpl(pythonLauncher, ['-3.14', scriptPath], {
        windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', WELLBEING_ASR_AUTH_TOKEN: token },
      });
      startupTimer = setTimeout(() => { if (!ready) stop(); }, startupTimeoutMs);
      child.stdout?.on('data', (chunk) => {
        stdoutBuffer = `${stdoutBuffer}${chunk.toString('utf8')}`.slice(-2_048);
        for (const line of stdoutBuffer.split(/\r?\n/u)) {
          const parsed = safeReadyMessage(line.trim());
          if (!parsed) continue;
          ready = parsed;
          if (startupTimer) clearTimeout(startupTimer);
          startupTimer = null;
          stdoutBuffer = '';
          break;
        }
      });
      child.stderr?.on('data', () => undefined);
      child.on('error', () => { ready = null; });
      child.on('exit', () => { ready = null; child = null; });
    } catch { child = null; }
  }

  return Object.freeze({
    status: async () => Object.freeze({ ready: Boolean(active && child && ready), localOnly: true, cacheOnly: true, rawAudioPersisted: false }),
    async transcribe({ requestId, mimeType, audio }) {
      if (!REQUEST_ID.test(requestId) || !ALLOWED_TYPES.includes(mimeType) || !Buffer.isBuffer(audio)
        || audio.length < 1 || audio.length > MAX_AUDIO_BYTES) throw new TypeError('Invalid local speech request.');
      if (!active || !child || !ready || busy) return unavailableResult(requestId);
      busy = true;
      try {
        const value = await postAudioImpl({ port: ready.port, token, requestId, mimeType, audio });
        if (!value || Object.getPrototypeOf(value) !== Object.prototype
          || Object.keys(value).sort().join(',') !== 'language,rawAudioPersisted,requestId,schema,status,text'
          || value.schema !== RESULT_SCHEMA || value.requestId !== requestId
          || !['completed', 'failed'].includes(value.status) || typeof value.text !== 'string' || value.text.length > 2_000
          || typeof value.language !== 'string' || value.language.length > 8 || value.rawAudioPersisted !== false) return unavailableResult(requestId);
        return Object.freeze(value);
      } finally { busy = false; }
    },
    dispose() { if (active) { active = false; stop(); } },
  });
}

module.exports = { ALLOWED_TYPES, MAX_AUDIO_BYTES, READY_PREFIX, READY_SCHEMA, RESULT_SCHEMA, createLocalSpeechProvider, postAudio, safeReadyMessage, unavailableResult };
