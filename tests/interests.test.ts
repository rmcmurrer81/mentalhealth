import { describe, expect, it } from "vitest";
import { factsSafeForConversation, learnInterestSignals, mergeInterestPacks, validateInterestSource } from "../src/lib/interests";
import { defaultProfile } from "../src/lib/memory";
import { respond } from "../src/lib/companion";

describe("default-on, spoiler-aware interest knowledge", () => {
  it("recognizes a supported interest and attaches bounded sourced facts", () => {
    const learned = learnInterestSignals("I love Miraculous.", []);
    expect(learned).toHaveLength(1);
    expect(learned[0].title).toContain("Miraculous");
    expect(learned[0].facts.length).toBeGreaterThan(0);
    expect(learned[0].facts.every((fact) => fact.sourceUrl.startsWith("https://"))).toBe(true);
  });

  it("remembers favorite character and progress without repeated permission prompts", () => {
    const first = learnInterestSignals("I love My Little Pony.", []);
    const second = learnInterestSignals("My favorite character is Fluttershy. I am on season 3.", first);
    const merged = mergeInterestPacks(first, second);
    expect(merged[0].favoriteCharacters).toContain("Fluttershy");
    expect(merged[0].progressLabel).toBe("season 3");
    expect(merged[0].spoilerBoundaryKnown).toBe(true);
  });

  it("holds episode-level facts until the recorded progress reaches that exact point", () => {
    const [pack] = learnInterestSignals("I love Miraculous.", []);
    expect(factsSafeForConversation(pack).every((fact) => fact.spoilerLevel === "premise")).toBe(true);
    const [earlySeason] = learnInterestSignals("I am on season 1.", [pack]);
    expect(factsSafeForConversation(earlySeason).some((fact) => fact.spoilerLevel === "episode")).toBe(false);
    const [beforeEpisode] = learnInterestSignals("I am on season 1 episode 21.", [earlySeason]);
    expect(factsSafeForConversation(beforeEpisode).some((fact) => fact.spoilerLevel === "episode")).toBe(false);
    const [atEpisode] = learnInterestSignals("I am on season 1 episode 22.", [beforeEpisode]);
    expect(factsSafeForConversation(atEpisode).some((fact) => fact.spoilerLevel === "episode")).toBe(true);
    const [laterSeason] = learnInterestSignals("I am on season 2.", [pack]);
    expect(factsSafeForConversation(laterSeason).some((fact) => fact.spoilerLevel === "episode")).toBe(true);
    const [finishedSeason] = learnInterestSignals("I finished season 1.", [pack]);
    expect(factsSafeForConversation(finishedSeason).some((fact) => fact.spoilerLevel === "episode")).toBe(true);
  });

  it("does not use a spoiler-level bullying analogy before the saved progress reaches it", () => {
    const interests = learnInterestSignals("I love Miraculous. I am on season 1.", []);
    const reply = respond("A bully keeps picking on me at school", { ...defaultProfile(), interests });
    expect(reply.text).not.toContain("Marinette faced Chloé");
  });

  it("uses a favorite hero as a realistic values lens without powers or money", () => {
    const interests = learnInterestSignals("I love Miraculous. My favorite character is Marinette. I am on season 2.", []);
    const reply = respond("What would Marinette do without powers or money?", { ...defaultProfile(), interests });
    expect(reply.text).toContain("values lens");
    expect(reply.text).toContain("without pretending powers, wealth, or plot armor");
  });

  it("offers a quiet bullying path and does not force reporting", () => {
    const interests = learnInterestSignals("I love Miraculous. I am on season 2.", []);
    const reply = respond("A bully keeps picking on me at school", { ...defaultProfile(), interests });
    expect(reply.text).toContain("not your fault");
    expect(reply.text).toContain("will not force you to report");
    expect(reply.suggestedActions).toContain("Quiet plan for tomorrow");
    expect(reply.text).toContain("if you say no, I will remember and not keep asking");
  });

  it("honors a current no-report boundary immediately and does not offer it again", () => {
    const reply = respond("A bully is picking on me. I do not want to be a snitch and I don't feel safe reporting it.", defaultProfile());
    expect(reply.text).toContain("reporting feels unsafe");
    expect(reply.text).not.toContain("carefully chosen person who might help");
  });

  it("reopens outside help carefully when a new specific death threat changes the risk", () => {
    const profile = {
      ...defaultProfile(),
      memories: [{
        id: "boundary-1",
        kind: "boundary" as const,
        label: "Do not repeat reporting suggestion",
        value: "I do not feel safe reporting",
        createdAt: "2026-08-24T20:00:00.000Z",
        sensitive: true,
        source: "conversation" as const,
      }],
    };
    const reply = respond("The bully sent a death threat and said they would bring a knife", profile);
    expect(reply.text).toContain("materially more dangerous");
    expect(reply.text).toContain("seriously consider");
    expect(reply.text).toContain("I will keep talking");
  });

  it("accepts only credential-free HTTPS sources", () => {
    expect(validateInterestSource("https://www.miraculousladybug.com/characters/ladybug/")).toBe(true);
    expect(validateInterestSource("http://example.com/fact")).toBe(false);
    expect(validateInterestSource("https://user:secret@example.com/fact")).toBe(false);
  });
});
