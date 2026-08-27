import type { CompanionReply, ConversationTurn } from "./types";
import type { LocalVoiceClient } from "./local-voice-client";

export type LocalModelName = "llama3.1:8b" | "qwen3.5:9b";

export interface LocalModelProvenance {
  runtime: "ollama-loopback";
  endpoint: "http://127.0.0.1:11434";
  model: LocalModelName;
  externalNetwork: false;
  deterministicGate: "steady-only";
  durationMs: number;
}

export type LocalModelResult = {
  status: "enhanced";
  candidateText: string;
  provenance: LocalModelProvenance;
} | {
  status: "fallback";
  candidateText: null;
  fallback: {
    code: "disabled" | "blocked-route" | "blocked-content" | "prompt-injection" | "invalid-request" | "request-too-large" | "model-not-allowlisted" | "model-not-installed" | "external-url-blocked" | "unavailable" | "timeout" | "response-too-large" | "invalid-response";
    deterministicReplyRequired: true;
  };
  provenance: Partial<LocalModelProvenance> & { externalNetwork: false };
};

export interface LocalModelRequest {
  requestId: string;
  userText: string;
  deterministicReply: string;
  safetyLevel: "steady";
  route: "ordinary-support";
  recentContext: Array<{ role: "user" | "companion"; text: string }>;
  model?: LocalModelName;
}

export interface WellbeingDesktopBridge {
  requestHandsFreePermission(): Promise<boolean>;
  armMicrophone(): Promise<boolean>;
  disarmMicrophone(): void;
  setWindowMode?(mode: "full" | "compact" | "character"): Promise<{
    mode: "full" | "compact" | "character";
    alwaysOnTop: boolean;
    rejected?: boolean;
    bounds?: { x?: number; y?: number; width: number; height: number };
  }>;
  onWindowModeChanged?(listener: (mode: "full" | "compact" | "character") => void): () => void;
  setAlwaysOnTop?(enabled: boolean): Promise<boolean>;
  hideWindow?(): void;
  localModel: {
    status(): Promise<{
      available: boolean;
      endpoint: "http://127.0.0.1:11434";
      installedAllowlistedModels: LocalModelName[];
      defaultModel: "llama3.1:8b";
      externalNetwork: false;
    }>;
    enhanceSteadyReply(request: LocalModelRequest): Promise<LocalModelResult>;
  };
  /** Native broker when present; its presence never implies provider or playback readiness. */
  localVoice?: LocalVoiceClient;
  runtime?: "native-windows-local";
}

declare global {
  interface Window {
    wellbeingDesktop?: WellbeingDesktopBridge;
  }
}

export interface EnhancementDecision {
  text: string;
  status: "enhanced" | "fallback" | "not-applicable";
  notice: string;
  provenance?: LocalModelProvenance;
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const HEALTH_BOUNDARY = /\b(?:suicid|kill myself|end my life|hurt myself|harm myself|want to die|(?:don't|do not|no longer) want to be alive|wish i (?:was|were) dead|jump (?:off|from)|bridge|roof|ledge|overdose|swallowed|ingested|bleeding|cut myself|stabbed myself|shot myself|medication|medicine|meds?|dose|dosage|pill|prescription|poison|bleach|diagnos|disorder|treatment|therapy|therapist|psychiat|psycholog|doctor|clinician|hospital|crisis|988|911|emergency|bully|bullied|bullying|harass|threat|weapon|gun|knife|stalk|attack|violence|abuse|assault|report|reporting|snitch|died|passed away|grief|grieving|bereave|loss)\b/i;
const PROTECTED_RELATIONSHIP_AND_RECALL_BOUNDARY = /\b(?:i may be reading too much into that|am i reading that right|thanks for correcting me|thank you for telling me i read that correctly|i remember that you|you told me|i don't have a saved preference|i don't have a saved detail identifying|your synthetic friend|i remembered your birthday as|if i understood the date wrong|happy birthday|how old will you be|how old are you today|birthday mix-up|birthday age|conflicting ages|won't save an age|never have to share it)\b/i;
const PRIVATE_DETAIL = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)|(?:\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b)/gi;
const UNSAFE_CANDIDATE = /(?:<\/?think>|\b(?:system|developer|assistant)\s*:|https?:\/\/|\[[^\]]+\]\([^)]+\)|\b(?:as an ai|i am human|i'm human)\b|\b(?:you have|you definitely have|you are suffering from)\s+(?:depression|bipolar|autism|adhd|ptsd|psychosis|a disorder)|\b(?:double|increase|decrease|stop|start|skip|change|adjust)\b.{0,60}\b(?:dose|medication|medicine|meds?|prescription)|\b(?:call|text|contact)\s+(?:988|911|a crisis|emergency services|the police))/i;

function clean(value: string, limit: number): string {
  return value.normalize("NFKC").replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function requestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function steadyEnhancementEligible(userText: string, reply: CompanionReply): boolean {
  return reply.safetyLevel === "steady"
    && !reply.showUrgentOptions
    && !HEALTH_BOUNDARY.test(userText)
    && !HEALTH_BOUNDARY.test(reply.text)
    && !PROTECTED_RELATIONSHIP_AND_RECALL_BOUNDARY.test(reply.text);
}

export function minimizedRecentContext(turns: ConversationTurn[]): LocalModelRequest["recentContext"] {
  return turns
    .filter((turn) => !HEALTH_BOUNDARY.test(turn.text))
    .slice(-6)
    .map((turn) => ({
      role: turn.role,
      text: clean(turn.text, 1_000).replace(PRIVATE_DETAIL, "[private detail]"),
    }))
    .filter((turn) => turn.text.length > 0);
}

export function validateLocalCandidate(candidate: string): string | null {
  const cleaned = clean(candidate, 1_201);
  if (cleaned.length < 2 || cleaned.length > 1_200) return null;
  if (UNSAFE_CANDIDATE.test(cleaned)) return null;
  return cleaned;
}

export async function enhanceSteadyReply(
  userText: string,
  reply: CompanionReply,
  turns: ConversationTurn[],
  bridge: WellbeingDesktopBridge | undefined,
): Promise<EnhancementDecision> {
  if (!steadyEnhancementEligible(userText, reply)) {
    return { text: reply.text, status: "not-applicable", notice: "Deterministic safety response" };
  }
  if (!bridge) {
    return { text: reply.text, status: "fallback", notice: "Offline deterministic response" };
  }
  const request: LocalModelRequest = {
    requestId: requestId(),
    userText: clean(userText, 2_000),
    deterministicReply: clean(reply.text, 3_000),
    safetyLevel: "steady",
    route: "ordinary-support",
    recentContext: minimizedRecentContext(turns),
  };
  try {
    const result = await bridge.localModel.enhanceSteadyReply(request);
    if (result.status !== "enhanced") {
      return { text: reply.text, status: "fallback", notice: "Local model unavailable · deterministic response" };
    }
    const validated = validateLocalCandidate(result.candidateText);
    if (!validated || result.provenance.externalNetwork !== false || result.provenance.endpoint !== "http://127.0.0.1:11434") {
      return { text: reply.text, status: "fallback", notice: "Local model output rejected · deterministic response" };
    }
    return {
      text: validated,
      status: "enhanced",
      notice: `Local ${result.provenance.model} · data stayed on this device`,
      provenance: result.provenance,
    };
  } catch {
    return { text: reply.text, status: "fallback", notice: "Local model unavailable · deterministic response" };
  }
}
