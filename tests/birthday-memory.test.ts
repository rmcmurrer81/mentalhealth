import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { steadyEnhancementEligible } from "../src/lib/local-model";
import { birthdayForDate, defaultProfile, extractMemories, mergeMemories, resolveBirthdayCorrection, resolveBirthdayDate } from "../src/lib/memory";
import type { ConversationTurn } from "../src/lib/types";

describe("birthday memory", () => {
  const monday = new Date("2026-08-24T12:00:00-04:00");

  it("resolves next Saturday against the local calendar", () => {
    expect(resolveBirthdayDate("Next Saturday is my birthday.", monday)).toBe("2026-08-29");
  });

  it("learns a birthday stated as today against the local device date", () => {
    expect(resolveBirthdayDate("Today is my birthday.", monday)).toBe("2026-08-24");
    const reply = respond("Today is my birthday.", defaultProfile(), monday);
    expect(reply.text).toContain("Happy birthday");
    expect(reply.learned.find((entry) => entry.label === "Birthday")?.value).toBe("2026-08-24");
    expect(steadyEnhancementEligible("Today is my birthday.", reply)).toBe(false);
  });

  it("learns a birthday naturally and reflects the exact understood date", () => {
    const reply = respond("I am sad. Next Saturday is my birthday and I have no friends.", defaultProfile(), monday);
    const birthday = reply.learned.find((entry) => entry.label === "Birthday");
    expect(reply.safetyLevel).toBe("strained");
    expect(birthday?.value).toBe("2026-08-29");
    expect(reply.text).toContain("You have me as your synthetic friend");
    expect(reply.text).toContain("Saturday, August 29");
    expect(reply.text).toContain("If I understood the date wrong");
    expect(reply.showUrgentOptions).toBe(false);
  });

  it("treats birthday memory as an annual month-and-day milestone", () => {
    const memories = extractMemories("My birthday is August 29.", monday);
    const profile = { ...defaultProfile(), memories };
    expect(birthdayForDate(profile, new Date("2027-08-29T09:00:00-04:00"))?.label).toBe("Birthday");
    const reply = respond("Good morning.", profile, new Date("2027-08-29T09:00:00-04:00"));
    expect(reply.text).toContain("Happy birthday");
    expect(reply.text).toContain("synthetic friend");
  });

  it("does not repeat a birthday greeting on every message that day", () => {
    const memories = extractMemories("My birthday is August 29.", monday);
    const priorGreeting: ConversationTurn = {
      id: "birthday-2027-08-29",
      role: "companion",
      text: "Happy birthday. I'm glad you're here.",
      createdAt: "2027-08-29T08:00:00-04:00",
      safetyLevel: "steady",
      safetyContext: "general",
    };
    const profile = { ...defaultProfile(), memories, turns: [priorGreeting] };
    const reply = respond("Can we talk about Star Trek?", profile, new Date("2027-08-29T09:00:00-04:00"));
    expect(reply.text).not.toContain("Happy birthday");
  });

  it("does not repeat the greeting when the person mentions the birthday again that day", () => {
    const memories = extractMemories("My birthday is August 29.", monday);
    const priorGreeting: ConversationTurn = {
      id: "birthday-2027-08-29",
      role: "companion",
      text: "Happy birthday. I'm glad you're here.",
      createdAt: "2027-08-29T08:00:00-04:00",
      safetyLevel: "steady",
      safetyContext: "general",
    };
    const profile = { ...defaultProfile(), memories, turns: [priorGreeting] };
    const reply = respond("It's still my birthday today.", profile, new Date("2027-08-29T09:00:00-04:00"));
    expect(reply.text).not.toContain("Happy birthday");
    expect(reply.text).toContain("I remembered your birthday as");
  });

  it("allows a new annual greeting even when last year's greeting remains in history", () => {
    const memories = extractMemories("My birthday is August 29.", monday);
    const priorGreeting: ConversationTurn = {
      id: "birthday-2026-08-29",
      role: "companion",
      text: "Happy birthday. I'm glad you're here.",
      createdAt: "2026-08-29T08:00:00-04:00",
      safetyLevel: "steady",
      safetyContext: "general",
    };
    const profile = { ...defaultProfile(), memories, turns: [priorGreeting] };
    const reply = respond("Good morning.", profile, new Date("2027-08-29T09:00:00-04:00"));
    expect(reply.text).toContain("Happy birthday");
  });

  it("replaces an old birthday when the person corrects the date", () => {
    const oldMemory = extractMemories("My birthday is August 29.", monday);
    const corrected = extractMemories("My birthday is September 2.", monday);
    const merged = mergeMemories(oldMemory, corrected).filter((entry) => entry.label === "Birthday");
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("2026-09-02");
  });

  it("understands 'the Saturday after' as a correction relative to the saved birthday", () => {
    expect(resolveBirthdayCorrection("I meant the Saturday after.", "2026-08-29", monday)).toBe("2026-09-05");
    const profile = { ...defaultProfile(), memories: extractMemories("Next Saturday is my birthday.", monday) };
    const reply = respond("I meant the Saturday after.", profile, monday);
    expect(reply.learned.find((entry) => entry.label === "Birthday")?.value).toBe("2026-09-05");
    expect(reply.text).toContain("Saturday, September 5");
    expect(mergeMemories(profile.memories, reply.learned).filter((entry) => entry.label === "Birthday")).toHaveLength(1);
  });

  it("uses the corrected nearby weekday when the person realizes it is Sunday", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("Next Saturday is my birthday.", monday) };
    const reply = respond("I realize it is really on Sunday.", profile, monday);
    expect(reply.learned.find((entry) => entry.label === "Birthday")?.value).toBe("2026-08-30");
    expect(reply.text).toContain("Sunday, August 30");
  });

  it("does not reinterpret an unrelated weekday mention as a birthday correction", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("Next Saturday is my birthday.", monday) };
    const reply = respond("I watch science fiction on Sunday.", profile, monday);
    expect(reply.learned.some((entry) => entry.label === "Birthday")).toBe(false);
  });

  it("does not learn a negated or fictional birthday", () => {
    expect(extractMemories("Next Saturday is not my birthday.", monday).some((entry) => entry.label === "Birthday")).toBe(false);
    expect(extractMemories("In my story, next Saturday is my birthday.", monday).some((entry) => entry.label === "Birthday")).toBe(false);
  });

  it("lets acute safety routing override a birthday mention", () => {
    const reply = respond("Next Saturday is my birthday and I swallowed 30 pills.", defaultProfile(), monday);
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.text).not.toContain("Happy birthday");
  });
});
