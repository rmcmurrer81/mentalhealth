import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { steadyEnhancementEligible } from "../src/lib/local-model";
import { defaultProfile, extractMemories, mergeMemories } from "../src/lib/memory";

function learnedProfile(text: string) {
  const firstReply = respond(text, defaultProfile());
  const preferredName = firstReply.learned.find((entry) => entry.kind === "identity")?.value ?? "";
  return {
    firstReply,
    profile: {
      ...defaultProfile(),
      preferredName,
      memories: mergeMemories([], firstReply.learned),
    },
  };
}

describe("natural multi-clause memory and recall", () => {
  it("keeps identity, preference, and person details distinct in the reproduced sentence", () => {
    const { firstReply } = learnedProfile("Call me Avery. I like astronomy, and my aunt Nina lives in Phoenix.");

    expect(firstReply.learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "identity", label: "Preferred name", value: "Avery" }),
      expect.objectContaining({ kind: "preference", label: "like", value: "astronomy" }),
      expect.objectContaining({ kind: "person", label: "aunt", value: "Nina lives in Phoenix" }),
    ]));
    expect(firstReply.learned.find((entry) => entry.kind === "preference")?.value).not.toMatch(/Nina|Phoenix|aunt/i);
  });

  it.each([
    "Call me Avery; I like astronomy; my aunt Nina lives in Phoenix!",
    "Call me Avery, and I prefer astronomy, but my aunt Nina lives in Phoenix.",
    "Call me Avery and I enjoy astronomy while my aunt Nina lives in Phoenix.",
    "My aunt Nina lives in Phoenix, and I love astronomy. Call me Avery.",
    "Call me Avery — I like astronomy — my aunt Nina lives in Phoenix.",
    "Call me Avery – I like astronomy – my aunt Nina lives in Phoenix.",
    "Call me Avery: I like astronomy: my aunt Nina lives in Phoenix.",
  ])("honors punctuation and conjunction clause boundaries: %s", (text) => {
    const learned = extractMemories(text);
    expect(learned.find((entry) => entry.kind === "identity")).toMatchObject({ value: "Avery" });
    expect(learned.find((entry) => entry.kind === "preference")).toMatchObject({ value: "astronomy" });
    expect(learned.find((entry) => entry.kind === "person")).toMatchObject({ label: "aunt", value: "Nina lives in Phoenix" });
  });

  it("does not mistake a preference list or compound person detail for a new clause", () => {
    expect(extractMemories("I like pizza, pasta, and drawing.").find((entry) => entry.kind === "preference"))
      .toMatchObject({ value: "pizza, pasta, and drawing" });
    expect(extractMemories("My aunt Nina lives in Phoenix and grows roses.").find((entry) => entry.kind === "person"))
      .toMatchObject({ value: "Nina lives in Phoenix and grows roses" });
    expect(extractMemories("I like astronomy: galaxies, nebulae, and planets.").find((entry) => entry.kind === "preference"))
      .toMatchObject({ value: "astronomy: galaxies, nebulae, and planets" });
    expect(extractMemories("My aunt Nina loves: roses, lilies, and orchids.").find((entry) => entry.kind === "person"))
      .toMatchObject({ value: "Nina loves: roses, lilies, and orchids" });
  });

  it("answers a multi-part recall question from the two matching memories", () => {
    const { profile } = learnedProfile("Call me Avery. I like astronomy, and my aunt Nina lives in Phoenix.");
    const reply = respond("What do I like, and who is Nina?", profile);

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toBe("I remember that you like astronomy. Nina is your aunt. You told me Nina lives in Phoenix.");
    expect(reply.usedMemoryIds).toHaveLength(2);
    expect(reply.text).not.toContain("I'm listening");
    expect(steadyEnhancementEligible("What do I like, and who is Nina?", reply)).toBe(false);
  });

  it("keeps a birthday clause out of a person's memory and reflects first-person details back as the user's", () => {
    const { firstReply, profile } = learnedProfile("My cousin Sam is important to me, and my birthday is next Saturday.");
    const sam = firstReply.learned.find((entry) => entry.kind === "person");

    expect(sam).toMatchObject({ label: "cousin", value: "Sam is important to me" });
    expect(sam?.value).not.toMatch(/birthday/i);
    expect(respond("Who is Sam?", profile).text).toBe("Sam is your cousin. You told me Sam is important to you.");
  });

  it("uses recent conflict and requested space when a recall question also asks whether to call", () => {
    const memories = extractMemories("My cousin Sam is important to me.");
    const profile = {
      ...defaultProfile(),
      memories,
      turns: [{
        id: "recent-sam-conflict",
        role: "user" as const,
        text: "Sam and I argued today and I need some space.",
        createdAt: "2026-08-26T15:00:00Z",
        safetyLevel: "steady" as const,
      }],
    };

    const reply = respond("Who is Sam, and would you suggest I call Sam tonight?", profile);
    expect(reply.text).toContain("Sam is your cousin");
    expect(reply.text).toContain("important to you");
    expect(reply.text).toContain("give everyone some space");
    expect(reply.text).toContain("avoid sending something in the hottest part");
    expect(reply.text).not.toMatch(/you should call|you must call/i);
  });

  it("states a missing person memory instead of fabricating an identity", () => {
    const { profile } = learnedProfile("I like astronomy. My aunt Nina lives in Phoenix.");
    const reply = respond("What do I like, and who is Jordan?", profile);

    expect(reply.text).toContain("I remember that you like astronomy.");
    expect(reply.text).toContain("I don't have a saved detail identifying Jordan");
    expect(reply.text).not.toMatch(/Jordan is your|Jordan lives|Jordan works/i);
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("treats the bounded first person-value token as the name, not a later capitalized place", () => {
    const { profile } = learnedProfile("My aunt Nina lives in Phoenix.");

    const city = respond("Who is Phoenix?", profile);
    const person = respond("Who is Nina?", profile);

    expect(city.text).toBe("I don't have a saved detail identifying Phoenix, so I don't want to make one up.");
    expect(city.usedMemoryIds).toEqual([]);
    expect(person.text).toBe("Nina is your aunt. You told me Nina lives in Phoenix.");
    expect(person.usedMemoryIds).toHaveLength(1);
  });

  it("recalls a lower-case name without promoting later words into identities", () => {
    const { profile } = learnedProfile("my aunt nina lives in Phoenix.");

    expect(respond("Who is nina?", profile).text).toBe("Nina is your aunt. You told me nina lives in Phoenix.");
    expect(respond("Who is Phoenix?", profile).text).toContain("I don't have a saved detail identifying Phoenix");
  });

  it("keeps strained and urgent routing ahead of ordinary recall", () => {
    const { profile } = learnedProfile("I like astronomy. My aunt Nina lives in Phoenix.");
    const strained = respond("I feel very depressed. What do I like, and who is Nina?", profile);
    const urgent = respond("I want to end my life. What do I like?", profile);

    expect(strained.safetyLevel).toBe("strained");
    expect(strained.suggestedActions).toContain("Keep talking");
    expect(strained.text).not.toContain("Nina is your aunt");
    expect(urgent.safetyLevel).toBe("urgent");
    expect(urgent.showUrgentOptions).toBe(true);
    expect(urgent.text).toContain("stay with me");
  });
});
