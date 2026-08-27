export type SafetyLevel = "steady" | "strained" | "urgent";
export type SafetyContext =
  | "self-harm"
  | "acute-medical"
  | "violence-risk"
  | "external-threat"
  | "third-party"
  | "general";
export type CompanionExpression = "neutral" | "concerned" | "happy";

export type MemoryKind =
  | "identity"
  | "person"
  | "preference"
  | "routine"
  | "milestone"
  | "goal"
  | "boundary"
  | "medication"
  | "appointment";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  label: string;
  value: string;
  createdAt: string;
  lastUsedAt?: string;
  sensitive: boolean;
  source: "conversation" | "user-entry";
}

export interface ConversationTurn {
  id: string;
  role: "user" | "companion";
  text: string;
  createdAt: string;
  safetyLevel: SafetyLevel;
  safetyContext?: SafetyContext;
  /** Memory records learned directly from this turn. Used for precise local deletion. */
  learnedMemoryIds?: string[];
  /** Memory records that directly grounded this reply. Used for precise local deletion. */
  groundedMemoryIds?: string[];
}

export interface AffectCueEvidence {
  schema: "wellbeing.affect-cue-evidence.v1";
  id: string;
  observedAt: string;
  status: "tentative" | "confirmed" | "dismissed";
  basis:
    | "sustained-length-change"
    | "repeated-withdrawal-language"
    | "explicit-low-confidence-cue"
    | "user-confirmed-check-in"
    | "user-corrected-check-in";
  evidenceTurnIds: string[];
  baselineSampleSize: number;
  baselineAverageWords: number;
  recentWordCounts: number[];
  currentWordCount: number;
  storesEmotionLabel: false;
}

export interface MedicationPlan {
  id: string;
  name: string;
  scheduleLabel: string;
  time: string;
  /** The user supplied a part of day, not a prescriber-specified clock time. */
  partOfDayOnly?: boolean;
  adherenceStreak: number;
  recentMisses: number;
  lastConfirmedDate?: string;
  lastMissedDate?: string;
}

export interface AppointmentPlan {
  id: string;
  title: string;
  dateTime: string;
  location?: string;
}

export interface InterestFact {
  id: string;
  text: string;
  sourceLabel: string;
  sourceUrl: string;
  spoilerLevel: "premise" | "episode";
  minimumProgress?: {
    season: number;
    episode: number;
  };
}

export interface InterestProgress {
  season?: number;
  episode?: number;
  completedThroughSeason?: number;
}

export interface InterestPack {
  id: string;
  title: string;
  normalizedTitle: string;
  favoriteCharacters: string[];
  progressLabel?: string;
  progress?: InterestProgress;
  spoilerBoundaryKnown: boolean;
  facts: InterestFact[];
  updatedAt: string;
}

export type ThemePreference = "system" | "light" | "dark";

export interface CompanionProfile {
  preferredName: string;
  memories: MemoryRecord[];
  medications: MedicationPlan[];
  appointments: AppointmentPlan[];
  turns: ConversationTurn[];
  voice: "soft-feminine" | "warm-neutral" | "calm-masculine";
  theme: ThemePreference;
  speechEnabled: boolean;
  learningEnabled: boolean;
  interestPacksEnabled: boolean;
  interests: InterestPack[];
  affectCueEvidence: AffectCueEvidence[];
}

export interface CompanionReply {
  text: string;
  safetyLevel: SafetyLevel;
  safetyContext?: SafetyContext;
  learned: MemoryRecord[];
  usedMemoryIds: string[];
  suggestedActions: string[];
  showUrgentOptions: boolean;
  affectCueEvidence?: AffectCueEvidence;
}
