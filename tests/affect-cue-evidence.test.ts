import { describe, expect, it } from "vitest";
import { appendAffectCueEvidence, evaluateAffectCue } from "../src/lib/affect-cues";
import { respond } from "../src/lib/companion";
import { defaultProfile } from "../src/lib/memory";
import type { AffectCueEvidence, ConversationTurn } from "../src/lib/types";

function turn(id: string, role: "user" | "companion", text: string): ConversationTurn {
  return { id, role, text, createdAt: "2026-08-25T12:00:00.000Z", safetyLevel: "steady", safetyContext: "general" };
}

function baselineProfile() {
  return {
    ...defaultProfile(),
    turns: [
      turn("u1", "user", "I spent the morning working on a detailed drawing of the city."),
      turn("c1", "companion", "That sounds absorbing."),
      turn("u2", "user", "The windows took a long time but I liked getting each one right."),
      turn("c2", "companion", "You stayed with the details."),
      turn("u3", "user", "I usually write a few notes about the colors before I start painting."),
      turn("c3", "companion", "That gives you a plan."),
      turn("u4", "user", "Okay."),
      turn("c4", "companion", "I'm here."),
      turn("u5", "user", "Fine."),
      turn("c5", "companion", "We can go slowly."),
    ],
  };
}

describe("explainable affect-cue evidence", () => {
  it("records bounded numeric evidence and turn references without saving an emotion or quoted text", () => {
    const reply = respond("Whatever.", baselineProfile(), new Date("2026-08-25T13:00:00.000Z"));
    const evidence = reply.affectCueEvidence;
    expect(evidence).toMatchObject({
      schema: "wellbeing.affect-cue-evidence.v1",
      status: "tentative",
      basis: "sustained-length-change",
      baselineSampleSize: 3,
      recentWordCounts: [1, 1],
      currentWordCount: 1,
      storesEmotionLabel: false,
    });
    expect(evidence?.evidenceTurnIds).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(JSON.stringify(evidence)).not.toMatch(/whatever|sad|depress|irritated|diagnos/i);
  });

  it("records a correction and backs off on later pattern changes", () => {
    const asked = respond("Whatever.", baselineProfile(), new Date("2026-08-25T13:00:00.000Z"));
    const withAsk = {
      ...baselineProfile(),
      affectCueEvidence: appendAffectCueEvidence([], asked.affectCueEvidence),
      turns: [...baselineProfile().turns, turn("c6", "companion", asked.text)],
    };
    const corrected = respond("No, I'm okay; I just type in short replies.", withAsk, new Date("2026-08-25T13:01:00.000Z"));
    expect(corrected.affectCueEvidence?.status).toBe("dismissed");
    expect(corrected.affectCueEvidence?.basis).toBe("user-corrected-check-in");

    const afterCorrection = {
      ...baselineProfile(),
      affectCueEvidence: appendAffectCueEvidence(withAsk.affectCueEvidence, corrected.affectCueEvidence),
    };
    expect(evaluateAffectCue("Whatever.", afterCorrection, "Whatever.")).toBeNull();
    expect(evaluateAffectCue("I don't know, I just feel off lately.", afterCorrection, "I don't know, I just feel off lately.")).not.toBeNull();
  });

  it("continues naturally after a confirmed check-in without diagnosing or rushing to fix it", () => {
    const confirmed: AffectCueEvidence = {
      schema: "wellbeing.affect-cue-evidence.v1",
      id: "confirmed-1",
      observedAt: "2026-08-25T13:00:00.000Z",
      status: "confirmed",
      basis: "user-confirmed-check-in",
      evidenceTurnIds: ["u1"],
      baselineSampleSize: 3,
      baselineAverageWords: 11,
      recentWordCounts: [1, 1],
      currentWordCount: 1,
      storesEmotionLabel: false,
    };
    const reply = respond("Just hear me", { ...defaultProfile(), affectCueEvidence: [confirmed] });
    expect(reply.text).toContain("won't rush to solve or reframe it");
    expect(reply.text).toContain("pauses are okay");
    expect(reply.text).not.toMatch(/diagnos|disorder|must call/i);
  });

  it("never emits affect evidence for an urgent safety route", () => {
    const reply = respond("I swallowed 30 pills.", baselineProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.affectCueEvidence).toBeUndefined();
  });

  it("bounds retained receipts and deduplicates an exact ID", () => {
    const seed = Array.from({ length: 30 }, (_, index): AffectCueEvidence => ({
      schema: "wellbeing.affect-cue-evidence.v1",
      id: `e-${index}`,
      observedAt: new Date(2026, 7, 25, 0, index).toISOString(),
      status: "tentative",
      basis: "explicit-low-confidence-cue",
      evidenceTurnIds: [],
      baselineSampleSize: 0,
      baselineAverageWords: 0,
      recentWordCounts: [],
      currentWordCount: 3,
      storesEmotionLabel: false,
    }));
    const next = { ...seed[29], status: "dismissed" as const, basis: "user-corrected-check-in" as const };
    const result = appendAffectCueEvidence(seed, next);
    expect(result).toHaveLength(24);
    expect(result.filter((entry) => entry.id === "e-29")).toHaveLength(1);
    expect(result.at(-1)?.status).toBe("dismissed");
  });
});
