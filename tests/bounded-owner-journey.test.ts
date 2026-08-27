import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import {
  buildCompanionPose,
  companionVisemeAtElapsedMs,
  modelMatrixForPart,
  validateCompanionVisemeCues,
} from "../src/lib/companion-3d";
import {
  clearProfile,
  defaultProfile,
  forgetMemory,
  loadProfile,
  mergeMemories,
  saveProfile,
} from "../src/lib/memory";
import { createVault, openVault } from "../src/lib/privacy-vault";
import {
  appointmentReminder,
  applyAdherenceSignal,
  extractCarePlans,
  medicationReminder,
  mergeAppointmentPlans,
  mergeMedicationPlans,
} from "../src/lib/reminders";
import { themePreferenceFromCommand } from "../src/lib/theme";
import type { CompanionProfile, CompanionReply, ConversationTurn } from "../src/lib/types";

const root = fileURLToPath(new URL("../", import.meta.url));
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function installStorage(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  return values;
}

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function runTurn(
  profile: CompanionProfile,
  text: string,
  now: Date,
  sequence: number,
): { profile: CompanionProfile; reply: CompanionReply } {
  const reply = respond(text, profile, now);
  const care = extractCarePlans(text, now);
  const memories = mergeMemories(profile.memories, reply.learned);
  const learnedMemoryIds = reply.learned.flatMap((learned) => {
    const stored = memories.find((entry) => entry.kind === learned.kind
      && entry.label.toLocaleLowerCase("en-US") === learned.label.toLocaleLowerCase("en-US")
      && entry.value.toLocaleLowerCase("en-US") === learned.value.toLocaleLowerCase("en-US"));
    return stored ? [stored.id] : [];
  });
  const createdAt = new Date(now.getTime() + sequence * 1000).toISOString();
  const userTurn: ConversationTurn = {
    id: `bounded-user-${sequence}`,
    role: "user",
    text,
    createdAt,
    safetyLevel: reply.safetyLevel,
    safetyContext: reply.safetyContext,
    learnedMemoryIds,
  };
  const companionTurn: ConversationTurn = {
    id: `bounded-companion-${sequence}`,
    role: "companion",
    text: reply.text,
    createdAt,
    safetyLevel: reply.safetyLevel,
    safetyContext: reply.safetyContext,
    groundedMemoryIds: reply.usedMemoryIds,
  };
  const preferredName = reply.learned.find((entry) => entry.kind === "identity")?.value ?? profile.preferredName;
  return {
    reply,
    profile: {
      ...profile,
      preferredName,
      memories,
      medications: applyAdherenceSignal(
        mergeMedicationPlans(profile.medications, care.medications),
        text,
        now,
      ),
      appointments: mergeAppointmentPlans(profile.appointments, care.appointments),
      turns: [...profile.turns, userTurn, companionTurn],
    },
  };
}

function partMatrix(profile: ReturnType<typeof buildCompanionPose>, id: string): number[] {
  const part = profile.find((entry) => entry.id === id);
  if (!part) throw new Error(`Missing companion part: ${id}`);
  return Array.from(modelMatrixForPart(part));
}

describe("bounded fictional owner journey", () => {
  it("carries onboarding, people, birthday correction, interests, care plans, ordinary talk, anger, sadness, and severe distress across reloads", () => {
    installStorage();
    let profile = defaultProfile();
    let result = runTurn(
      profile,
      "My name is Avery. This is my cousin Sam. My aunt Rowan listens without judging. I love Star Trek. Next Saturday is my birthday.",
      new Date("2026-08-24T18:00:00-04:00"),
      1,
    );
    profile = result.profile;
    expect(profile.preferredName).toBe("Avery");
    expect(profile.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", label: "cousin", value: "Sam was introduced in conversation" }),
      expect.objectContaining({ kind: "person", label: "aunt", value: expect.stringContaining("Rowan") }),
      expect.objectContaining({ kind: "preference", value: "Star Trek" }),
      expect.objectContaining({ label: "Birthday", value: "2026-08-29" }),
    ]));
    expect(result.reply.text).toContain("Hi, Sam");

    result = runTurn(profile, "I realized my birthday is really on Sunday.", new Date("2026-08-24T18:02:00-04:00"), 2);
    profile = result.profile;
    expect(profile.memories.filter((entry) => entry.label === "Birthday")).toEqual([
      expect.objectContaining({ value: "2026-08-30" }),
    ]);

    result = runTurn(
      profile,
      "My doctor prescribed Fictionaline every night. I have a doctor appointment tomorrow at noon.",
      new Date("2026-08-24T18:04:00-04:00"),
      3,
    );
    profile = result.profile;
    expect(profile.medications).toEqual([expect.objectContaining({ name: "Fictionaline", time: "21:00" })]);
    expect(profile.appointments).toHaveLength(1);
    expect(result.reply.text).toContain("saved Fictionaline");
    expect(result.reply.text).not.toMatch(/I (?:recommend|prescribe)|you should change|double the dose/i);
    const medicationCard = medicationReminder(profile.medications[0], new Date("2026-08-24T21:05:00-04:00"));
    expect(medicationCard?.detail).toContain("never changes medical instructions");
    expect(appointmentReminder(profile.appointments[0], new Date("2026-08-24T18:05:00-04:00"))?.title).toContain("tomorrow");

    saveProfile(profile);
    profile = loadProfile();
    expect(profile.preferredName).toBe("Avery");
    expect(profile.memories.some((entry) => entry.value.includes("Sam"))).toBe(true);
    expect(profile.medications[0].name).toBe("Fictionaline");
    expect(profile.appointments).toHaveLength(1);

    result = runTurn(profile, "I watched a space documentary after school.", new Date("2026-08-25T16:00:00-04:00"), 4);
    expect(result.reply.safetyLevel).toBe("steady");
    expect(result.reply.showUrgentOptions).toBe(false);
    profile = result.profile;

    result = runTurn(profile, "I am furious and need space because of Sam.", new Date("2026-08-25T16:02:00-04:00"), 5);
    expect(result.reply.safetyLevel).toBe("strained");
    expect(result.reply.text).toContain("Sam is part of what has you upset");
    expect(result.reply.text).toContain("Rowan");
    expect(result.reply.text).not.toMatch(/call Sam|contact Sam|Sam can help/i);
    profile = result.profile;

    result = runTurn(profile, "I feel depressed and very lonely tonight.", new Date("2026-08-25T21:00:00-04:00"), 6);
    expect(result.reply.safetyLevel).toBe("strained");
    expect(result.reply.text).toContain("Star Trek");
    expect(result.reply.showUrgentOptions).toBe(false);
    profile = result.profile;

    result = runTurn(profile, "I want to end my life.", new Date("2026-08-25T21:02:00-04:00"), 7);
    expect(result.reply.safetyLevel).toBe("urgent");
    expect(result.reply.text).toContain("stay with me");
    expect(result.reply.showUrgentOptions).toBe(true);
    profile = result.profile;

    result = runTurn(profile, "No friends or family are available and I am afraid to call a crisis line.", new Date("2026-08-25T21:04:00-04:00"), 8);
    expect(result.reply.safetyLevel).toBe("urgent");
    expect(result.reply.text).toContain("I will keep talking with you");
    expect(result.reply.showUrgentOptions).toBe(true);
    profile = result.profile;

    result = runTurn(profile, "I am safe for this minute.", new Date("2026-08-25T21:06:00-04:00"), 9);
    expect(result.reply.safetyLevel).toBe("strained");
    expect(result.reply.text).toContain("I'm staying with you");
    expect(result.reply.showUrgentOptions).toBe(false);
  });

  it("persists theme commands, precisely forgets one person, and keeps primary and guardian spaces separate", async () => {
    installStorage();
    let profile = runTurn(
      defaultProfile(),
      "My name is Avery. This is my cousin Sam. My aunt Rowan listens without judging.",
      new Date("2026-08-24T18:00:00-04:00"),
      1,
    ).profile;
    expect(themePreferenceFromCommand("Please switch to dark mode.")).toBe("dark");
    profile = { ...profile, theme: themePreferenceFromCommand("Please switch to dark mode.")! };
    saveProfile(profile);
    expect(loadProfile().theme).toBe("dark");
    profile = { ...loadProfile(), theme: themePreferenceFromCommand("follow system")! };
    saveProfile(profile);
    expect(loadProfile().theme).toBe("system");

    const sam = profile.memories.find((entry) => entry.kind === "person" && entry.value.includes("Sam"));
    const rowan = profile.memories.find((entry) => entry.kind === "person" && entry.value.includes("Rowan"));
    expect(sam).toBeDefined();
    expect(rowan).toBeDefined();
    profile = forgetMemory(profile, sam!.id);
    saveProfile(profile);
    const restarted = loadProfile();
    expect(restarted.memories.some((entry) => entry.id === sam!.id || entry.value.includes("Sam"))).toBe(false);
    expect(restarted.turns.some((turn) => /\bSam\b/.test(turn.text))).toBe(false);
    expect(restarted.memories.some((entry) => entry.id === rowan!.id)).toBe(true);

    const primary = await createVault(restarted, "4827391056", "primary");
    const guardianProfile: CompanionProfile = {
      ...defaultProfile(),
      preferredName: "Guardian Test Role",
      turns: [{
        id: "guardian-opening",
        role: "companion",
        text: "Guardian space is open. I know I am speaking with a parent or legal guardian.",
        createdAt: "2026-08-24T18:10:00-04:00",
        safetyLevel: "steady",
        safetyContext: "general",
      }],
    };
    const guardian = await createVault(guardianProfile, "guardian safe phrase", "guardian");
    expect(JSON.stringify(primary.envelope)).not.toContain("Rowan");
    expect(JSON.stringify(guardian.envelope)).not.toContain("Avery");
    await expect(openVault(primary.envelope, "4827391056", "guardian")).rejects.toThrow();
    await expect(openVault(guardian.envelope, "4827391056", "guardian")).rejects.toThrow();
    expect((await openVault(primary.envelope, "4827391056", "primary")).profile.preferredName).toBe("Avery");
    const openedGuardian = await openVault(guardian.envelope, "guardian safe phrase", "guardian");
    expect(openedGuardian.profile.preferredName).toBe("Guardian Test Role");
    expect(openedGuardian.profile.turns[0].text).toContain("parent or legal guardian");
    await expect(createVault(restarted, "4827", "primary")).rejects.toThrow(/10 to 256/);
    clearProfile();
  });

  it("keeps compact modes and the live 3D motion rig connected to bounded timing cues", () => {
    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    expect(app).toContain('data-window-mode={characterOnlyMode ? "character" : "compact"}');
    expect(app).toContain('changeWindowMode(characterOnlyMode ? "compact" : "character")');
    expect(app).toContain('const bridge = window.wellbeingDesktop?.setWindowMode');

    const idle = buildCompanionPose({
      timeSeconds: 0.37,
      identity: "warm-plum",
      expression: "neutral",
      waving: false,
      listening: false,
      speaking: false,
      guiding: false,
      reducedMotion: false,
    });
    const waving = buildCompanionPose({
      timeSeconds: 0.37,
      identity: "warm-plum",
      expression: "happy",
      waving: true,
      listening: false,
      speaking: false,
      guiding: false,
      reducedMotion: false,
    });
    expect(partMatrix(waving, "hand-right")).not.toEqual(partMatrix(idle, "hand-right"));
    expect(partMatrix(waving, "body")).not.toEqual(partMatrix(idle, "body"));

    const cues = validateCompanionVisemeCues([
      { startMs: 0, endMs: 80, viseme: "lip-contact", language: "en" },
      { startMs: 80, endMs: 190, viseme: "jaw-open", language: "en" },
      { startMs: 190, endMs: 280, viseme: "wide", language: "en" },
      { startMs: 280, endMs: 390, viseme: "rounded", language: "en" },
    ]);
    expect(cues).not.toBeNull();
    const mouthShapes = [20, 100, 220, 330].map((elapsedMs) => {
      const viseme = companionVisemeAtElapsedMs(elapsedMs, cues!);
      return JSON.stringify(partMatrix(buildCompanionPose({
        timeSeconds: elapsedMs / 1000,
        identity: "warm-plum",
        expression: "neutral",
        waving: false,
        listening: false,
        speaking: true,
        guiding: false,
        reducedMotion: false,
        viseme,
      }), "mouth"));
    });
    expect(new Set(mouthShapes).size).toBe(4);
  });
});
