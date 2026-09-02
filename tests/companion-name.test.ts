import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { respond } from "../src/lib/companion";
import {
  DEFAULT_COMPANION_NAME,
  asksCompanionName,
  cleanCompanionName,
  companionNameFromOptionalInput,
  requestedCompanionName,
} from "../src/lib/companion-name";
import { steadyEnhancementEligible } from "../src/lib/local-model";
import { defaultProfile, loadProfile, saveProfile } from "../src/lib/memory";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = readFileSync(`${root}src/App.tsx`, "utf8");

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

describe("private companion naming", () => {
  it("accepts trimmed Unicode names and rejects unsafe or overlong values", () => {
    expect(cleanCompanionName("  Áine  ")).toBe("Áine");
    expect(cleanCompanionName("小雨")).toBe("小雨");
    expect(cleanCompanionName("R2-D2")).toBe("R2-D2");
    expect(cleanCompanionName("doctor")).toBeNull();
    expect(cleanCompanionName("<img src=x>")).toBeNull();
    expect(cleanCompanionName("a".repeat(41))).toBeNull();
  });

  it("uses the neutral default when onboarding is skipped", () => {
    expect(companionNameFromOptionalInput("")).toBe(DEFAULT_COMPANION_NAME);
    expect(companionNameFromOptionalInput("   ")).toBe(DEFAULT_COMPANION_NAME);
    expect(defaultProfile().companionName).toBe(DEFAULT_COMPANION_NAME);
  });

  it("persists the selected name locally across a profile restart and migrates legacy profiles", () => {
    const storage = localStorageStub();
    vi.stubGlobal("localStorage", storage);
    saveProfile({ ...defaultProfile(), onboardingCompleted: true, companionName: "Nóva" });
    expect(loadProfile().companionName).toBe("Nóva");

    storage.setItem("humanity-companion-profile-v1", JSON.stringify({ ...defaultProfile(), companionName: undefined }));
    expect(loadProfile().companionName).toBe(DEFAULT_COMPANION_NAME);
  });

  it("answers the name question with the selected synthetic identity", () => {
    expect(asksCompanionName("What's your name?")).toBe(true);
    const reply = respond("What is your name?", { ...defaultProfile(), companionName: "Sol" });
    expect(reply.text).toContain("My name is Sol");
    expect(reply.text).toContain("not a human person");
    expect(reply.text).not.toContain("don't have a personal name");
    expect(steadyEnhancementEligible("What is your name?", reply)).toBe(false);
  });

  it("recognizes a bounded direct rename, confirms it, and protects it from local-model rewriting", () => {
    expect(requestedCompanionName("I want to call you Lumi.")).toBe("Lumi");
    const reply = respond("I want to call you Lumi.", defaultProfile());
    expect(reply.companionNameChange).toBe("Lumi");
    expect(reply.text).toContain("You can call me Lumi");
    expect(reply.text).toContain("private device profile");
    expect(steadyEnhancementEligible("I want to call you Lumi.", reply)).toBe(false);
  });

  it("does not let a naming clause override urgent safety handling", () => {
    const reply = respond("I want to call you Lumi, and I swallowed 30 pills ten minutes ago.", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.companionNameChange).toBeUndefined();
  });

  it("wires choose, skip, rename, reset, and selected-name labels in full and compact layouts", () => {
    expect(app).toContain("Your companion’s name (optional)");
    expect(app).toContain("Leave this blank to use the neutral name “Companion.”");
    expect(app).toContain("companionNameFromOptionalInput(onboardingCompanionName)");
    expect(app).toContain("companionName: reply.companionNameChange ?? current.companionName");
    expect(app).toContain("function saveCompanionName()");
    expect(app).toContain("function resetCompanionName()");
    expect(app).toContain("Reset to Companion");
    expect(app).toContain('className="compact-name-settings"');
    expect(app).toContain('className="companion-name-settings"');
    expect(app).toContain('turn.role === "companion" ? profile.companionName : "You"');
    expect(app).toContain('<span className="brand-name">{profile.companionName}');
  });
});
