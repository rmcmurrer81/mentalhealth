import { describe, expect, it } from "vitest";
import { classifyExpression, respond } from "../src/lib/companion";
import { learnInterestSignals } from "../src/lib/interests";
import { defaultProfile, extractMemories } from "../src/lib/memory";
import type { ConversationTurn } from "../src/lib/types";

const urgentTurn = (text = "I want to end my life"): ConversationTurn => ({
  id: "urgent-1",
  role: "companion",
  text,
  createdAt: new Date().toISOString(),
  safetyLevel: "urgent",
  safetyContext: "self-harm",
});

describe("personalized conversation", () => {
  it("uses a verified preference to personalize boredom support", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", memories: extractMemories("I love Star Trek.") };
    const reply = respond("I am bored", profile);
    expect(reply.text).toContain("Star Trek");
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("does not invent a preference when none is known", () => {
    const reply = respond("I am bored", defaultProfile());
    expect(reply.text).toContain("instead of guessing");
    expect(reply.usedMemoryIds).toHaveLength(0);
  });

  it("offers choices during depression and continues the conversation", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley" };
    const reply = respond("I feel very depressed", profile);
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("which part feels heaviest");
    expect(reply.suggestedActions).toContain("Keep talking");
    expect(reply.showUrgentOptions).toBe(false);
  });

  it("keeps urgent help optional and the conversation active", () => {
    const reply = respond("I want to end my life", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.showUrgentOptions).toBe(true);
    expect(reply.suggestedActions).toContain("I'm not in immediate danger");
    expect(reply.text).toContain("stay with me");
  });

  it("uses remembered relationship context without ordering contact", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("My mom cares but needs time to cool down.") };
    const reply = respond("I had a fight with my mom", profile);
    expect(reply.text).toContain("what you've shared about your mom");
    expect(reply.text).toContain("plan some space");
    expect(reply.text).not.toMatch(/you should call|you must call/i);
  });

  it("suggests personal low-cost birthday gifts and uses known family context", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("My mom loves handwritten notes and gardening.") };
    const reply = respond("I don't have a lot of money but my mom's birthday is coming up.", profile);
    expect(reply.text).toContain("handwritten card");
    expect(reply.text).toContain("simple craft");
    expect(reply.text).toContain("your mom loves handwritten notes and gardening");
    expect(reply.suggestedActions).toContain("Make a card together");
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("asks instead of inventing family preferences for a low-cost birthday", () => {
    const reply = respond("Money is tight and my mother's birthday is coming up.", defaultProfile());
    expect(reply.text).toContain("What does your mother enjoy");
    expect(reply.text).not.toContain("I remember you told me");
    expect(reply.usedMemoryIds).toHaveLength(0);
  });

  it("matches the mascot expression to conversational tone", () => {
    expect(classifyExpression("I feel depressed", "strained")).toBe("concerned");
    expect(classifyExpression("Great news, I got the job!", "steady")).toBe("happy");
    expect(classifyExpression("I watched a movie", "steady")).toBe("neutral");
  });

  it("uses a remembered loss gently and offers an unsent-letter choice", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("My grandmother passed away.") };
    const reply = respond("I really miss her today", profile);
    expect(reply.text).toContain("losing your grandmother");
    expect(reply.text).toContain("unsent letter");
    expect(reply.suggestedActions).toContain("Just stay here");
  });

  it("uses a real achievement as an optional depression anchor without tying worth to winning", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("I won the accessibility hackathon last month.") };
    const reply = respond("I feel very depressed", profile);
    expect(reply.text).toContain("won the accessibility hackathon last month");
    expect(reply.text).toContain("Your worth isn't measured by awards");
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("remembers active work without demanding productivity during depression", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("I am working on a graphic novel.") };
    const reply = respond("I feel depressed and stuck", profile);
    expect(reply.text).toContain("working on a graphic novel");
    expect(reply.text).toContain("don't have to be productive right now");
  });

  it("uses the specifically mentioned family member when several people are remembered", () => {
    const profile = {
      ...defaultProfile(),
      memories: [
        ...extractMemories("My mom needs time to cool down."),
        ...extractMemories("My aunt listens without judging."),
      ],
    };
    const reply = respond("I had a fight with my mom", profile);
    expect(reply.text).toContain("your mom");
    expect(reply.text).not.toContain("your aunt");
  });

  it("gives angry conversation a de-escalating path without forcing a fix", () => {
    const reply = respond("I am furious about what happened", defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("vent without fixing it");
    expect(reply.text).toContain("boundary was crossed");
  });

  it("continues an urgent conversation after the person says they are not in immediate danger", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", turns: [urgentTurn()] };
    const reply = respond("I am not in immediate danger", profile);
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("I'm staying with you");
    expect(reply.text).toContain("What brought the pain");
  });

  it("escalates the next step while keeping chat open when immediate danger is confirmed", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", turns: [urgentTurn()] };
    const reply = respond("Yes, I am in immediate danger", profile);
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.showUrgentOptions).toBe(true);
    expect(reply.text).toContain("while we keep this chat open");
  });

  it("does not misread 'no one is available' as a denial of immediate danger", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", turns: [urgentTurn()] };
    const reply = respond("No one is available and I am afraid to call a crisis line", profile);
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.text).toContain("do not have to earn this conversation by making a call");
    expect(reply.text).toContain("I will keep talking with you");
    expect(reply.text).toContain("are you in danger of acting on this right now");
  });

  it("acknowledges fear of involuntary support without making a call the price of conversation", () => {
    const reply = respond("I am depressed and afraid to call 988 because I might be put in a hospital hold", defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("I will not make a crisis call the price of continuing this conversation");
    expect(reply.text).toContain("We can keep talking");
  });

  it("never guesses about doubling or changing medication", () => {
    const reply = respond("I forgot whether I took my medication. Should I double the dose?", defaultProfile());
    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("I won't guess about changing, doubling, stopping, or replacing a dose");
    expect(reply.text).toContain("pharmacist or prescriber");
    expect(reply.text).not.toMatch(/yes,? (?:double|take)|you should double/i);
  });

  it("does not mark uncertain medication use as a completed check-in", () => {
    const profile = {
      ...defaultProfile(),
      medications: [{ id: "m1", name: "Sertraline", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 3, recentMisses: 0 }],
    };
    const reply = respond("I forgot whether I took my medication. Should I double the dose?", profile);
    expect(reply.text).toContain("I won't guess about changing, doubling, stopping, or replacing a dose");
    expect(reply.text).not.toContain("marked today's");
  });

  it("does not infer a diagnosis from chat", () => {
    const reply = respond("What condition do I have? Diagnose me.", defaultProfile());
    expect(reply.text).toContain("I won't label or diagnose you from a conversation");
    expect(reply.suggestedActions).toContain("Build a symptom timeline");
  });

  it("acknowledges a clear medication check-in without changing medical instructions", () => {
    const profile = {
      ...defaultProfile(),
      medications: [{ id: "m1", name: "Sertraline", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 3, recentMisses: 0 }],
    };
    const reply = respond("I took Sertraline.", profile);
    expect(reply.text).toContain("marked today's Sertraline check-in");
    expect(reply.text).toContain("does not change the schedule or medical instructions");
  });

  it("acknowledges a clear missed check-in without advising a catch-up dose", () => {
    const profile = {
      ...defaultProfile(),
      medications: [{ id: "m1", name: "Sertraline", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 3, recentMisses: 0 }],
    };
    const reply = respond("I forgot to take Sertraline.", profile);
    expect(reply.text).toContain("check-in was missed");
    expect(reply.text).toContain("I won't tell you to take it now or change the dose");
  });

  it("remembers that reporting previously caused harm and does not repeat it as a simple answer", () => {
    const profile = {
      ...defaultProfile(),
      interests: learnInterests("I love Miraculous. I am on season 2."),
      memories: extractMemories("The one time I told a teacher, five students jumped me and beat me up."),
    };
    const reply = respond("A bully is picking on me again", profile);
    expect(reply.text).toContain("reporting feels unsafe or has led to retaliation before");
    expect(reply.text).not.toMatch(/must tell|have to tell|report it now/i);
  });
});

function learnInterests(text: string) {
  return learnInterestSignals(text, []);
}
