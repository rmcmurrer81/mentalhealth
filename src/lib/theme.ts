import type { ThemePreference } from "./types";

export type EffectiveTheme = Exclude<ThemePreference, "system">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "medium" || value === "dark";
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : "medium";
}

export function resolveEffectiveTheme(preference: ThemePreference, systemPrefersDark: boolean): EffectiveTheme {
  return preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
}

/** Narrow matching prevents ordinary uses of the words light and dark from changing the interface. */
export function themePreferenceFromCommand(text: string): ThemePreference | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (/^(?:please\s+)?(?:use|switch\s+to|set|turn\s+on)\s+(?:the\s+)?dark\s+(?:mode|theme)$/.test(normalized)) return "dark";
  if (/^(?:please\s+)?(?:use|switch\s+to|set|turn\s+on)\s+(?:the\s+)?light\s+(?:mode|theme)$/.test(normalized)) return "light";
  if (/^(?:please\s+)?(?:use|switch\s+to|set|turn\s+on)\s+(?:the\s+)?(?:medium|default)\s+(?:mode|theme)$/.test(normalized)) return "medium";
  if (/^(?:please\s+)?(?:use|switch\s+to|set|follow)\s+(?:the\s+)?(?:system|system default|device|device default)(?:\s+(?:mode|theme|setting))?$/.test(normalized)) return "system";
  return null;
}

export function themeConfirmation(preference: ThemePreference): string {
  if (preference === "system") return "I’ll follow this device’s light or dark appearance from now on.";
  if (preference === "medium") return "I switched to the balanced medium appearance and saved it in this private profile.";
  return `I switched to the ${preference} appearance and saved it in this private profile.`;
}
