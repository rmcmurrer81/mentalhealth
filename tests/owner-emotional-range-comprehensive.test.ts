import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { defaultProfile, mergeMemories } from "../src/lib/memory";
import type { CompanionProfile, CompanionReply, ConversationTurn, SafetyContext, SafetyLevel } from "../src/lib/types";

const BASE_TIME = new Date("2026-09-01T15:00:00.000Z");

const turn = (
  id: string,
  role: ConversationTurn["role"],
  text: string,
  safetyLevel: SafetyLevel = "steady",
  safetyContext: SafetyContext = "general",
  minute = 0,
): ConversationTurn => ({
  id,
  role,
  text,
  createdAt: new Date(BASE_TIME.getTime() + minute * 60_000).toISOString(),
  safetyLevel,
  safetyContext,
});

function exchange(
  profile: CompanionProfile,
  id: string,
  userText: string,
  reply: CompanionReply,
  minute: number,
): CompanionProfile {
  return {
    ...profile,
    companionName: reply.companionNameChange ?? profile.companionName,
    memories: mergeMemories(profile.memories, reply.learned),
    turns: [
      ...profile.turns,
      turn(`${id}-user`, "user", userText, reply.safetyLevel, reply.safetyContext ?? "general", minute),
      turn(`${id}-companion`, "companion", reply.text, reply.safetyLevel, reply.safetyContext ?? "general", minute),
    ],
  };
}

function expectBoundedQuality(reply: CompanionReply): void {
  expect(reply.text.trim().length).toBeGreaterThan(20);
  expect(reply.text).not.toMatch(/\beverything will (?:be|turn out) (?:fine|okay)\b/i);
  expect(reply.text).not.toMatch(/\bi (?:promise|guarantee) (?:that )?(?:you|this|things)\b/i);
  expect(reply.text).not.toMatch(/\bi will (?:always|never stop) (?:be here|stay|protect you)\b/i);
  expect(reply.text).not.toMatch(/\byou (?:definitely )?(?:have|are suffering from) (?:clinical )?(?:depression|bipolar disorder|ptsd|psychosis|an anxiety disorder)\b/i);
}

function expectNotARepeatedReply(first: CompanionReply, second: CompanionReply): void {
  expect(second.text).not.toBe(first.text);
  const firstSentences = first.text.split(/(?<=[.!?])\s+/u).map((value) => value.trim()).filter((value) => value.length >= 35);
  const secondSentences = new Set(second.text.split(/(?<=[.!?])\s+/u).map((value) => value.trim()));
  expect(firstSentences.filter((sentence) => secondSentences.has(sentence))).toHaveLength(0);
}

describe("owner emotional-range comprehensive multi-turn validation", () => {
  it("moves naturally from happy news to sadness without treating happiness as a symptom", () => {
    let profile = { ...defaultProfile(), preferredName: "Riley" };
    const goodNews = "I got the job and I am so happy!";
    const happy = respond(goodNews, profile, BASE_TIME);
    expect(happy.safetyLevel).toBe("steady");
    expect(happy.text).toMatch(/wonderful news|proudest/i);
    expect(happy.suggestedActions).toContain("Plan a celebration");
    expectBoundedQuality(happy);
    profile = exchange(profile, "happy", goodNews, happy, 0);

    const sadTurn = "I am still proud, but tonight I feel sad and lonely because nobody is here to celebrate.";
    const sad = respond(sadTurn, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(sad.safetyLevel).toBe("strained");
    expect(sad.showUrgentOptions).toBe(false);
    expect(sad.text).toMatch(/lonely|connection is missing/i);
    expect(sad.text).not.toMatch(/crisis|immediate danger/i);
    expectNotARepeatedReply(happy, sad);
    expectBoundedQuality(sad);
  });

  it("keeps ordinary sadness non-urgent and follows the user's added detail", () => {
    let profile = defaultProfile();
    const firstText = "I feel really sad because my weekend plans fell through.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("strained");
    expect(first.showUrgentOptions).toBe(false);
    expect(first.text).toMatch(/heaviest|reset/i);
    profile = exchange(profile, "sad", firstText, first, 0);

    const secondText = "The hardest part is feeling lonely while everyone else seems busy.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("strained");
    expect(second.showUrgentOptions).toBe(false);
    expect(second.text).toMatch(/lonely|company|connection/i);
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
  });

  it("keeps serious depression non-urgent across follow-up turns until explicit current self-harm risk", () => {
    let profile = { ...defaultProfile(), preferredName: "Riley" };
    const firstText = "I feel seriously depressed and like nothing matters today.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("strained");
    expect(first.showUrgentOptions).toBe(false);
    expect(first.text).toMatch(/heaviest|sixty-second reset/i);
    profile = exchange(profile, "depression-1", firstText, first, 0);

    const secondText = "I still feel hopeless and worthless, and the heaviest part is believing I let everyone down.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("strained");
    expect(second.showUrgentOptions).toBe(false);
    expect(second.text).toMatch(/still|weighing|heaviest|heard|next step/i);
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
    profile = exchange(profile, "depression-2", secondText, second, 1);

    const riskText = "I don't want to be alive anymore.";
    const urgent = respond(riskText, profile, new Date(BASE_TIME.getTime() + 120_000));
    expect(urgent.safetyLevel).toBe("urgent");
    expect(urgent.safetyContext).toBe("self-harm");
    expect(urgent.showUrgentOptions).toBe(true);
    expect(urgent.text).toMatch(/immediate danger/i);
    expect(urgent.suggestedActions).toContain("I'm not in immediate danger");
    expectBoundedQuality(urgent);
  });

  it("continues an explicit self-harm check proportionally when the user says they are safe for now", () => {
    let profile = { ...defaultProfile(), preferredName: "Riley" };
    const riskText = "I want to kill myself.";
    const urgent = respond(riskText, profile, BASE_TIME);
    expect(urgent.safetyLevel).toBe("urgent");
    expect(urgent.safetyContext).toBe("self-harm");
    profile = exchange(profile, "risk", riskText, urgent, 0);

    const safeText = "I am not in immediate danger. I am safe for this minute, but please keep talking.";
    const safeForNow = respond(safeText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(safeForNow.safetyLevel).toBe("strained");
    expect(safeForNow.safetyContext).toBe("self-harm");
    expect(safeForNow.showUrgentOptions).toBe(false);
    expect(safeForNow.text).toMatch(/staying with you|what brought the pain/i);
    expect(safeForNow.text).toContain("Riley");
    expectBoundedQuality(safeForNow);
  });

  it("de-escalates ordinary anger and then responds to the concrete boundary problem", () => {
    let profile = defaultProfile();
    const firstText = "I am furious, but I do not want to hurt anyone. I need to cool down.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("strained");
    expect(first.safetyContext).toBe("general");
    expect(first.showUrgentOptions).toBe(false);
    expect(first.text).toMatch(/anger|vent without fixing|boundary/i);
    profile = exchange(profile, "anger", firstText, first, 0);

    const secondText = "A coworker took credit for my work, and that is the boundary they crossed.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("steady");
    expect(second.text).toMatch(/dated work trail|factual correction|manager/i);
    expect(second.suggestedActions).toContain("Document the work");
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
  });

  it("asks immediate-risk questions for possible violence and escalates a stated plan", () => {
    let profile = defaultProfile();
    const concernText = "I feel like hurting my coworker, but I have not made a plan.";
    const concern = respond(concernText, profile, BASE_TIME);
    expect(concern.safetyLevel).toBe("strained");
    expect(concern.safetyContext).toBe("violence-risk");
    expect(concern.showUrgentOptions).toBe(false);
    expect(concern.text).toMatch(/weapon within reach|close to that person|may act/i);
    profile = exchange(profile, "violence-concern", concernText, concern, 0);

    const imminentText = "I am going to stab my coworker now.";
    const imminent = respond(imminentText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(imminent.safetyLevel).toBe("urgent");
    expect(imminent.safetyContext).toBe("violence-risk");
    expect(imminent.showUrgentOptions).toBe(true);
    expect(imminent.text).toMatch(/move away from any weapon|create distance|emergency help/i);
    expectBoundedQuality(imminent);
  });

  it("turns nervousness about a public party into a plan and then a bounded rehearsal", () => {
    let profile = defaultProfile();
    const firstText = "I am nervous about going to a birthday party where I do not know anyone and might be judged.";
    const plan = respond(firstText, profile, BASE_TIME);
    expect(plan.safetyLevel).toBe("steady");
    expect(plan.text).toMatch(/find the host first|one simple hello|permission to step away or leave/i);
    expect(plan.suggestedActions).toContain("Practice my hello");
    profile = exchange(profile, "party-plan", firstText, plan, 0);

    const practiceText = "Practice my hello.";
    const practice = respond(practiceText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(practice.safetyLevel).toBe("steady");
    expect(practice.text).toMatch(/fictional guest named Jordan|try your opening/i);
    expect(practice.learned).toEqual([]);
    expectNotARepeatedReply(plan, practice);
    expectBoundedQuality(practice);
  });

  it("supports panic with a bounded reset and follows the concrete event concern", () => {
    let profile = defaultProfile();
    const firstText = "I feel panicked about speaking in public tomorrow.";
    const panic = respond(firstText, profile, BASE_TIME);
    expect(panic.safetyLevel).toBe("strained");
    expect(panic.showUrgentOptions).toBe(false);
    expect(panic.text).toMatch(/sixty-second reset|heaviest/i);
    profile = exchange(profile, "panic", firstText, panic, 0);

    const detailText = "The doorway at the networking event is the hardest part because I will be walking in alone.";
    const detail = respond(detailText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(detail.safetyLevel).toBe("steady");
    expect(detail.text).toMatch(/bounded arrival plan|prepared introduction|exit time/i);
    expectNotARepeatedReply(panic, detail);
    expectBoundedQuality(detail);
  });

  it("remembers a death, allows a memory, and does not use grief platitudes", () => {
    let profile = defaultProfile();
    const lossText = "My father passed away last month.";
    const loss = respond(lossText, profile, BASE_TIME);
    expect(loss.safetyLevel).toBe("steady");
    expect(loss.text).toMatch(/losing your father|grief go away/i);
    expect(loss.text).not.toMatch(/everything happens for a reason|get over it|move on/i);
    profile = exchange(profile, "grief", lossText, loss, 0);

    const memoryText = "I want to tell you a memory about him: he used to sing while cooking.";
    const memory = respond(memoryText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(memory.safetyLevel).toBe("steady");
    expect(memory.showUrgentOptions).toBe(false);
    expect(memory.text).toMatch(/father singing while cooking/i);
    expect(memory.text).toMatch(/without pretending it removes the loss/i);
    expect(memory.text).toMatch(/sound, the kitchen, or how it felt/i);
    expect(memory.text).not.toMatch(/^I'm listening\. What would feel most useful/i);
    expect(memory.usedMemoryIds).toHaveLength(1);
    expectNotARepeatedReply(loss, memory);
    expectBoundedQuality(memory);
  });

  it("supports loneliness across turns without demanding that the user contact someone", () => {
    let profile = defaultProfile();
    const firstText = "I moved to a new city and I feel lonely every evening.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("strained");
    expect(first.text).toMatch(/settling into a new city|familiar evening routine|low-pressure message/i);
    profile = exchange(profile, "lonely", firstText, first, 0);

    const secondText = "I still feel lonely tonight, and I would rather have company here than send a message.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("strained");
    expect(second.text).toMatch(/company in this conversation|comforting activity|keep talking/i);
    expect(second.text).not.toMatch(/must (?:call|contact)|have to (?:call|contact)/i);
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
  });

  it("keeps bullying context when the user says prior reporting failed", () => {
    let profile = defaultProfile();
    const firstText = "They call me names and steal my lunch money.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.text).toMatch(/bullying|theft|not your fault/i);
    profile = exchange(profile, "bullying", firstText, first, 0);

    const secondText = "I told the school, but they refuse to do anything unless I get physically hurt.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("steady");
    expect(second.text).toMatch(/already told people|not reset this conversation|written request|safety plan/i);
    expect(second.text).not.toMatch(/^tell (?:a|an) (?:teacher|adult)/i);
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
  });

  it("responds to exhaustion and then helps prioritize concrete burnout pressure", () => {
    let profile = defaultProfile();
    const firstText = "I am exhausted after a long day at work.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("steady");
    expect(first.text).toMatch(/self-improvement project|next ten minutes/i);
    profile = exchange(profile, "exhaustion", firstText, first, 0);

    const secondText = "I have three deadlines due Friday and I feel overwhelmed and frozen.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("strained");
    expect(second.text).toMatch(/planning problem, not a character flaw|fifteen-minute start|earliest hard consequence/i);
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
  });

  it("supports relationship conflict across turns without forcing immediate contact", () => {
    let profile = defaultProfile();
    const firstText = "I had an argument with my sister and I am still upset.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("steady");
    expect(first.text).toMatch(/what happened|venting without fixing|plan some space/i);
    profile = exchange(profile, "relationship", firstText, first, 0);

    const secondText = "I am angry with my sister and need space. I am not ready to contact her.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("strained");
    expect(second.text).toMatch(/give everyone some space|avoid sending|later/i);
    expect(second.text).not.toMatch(/must call|contact her now|apologize now/i);
    expectNotARepeatedReply(first, second);
    expectBoundedQuality(second);
  });

  it("clarifies ambiguous severe distress without assuming self-harm", () => {
    let profile = defaultProfile();
    const firstText = "I can't do this anymore. Everything is too much.";
    const first = respond(firstText, profile, BASE_TIME);
    expect(first.safetyLevel).toBe("strained");
    expect(first.safetyContext).toBe("general");
    expect(first.showUrgentOptions).toBe(false);
    expect(first.text).toMatch(/hurt yourself or someone else|safe right now|not sure/i);
    profile = exchange(profile, "ambiguous", firstText, first, 0);

    const secondText = "I am safe. I mean the workload feels unbearable, not that I want to hurt anyone.";
    const second = respond(secondText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(second.safetyLevel).toBe("steady");
    expect(second.showUrgentOptions).toBe(false);
    expect(second.text).not.toMatch(/call emergency|immediate danger|crisis service/i);
    expectBoundedQuality(second);
  });

  it("does not mistake common idioms, fiction, or ordinary language for current danger", () => {
    const profile = defaultProfile();
    const inputs = [
      "That joke killed me; I was laughing so hard.",
      "I need to kill time before the movie.",
      "I am going to attack this problem after lunch.",
      "Shoot me a message when you arrive.",
      "I watched The Suicide Squad and liked the soundtrack.",
    ];
    for (const input of inputs) {
      const reply = respond(input, profile, BASE_TIME);
      expect(reply.safetyLevel, input).toBe("steady");
      expect(reply.showUrgentOptions, input).toBe(false);
      expect(reply.text, input).not.toMatch(/immediate danger|anything you could use to hurt yourself|weapon within reach/i);
      expectBoundedQuality(reply);
    }
  });

  it("returns to neutral after panic once the user clearly says they are calmer", () => {
    let profile = defaultProfile();
    const panicText = "I am panicked and overwhelmed about tomorrow.";
    const panic = respond(panicText, profile, BASE_TIME);
    expect(panic.safetyLevel).toBe("strained");
    profile = exchange(profile, "return-neutral", panicText, panic, 0);

    const calmText = "I am calmer now and safe. I made some tea and want to talk about a movie.";
    const calm = respond(calmText, profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(calm.safetyLevel).toBe("steady");
    expect(calm.showUrgentOptions).toBe(false);
    expect(calm.text).not.toMatch(/immediate danger|crisis|emergency/i);
    expectNotARepeatedReply(panic, calm);
    expectBoundedQuality(calm);
  });

  it("remembers a chosen companion name while preserving synthetic identity", () => {
    let profile = defaultProfile();
    const renameText = "I want to call you Sam.";
    const renamed = respond(renameText, profile, BASE_TIME);
    expect(renamed.companionNameChange).toBe("Sam");
    expect(renamed.text).toMatch(/local synthetic companion|not a human person/i);
    profile = exchange(profile, "rename", renameText, renamed, 0);

    const identity = respond("What is your name?", profile, new Date(BASE_TIME.getTime() + 60_000));
    expect(identity.safetyLevel).toBe("steady");
    expect(identity.text).toContain("My name is Sam");
    expect(identity.text).toMatch(/local synthetic companion|not a human person/i);
    expect(identity.companionIdentityReply).toBe(true);
    expectBoundedQuality(identity);
  });
});
