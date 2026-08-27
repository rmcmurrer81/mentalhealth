'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PROVIDER_ID = 'chatterbox.local.synthetic.v1';
const PROVIDER_STATE_SCHEMA = 'wellbeing.local-voice.provider-state.v1';
const PROVIDER_RESULT_SCHEMA = 'wellbeing.local-voice.provider-result.v1';
const READY_SCHEMA = 'wellbeing.chatterbox.host-ready.v1';
const READY_PREFIX = 'WELLBEING_VOICE_READY ';
const MAX_READY_BYTES = 4_096;
const MAX_HTTP_RESPONSE_BYTES = 4_096;
const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 75_000;
const PROFILES = Object.freeze(['soft-feminine', 'calm-masculine']);

function providerState({ active = false, ready = false } = {}) {
  return Object.freeze({
    schema: PROVIDER_STATE_SCHEMA,
    providerId: PROVIDER_ID,
    approved: true,
    active,
    ready,
    localOnly: true,
    playbackReady: ready,
    supportedProfiles: ready ? PROFILES : Object.freeze([]),
    supportedLocales: ready ? Object.freeze(['en-US']) : Object.freeze([]),
  });
}

function providerResult(requestId, status, playbackConfirmed = false) {
  return Object.freeze({
    schema: PROVIDER_RESULT_SCHEMA,
    requestId,
    status,
    playbackConfirmed,
  });
}

function safeReadyMessage(line) {
  if (typeof line !== 'string' || !line.startsWith(READY_PREFIX) || Buffer.byteLength(line, 'utf8') > MAX_READY_BYTES) return null;
  try {
    const value = JSON.parse(line.slice(READY_PREFIX.length));
    if (!value
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).sort().join(',') !== 'localOnly,modelBundled,port,profiles,schema'
      || value.schema !== READY_SCHEMA
      || value.localOnly !== true
      || value.modelBundled !== false
      || !Number.isInteger(value.port)
      || value.port < 1024
      || value.port > 65535
      || !Array.isArray(value.profiles)
      || value.profiles.length !== PROFILES.length
      || !PROFILES.every((profile) => value.profiles.includes(profile))) return null;
    return Object.freeze({ port: value.port });
  } catch {
    return null;
  }
}

function postJson({ port, authToken, route, value, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > 2_048) return Promise.resolve({ ok: false, value: null });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      agent: false,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= MAX_HTTP_RESPONSE_BYTES) chunks.push(chunk);
        else request.destroy();
      });
      response.on('end', () => {
        if (bytes > MAX_HTTP_RESPONSE_BYTES || response.statusCode !== 200) return finish({ ok: false, value: null });
        try {
          return finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          return finish({ ok: false, value: null });
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('local voice timeout')));
    request.on('error', () => finish({ ok: false, value: null }));
    request.end(body);
  });
}

function createChatterboxLocalVoiceProvider({
  pythonLauncher = process.platform === 'win32' ? 'py.exe' : 'python3',
  scriptPath = path.join(__dirname, 'chatterbox-voice-host.py'),
  referenceRoot = path.join(__dirname, '..', 'web', 'voice-previews'),
  runtimeRoot,
  platform = process.platform,
  spawnImpl = spawn,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
} = {}) {
  let lifecycleActive = true;
  let child = null;
  let ready = null;
  let startupTimer = null;
  let stdoutBuffer = '';
  const authToken = crypto.randomBytes(32).toString('hex');
  const activeRequests = new Set();

  function stopHost() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    ready = null;
    const running = child;
    child = null;
    if (running && !running.killed) {
      try { running.kill(); } catch { /* already gone */ }
    }
  }

  function failHost() {
    ready = null;
  }

  function startHost() {
    if (platform !== 'win32'
      || typeof runtimeRoot !== 'string'
      || !path.isAbsolute(runtimeRoot)
      || !fs.existsSync(scriptPath)
      || !fs.existsSync(referenceRoot)) return;
    try {
      fs.mkdirSync(runtimeRoot, { recursive: true });
      child = spawnImpl(pythonLauncher, [
        '-3.14',
        scriptPath,
        '--reference-root', referenceRoot,
        '--runtime-root', runtimeRoot,
      ], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          NUMBA_CACHE_DIR: path.join(runtimeRoot, 'numba-cache'),
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          WELLBEING_VOICE_AUTH_TOKEN: authToken,
        },
      });
    } catch {
      child = null;
      return;
    }
    startupTimer = setTimeout(() => {
      if (!ready) stopHost();
    }, startupTimeoutMs);
    child.stdout?.on('data', (chunk) => {
      if (!lifecycleActive || ready) return;
      stdoutBuffer = `${stdoutBuffer}${chunk.toString('utf8')}`.slice(-MAX_READY_BYTES);
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
    child.on('error', failHost);
    child.on('exit', () => {
      failHost();
      child = null;
    });
    // Drain bounded diagnostics without exposing environment paths or model details.
    child.stderr?.on('data', () => undefined);
  }

  startHost();

  return Object.freeze({
    status: async () => providerState({ active: Boolean(child), ready: Boolean(child && ready) }),

    async speak(request) {
      if (!lifecycleActive || !child || !ready || activeRequests.size > 0) {
        return providerResult(request.requestId, 'unavailable');
      }
      activeRequests.add(request.requestId);
      try {
        const response = await postJson({
          port: ready.port,
          authToken,
          route: '/speak',
          value: request,
        });
        const value = response.value;
        if (!response.ok
          || !value
          || Object.getPrototypeOf(value) !== Object.prototype
          || Object.keys(value).sort().join(',') !== 'playbackConfirmed,requestId,schema,status'
          || value.schema !== PROVIDER_RESULT_SCHEMA
          || value.requestId !== request.requestId
          || !['completed', 'unavailable', 'failed'].includes(value.status)
          || typeof value.playbackConfirmed !== 'boolean'
          || (value.status === 'completed') !== value.playbackConfirmed) {
          return providerResult(request.requestId, 'failed');
        }
        return providerResult(request.requestId, value.status, value.playbackConfirmed);
      } finally {
        activeRequests.delete(request.requestId);
      }
    },

    cancel(requestId) {
      if (!ready || !activeRequests.has(requestId)) return;
      void postJson({ port: ready.port, authToken, route: '/cancel', value: { requestId }, timeoutMs: 2_000 });
    },

    dispose() {
      if (!lifecycleActive) return;
      lifecycleActive = false;
      activeRequests.clear();
      stopHost();
    },
  });
}

module.exports = {
  PROVIDER_ID,
  READY_PREFIX,
  READY_SCHEMA,
  createChatterboxLocalVoiceProvider,
  postJson,
  providerResult,
  providerState,
  safeReadyMessage,
};
