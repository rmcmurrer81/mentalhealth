import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { respond } from "../src/lib/companion";
import { defaultProfile, loadProfile, saveProfile } from "../src/lib/memory";
import type { ConversationTurn } from "../src/lib/types";

const root = fileURLToPath(new URL("../", import.meta.url));

function localStorageStub() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("September 1 synthetic regression coverage", () => {
  it("defaults spoken replies on, migrates an ambiguous old false, and preserves a new explicit mute", () => {
    const storage = localStorageStub();
    vi.stubGlobal("localStorage", storage);

    expect(loadProfile().speechEnabled).toBe(true);

    storage.setItem("humanity-companion-profile-v1", JSON.stringify({
      ...defaultProfile(),
      speechEnabled: false,
      speechPreferenceSet: undefined,
    }));
    expect(loadProfile().speechEnabled).toBe(true);
    expect(loadProfile().speechPreferenceSet).toBe(false);

    saveProfile({ ...defaultProfile(), speechEnabled: false, speechPreferenceSet: true });
    expect(loadProfile().speechEnabled).toBe(false);
    expect(loadProfile().speechPreferenceSet).toBe(true);

    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    expect(app).toContain("profile.speechPreferenceSet === true ? profile.speechEnabled !== false : true");
    expect(app).toContain("speechEnabled: enabled, speechPreferenceSet: true");
  });

  it("follows boredom with concrete Civil War report help instead of resetting the conversation", () => {
    const turns: ConversationTurn[] = [
      {
        id: "synthetic-bored-user",
        role: "user",
        text: "I am bored and cannot think of anything to do.",
        createdAt: "2026-09-01T12:00:00.000Z",
        safetyLevel: "steady",
        safetyContext: "general",
      },
      {
        id: "synthetic-bored-companion",
        role: "companion",
        text: "What sounds appealing to you right now—watching a movie, creating something, getting active, or learning something new?",
        createdAt: "2026-09-01T12:00:01.000Z",
        safetyLevel: "steady",
        safetyContext: "general",
      },
    ];
    const profile = { ...defaultProfile(), preferredName: "Taylor", turns };
    const reply = respond(
      "I am stressed about school and work. I need to finish a history report on the American Civil War, and I do not know where to start.",
      profile,
      new Date("2026-09-01T12:01:00.000Z"),
    );

    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toMatch(/school-and-work pressure|juggle between school and work/i);
    expect(reply.text).toMatch(/Civil War/i);
    expect(reply.text).toMatch(/assignment requirements|thesis|outline/i);
    expect(reply.suggestedActions).toContain("Build an outline");
    expect(reply.text).not.toMatch(/^I'm listening/i);
    expect(reply.text).not.toMatch(/what happened and what you want from this moment/i);
  });
});
