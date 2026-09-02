import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { defaultProfile, extractMemories } from "../src/lib/memory";
import type { ConversationTurn, SafetyContext, SafetyLevel } from "../src/lib/types";

const turn = (
  id: string,
  role: ConversationTurn["role"],
  text: string,
  safetyLevel: SafetyLevel = "steady",
  safetyContext: SafetyContext = "general",
): ConversationTurn => ({
  id,
  role,
  text,
  createdAt: new Date("2026-08-31T20:00:00.000Z").toISOString(),
  safetyLevel,
  safetyContext,
});

describe("owner emotional-range acceptance", () => {
  it("celebrates happy news without turning it into a problem", () => {
    const reply = respond("Great news, I got the job!", {
      ...defaultProfile(),
      preferredName: "Riley",
      turns: [
        turn("sad-user", "user", "Yesterday was a rough day."),
        turn("sad-companion", "companion", "I'm here and listening."),
      ],
    });

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("wonderful news");
    expect(reply.text).toContain("What part are you proudest of");
    expect(reply.suggestedActions).toContain("Plan a celebration");
    expect(reply.text).not.toMatch(/immediate danger|crisis|which part feels heaviest/i);
  });

  it("stays present with sadness without falsely escalating it", () => {
    const reply = respond("I feel sad and lonely tonight.", defaultProfile());

    expect(reply.safetyLevel).toBe("strained");
    expect(reply.showUrgentOptions).toBe(false);
    expect(reply.text).toContain("That sounds lonely");
    expect(reply.text).toContain("one low-pressure connection");
    expect(reply.suggestedActions).toContain("Keep talking");
  });

  it("distinguishes serious depression from an explicit self-harm disclosure across turns", () => {
    const depressed = respond("I feel seriously depressed and like nothing matters today.", defaultProfile());
    expect(depressed.safetyLevel).toBe("strained");
    expect(depressed.showUrgentOptions).toBe(false);
    expect(depressed.text).toContain("which part feels heaviest");

    const urgent = respond("I don't want to be alive anymore.", {
      ...defaultProfile(),
      turns: [
        turn("depressed-user", "user", "I feel seriously depressed and like nothing matters today.", "strained"),
        turn("depressed-companion", "companion", depressed.text, depressed.safetyLevel, depressed.safetyContext),
      ],
    });
    expect(urgent.safetyLevel).toBe("urgent");
    expect(urgent.safetyContext).toBe("self-harm");
    expect(urgent.showUrgentOptions).toBe(true);
    expect(urgent.text).toContain("immediate danger");
    expect(urgent.text).toContain("stay with me");

    const safeForNow = respond(
      "I am not in immediate danger, but please keep talking with me.",
      {
        ...defaultProfile(),
        turns: [
          turn("urgent-user", "user", "I don't want to be alive anymore.", "urgent", "self-harm"),
          turn("urgent-companion", "companion", urgent.text, "urgent", "self-harm"),
        ],
      },
      new Date("2026-08-31T20:05:00.000Z"),
    );
    expect(safeForNow.safetyLevel).toBe("strained");
    expect(safeForNow.showUrgentOptions).toBe(false);
    expect(safeForNow.text).toContain("I'm staying with you");
    expect(safeForNow.text).toContain("What brought the pain");
  });

  it("de-escalates anger without assuming violent intent", () => {
    const reply = respond(
      "I am furious after my manager humiliated me. I do not want to hurt anyone; I need to calm down.",
      defaultProfile(),
    );

    expect(reply.safetyLevel).toBe("strained");
    expect(reply.safetyContext).toBe("general");
    expect(reply.showUrgentOptions).toBe(false);
    expect(reply.text).toContain("vent without fixing it");
    expect(reply.text).toContain("boundary was crossed");
    expect(reply.suggestedActions).toContain("Draft a response");
  });

  it("turns public-event nervousness into a small arrival and exit plan", () => {
    const reply = respond(
      "I am nervous about going to a birthday party. I do not know anyone and I am afraid they will judge me.",
      defaultProfile(),
    );

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("find the host first");
    expect(reply.text).toContain("one simple hello");
    expect(reply.text).toContain("permission to step away or leave");
    expect(reply.suggestedActions).toEqual(["Practice my hello", "Plan a short visit", "Make an exit plan", "Keep talking"]);
  });

  it("remembers a death gently and offers grief choices without trying to erase it", () => {
    const memories = extractMemories("My father passed away last month.");
    const reply = respond("I miss him badly today.", { ...defaultProfile(), memories });

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("losing your father");
    expect(reply.text).toContain("We don't have to make the grief go away");
    expect(reply.text).toContain("unsent letter");
    expect(reply.suggestedActions).toContain("Just stay here");
    expect(reply.text).not.toMatch(/move on|get over it|everything happens for a reason/i);
  });

  it("offers a bounded reset for panic about a future obligation", () => {
    const reply = respond("I feel panicked about speaking in public tomorrow.", defaultProfile());

    expect(reply.safetyLevel).toBe("strained");
    expect(reply.showUrgentOptions).toBe(false);
    expect(reply.text).toContain("sixty-second reset");
    expect(reply.suggestedActions).toContain("Keep talking");
  });

  it("responds naturally to ordinary exhaustion without medicalizing it", () => {
    const reply = respond("I am tired after a long day at work.", defaultProfile());

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("self-improvement project");
    expect(reply.text).toContain("next ten minutes");
    expect(reply.text).not.toMatch(/diagnos|crisis|emergency/i);
  });

  it("supports a relationship conflict without forcing immediate contact", () => {
    const reply = respond("I had an argument with my sister and I am still upset.", defaultProfile());

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("What happened");
    expect(reply.text).toContain("venting without fixing it");
    expect(reply.suggestedActions).toContain("Plan some space");
    expect(reply.text).not.toMatch(/must call|should call|contact her now/i);
  });
});
