import { describe, expect, it } from "vitest";
import { extractMemories, mergeMemories, personNameFromMemoryValue } from "../src/lib/memory";

const peopleFrom = (text: string) => extractMemories(text).filter((entry) => entry.kind === "person");
const achievementsFrom = (text: string) => extractMemories(text).filter((entry) => entry.kind === "milestone" && entry.label === "Achievement");
const preferencesFrom = (text: string) => extractMemories(text).filter((entry) => entry.kind === "preference");

describe("relationship identity and transient-event boundaries", () => {
  it.each([
    "My mom called me yesterday.",
    "My mom had a hard day at work.",
    "My mom got into an argument at work.",
    "My mom phoned me.",
    "My mom emailed me.",
    "My mom drove home.",
    "My mom lost her keys.",
    "My mom cried after work.",
    "My mom is sick today.",
    "My mom is patient.",
    "My mom, tired after work, called me.",
    "My mom, unfortunately, called me.",
  ])("does not fabricate a person name from a relation-only event or state: %s", (text) => {
    expect(peopleFrom(text)).toEqual([]);
  });

  it.each([
    ["My mom is Dana.", "Dana"],
    ["My mom was Dana.", "Dana"],
    ["My mom's name is Dana.", "Dana"],
    ["My mom named Dana called me.", "Dana"],
    ["Dana is my mom.", "Dana"],
    ["Dana was my mom.", "Dana"],
    ["Dana, who is my mom, called me.", "Dana"],
    ["My mom, Dana, called me.", "Dana"],
    ["Dana — my mom — called me yesterday.", "Dana"],
    ["My mom — Dana — called me yesterday.", "Dana"],
    ["Dana (my mom) called me yesterday.", "Dana"],
    ["My mom (Dana) called me yesterday.", "Dana"],
    ["Dana Lee, my mom, called me.", "Dana Lee"],
    ["My mom Dana Lee called me.", "Dana Lee"],
  ])("extracts the explicit identity and excludes its transient event: %s", (text, expectedName) => {
    const people = peopleFrom(text);
    expect(people).toHaveLength(1);
    expect(people[0].label).toBe("mom");
    expect(personNameFromMemoryValue(people[0].value)).toBe(expectedName);
    expect(people[0].value).not.toMatch(/called|sick|argument|hard day|yesterday/i);
  });

  it.each([
    "Dana is my mom and she called me yesterday.",
    "Dana is my mom, and she called me yesterday.",
    "Dana is my mom — and she called me yesterday.",
  ])("does not turn a coordinated pronoun/event into a second person identity: %s", (text) => {
    const people = peopleFrom(text);
    expect(people).toHaveLength(1);
    expect(personNameFromMemoryValue(people[0].value)).toBe("Dana");
  });

  it.each([
    "Dana is my mom, and I won an award.",
    "Dana is my mom — and I won an award.",
  ])("keeps a coordinated achievement separate from the relationship identity: %s", (text) => {
    const people = peopleFrom(text);
    expect(people).toHaveLength(1);
    expect(personNameFromMemoryValue(people[0].value)).toBe("Dana");
    expect(achievementsFrom(text)).toEqual([expect.objectContaining({ value: "won an award" })]);
  });

  it("marks a punctuated introduction as introduced and upgrades an earlier identity", () => {
    const identified = extractMemories("Sam is my cousin.");
    const introduced = extractMemories("This is my cousin Sam;");
    const merged = mergeMemories(identified, introduced).filter((entry) => entry.kind === "person");
    expect(introduced).toEqual([expect.objectContaining({ kind: "person", label: "cousin", value: "Sam was introduced in conversation", sensitive: true })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("Sam was introduced in conversation");
  });

  it.each([
    "This is my cousin Sam: he called me.",
    "This is my cousin Sam — he called me.",
  ])("keeps introduction punctuation and the later event out of the name: %s", (text) => {
    const people = peopleFrom(text);
    expect(people).toHaveLength(1);
    expect(people[0].value).toBe("Sam was introduced in conversation");
  });

  it.each([
    ["My aunt is José.", "aunt", "José"],
    ["My friend is Zoë.", "friend", "Zoë"],
    ["Renée is my sister.", "sister", "Renée"],
    ["My uncle Łukasz Kowalski called me.", "uncle", "Łukasz Kowalski"],
    ["My aunt is Dr. Nina Patel.", "aunt", "Dr. Nina Patel"],
    ["Dr. Nina Patel is my aunt.", "aunt", "Dr. Nina Patel"],
    ["My sister is Emily.", "sister", "Emily"],
  ])("supports international and honorific relationship names: %s", (text, relationship, expectedName) => {
    const people = peopleFrom(text);
    expect(people).toEqual([
      expect.objectContaining({ label: relationship, value: `${expectedName} was identified in conversation`, sensitive: true }),
    ]);
    expect(personNameFromMemoryValue(people[0].value)).toBe(expectedName);
  });

  it.each([
    ["Call me José.", "José"],
    ["My name is Zoë.", "Zoë"],
    ["Call me Renée.", "Renée"],
    ["My name is Łukasz.", "Łukasz"],
  ])("supports international preferred names: %s", (text, expectedName) => {
    expect(extractMemories(text)).toEqual([
      expect.objectContaining({ kind: "identity", label: "Preferred name", value: expectedName }),
    ]);
  });

  it.each([
    ["This is my cousin: Sam.", "cousin", "Sam"],
    ["This is Sam—he is my cousin.", "cousin", "Sam"],
    ["This is Zoë — she happens to be my friend.", "friend", "Zoë"],
  ])("recognizes colon and explanatory-dash introductions: %s", (text, relationship, expectedName) => {
    expect(peopleFrom(text)).toEqual([
      expect.objectContaining({ label: relationship, value: `${expectedName} was introduced in conversation`, sensitive: true }),
    ]);
  });

  it.each([
    ["This is my brother; Kenji.", "brother", "Kenji"],
    ["This is Kenji; he is my brother.", "brother", "Kenji"],
    ["Meet my sister; Aiko.", "sister", "Aiko"],
  ])("recognizes semicolon relationship introductions: %s", (text, relationship, expectedName) => {
    expect(peopleFrom(text)).toEqual([
      expect.objectContaining({ label: relationship, value: `${expectedName} was introduced in conversation`, sensitive: true }),
    ]);
  });

  it("recognizes a who-happens-to-be appositive without its event", () => {
    expect(peopleFrom("Dana, who happens to be my mom, coughed yesterday.")).toEqual([
      expect.objectContaining({ label: "mom", value: "Dana was identified in conversation", sensitive: true }),
    ]);
  });

  it.each([
    ["Mina, who turned out to be my cousin, called me.", "cousin", "Mina"],
    ["Luis, who turns out to be my uncle, emailed me.", "uncle", "Luis"],
    ["This is Priya, who turned out to be my friend.", "friend", "Priya"],
  ])("recognizes who-turned-out-to-be appositives without their event: %s", (text, relationship, expectedName) => {
    const people = peopleFrom(text);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ label: relationship, sensitive: true });
    expect(personNameFromMemoryValue(people[0].value)).toBe(expectedName);
    expect(people[0].value).not.toMatch(/called|emailed/i);
  });

  it.each([
    "My mom sneezed during breakfast.",
    "My mom coughed this morning.",
    "My mom fell yesterday.",
    "My mom broke a cup.",
    "My mom moved yesterday.",
    "My mom, sneezing, called me.",
    "My mom, coughing, emailed me.",
  ])("does not persist a relation-only transient action or action-like appositive: %s", (text) => {
    expect(peopleFrom(text)).toEqual([]);
  });

  it.each([
    "My dad vomited this morning.",
    "My aunt tripped yesterday.",
    "My sister misplaced her wallet.",
    "My dad is vomiting this morning.",
    "My aunt is tripping over the rug.",
    "My sister is misplacing her wallet again.",
  ])("does not persist vomit, trip, or misplace relation-only events: %s", (text) => {
    expect(peopleFrom(text)).toEqual([]);
  });

  it.each([
    "My mom Dana sneezed during breakfast.",
    "My mom Dana coughed this morning.",
    "My mom Dana fell yesterday.",
    "My mom Dana broke a cup.",
    "My mom Dana moved yesterday.",
    "Dana, my mom, sneezed during breakfast.",
    "Dana — my mom — coughed this morning.",
    "My mom, Dana, fell yesterday.",
  ])("retains only an explicit identity beside a transient action: %s", (text) => {
    expect(peopleFrom(text)).toEqual([
      expect.objectContaining({ label: "mom", value: "Dana was identified in conversation", sensitive: true }),
    ]);
  });

  it.each([
    ["My cousin Aria vomited this morning.", "cousin", "Aria"],
    ["My aunt Renée tripped yesterday.", "aunt", "Renée"],
    ["My sister Zoë misplaced her wallet.", "sister", "Zoë"],
  ])("keeps only a named identity beside vomit, trip, or misplace events: %s", (text, relationship, expectedName) => {
    expect(peopleFrom(text)).toEqual([
      expect.objectContaining({ label: relationship, value: `${expectedName} was identified in conversation`, sensitive: true }),
    ]);
  });
});

describe("atomic personal facts and factuality", () => {
  it.each([
    "I won the Cedar prize but love astronomy.",
    "I won the Cedar prize, and I love astronomy.",
    "I won the Cedar prize plus I love astronomy.",
    "I won the Cedar prize and also love astronomy.",
    "I love astronomy but won the Cedar prize.",
    "I love astronomy, and I won the Cedar prize.",
    "I love astronomy plus I won the Cedar prize.",
    "I love astronomy and also won the Cedar prize.",
  ])("splits achievement and preference in either order without contamination: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([expect.objectContaining({ value: "won the Cedar prize" })]);
    expect(preferencesFrom(text)).toEqual([expect.objectContaining({ value: "astronomy" })]);
  });

  it("splits two comma-coordinated achievements", () => {
    expect(achievementsFrom("I won one prize, earned another.").map((entry) => entry.value)).toEqual([
      "won one prize",
      "earned another",
    ]);
  });

  it.each([
    "I won no awards.",
    "If I won an award, I would celebrate.",
    "I passed out yesterday.",
  ])("does not learn a negated, hypothetical, or non-achievement phrase: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([]);
  });

  it("does not learn a preference under epistemic negation", () => {
    expect(preferencesFrom("I do not think I like astronomy.")).toEqual([]);
  });

  it.each([
    "I won the Cedar Lantern prize—",
    "I won the Cedar Lantern prize…",
    "I won the Cedar Lantern prize。",
  ])("normalizes and removes trailing Unicode punctuation: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([expect.objectContaining({ value: "won the Cedar Lantern prize" })]);
  });

  it.each([
    "I doubt I won an award.",
    "I am unsure whether I won an award.",
    "I may be mistaken, but I won an award.",
    "The claim that I won an award is false.",
    "I was mistaken when I said I earned a prize.",
    "I won an award?",
  ])("does not learn doubtful, mistaken, false-claim, or questioned achievements: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([]);
  });

  it.each([
    "I suspect I won the regional prize.",
    "I suspected I earned a medal.",
    "I am suspecting I completed the course.",
  ])("does not learn achievements governed by suspicion: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([]);
  });

  it.each([
    "I doubt I like astronomy.",
    "I am unsure whether I love jazz.",
    "The claim that I prefer tea is false.",
    "I wonder whether I enjoy painting.",
    "Do I like astronomy?",
    "I love astronomy?",
  ])("does not learn doubtful, false-claim, or questioned preferences: %s", (text) => {
    expect(preferencesFrom(text)).toEqual([]);
  });

  it.each([
    "Rumor has it that I prefer tea.",
    "Rumour has it I love jazz.",
    "I suspect I enjoy painting.",
  ])("does not learn rumored or suspected preferences: %s", (text) => {
    expect(preferencesFrom(text)).toEqual([]);
  });

  it.each([
    "I won the Cedar prize & love astronomy.",
    "I love astronomy & won the Cedar prize.",
    "I won the Cedar prize then love astronomy.",
    "I love astronomy then won the Cedar prize.",
    "I won the Cedar prize; then love astronomy.",
    "I love astronomy; then won the Cedar prize.",
    "I won the Cedar prize&love astronomy.",
    "I love astronomy&won the Cedar prize.",
  ])("splits ampersand, then, and semicolon personal-fact coordination: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([expect.objectContaining({ value: "won the Cedar prize" })]);
    expect(preferencesFrom(text)).toEqual([expect.objectContaining({ value: "astronomy" })]);
  });

  it.each([
    ["I won the regional prize, afterward earned a medal.", ["won the regional prize", "earned a medal"]],
    ["I completed one course; afterward earned another certificate.", ["completed one course", "earned another certificate"]],
    ["I earned a medal and afterward won the regional prize.", ["earned a medal", "won the regional prize"]],
    ["I won the regional prize; afterwards earned a medal.", ["won the regional prize", "earned a medal"]],
  ])("splits afterward-coordinated achievements atomically: %s", (text, expectedValues) => {
    expect(achievementsFrom(text as string).map((entry) => entry.value)).toEqual(expectedValues);
  });

  it.each([
    "I won the regional prize, afterward love astronomy.",
    "I love astronomy; afterward won the regional prize.",
  ])("splits afterward coordination across achievement and preference facts: %s", (text) => {
    expect(achievementsFrom(text)).toEqual([expect.objectContaining({ value: "won the regional prize" })]);
    expect(preferencesFrom(text)).toEqual([expect.objectContaining({ value: "astronomy" })]);
  });

  it.each([
    ["I love astro\u200Bnomy⋯", "preference", "astronomy"],
    ["I love “astronomy”।", "preference", "astronomy"],
    ["I won the Cedar prize।", "milestone", "won the Cedar prize"],
    ["Call me Avery؟", "identity", "Avery"],
    ["Call me Avery‽", "identity", "Avery"],
  ])("removes Unicode punctuation, wrapping curly quotes, and zero-width contamination: %s", (text, kind, value) => {
    expect(extractMemories(text as string)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind, value }),
    ]));
  });
});
