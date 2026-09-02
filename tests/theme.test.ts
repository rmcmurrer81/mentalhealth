import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defaultProfile, loadProfile, saveProfile } from "../src/lib/memory";
import {
  normalizeThemePreference,
  resolveEffectiveTheme,
  themeConfirmation,
  themePreferenceFromCommand,
} from "../src/lib/theme";

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

describe("per-profile appearance", () => {
  it("defaults to balanced medium while retaining an explicit device-following preference", () => {
    expect(defaultProfile().theme).toBe("medium");
    expect(resolveEffectiveTheme("medium", true)).toBe("medium");
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });

  it("persists a valid preference and migrates malformed or legacy data to medium", () => {
    const values = installStorage();
    saveProfile({ ...defaultProfile(), theme: "dark" });
    expect(loadProfile().theme).toBe("dark");

    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({ ...defaultProfile(), theme: "neon" }));
    expect(loadProfile().theme).toBe("medium");
    values.set(key, JSON.stringify({ preferredName: "Legacy" }));
    expect(loadProfile().theme).toBe("medium");
    expect(loadProfile().onboardingCompleted).toBe(false);
    values.set(key, JSON.stringify({ ...defaultProfile(), onboardingCompleted: "yes" }));
    expect(loadProfile().onboardingCompleted).toBe(false);
    values.set(key, JSON.stringify({ ...defaultProfile(), onboardingCompleted: true }));
    expect(loadProfile().onboardingCompleted).toBe(true);
    expect(normalizeThemePreference(null)).toBe("medium");
  });

  it("recognizes only explicit conversational appearance commands", () => {
    expect(themePreferenceFromCommand("Please use dark theme.")) .toBe("dark");
    expect(themePreferenceFromCommand("switch to light mode")) .toBe("light");
    expect(themePreferenceFromCommand("use medium theme")) .toBe("medium");
    expect(themePreferenceFromCommand("follow system")) .toBe("system");
    expect(themePreferenceFromCommand("This room is dark")) .toBeNull();
    expect(themePreferenceFromCommand("I saw a light in the hall")) .toBeNull();
    expect(themeConfirmation("system")).toContain("device");
  });

  it("wires the three onboarding themes plus optional device following through settings and CSS", () => {
    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    const styles = readFileSync(`${root}src/styles.css`, "utf8");
    expect(app).toContain('window.matchMedia?.("(prefers-color-scheme: dark)")');
    expect(app).toContain("document.documentElement.dataset.theme = effectiveTheme");
    expect(app).toContain('(["light", "medium", "dark"] as const)');
    expect(app).toContain('(["light", "medium", "dark", "system"] as const)');
    expect(app).toContain("themePreferenceFromCommand(text)");
    expect(styles).toContain('html[data-theme="light"] .app-shell');
    expect(styles).toContain('html[data-theme="dark"] .lock-screen');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
