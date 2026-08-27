'use strict';

const LOCAL_VOICE_STATUS_SCHEMA = 'wellbeing.local-voice.status.v1';
const LOCAL_VOICE_REQUEST_SCHEMA = 'wellbeing.local-voice.speak-request.v1';
const LOCAL_VOICE_RESULT_SCHEMA = 'wellbeing.local-voice.speak-result.v1';
const PROVIDER_STATE_SCHEMA = 'wellbeing.local-voice.provider-state.v1';
const PROVIDER_RESULT_SCHEMA = 'wellbeing.local-voice.provider-result.v1';
const PROVIDER_REQUEST_SCHEMA = 'wellbeing.local-voice.provider-request.v1';
const PUBLIC_PROVIDER_ID = 'desktop.local-voice';
const MAX_SPEECH_CHARS = 220;
const REQUEST_CAP_BYTES = 1_024;
const STATUS_TIMEOUT_MS = 1_500;
const SPEAK_TIMEOUT_MS = 75_000;
const PROFILES = Object.freeze(['soft-feminine', 'warm-neutral', 'calm-masculine']);
const APPROVED_SELECTOR_BY_PROFILE = Object.freeze({
  'soft-feminine': 'calm-female.owner-approved.v1',
  'calm-masculine': 'warm-male.owner-approved.v1',
});
const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

const IPC_CHANNELS = Object.freeze({
  status: 'wellbeing:local-voice-status',
  speak: 'wellbeing:local-voice-speak',
  cancel: 'wellbeing:local-voice-cancel',
});

class LocalVoiceBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalVoiceBoundaryError';
    this.code = code;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new LocalVoiceBoundaryError('invalid-schema', `${label} must be a plain object.`);
  }
}

function assertExactKeys(value, required, label) {
  const keys = Object.keys(value);
  if (keys.length !== required.length
    || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new LocalVoiceBoundaryError('invalid-schema', `${label} has an invalid schema.`);
  }
}

function validateRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice request ID is invalid.');
  }
  return value;
}

function validateCanonicalLocale(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35 || CONTROL_OR_BIDI.test(value)) {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice locale is invalid.');
  }
  let canonical;
  try {
    canonical = Intl.getCanonicalLocales(value)[0];
  } catch {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice locale is invalid.');
  }
  if (!canonical || canonical !== value) {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice locale must be canonical.');
  }
  return canonical;
}

function validateSpeakRequest(input) {
  assertPlainObject(input, 'request');
  assertExactKeys(input, ['schema', 'requestId', 'text', 'profile', 'locale'], 'request');
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice request is not serializable.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > REQUEST_CAP_BYTES) {
    throw new LocalVoiceBoundaryError('request-too-large', 'The local-voice request exceeds its byte cap.');
  }
  if (input.schema !== LOCAL_VOICE_REQUEST_SCHEMA) {
    throw new LocalVoiceBoundaryError('invalid-schema', 'The local-voice request schema is invalid.');
  }
  const requestId = validateRequestId(input.requestId);
  if (typeof input.text !== 'string'
    || input.text.length < 1
    || input.text.length > MAX_SPEECH_CHARS
    || input.text.trim() !== input.text
    || CONTROL_OR_BIDI.test(input.text)) {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice text is invalid.');
  }
  if (!PROFILES.includes(input.profile)) {
    throw new LocalVoiceBoundaryError('invalid-request', 'The local-voice profile is invalid.');
  }
  const locale = validateCanonicalLocale(input.locale);
  return Object.freeze({
    schema: LOCAL_VOICE_REQUEST_SCHEMA,
    requestId,
    text: input.text,
    profile: input.profile,
    locale,
  });
}

function validateStringSet(value, predicate, label) {
  if (!Array.isArray(value)
    || value.some((candidate) => typeof candidate !== 'string' || !predicate(candidate))
    || new Set(value).size !== value.length) {
    throw new LocalVoiceBoundaryError('invalid-provider-state', `${label} is invalid.`);
  }
  return Object.freeze([...value]);
}

function validateProviderState(input) {
  assertPlainObject(input, 'provider state');
  assertExactKeys(input, [
    'schema',
    'providerId',
    'approved',
    'active',
    'ready',
    'localOnly',
    'playbackReady',
    'supportedProfiles',
    'supportedLocales',
  ], 'provider state');
  if (input.schema !== PROVIDER_STATE_SCHEMA
    || typeof input.providerId !== 'string'
    || !PROVIDER_ID.test(input.providerId)
    || typeof input.approved !== 'boolean'
    || typeof input.active !== 'boolean'
    || typeof input.ready !== 'boolean'
    || typeof input.localOnly !== 'boolean'
    || typeof input.playbackReady !== 'boolean') {
    throw new LocalVoiceBoundaryError('invalid-provider-state', 'The provider state is invalid.');
  }
  const supportedProfiles = validateStringSet(
    input.supportedProfiles,
    (candidate) => PROFILES.includes(candidate),
    'supportedProfiles',
  );
  const supportedLocales = validateStringSet(input.supportedLocales, (candidate) => {
    try {
      return Intl.getCanonicalLocales(candidate)[0] === candidate;
    } catch {
      return false;
    }
  }, 'supportedLocales');
  return Object.freeze({
    schema: PROVIDER_STATE_SCHEMA,
    providerId: input.providerId,
    approved: input.approved,
    active: input.active,
    ready: input.ready,
    localOnly: input.localOnly,
    playbackReady: input.playbackReady,
    supportedProfiles,
    supportedLocales,
  });
}

function validateProviderResult(input, requestId) {
  assertPlainObject(input, 'provider result');
  assertExactKeys(input, ['schema', 'requestId', 'status', 'playbackConfirmed'], 'provider result');
  if (input.schema !== PROVIDER_RESULT_SCHEMA
    || input.requestId !== requestId
    || !['completed', 'unavailable', 'failed'].includes(input.status)
    || typeof input.playbackConfirmed !== 'boolean'
    || (input.status === 'completed') !== input.playbackConfirmed) {
    throw new LocalVoiceBoundaryError('invalid-provider-result', 'The provider result is invalid.');
  }
  return input;
}

function publicStatus({ ready = false, localOnly = true, supportedProfiles = [], unavailableCode } = {}) {
  const result = {
    schema: LOCAL_VOICE_STATUS_SCHEMA,
    providerId: PUBLIC_PROVIDER_ID,
    ready,
    localOnly,
    supportedProfiles: Object.freeze([...supportedProfiles]),
  };
  if (!ready) result.unavailableCode = unavailableCode ?? 'not-ready';
  return Object.freeze(result);
}

function unavailableStatus(code = 'not-configured', localOnly = true) {
  return publicStatus({ ready: false, localOnly, supportedProfiles: [], unavailableCode: code });
}

function providerIsApproved(state, approvedProviderId) {
  return Boolean(state
    && approvedProviderId
    && state.approved
    && state.providerId === approvedProviderId);
}

function publicStatusForProvider(state, approvedProviderId) {
  if (!state) return unavailableStatus('not-configured');
  if (!state.localOnly) return unavailableStatus('not-ready', false);
  if (!providerIsApproved(state, approvedProviderId)) return unavailableStatus('not-configured');
  const approvedProfiles = state.supportedProfiles.filter((profile) => APPROVED_SELECTOR_BY_PROFILE[profile]);
  if (!state.active
    || !state.ready
    || !state.playbackReady
    || approvedProfiles.length === 0
    || state.supportedLocales.length === 0) {
    return unavailableStatus('not-ready');
  }
  return publicStatus({ ready: true, localOnly: true, supportedProfiles: approvedProfiles });
}

function publicResult(requestId, status) {
  return Object.freeze({ schema: LOCAL_VOICE_RESULT_SCHEMA, requestId, status });
}

function isProviderUsableFor(state, request, approvedProviderId) {
  return Boolean(state
    && providerIsApproved(state, approvedProviderId)
    && state.active
    && state.ready
    && state.localOnly
    && state.playbackReady
    && Boolean(APPROVED_SELECTOR_BY_PROFILE[request.profile])
    && state.supportedProfiles.includes(request.profile)
    && state.supportedLocales.includes(request.locale));
}

function providerRequest(request) {
  const selectorId = APPROVED_SELECTOR_BY_PROFILE[request.profile];
  if (!selectorId) throw new LocalVoiceBoundaryError('unapproved-selector', 'The requested voice has no owner-approved selector.');
  return Object.freeze({
    schema: PROVIDER_REQUEST_SCHEMA,
    requestId: request.requestId,
    text: request.text,
    profile: request.profile,
    selectorId,
    locale: request.locale,
  });
}

function callWithTimeout(call, timeoutMs) {
  let timer;
  return new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    Promise.resolve()
      .then(call)
      .then(
        (value) => resolve({ kind: 'provider', value }),
        () => resolve({ kind: 'provider-error' }),
      )
      .finally(() => clearTimeout(timer));
  });
}

function createUnavailableLocalVoiceProvider() {
  const state = Object.freeze({
    schema: PROVIDER_STATE_SCHEMA,
    providerId: 'desktop.unconfigured',
    approved: false,
    active: false,
    ready: false,
    localOnly: true,
    playbackReady: false,
    supportedProfiles: Object.freeze([]),
    supportedLocales: Object.freeze([]),
  });
  return Object.freeze({
    status: async () => state,
    speak: async (request) => Object.freeze({
      schema: PROVIDER_RESULT_SCHEMA,
      requestId: request.requestId,
      status: 'unavailable',
      playbackConfirmed: false,
    }),
    cancel: () => undefined,
  });
}

function createLocalVoiceBridge({
  provider = createUnavailableLocalVoiceProvider(),
  approvedProviderId = null,
  statusTimeoutMs = STATUS_TIMEOUT_MS,
  speakTimeoutMs = SPEAK_TIMEOUT_MS,
} = {}) {
  if (!provider
    || typeof provider.status !== 'function'
    || typeof provider.speak !== 'function'
    || typeof provider.cancel !== 'function') {
    throw new TypeError('A local-voice provider with status, speak, and cancel is required.');
  }
  if (approvedProviderId !== null
    && (typeof approvedProviderId !== 'string' || !PROVIDER_ID.test(approvedProviderId))) {
    throw new TypeError('approvedProviderId must be an exact provider ID or null.');
  }
  if (!Number.isInteger(statusTimeoutMs) || statusTimeoutMs < 1 || statusTimeoutMs > STATUS_TIMEOUT_MS) {
    throw new TypeError('statusTimeoutMs is outside the allowed boundary.');
  }
  if (!Number.isInteger(speakTimeoutMs) || speakTimeoutMs < 1 || speakTimeoutMs > SPEAK_TIMEOUT_MS) {
    throw new TypeError('speakTimeoutMs is outside the allowed boundary.');
  }

  const active = new Map();
  let nextGeneration = 0;
  let lifecycleActive = true;
  let lifecycleEpoch = 0;
  let readyLeaseEpoch = -1;

  async function providerState() {
    const outcome = await callWithTimeout(() => provider.status(), statusTimeoutMs);
    if (outcome.kind !== 'provider') return null;
    try {
      return validateProviderState(outcome.value);
    } catch {
      return null;
    }
  }

  function isCurrent(entry) {
    return lifecycleActive
      && entry.lifecycleEpoch === lifecycleEpoch
      && active.get(entry.requestId)?.generation === entry.generation;
  }

  function finishEntry(entry) {
    if (active.get(entry.requestId)?.generation === entry.generation) active.delete(entry.requestId);
  }

  function bestEffortProviderCancel(entry) {
    if (!entry.providerStarted) return;
    try {
      void Promise.resolve(provider.cancel(entry.requestId)).catch(() => undefined);
    } catch {
      // Cancellation remains fail-closed even when the inactive provider misbehaves.
    }
  }

  function cancelEntry(entry) {
    readyLeaseEpoch = -1;
    finishEntry(entry);
    entry.resolveCancellation({ kind: 'cancelled' });
    bestEffortProviderCancel(entry);
  }

  function cancelAll() {
    lifecycleEpoch += 1;
    readyLeaseEpoch = -1;
    for (const entry of [...active.values()]) cancelEntry(entry);
  }

  return Object.freeze({
    async status() {
      if (!lifecycleActive) return unavailableStatus('not-ready');
      const requestedEpoch = lifecycleEpoch;
      const result = publicStatusForProvider(await providerState(), approvedProviderId);
      if (!lifecycleActive || requestedEpoch !== lifecycleEpoch) return unavailableStatus('not-ready');
      readyLeaseEpoch = result.ready ? requestedEpoch : -1;
      return result;
    },

    async speak(input) {
      const request = validateSpeakRequest(input);
      if (!lifecycleActive) return publicResult(request.requestId, 'unavailable');
      if (readyLeaseEpoch !== lifecycleEpoch) return publicResult(request.requestId, 'unavailable');
      if (active.size > 0) return publicResult(request.requestId, 'failed');

      let resolveCancellation;
      const cancellation = new Promise((resolve) => { resolveCancellation = resolve; });
      const entry = {
        requestId: request.requestId,
        generation: ++nextGeneration,
        lifecycleEpoch,
        providerStarted: false,
        resolveCancellation,
      };
      active.set(request.requestId, entry);

      const stateOutcome = await Promise.race([
        providerState().then((state) => ({ kind: 'state', state })),
        cancellation,
      ]);
      if (!isCurrent(entry) || stateOutcome.kind === 'cancelled') {
        return publicResult(request.requestId, 'failed');
      }
      const state = stateOutcome.state;
      if (!isProviderUsableFor(state, request, approvedProviderId)) {
        readyLeaseEpoch = -1;
        finishEntry(entry);
        return publicResult(request.requestId, 'unavailable');
      }

      entry.providerStarted = true;
      const outcome = await Promise.race([
        callWithTimeout(() => provider.speak(providerRequest(request)), speakTimeoutMs),
        cancellation,
      ]);
      if (!isCurrent(entry) || outcome.kind === 'cancelled') {
        return publicResult(request.requestId, 'failed');
      }
      if (outcome.kind !== 'provider') {
        readyLeaseEpoch = -1;
        bestEffortProviderCancel(entry);
        finishEntry(entry);
        return publicResult(request.requestId, 'failed');
      }
      finishEntry(entry);
      try {
        const result = validateProviderResult(outcome.value, request.requestId);
        if (result.status !== 'completed') {
          readyLeaseEpoch = -1;
          bestEffortProviderCancel(entry);
        }
        return publicResult(request.requestId, result.status);
      } catch {
        readyLeaseEpoch = -1;
        bestEffortProviderCancel(entry);
        return publicResult(request.requestId, 'failed');
      }
    },

    cancel(requestId) {
      const validated = validateRequestId(requestId);
      const entry = active.get(validated);
      if (entry) cancelEntry(entry);
    },

    cancelAll,

    reject(input) {
      const request = validateSpeakRequest(input);
      return publicResult(request.requestId, 'failed');
    },

    dispose() {
      if (!lifecycleActive) return;
      lifecycleActive = false;
      cancelAll();
      if (typeof provider.dispose === 'function') {
        try {
          void Promise.resolve(provider.dispose()).catch(() => undefined);
        } catch {
          // Provider teardown cannot reactivate or escape the closed bridge.
        }
      }
    },
  });
}

function registerLocalVoiceIpc({ ipcMain, bridge, isTrustedEvent }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required.');
  if (!bridge || typeof bridge.status !== 'function' || typeof bridge.speak !== 'function' || typeof bridge.cancel !== 'function') {
    throw new TypeError('A local-voice bridge is required.');
  }
  if (typeof isTrustedEvent !== 'function') throw new TypeError('isTrustedEvent is required.');

  function trusted(event) {
    try {
      return isTrustedEvent(event) === true;
    } catch {
      return false;
    }
  }

  ipcMain.handle(IPC_CHANNELS.status, (event) => (
    trusted(event) ? bridge.status() : unavailableStatus('not-configured')
  ));
  ipcMain.handle(IPC_CHANNELS.speak, (event, request) => (
    trusted(event) ? bridge.speak(request) : bridge.reject(request)
  ));
  ipcMain.handle(IPC_CHANNELS.cancel, (event, requestId) => {
    validateRequestId(requestId);
    if (trusted(event)) bridge.cancel(requestId);
  });
}

module.exports = {
  IPC_CHANNELS,
  LOCAL_VOICE_REQUEST_SCHEMA,
  LOCAL_VOICE_RESULT_SCHEMA,
  LOCAL_VOICE_STATUS_SCHEMA,
  LocalVoiceBoundaryError,
  MAX_SPEECH_CHARS,
  PROFILES,
  PROVIDER_RESULT_SCHEMA,
  PROVIDER_REQUEST_SCHEMA,
  APPROVED_SELECTOR_BY_PROFILE,
  PROVIDER_STATE_SCHEMA,
  PUBLIC_PROVIDER_ID,
  REQUEST_CAP_BYTES,
  SPEAK_TIMEOUT_MS,
  STATUS_TIMEOUT_MS,
  createLocalVoiceBridge,
  createUnavailableLocalVoiceProvider,
  registerLocalVoiceIpc,
  unavailableStatus,
  validateProviderResult,
  validateProviderState,
  validateSpeakRequest,
};
