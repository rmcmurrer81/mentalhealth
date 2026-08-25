import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { steadyEnhancementEligible } from "../src/lib/local-model";
import {
  birthdayOccurrenceOnOrAfter,
  createBirthdayAgeMemory,
  defaultProfile,
  extractMemories,
  mergeMemories,
} from "../src/lib/memory";
import type { CompanionProfile, ConversationTurn } from "../src/lib/types";

const learnedOn = new Date("2026-08-24T12:00:00-04:00");
const beforeBirthday = new Date("2026-08-25T09:00:00-04:00");

function companionTurn(text: string, createdAt = "2026-08-25T08:59:00-04:00"): ConversationTurn {
  return {
    id: `turn-${createdAt}`,
    role: "companion",
    text,
    createdAt,
    safetyLevel: "steady",
    safetyContext: "general",
  };
}

function profileWithBirthday(turnText?: string): CompanionProfile {
  return {
    ...defaultProfile(),
    memories: extractMemories("My birthday is August 29.", learnedOn),
    turns: turnText ? [companionTurn(turnText)] : [],
  };
}

describe("optional birthday age memory", () => {
  it("asks a future-facing age question before the birthday", () => {
    const reply = respond("Can we talk about my birthday?", profileWithBirthday(), beforeBirthday);
    expect(reply.text).toContain("How old will you be");
    expect(reply.learned.some((entry) => entry.label === "Birthday age")).toBe(false);
    expect(steadyEnhancementEligible("Can we talk about my birthday?", reply)).toBe(false);
  });

  it("asks a today-facing age question on the birthday", () => {
    const reply = respond("Good morning.", profileWithBirthday(), new Date("2027-08-29T09:00:00-04:00"));
    expect(reply.text).toContain("Happy birthday");
    expect(reply.text).toContain("How old are you today");
    expect(steadyEnhancementEligible("Good morning.", reply)).toBe(false);
  });

  it("learns a clean answer after the optional prompt as sensitive memory", () => {
    const profile = profileWithBirthday("How old will you be, if you feel like sharing?");
    const reply = respond("I'll be 32.", profile, beforeBirthday);
    const age = reply.learned.find((entry) => entry.label === "Birthday age");
    expect(age?.value).toBe("32 on 2026-08-29");
    expect(age?.sensitive).toBe(true);
    expect(reply.text).toContain("age you gave me for Saturday, August 29");
    expect(steadyEnhancementEligible("I'll be 32.", reply)).toBe(false);
  });

  it("replaces rather than duplicates an explicitly corrected age", () => {
    const profile = profileWithBirthday();
    profile.memories.push(createBirthdayAgeMemory(31, "2026-08-29"));
    const reply = respond("I meant 32, not 31.", profile, beforeBirthday);
    const merged = mergeMemories(profile.memories, reply.learned).filter((entry) => entry.label === "Birthday age");
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("32 on 2026-08-29");
  });

  it("gently confirms a repeated old age one birthday year later before changing memory", () => {
    const profile = profileWithBirthday("How old are you today, if you feel like sharing?");
    profile.memories.push(createBirthdayAgeMemory(31, "2026-08-29"));
    profile.turns = [companionTurn("How old are you today, if you feel like sharing?", "2027-08-29T08:59:00-04:00")];
    const reply = respond("31", profile, new Date("2027-08-29T09:00:00-04:00"));
    expect(reply.text).toContain("easy birthday mix-up");
    expect(reply.text).toContain("Did you mean 32, or is 31 correct?");
    expect(reply.learned.some((entry) => entry.label === "Birthday age")).toBe(false);
    expect(steadyEnhancementEligible("31", reply)).toBe(false);
  });

  it("accepts the person's confirmation even when the repeated age really is correct", () => {
    const profile = profileWithBirthday();
    profile.memories.push(createBirthdayAgeMemory(31, "2026-08-29"));
    profile.turns = [companionTurn(
      "I may have caught an easy birthday mix-up. You previously told me 31, and 1 birthday year has passed. Did you mean 32, or is 31 correct? I won't change the saved age until you tell me.",
      "2027-08-29T09:00:00-04:00",
    )];
    const reply = respond("31 is right", profile, new Date("2027-08-29T09:01:00-04:00"));
    expect(reply.learned.find((entry) => entry.label === "Birthday age")?.value).toBe("31 on 2027-08-29");
    expect(mergeMemories(profile.memories, reply.learned).filter((entry) => entry.label === "Birthday age")).toHaveLength(1);
  });

  it("honors a choice not to save age", () => {
    const profile = profileWithBirthday("How old will you be, if you feel like sharing?");
    const reply = respond("Don't save my age", profile, beforeBirthday);
    expect(reply.text).toContain("won't save an age");
    expect(reply.text).toContain("never have to share");
    expect(reply.learned.some((entry) => entry.label === "Birthday age")).toBe(false);
    expect(steadyEnhancementEligible("Don't save my age", reply)).toBe(false);
  });

  it("does not mistake scores or scenes for an age", () => {
    const profile = profileWithBirthday("How old will you be, if you feel like sharing?");
    expect(respond("The score is 32.", profile, beforeBirthday).learned.some((entry) => entry.label === "Birthday age")).toBe(false);
    expect(respond("Scene 32 is next.", profile, beforeBirthday).learned.some((entry) => entry.label === "Birthday age")).toBe(false);
  });

  it("lets acute medical routing override numbers after an age prompt", () => {
    const profile = profileWithBirthday("How old will you be, if you feel like sharing?");
    const reply = respond("I swallowed 30 pills.", profile, beforeBirthday);
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.learned.some((entry) => entry.label === "Birthday age")).toBe(false);
  });

  it("uses the next annual occurrence instead of the stale year stored with the birthday", () => {
    expect(birthdayOccurrenceOnOrAfter("2026-08-29", new Date("2027-08-20T09:00:00-04:00"))).toBe("2027-08-29");
    expect(birthdayOccurrenceOnOrAfter("2026-08-29", new Date("2027-08-30T09:00:00-04:00"))).toBe("2028-08-29");
  });
});
