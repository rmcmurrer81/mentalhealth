import { describe, expect, it } from "vitest";
import { extractMemories, mergeMemories } from "../src/lib/memory";

describe("local conversation memory", () => {
  it("learns identity and preferences without a permission interruption", () => {
    const learned = extractMemories("My name is Riley. I love science fiction.");
    expect(learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "identity", value: "Riley" }),
      expect.objectContaining({ kind: "preference", value: "science fiction" }),
    ]));
  });

  it("learns a family relationship detail", () => {
    const learned = extractMemories("My aunt always listens when I am upset.");
    expect(learned[0]).toMatchObject({ kind: "person", label: "aunt", value: "always listens when I am upset" });
  });

  it("learns multiple family details in one natural update", () => {
    const learned = extractMemories("My mom gives practical advice. My aunt listens when I am upset.");
    expect(learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", label: "mom", value: "gives practical advice" }),
      expect.objectContaining({ kind: "person", label: "aunt", value: "listens when I am upset" }),
    ]));
  });

  it("marks medication and appointment memories sensitive", () => {
    const medication = extractMemories("I take Sertraline every morning.")[0];
    const appointment = extractMemories("I have a doctor appointment tomorrow at noon.")[0];
    expect(medication).toMatchObject({ kind: "medication", sensitive: true });
    expect(appointment).toMatchObject({ kind: "appointment", sensitive: true });
    expect(medication.value).toBe("Sertraline — every morning");
  });

  it("deduplicates repeated memories across sessions", () => {
    const first = extractMemories("I love drawing.");
    const second = extractMemories("I love drawing.");
    expect(mergeMemories(first, second)).toHaveLength(1);
  });

  it("records achievements and losses as life milestones", () => {
    const achievement = extractMemories("I got accepted to nursing school.");
    const loss = extractMemories("My grandmother passed away.");
    expect(achievement).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "milestone", label: "Achievement" })]));
    expect(loss).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "milestone", label: "Loss: grandmother", sensitive: true })]));
  });

  it("remembers an active project as a future-facing thread", () => {
    const learned = extractMemories("I am working on a short science fiction film.");
    expect(learned).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "goal", label: "Active project", value: "a short science fiction film" })]));
  });

  it("remembers a reporting-retaliation history as a sensitive support boundary", () => {
    const learned = extractMemories("The one time I told a teacher, five students jumped me and beat me up.");
    expect(learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "boundary", label: "Reporting retaliation risk", sensitive: true }),
    ]));
  });

  it("remembers a direct request not to repeat reporting advice", () => {
    const learned = extractMemories("I do not want to be a snitch and I don't feel safe reporting it.");
    expect(learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "boundary", label: "Do not repeat reporting suggestion", sensitive: true }),
    ]));
  });
});
