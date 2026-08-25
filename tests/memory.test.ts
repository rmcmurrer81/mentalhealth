import { describe, expect, it, vi } from "vitest";
import { defaultProfile, extractMemories, forgetMemory, mergeMemories } from "../src/lib/memory";
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
