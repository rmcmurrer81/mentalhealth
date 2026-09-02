export const DEFAULT_COMPANION_NAME = "Companion";
export const MAX_COMPANION_NAME_CODE_POINTS = 40;

const CONTROL_OR_DIRECTIONAL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu;
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/gu;
const VALID_NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\- ]*$/u;
const RESERVED_IDENTITY = new Set([
  "human",
  "a human",
  "person",
  "a person",
  "doctor",
  "therapist",
  "psychologist",
  "psychiatrist",
  "emergency services",
  "911",
  "988",
]);

function stripNameWrapping(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_OR_DIRECTIONAL, " ")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^["“”'‘’«»]+|["“”'‘’«».,!?;:]+$/gu, "")
    .trim();
}

/** Returns a safe local display name, or null when the user supplied an invalid value. */
export function cleanCompanionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = stripNameWrapping(value);
  if (!candidate || Array.from(candidate).length > MAX_COMPANION_NAME_CODE_POINTS) return null;
  if (!VALID_NAME.test(candidate)) return null;
  if (RESERVED_IDENTITY.has(candidate.toLocaleLowerCase("en-US"))) return null;
  return candidate;
}

/** Empty onboarding input means the neutral default; malformed non-empty input remains invalid. */
export function companionNameFromOptionalInput(value: unknown): string | null {
  if (typeof value !== "string" || !stripNameWrapping(value)) return DEFAULT_COMPANION_NAME;
  return cleanCompanionName(value);
}

/** Migrates legacy/malformed local profiles without trusting persisted display text. */
export function companionNameFromStoredProfile(value: unknown): string {
  return cleanCompanionName(value) ?? DEFAULT_COMPANION_NAME;
}

export function asksCompanionName(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return /^(?:what(?:'s| is) your name|who are you|tell me your name)[?.!]*$/iu.test(normalized);
}

/** Recognizes bounded naming requests. The caller still confirms before persisting. */
export function requestedCompanionName(text: string): string | null {
  const normalized = text.normalize("NFKC").replace(CONTROL_OR_DIRECTIONAL, " ").trim();
  const match = /^(?:i want to call you|i(?:'d| would) like to call you|i(?:'ll| will) call you|can i call you|please (?:use the name|call yourself)|your name is)\s+(.+?)[.!?]*$/iu.exec(normalized);
  return match ? cleanCompanionName(match[1]) : null;
}
