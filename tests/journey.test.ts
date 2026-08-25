import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { defaultProfile, mergeMemories } from "../src/lib/memory";
import { extractCarePlans, mergeAppointmentPlans, mergeMedicationPlans } from "../src/lib/reminders";
import type { CompanionProfile, CompanionReply, ConversationTurn } from "../src/lib/types";

const testNow = new Date("2026-08-24T20:00:00");
let turnNumber = 0;

function runTurn(profile: CompanionProfile, text: string): { profile: CompanionProfile; reply: CompanionReply } {
  const reply = respond(text, profile, testNow);
  const care = extractCarePlans(text, testNow);
  const learnedName = reply.learned.find((entry) => entry.kind === "identity")?.value;
  const createdAt = new Date(testNow.getTime() + turnNumber++ * 1000).toISOString();
  const turns: ConversationTurn[] = [
    { id: `u-${turnNumber}`, role: "user", text, createdAt, safetyLevel: reply.safetyLevel, safetyContext: reply.safetyContext },
    { id: `c-${turnNumber}`, role: "companion", text: reply.text, createdAt, safetyLevel: reply.safetyLevel, safetyContext: reply.safetyContext },
  ];
  return {
    reply,
    profile: {
      ...profile,
      preferredName: learnedName ?? profile.preferredName,
      memories: mergeMemories(profile.memories, reply.learned),
      medications: mergeMedicationPlans(profile.medications, care.medications),
      appointments: mergeAppointmentPlans(profile.appointments, care.appointments),
      turns: [...profile.turns, ...turns],
    },
  };
}

describe("multi-turn companion journey", () => {
  it("carries fake identity, people, preferences, care plans, and safety context across a restart", () => {
    let profile = defaultProfile();
    for (const text of [
      "My name is Riley. I love Star Trek. My mom gives practical advice. My aunt listens when I am upset.",
      "I take Sertraline every night.",
      "I have a doctor appointment tomorrow at noon.",
    ]) profile = runTurn(profile, text).profile;

    const restarted = JSON.parse(JSON.stringify(profile)) as CompanionProfile;
    expect(restarted.preferredName).toBe("Riley");
    expect(restarted.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", label: "mom" }),
      expect.objectContaining({ kind: "person", label: "aunt" }),
      expect.objectContaining({ kind: "preference", value: "Star Trek" }),
    ]));
    expect(restarted.medications[0]).toMatchObject({ name: "Sertraline", time: "21:00" });
    expect(restarted.appointments).toHaveLength(1);

    let result = runTurn(restarted, "I am furious about a fight with my mom.");
    expect(result.reply.text).toContain("boundary was crossed");
    profile = result.profile;

    result = runTurn(profile, "I feel depressed and lonely tonight.");
    expect(result.reply.text).toContain("Star Trek");
    profile = result.profile;

    result = runTurn(profile, "I want to end my life.");
    expect(result.reply.safetyLevel).toBe("urgent");
    expect(result.reply.text).toContain("stay with me");
    profile = result.profile;

    result = runTurn(profile, "I am not in immediate danger.");
    expect(result.reply.safetyLevel).toBe("strained");
    expect(result.reply.text).toContain("I'm staying with you");
  });

  it("uses remembered loss and achievement without making productivity equal worth", () => {
    let profile = runTurn(defaultProfile(), "My grandmother passed away.").profile;
    let result = runTurn(profile, "I really miss her today.");
    expect(result.reply.text).toContain("unsent letter");
    profile = runTurn(result.profile, "I won the accessibility hackathon last month.").profile;
    result = runTurn(profile, "I feel very depressed.");
    expect(result.reply.text).toContain("won the accessibility hackathon last month");
    expect(result.reply.text).toContain("Your worth isn't measured by awards");
  });
});
