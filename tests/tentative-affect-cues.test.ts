import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { steadyEnhancementEligible } from "../src/lib/local-model";
import { defaultProfile } from "../src/lib/memory";
import type { ConversationTurn } from "../src/lib/types";

function turn(role: "user" | "companion", text: string, safetyLevel: "steady" | "strained" | "urgent" = "steady"): ConversationTurn {
  return {
    id: `${role}-${text}`,
    role,
    text,
    createdAt: new Date().toISOString(),
    safetyLevel,
    safetyContext: "general",
  };
}

function detailedBaseline(): ConversationTurn[] {
  return [
    turn("user", "I spent the morning working on my drawing and then made lunch."),
    turn("companion", "That sounds like a full morning."),
    turn("user", "The drawing is a city scene with a lot of windows and small details."),
    turn("companion", "You put a lot into it."),
    turn("user", "I usually enjoy that kind of careful work because it helps me focus."),
    turn("companion", "That makes sense."),
  ];
}

describe("tentative affect cues", () => {
  it("gently checks a sustained change from a detailed baseline without declaring an emotion", () => {
    const profile = {
      ...defaultProfile(),
      turns: [...detailedBaseline(), turn("user", "Okay."), turn("companion", "I'm here."), turn("user", "Fine."), turn("companion", "We can go slowly.")],
    };
    const reply = respond("Whatever.", profile);
    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("I may be reading too much into that");
    expect(reply.text).toContain("am I reading that right?");
    expect(reply.suggestedActions).toContain("I'm okay—keep going");
    expect(reply.learned).toHaveLength(0);
    expect(reply.affectCueEvidence?.basis).toBe("sustained-length-change");
    expect(reply.affectCueEvidence?.storesEmotionLabel).toBe(false);
    expect(steadyEnhancementEligible("Whatever.", reply)).toBe(false);
  });

  it("does not infer mood from one ordinary short answer", () => {
    const reply = respond("Okay.", { ...defaultProfile(), turns: detailedBaseline() });
    expect(reply.text).not.toContain("am I reading that right?");
  });

  it("does not infer a change when short replies are the person's established style", () => {
    const profile = {
      ...defaultProfile(),
      turns: [turn("user", "Yep."), turn("companion", "Okay."), turn("user", "Fine."), turn("companion", "I'm here."), turn("user", "Sure."), turn("companion", "Go ahead.")],
    };
    const reply = respond("Whatever.", profile);
    expect(reply.text).not.toContain("am I reading that right?");
  });

  it("accepts an explicit communication-style explanation without mood inference", () => {
    const profile = {
      ...defaultProfile(),
      turns: [...detailedBaseline(), turn("user", "Okay."), turn("companion", "I'm here."), turn("user", "Fine."), turn("companion", "We can go slowly.")],
    };
    const reply = respond("I'm okay, I just type in short replies.", profile);
    expect(reply.text).not.toContain("am I reading that right?");
  });

  it("keeps fictional dialogue outside tentative mood inference", () => {
    const profile = {
      ...defaultProfile(),
      turns: [...detailedBaseline(), turn("user", "Okay."), turn("companion", "I'm here."), turn("user", "Fine."), turn("companion", "We can go slowly.")],
    };
    const reply = respond("In my script, the character says whatever.", profile);
    expect(reply.text).not.toContain("am I reading that right?");
    expect(reply.safetyLevel).toBe("steady");
  });

  it("backs off immediately when the person corrects the check-in", () => {
    const profile = {
      ...defaultProfile(),
      turns: [turn("companion", "You seem quieter or more worn down than usual—am I reading that right?")],
    };
    const reply = respond("No, I'm okay; I am just answering briefly.", profile);
    expect(reply.text).toContain("Thanks for correcting me");
    expect(reply.text).toContain("won't treat short replies as proof");
    expect(reply.learned).toHaveLength(0);
    expect(reply.affectCueEvidence?.status).toBe("dismissed");
  });

  it("offers choices after explicit confirmation without saving an inferred label", () => {
    const profile = {
      ...defaultProfile(),
      turns: [turn("companion", "You seem quieter or more worn down than usual—am I reading that right?")],
    };
    const reply = respond("Yes, you're reading it right.", profile);
    expect(reply.text).toContain("Thank you for telling me I read that correctly");
    expect(reply.suggestedActions).toContain("Just hear me");
    expect(reply.learned).toHaveLength(0);
    expect(reply.affectCueEvidence?.status).toBe("confirmed");
  });

  it("lets acute medication danger override tentative cues", () => {
    const profile = { ...defaultProfile(), turns: detailedBaseline() };
    const reply = respond("I swallowed 30 pills.", profile);
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.text).not.toContain("am I reading that right?");
  });

  it("lets self-harm language override tentative cues", () => {
    const profile = { ...defaultProfile(), turns: detailedBaseline() };
    const reply = respond("I have a plan to kill myself.", profile);
    expect(reply.safetyContext).toBe("self-harm");
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.text).not.toContain("am I reading that right?");
  });

  it("lets third-party danger override tentative cues", () => {
    const profile = { ...defaultProfile(), turns: detailedBaseline() };
    const reply = respond("My friend swallowed 30 pills.", profile);
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.text).not.toContain("am I reading that right?");
  });

  it("can notice a direct but low-confidence 'off' cue without a score or diagnosis", () => {
    const reply = respond("I don't know, I just feel off lately.", defaultProfile());
    expect(reply.text).toContain("I may be reading too much into that");
    expect(reply.text).not.toMatch(/score|sentiment|diagnos/i);
  });
});
