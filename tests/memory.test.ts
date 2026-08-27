import { describe, expect, it, vi } from "vitest";
import { defaultProfile, extractMemories, forgetMemory, mergeMemories, personNameFromMemoryValue } from "../src/lib/memory";
import { enhanceSteadyReply, minimizedRecentContext, type WellbeingDesktopBridge } from "../src/lib/local-model";
import { respond } from "../src/lib/companion";
import type { ConversationTurn } from "../src/lib/types";

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

  it("remembers one named relationship when the user introduces someone", () => {
    const learned = extractMemories("This is my cousin Sam.");
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({
      kind: "person",
      label: "cousin",
      value: "Sam was introduced in conversation",
      sensitive: true,
    });
    expect(personNameFromMemoryValue(learned[0].value)).toBe("Sam");
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

  it("preserves a clinician honorific and surname in appointment memory", () => {
    const learned = extractMemories(
      "I have an appointment tomorrow at 3 PM with Dr. Lee. My doctor prescribed Lunexa once at night. Please remind me.",
      new Date("2026-08-24T09:05:00-04:00"),
    );
    expect(learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "appointment", value: "tomorrow at 3 PM with Dr. Lee", sensitive: true }),
      expect.objectContaining({ kind: "medication", value: "Lunexa — once at night", sensitive: true }),
    ]));
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

  it("keeps an achievement and a separate interest as two atomic facts", () => {
    const learned = extractMemories("I won the fictional Cedar Lantern prize and I love astronomy.");
    expect(learned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "milestone", label: "Achievement", value: "won the fictional Cedar Lantern prize" }),
      expect.objectContaining({ kind: "preference", label: "love", value: "astronomy" }),
    ]));
    expect(learned.some((entry) => /astronomy/i.test(entry.value) && entry.kind === "milestone")).toBe(false);
  });

  it.each([
    "I won the fictional Cedar Lantern prize and I love astronomy.",
    "I love astronomy and I won the fictional Cedar Lantern prize.",
    "I won the fictional Cedar Lantern prize plus I love astronomy.",
    "I love astronomy plus I won the fictional Cedar Lantern prize.",
    "I won the fictional Cedar Lantern prize and also love astronomy.",
    "I love astronomy and also won the fictional Cedar Lantern prize.",
  ])("keeps achievement and interest values atomic in either order: %s", (text) => {
    const learned = extractMemories(text);
    const achievement = learned.filter((entry) => entry.kind === "milestone" && entry.label === "Achievement");
    const interests = learned.filter((entry) => entry.kind === "preference");
    expect(achievement).toEqual([
      expect.objectContaining({ value: "won the fictional Cedar Lantern prize" }),
    ]);
    expect(interests).toEqual([
      expect.objectContaining({ label: "love", value: "astronomy" }),
    ]);
  });

  it.each([
    "I won the Cedar Lantern prize, and I love astronomy.",
    "I love astronomy, and I won the Cedar Lantern prize.",
  ])("cleans punctuation while keeping comma-joined achievement and interest facts atomic: %s", (text) => {
    const learned = extractMemories(text);
    expect(learned.filter((entry) => entry.kind === "milestone" && entry.label === "Achievement")).toEqual([
      expect.objectContaining({ value: "won the Cedar Lantern prize" }),
    ]);
    expect(learned.filter((entry) => entry.kind === "preference")).toEqual([
      expect.objectContaining({ label: "love", value: "astronomy" }),
    ]);
    expect(learned.every((entry) => !/[.!?,;:]$/.test(entry.value))).toBe(true);
  });

  it.each([
    "My mom is Dana.",
    "My mom's name is Dana.",
    "Dana is my mom.",
    "My mom, Dana.",
    "My mom Dana got into an argument at work.",
    "My mom is Dana. Dana got into an argument at work.",
  ])("keeps a relative's identity separate from transient events: %s", (text) => {
    const people = extractMemories(text).filter((entry) => entry.kind === "person");
    expect(people).toEqual([
      expect.objectContaining({ label: "mom", value: "Dana was identified in conversation" }),
    ]);
    expect(personNameFromMemoryValue(people[0].value)).toBe("Dana");
    expect(people[0].value).not.toMatch(/argument|work/i);
  });

  it.each([
    "My mom Dana and we had a fight today.",
    "My mom Dana had a fight with me today.",
  ])("keeps a named relative's identity separate from a transient conflict: %s", (text) => {
    const people = extractMemories(text).filter((entry) => entry.kind === "person");
    expect(people).toEqual([
      expect.objectContaining({ label: "mom", value: "Dana was identified in conversation" }),
    ]);
    expect(personNameFromMemoryValue(people[0].value)).toBe("Dana");
    expect(people[0].value).not.toMatch(/fight|today/i);
  });

  it("keeps a named relative call separate from a following achievement", () => {
    const learned = extractMemories("My mom Dana called me, and I won an award.");
    expect(learned.filter((entry) => entry.kind === "person")).toEqual([
      expect.objectContaining({ label: "mom", value: "Dana was identified in conversation" }),
    ]);
    expect(learned.filter((entry) => entry.kind === "milestone" && entry.label === "Achievement")).toEqual([
      expect.objectContaining({ value: "won an award" }),
    ]);
    expect(learned.some((entry) => /called me/i.test(entry.value))).toBe(false);
  });

  it.each([
    { text: "Dana, my mom, had a hard day at work.", relationship: "mom", name: "Dana" },
    { text: "Luis, my uncle, called me yesterday.", relationship: "uncle", name: "Luis" },
    { text: "Dana, who is my mom, called me yesterday.", relationship: "mom", name: "Dana" },
    { text: "My mom named Dana called me yesterday.", relationship: "mom", name: "Dana" },
  ])("learns a name-first appositive relation without retaining its transient event: $text", ({ text, relationship, name }) => {
    const people = extractMemories(text).filter((entry) => entry.kind === "person");
    expect(people).toEqual([
      expect.objectContaining({ label: relationship, value: `${name} was identified in conversation` }),
    ]);
    expect(personNameFromMemoryValue(people[0].value)).toBe(name);
    expect(people[0].value).not.toMatch(/hard day|work|called|yesterday/i);
  });

  it.each([
    "I won the Cedar Lantern prize — and I love astronomy.",
    "I love astronomy — and I won the Cedar Lantern prize.",
  ])("keeps em-dash-joined achievement and interest facts atomic: %s", (text) => {
    const learned = extractMemories(text);
    expect(learned.filter((entry) => entry.kind === "milestone" && entry.label === "Achievement")).toEqual([
      expect.objectContaining({ value: "won the Cedar Lantern prize" }),
    ]);
    expect(learned.filter((entry) => entry.kind === "preference")).toEqual([
      expect.objectContaining({ value: "astronomy" }),
    ]);
    expect(learned.every((entry) => !/[—–]$/.test(entry.value))).toBe(true);
  });

  it.each([
    "I won the Cedar Lantern prize but love astronomy.",
    "I love astronomy but won the Cedar Lantern prize.",
    "I won the Cedar Lantern prize, love astronomy.",
    "I love astronomy, won the Cedar Lantern prize.",
    "I won the Cedar Lantern prize; love astronomy.",
    "I love astronomy; won the Cedar Lantern prize.",
    "I won the Cedar Lantern prize - love astronomy.",
    "I love astronomy - won the Cedar Lantern prize.",
    "I won the Cedar Lantern prize – plus love astronomy.",
    "I love astronomy — and also won the Cedar Lantern prize.",
  ])("splits elided-subject achievement and preference facts across natural separators: %s", (text) => {
    const learned = extractMemories(text);
    expect(learned.filter((entry) => entry.kind === "milestone" && entry.label === "Achievement")).toEqual([
      expect.objectContaining({ value: "won the Cedar Lantern prize" }),
    ]);
    expect(learned.filter((entry) => entry.kind === "preference")).toEqual([
      expect.objectContaining({ label: "love", value: "astronomy" }),
    ]);
  });

  it.each([
    ["I won one prize, earned another.", ["won one prize", "earned another"]],
    ["I earned one prize but won another.", ["earned one prize", "won another"]],
    ["I completed one course and also passed another.", ["completed one course", "passed another"]],
  ])("keeps multiple achievements separate without inventing a conjunction value: %s", (text, expected) => {
    const achievements = extractMemories(text as string)
      .filter((entry) => entry.kind === "milestone" && entry.label === "Achievement")
      .map((entry) => entry.value);
    expect(achievements).toEqual(expected);
  });

  it.each([
    "I won no awards.",
    "If I won an award, I would celebrate.",
    "Suppose I earned a prize.",
    "I do not think I won an award.",
    "I never said I completed the course.",
    "I passed out at school.",
  ])("does not learn negated, hypothetical, or non-achievement milestone wording: %s", (text) => {
    expect(extractMemories(text).some((entry) => entry.kind === "milestone" && entry.label === "Achievement")).toBe(false);
  });

  it.each([
    "If I like astronomy, I might buy a telescope.",
    "Pretend I prefer jazz.",
    "I do not think I like astronomy.",
    "I never said I love astronomy.",
  ])("does not learn negated or hypothetical preferences: %s", (text) => {
    expect(extractMemories(text).some((entry) => entry.kind === "preference")).toBe(false);
  });

  it.each([
    ["I love astronomy…", "preference", "astronomy"],
    ["I love astronomy！", "preference", "astronomy"],
    ["I love astronomy，", "preference", "astronomy"],
    ["I won the Cedar Lantern prize。", "milestone", "won the Cedar Lantern prize"],
    ["I won the Cedar Lantern prize；", "milestone", "won the Cedar Lantern prize"],
    ["I won the Cedar Lantern prize：", "milestone", "won the Cedar Lantern prize"],
  ])("normalizes Unicode and full-width trailing punctuation: %s", (text, kind, value) => {
    expect(extractMemories(text as string)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind, value }),
    ]));
  });

  it.each([
    "My mom called me yesterday.",
    "My mom had a hard day at work.",
    "My mom got into an argument.",
    "My mom phoned me after lunch.",
    "My mom emailed me yesterday.",
    "My mom drove to work today.",
    "My mom lost her keys.",
    "My mom cried last night.",
    "My mom is sick today.",
  ])("does not persist a relation-only transient event or state: %s", (text) => {
    expect(extractMemories(text).filter((entry) => entry.kind === "person")).toEqual([]);
  });

  it.each([
    "My mom is patient.",
    "My mom, tired after work, called me.",
    "My mom, unfortunately, called me.",
  ])("does not manufacture a person's name from an adjective or appositive aside: %s", (text) => {
    const people = extractMemories(text).filter((entry) => entry.kind === "person");
    expect(people.every((entry) => personNameFromMemoryValue(entry.value) === undefined)).toBe(true);
    expect(people.every((entry) => !/was (?:identified|introduced) in conversation/i.test(entry.value))).toBe(true);
  });

  it.each([
    { text: "Dana is my mom and she called me.", relationship: "mom", name: "Dana" },
    { text: "Dana is my mom, and I won an award.", relationship: "mom", name: "Dana" },
    { text: "Dana is my mom — and I won an award.", relationship: "mom", name: "Dana" },
    { text: "Dana — my mom — called me.", relationship: "mom", name: "Dana" },
    { text: "My mom — Dana — called me.", relationship: "mom", name: "Dana" },
    { text: "Dana (my mom) called me.", relationship: "mom", name: "Dana" },
    { text: "My mom (Dana) called me.", relationship: "mom", name: "Dana" },
    { text: "Dana Lee, my mom, called me.", relationship: "mom", name: "Dana Lee" },
    { text: "My mom Dana Lee called me.", relationship: "mom", name: "Dana Lee" },
    { text: "Dana was my mom.", relationship: "mom", name: "Dana" },
    { text: "My mom was Dana.", relationship: "mom", name: "Dana" },
    { text: "Dana Lee, who was my mom, called me.", relationship: "mom", name: "Dana Lee" },
    { text: "My uncle named Luis Miguel phoned me.", relationship: "uncle", name: "Luis Miguel" },
    { text: "My aunt's name was Nina Simone.", relationship: "aunt", name: "Nina Simone" },
  ])("extracts explicit single- and multiword relationship identities without their transient event: $text", ({ text, relationship, name }) => {
    const people = extractMemories(text).filter((entry) => entry.kind === "person");
    expect(people).toEqual([
      expect.objectContaining({ label: relationship, value: `${name} was identified in conversation`, sensitive: true }),
    ]);
    expect(personNameFromMemoryValue(people[0].value)).toBe(name);
  });

  it.each([
    "This is my cousin Sam; please say hello.",
    "This is my cousin Sam: please say hello.",
    "This is my cousin Sam — he just arrived.",
    "Meet my cousin Sam.",
    "This is Sam, my cousin.",
    "Meet Sam — my cousin — please say hello.",
  ])("marks explicit introductions across punctuation forms: %s", (text) => {
    expect(extractMemories(text).filter((entry) => entry.kind === "person")).toEqual([
      expect.objectContaining({ label: "cousin", value: "Sam was introduced in conversation", sensitive: true }),
    ]);
  });

  it("upgrades an identified relationship to introduced without duplicating the person", () => {
    const identified = extractMemories("My cousin is Sam.");
    const introduced = extractMemories("This is my cousin Sam.");

    for (const merged of [mergeMemories(identified, introduced), mergeMemories(introduced, identified)]) {
      expect(merged.filter((entry) => entry.kind === "person")).toEqual([
        expect.objectContaining({ label: "cousin", value: "Sam was introduced in conversation" }),
      ]);
    }
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

  it("forgets the current preferred name atomically with its identity memory", () => {
    const identity = extractMemories("Call me Avery.").find((entry) => entry.kind === "identity");
    expect(identity).toBeDefined();
    const profile = {
      ...defaultProfile(),
      preferredName: "Avery",
      memories: [identity!],
    };

    const forgotten = forgetMemory(profile, identity!.id);

    expect(forgotten.preferredName).toBe("");
    expect(forgotten.memories).toEqual([]);
  });

  it("keeps the preferred name when forgetting an unrelated memory", () => {
    const memories = extractMemories("Call me Avery. I love astronomy.");
    const preference = memories.find((entry) => entry.kind === "preference");
    expect(preference).toBeDefined();
    const profile = { ...defaultProfile(), preferredName: "Avery", memories };

    const forgotten = forgetMemory(profile, preference!.id);

    expect(forgotten.preferredName).toBe("Avery");
    expect(forgotten.memories).toContainEqual(expect.objectContaining({ kind: "identity", value: "Avery" }));
  });

  it("does not clear a newer preferred name when an old identity memory is forgotten", () => {
    const oldIdentity = extractMemories("My name is Riley.").find((entry) => entry.kind === "identity");
    expect(oldIdentity).toBeDefined();
    const profile = {
      ...defaultProfile(),
      preferredName: "Avery",
      memories: [oldIdentity!],
    };

    const forgotten = forgetMemory(profile, oldIdentity!.id);

    expect(forgotten.preferredName).toBe("Avery");
    expect(forgotten.memories).toEqual([]);
  });

  it("removes source, exact-detail, and grounded transcript turns while preserving unrelated conversation", async () => {
    const memories = extractMemories("My aunt Nina lives in Phoenix. I love astronomy.");
    const person = memories.find((entry) => entry.kind === "person");
    const preference = memories.find((entry) => entry.kind === "preference");
    expect(person).toBeDefined();
    expect(preference).toBeDefined();
    const turns: ConversationTurn[] = [
      { id: "source", role: "user", text: "My aunt Nina lives in Phoenix.", createdAt: "2026-08-25T10:00:00Z", safetyLevel: "steady", learnedMemoryIds: [person!.id] },
      { id: "echo", role: "companion", text: "Nina is your aunt. You told me Nina lives in Phoenix.", createdAt: "2026-08-25T10:00:01Z", safetyLevel: "steady", groundedMemoryIds: [person!.id] },
      { id: "paraphrase", role: "companion", text: "I remember what you've shared about your aunt.", createdAt: "2026-08-25T10:00:02Z", safetyLevel: "steady", groundedMemoryIds: [person!.id] },
      { id: "legacy-paraphrase", role: "companion", text: "Nina sounds like someone important to you.", createdAt: "2026-08-25T10:00:02Z", safetyLevel: "steady" },
      { id: "unrelated-user", role: "user", text: "I love astronomy and watched the Phoenix Suns game.", createdAt: "2026-08-25T10:00:03Z", safetyLevel: "steady", learnedMemoryIds: [preference!.id] },
      { id: "unrelated-reply", role: "companion", text: "Astronomy can be a wonderful thread to return to.", createdAt: "2026-08-25T10:00:04Z", safetyLevel: "steady", groundedMemoryIds: [preference!.id] },
    ];
    const forgotten = forgetMemory({ ...defaultProfile(), memories, turns }, person!.id);

    expect(forgotten.memories).toEqual([preference]);
    expect(forgotten.turns.map((turn) => turn.id)).toEqual(["unrelated-user", "unrelated-reply"]);
    expect(JSON.stringify(minimizedRecentContext(forgotten.turns))).not.toMatch(/Nina|Nina lives in Phoenix/i);
    expect(minimizedRecentContext(forgotten.turns)).toEqual([
      { role: "user", text: "I love astronomy and watched the Phoenix Suns game." },
      { role: "companion", text: "Astronomy can be a wonderful thread to return to." },
    ]);

    const localModel: WellbeingDesktopBridge = {
      requestHandsFreePermission: vi.fn(),
      armMicrophone: vi.fn(),
      disarmMicrophone: vi.fn(),
      localModel: {
        status: vi.fn(),
        enhanceSteadyReply: vi.fn().mockResolvedValue({
          status: "fallback",
          candidateText: null,
          fallback: { code: "unavailable", deterministicReplyRequired: true },
          provenance: { externalNetwork: false },
        }),
      },
    };
    const ordinaryReply = respond("I had a long day at work.", forgotten);
    await enhanceSteadyReply("I had a long day at work.", ordinaryReply, forgotten.turns, localModel);
    const request = vi.mocked(localModel.localModel.enhanceSteadyReply).mock.calls[0]?.[0];
    expect(JSON.stringify(request?.recentContext)).not.toMatch(/Nina|Nina lives in Phoenix/i);
    expect(JSON.stringify(request?.recentContext)).toContain("astronomy");
  });

  it("does not erase an unrelated legacy turn that only shares a person's given name", () => {
    const person = extractMemories("My aunt Nina lives in Phoenix.").find((entry) => entry.kind === "person");
    expect(person).toBeDefined();
    const profile = {
      ...defaultProfile(),
      memories: [person!],
      turns: [
        { id: "source", role: "user" as const, text: "My aunt Nina lives in Phoenix.", createdAt: "2026-08-25T10:00:00Z", safetyLevel: "steady" as const, learnedMemoryIds: [person!.id] },
        { id: "collision", role: "user" as const, text: "I listened to Nina Simone and enjoyed the concert.", createdAt: "2026-08-25T10:00:01Z", safetyLevel: "steady" as const },
        { id: "relationship-echo", role: "companion" as const, text: "Nina sounds like someone important to you.", createdAt: "2026-08-25T10:00:02Z", safetyLevel: "steady" as const },
        { id: "relationship-role", role: "companion" as const, text: "Nina is your aunt.", createdAt: "2026-08-25T10:00:02Z", safetyLevel: "steady" as const },
        { id: "other-nina", role: "user" as const, text: "Nina is the singer whose record I bought.", createdAt: "2026-08-25T10:00:02Z", safetyLevel: "steady" as const },
        { id: "unrelated", role: "companion" as const, text: "Music can make an ordinary evening brighter.", createdAt: "2026-08-25T10:00:03Z", safetyLevel: "steady" as const },
      ],
    };

    const forgotten = forgetMemory(profile, person!.id);

    expect(forgotten.turns.map((turn) => turn.id)).toEqual(["collision", "other-nina", "unrelated"]);
    expect(minimizedRecentContext(forgotten.turns)).toEqual([
      { role: "user", text: "I listened to Nina Simone and enjoyed the concert." },
      { role: "user", text: "Nina is the singer whose record I bought." },
      { role: "companion", text: "Music can make an ordinary evening brighter." },
    ]);
  });
});
