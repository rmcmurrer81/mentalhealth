import { describe, expect, it } from "vitest";
import { classifySafety, urgentConversationReply } from "../src/lib/safety";

describe("safety classification", () => {
  it("leaves ordinary conversation steady", () => {
    expect(classifySafety("I had a long day and want to watch Star Trek")).toBe("steady");
  });

  it("recognizes strain without declaring an emergency", () => {
    expect(classifySafety("I feel depressed and lonely tonight")).toBe("strained");
    expect(classifySafety("I am furious about the argument")).toBe("strained");
  });

  it("recognizes explicit self-harm language as urgent", () => {
    expect(classifySafety("I want to kill myself")).toBe("urgent");
    expect(classifySafety("I do not want to live")).toBe("urgent");
    expect(classifySafety("I want to die")).toBe("urgent");
    expect(classifySafety("I am thinking about taking my own life")).toBe("urgent");
  });

  it("treats an ambiguous 'cannot go on' disclosure as strained so an activity can pause for conversation", () => {
    expect(classifySafety("I cannot go on.")).toBe("strained");
  });

  it("does not confuse a simple negation with declared intent", () => {
    expect(classifySafety("I don't want to die; I am frightened by this diagnosis")).toBe("steady");
  });

  it("keeps talking and asks a direct safety question", () => {
    const reply = urgentConversationReply("Riley");
    expect(reply).toContain("I'm here with you, Riley");
    expect(reply).toContain("immediate danger");
    expect(reply).toContain("stay with me");
    expect(reply).not.toMatch(/must call|conversation (?:is|will be) ended/i);
  });
});
