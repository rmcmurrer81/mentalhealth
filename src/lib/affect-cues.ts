import { realRiskText } from "./safety";
import type { AffectCueEvidence, CompanionProfile } from "./types";

export type AffectCueResult = Readonly<{
  evidence: AffectCueEvidence;
  text: string;
  actions: string[];
}>;

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function evidenceId(profile: CompanionProfile, now: Date): string {
  return `affect-${now.getTime()}-${profile.affectCueEvidence.length + 1}`;
}

function followUpEvidence(
  profile: CompanionProfile,
  status: "confirmed" | "dismissed",
  now: Date,
): AffectCueEvidence {
  const prior = [...profile.affectCueEvidence].reverse().find((entry) => entry.status === "tentative");
  const companionTurn = [...profile.turns].reverse().find((turn) => turn.role === "companion");
  return {
    schema: "wellbeing.affect-cue-evidence.v1",
    id: evidenceId(profile, now),
    observedAt: now.toISOString(),
    status,
    basis: status === "confirmed" ? "user-confirmed-check-in" : "user-corrected-check-in",
    evidenceTurnIds: prior?.evidenceTurnIds ?? (companionTurn ? [companionTurn.id] : []),
    baselineSampleSize: prior?.baselineSampleSize ?? 0,
    baselineAverageWords: prior?.baselineAverageWords ?? 0,
    recentWordCounts: prior?.recentWordCounts ?? [],
    currentWordCount: 0,
    storesEmotionLabel: false,
  };
}

/**
 * Produces an auditable, non-diagnostic check-in from a sustained change or an
 * explicit low-confidence cue. It stores counts and turn references, never a
 * sentiment score, hidden diagnosis, quoted message, or inferred emotion.
 */
export function evaluateAffectCue(
  text: string,
  profile: CompanionProfile,
  groundedText: string,
  now = new Date(),
): AffectCueResult | null {
  const lastCompanion = [...profile.turns].reverse().find((turn) => turn.role === "companion");
  const followsTentativeCheck = /am i reading that right\?/i.test(lastCompanion?.text ?? "");
  if (followsTentativeCheck) {
    if (/^(?:no|nope|not really)\b|\b(?:i am|i'm) (?:fine|okay)\b|\bjust (?:typing|answering|speaking|communicating) (?:briefly|in short replies)\b/i.test(text)) {
      return {
        evidence: followUpEvidence(profile, "dismissed", now),
        text: "Thanks for correcting me. I won't treat short replies as proof of a feeling, and I will remember that correction when I notice your communication pattern again. We can carry on normally, change the subject, or stay quiet for a moment—whichever fits.",
        actions: ["Carry on normally", "Change the subject", "Quiet company"],
      };
    }
    if (/^(?:yes|yeah|yep|right|exactly)\b|\b(?:you are|you're) reading (?:me|it) right\b/i.test(text)) {
      return {
        evidence: followUpEvidence(profile, "confirmed", now),
        text: "Thank you for telling me I read that correctly. What would help most right now: being heard without fixing it, putting words to the feeling, making the next few minutes gentler, or working through one problem?",
        actions: ["Just hear me", "Name the feeling", "Gentler next few minutes", "Work through one problem"],
      };
    }
  }

  const grounded = groundedText.trim();
  if (!grounded) return null;
  if (/\b(?:in my (?:movie|film|story|script|book|game)|a character|fictional|pretend|roleplay|quoting|quote|lyrics?)\b/i.test(text)) return null;
  if (/\b(?:sarcasm|sarcastic|just kidding|only kidding|just joking|not serious)\b|\/s\b/i.test(text)) return null;
  if (/\b(?:i am|i'm) (?:fine|okay|good)\b.{0,80}\b(?:just|only) (?:typing|answering|speaking|communicating) (?:briefly|in short replies)\b/i.test(text)) return null;
  if (/\b(?:i prefer|i use|my style is) (?:short|brief) (?:answers|replies|messages)|\b(?:aac|communication device|speech device)\b/i.test(text)) return null;
  if (profile.memories.some((memory) => /\b(?:short|brief) (?:answers|replies|messages)|\b(?:aac|communication|speech) device\b/i.test(`${memory.label} ${memory.value}`))) return null;
  const tersePatternDismissed = profile.affectCueEvidence.some((entry) => entry.status === "dismissed");

  const priorUserTurns = profile.turns
    .filter((turn) => turn.role === "user")
    .map((turn) => ({ id: turn.id, text: realRiskText(turn.text).text.trim() }))
    .filter((turn) => Boolean(turn.text))
    .slice(-10);
  const recent = priorUserTurns.slice(-2);
  const baseline = priorUserTurns.slice(0, -2).slice(-6);
  const baselineAverage = baseline.length
    ? baseline.reduce((sum, turn) => sum + wordCount(turn.text), 0) / baseline.length
    : 0;
  const currentWords = wordCount(grounded);
  const abruptTerseShift = baseline.length >= 3
    && baselineAverage >= 8
    && recent.length === 2
    && [...recent.map((turn) => turn.text), grounded].every((value) => wordCount(value) <= 4);
  const withdrawalMarker = /\b(?:whatever|never mind|doesn'?t matter|not much,? i guess|same as always|just leave it|i don'?t really care|don'?t want to talk)\b|\bi don'?t know\.{2,}/i;
  const repeatedWithdrawal = [...recent.map((turn) => turn.text), grounded].filter((value) => withdrawalMarker.test(value)).length >= 2;
  const singleOffCue = /\b(?:i don'?t know,? i just feel off|everything feels a little off|i have been quieter than usual|i keep snapping at people|everything is getting on my nerves)\b/i.test(grounded);

  if (!abruptTerseShift && !repeatedWithdrawal && !singleOffCue) return null;
  if (abruptTerseShift && tersePatternDismissed && !repeatedWithdrawal && !singleOffCue) return null;

  const basis = abruptTerseShift
    ? "sustained-length-change"
    : repeatedWithdrawal
      ? "repeated-withdrawal-language"
      : "explicit-low-confidence-cue";
  const evidence: AffectCueEvidence = {
    schema: "wellbeing.affect-cue-evidence.v1",
    id: evidenceId(profile, now),
    observedAt: now.toISOString(),
    status: "tentative",
    basis,
    evidenceTurnIds: [...baseline, ...recent].map((turn) => turn.id),
    baselineSampleSize: baseline.length,
    baselineAverageWords: Number(baselineAverage.toFixed(2)),
    recentWordCounts: recent.map((turn) => wordCount(turn.text)),
    currentWordCount: currentWords,
    storesEmotionLabel: false,
  };
  const tone = /\b(?:snapping|nerves|whatever)\b/i.test(grounded) ? "more irritated or shut down" : "quieter or more worn down";
  const reason = abruptTerseShift
    ? "Your last few replies became much shorter than your usual messages"
    : "A few small phrases sound different from your usual tone";
  return {
    evidence,
    text: `${reason}, and I may be reading too much into that. You seem ${tone} than usual—am I reading that right? You can say no and I will back off, or we can slow down and work out what might help.`,
    actions: ["You're reading it right", "I'm okay—keep going", "Just listen", "Change the subject"],
  };
}

export function appendAffectCueEvidence(
  existing: AffectCueEvidence[],
  next: AffectCueEvidence | undefined,
  maximum = 24,
): AffectCueEvidence[] {
  if (!next) return existing;
  const boundedMaximum = Math.max(1, Math.min(100, Math.floor(maximum)));
  return [...existing.filter((entry) => entry.id !== next.id), next].slice(-boundedMaximum);
}
