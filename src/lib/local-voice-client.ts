import type { CompanionProfile } from "./types";

export type CompanionVoiceProfile = CompanionProfile["voice"];

export const LOCAL_VOICE_STATUS_SCHEMA = "wellbeing.local-voice.status.v1" as const;
export const LOCAL_VOICE_REQUEST_SCHEMA = "wellbeing.local-voice.speak-request.v1" as const;
export const LOCAL_VOICE_RESULT_SCHEMA = "wellbeing.local-voice.speak-result.v1" as const;

export type LocalVoiceUnavailableCode =
  | "not-configured"
  | "not-ready"
  | "not-local-only"
  | "unsupported-profile"
  | "invalid-provider-response"
  | "provider-error";

export type LocalVoiceProviderStatus = {
  schema: typeof LOCAL_VOICE_STATUS_SCHEMA;
  providerId: string;
  ready: boolean;
  localOnly: boolean;
  supportedProfiles: CompanionVoiceProfile[];
  unavailableCode?: "not-configured" | "not-ready";
};

export type LocalVoiceSpeakRequest = {
  schema: typeof LOCAL_VOICE_REQUEST_SCHEMA;
  requestId: string;
  text: string;
  profile: CompanionVoiceProfile;
  locale: string;
};

export type LocalVoiceSpeakResult = {
  schema: typeof LOCAL_VOICE_RESULT_SCHEMA;
  requestId: string;
  status: "completed" | "unavailable" | "failed";
};

/**
 * Provider-neutral IPC-safe boundary for a future reviewed local voice host.
 * Implementations own synthesis and playback and must settle every promise.
 * This interface does not imply that a provider, model, or voice is installed.
 */
export type LocalVoiceClient = {
  status: () => Promise<LocalVoiceProviderStatus>;
  speak: (request: LocalVoiceSpeakRequest) => Promise<LocalVoiceSpeakResult>;
  cancel: (requestId: string) => void | Promise<void>;
};

const PROFILES: readonly CompanionVoiceProfile[] = ["soft-feminine", "warm-neutral", "calm-masculine"];
const APPROVED_SELECTOR_BY_PROFILE: Readonly<Partial<Record<CompanionVoiceProfile, string>>> = Object.freeze({
  "soft-feminine": "calm-female.owner-approved.v1",
  "calm-masculine": "warm-male.owner-approved.v1",
});
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function hasExactKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

export function isCompanionVoiceProfile(value: unknown): value is CompanionVoiceProfile {
  return typeof value === "string" && PROFILES.includes(value as CompanionVoiceProfile);
}

/**
 * Product-level selector only. The renderer never receives a model, raw voice
 * pack identifier, generated-audio path, or private reference.
 */
export function approvedVoiceSelector(profile: CompanionVoiceProfile): string | null {
  return APPROVED_SELECTOR_BY_PROFILE[profile] ?? null;
}

export function localVoiceAvailability(
  value: unknown,
  profile: CompanionVoiceProfile,
): { available: true; providerId: string } | { available: false; code: LocalVoiceUnavailableCode } {
  if (!value || typeof value !== "object") return { available: false, code: "invalid-provider-response" };
  const status = value as Partial<LocalVoiceProviderStatus>;
  if (
    !hasExactKeys(
      value,
      ["schema", "providerId", "ready", "localOnly", "supportedProfiles"],
      ["unavailableCode"],
    )
    || status.schema !== LOCAL_VOICE_STATUS_SCHEMA
    || typeof status.providerId !== "string"
    || !PROVIDER_ID.test(status.providerId)
    || typeof status.ready !== "boolean"
    || typeof status.localOnly !== "boolean"
    || !Array.isArray(status.supportedProfiles)
    || status.supportedProfiles.some((candidate) => !isCompanionVoiceProfile(candidate))
    || new Set(status.supportedProfiles).size !== status.supportedProfiles.length
    || (status.unavailableCode !== undefined && !["not-configured", "not-ready"].includes(status.unavailableCode))
    || (status.ready && status.unavailableCode !== undefined)
  ) {
    return { available: false, code: "invalid-provider-response" };
  }
  if (!status.localOnly) return { available: false, code: "not-local-only" };
  if (!status.ready) return { available: false, code: status.unavailableCode ?? "not-ready" };
  if (!status.supportedProfiles.includes(profile)) return { available: false, code: "unsupported-profile" };
  return { available: true, providerId: status.providerId };
}

export function validLocalVoiceResult(value: unknown, requestId: string): value is LocalVoiceSpeakResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LocalVoiceSpeakResult>;
  return hasExactKeys(value, ["schema", "requestId", "status"])
    && result.schema === LOCAL_VOICE_RESULT_SCHEMA
    && result.requestId === requestId
    && (result.status === "completed" || result.status === "unavailable" || result.status === "failed");
}

/** Explicit text-only client used until a reviewed local provider is wired. */
export function createUnavailableLocalVoiceClient(): LocalVoiceClient {
  return {
    status: async () => ({
      schema: LOCAL_VOICE_STATUS_SCHEMA,
      providerId: "not-configured",
      ready: false,
      localOnly: true,
      supportedProfiles: [],
      unavailableCode: "not-configured",
    }),
    speak: async (request) => ({
      schema: LOCAL_VOICE_RESULT_SCHEMA,
      requestId: request.requestId,
      status: "unavailable",
    }),
    cancel: () => undefined,
  };
}
