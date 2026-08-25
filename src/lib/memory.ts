import type { CompanionProfile, MemoryKind, MemoryRecord } from "./types";

const STORAGE_KEY = "humanity-companion-profile-v1";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mem-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function memory(kind: MemoryKind, label: string, value: string, sensitive = false): MemoryRecord {
  return {
    id: newId(),
    kind,
    label,
    value: value.trim(),
    createdAt: new Date().toISOString(),
    sensitive,
    source: "conversation",
  };
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validLocalDate(year: number, month: number, day: number): Date | null {
  const candidate = new Date(year, month, day, 12, 0, 0, 0);
  return candidate.getFullYear() === year && candidate.getMonth() === month && candidate.getDate() === day ? candidate : null;
}

export function resolveBirthdayDate(text: string, now = new Date()): string | null {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!/\bmy birthday\b/i.test(cleaned)) return null;
  if (/\b(?:not|isn'?t) my birthday\b|\b(?:if|pretend|fictional|in my (?:story|script|movie|film|book))\b.{0,80}\bmy birthday\b/i.test(cleaned)) return null;

  if (/\b(?:today is my birthday|my birthday is today)\b/i.test(cleaned)) {
    return localDateKey(now);
  }

  if (/\b(?:tomorrow is my birthday|my birthday is tomorrow)\b/i.test(cleaned)) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0, 0);
    return localDateKey(tomorrow);
  }

  const weekdayMatch = cleaned.match(/\b(?:next\s+)(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+is my birthday\b|\bmy birthday is\s+(?:on\s+)?next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (weekdayMatch) {
    const weekday = WEEKDAYS[(weekdayMatch[1] ?? weekdayMatch[2]).toLowerCase()];
    let delta = (weekday - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    const resolved = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, 12, 0, 0, 0);
    return localDateKey(resolved);
  }

  const monthMatch = cleaned.match(/\bmy birthday is\s+(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+is my birthday\b/i);
  if (monthMatch) {
    const month = MONTHS[(monthMatch[1] ?? monthMatch[3]).toLowerCase()];
    const day = Number(monthMatch[2] ?? monthMatch[4]);
    let year = now.getFullYear();
    let resolved = validLocalDate(year, month, day);
    if (!resolved) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    if (resolved < today) {
      year += 1;
      resolved = validLocalDate(year, month, day);
    }
    return resolved ? localDateKey(resolved) : null;
  }

  return null;
}

function birthdayDateFromValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? validLocalDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function resolveBirthdayCorrection(text: string, currentBirthdayValue: string | undefined, now = new Date()): string | null {
  const current = currentBirthdayValue ? birthdayDateFromValue(currentBirthdayValue) : null;
  if (!current) return null;
  const cleaned = text.trim().replace(/\s+/g, " ");
  const correctionLanguage = /\b(?:i (?:mean|meant|realize[ds]?|realise[ds]?)|actually|sorry|correction|it is really|it'?s really|not\s+(?:sun|mon|tues|wednes|thurs|fri|satur)day)\b/i.test(cleaned);
  if (!correctionLanguage) return null;
  if (/\b(?:pretend|fictional|in my (?:story|script|movie|film|book))\b/i.test(cleaned)) return null;

  const afterMatch = cleaned.match(/\b(?:the\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+after\b/i);
  if (afterMatch) {
    const target = WEEKDAYS[afterMatch[1].toLowerCase()];
    let delta = (target - current.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return localDateKey(new Date(current.getFullYear(), current.getMonth(), current.getDate() + delta, 12, 0, 0, 0));
  }

  const weekdayMatches = [...cleaned.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)];
  if (!weekdayMatches.length) return null;
  const targetName = weekdayMatches.at(-1)?.[1].toLowerCase();
  if (!targetName) return null;
  const target = WEEKDAYS[targetName];
  if (new RegExp(`\\bnext\\s+${targetName}\\b`, "i").test(cleaned)) {
    let delta = (target - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, 12, 0, 0, 0));
  }

  let nearestDelta = (target - current.getDay() + 7) % 7;
  if (nearestDelta > 3) nearestDelta -= 7;
  return localDateKey(new Date(current.getFullYear(), current.getMonth(), current.getDate() + nearestDelta, 12, 0, 0, 0));
}

export function birthdayForDate(profile: CompanionProfile, now = new Date()): MemoryRecord | undefined {
  return [...profile.memories].reverse().find((entry) => {
    if (entry.kind !== "milestone" || entry.label !== "Birthday" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.value)) return false;
    const [, month, day] = entry.value.split("-").map(Number);
    return month === now.getMonth() + 1 && day === now.getDate();
  });
}

export function birthdayOccurrenceOnOrAfter(value: string, now = new Date()): string | null {
  const saved = birthdayDateFromValue(value);
  if (!saved) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  for (let year = now.getFullYear(); year <= now.getFullYear() + 8; year += 1) {
    const candidate = validLocalDate(year, saved.getMonth(), saved.getDate());
    if (candidate && candidate >= today) return localDateKey(candidate);
  }
  return null;
}

export function formatBirthdayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = validLocalDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date)
    : value;
}

export function createBirthdayAgeMemory(age: number, birthdayDate: string): MemoryRecord {
  if (!Number.isInteger(age) || age < 1 || age > 125 || !birthdayDateFromValue(birthdayDate)) {
    throw new Error("Birthday age must be an integer from 1 through 125 with a valid local birthday date.");
  }
  return memory("milestone", "Birthday age", `${age} on ${birthdayDate}`, true);
}

export function parseBirthdayAgeMemory(entry: MemoryRecord | undefined): { age: number; birthdayDate: string } | null {
  if (!entry || entry.kind !== "milestone" || entry.label !== "Birthday age") return null;
  const match = /^(\d{1,3}) on (\d{4}-\d{2}-\d{2})$/.exec(entry.value);
  if (!match) return null;
  const age = Number(match[1]);
  return Number.isInteger(age) && age >= 1 && age <= 125 && birthdayDateFromValue(match[2])
    ? { age, birthdayDate: match[2] }
    : null;
}

export function statedBirthdayAge(text: string, ageQuestionActive = false): number | null {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (/\b(?:pill|tablet|capsule|dose|medication|medicine|temperature|degrees?|score|points?|page|scene)\b/i.test(cleaned)) return null;
  const correction = cleaned.match(/\b(?:i\s+)?(?:mean|meant)\s+(\d{1,3})\b/i);
  const explicit = cleaned.match(/\bi(?:'m| am)\s+(\d{1,3})\s+years? old\b/i)
    ?? cleaned.match(/\bi(?:'ll| will) be\s+(\d{1,3})(?:\s+years? old)?\b/i)
    ?? cleaned.match(/\bi(?:'m| am) turning\s+(\d{1,3})\b/i);
  const contextual = ageQuestionActive
    ? cleaned.match(/^(?:(?:i(?:'m| am| will be)|turning)\s+)?(\d{1,3})(?:\s+years? old)?(?:\s+is right)?[.!]?$/i)
    : null;
  const age = Number((correction ?? explicit ?? contextual)?.[1] ?? Number.NaN);
  return Number.isInteger(age) && age >= 1 && age <= 125 ? age : null;
}

export function extractMemories(text: string, now = new Date(), currentBirthdayValue?: string): MemoryRecord[] {
  const learned: MemoryRecord[] = [];
  const cleaned = text.trim().replace(/\s+/g, " ");

  const nameMatch = cleaned.match(/\b(?:my name is|call me)\s+([A-Za-z][A-Za-z' -]{0,32})(?:[.!?,]|$)/i);
  if (nameMatch) learned.push(memory("identity", "Preferred name", nameMatch[1]));

  const preferenceMatch = cleaned.match(/\bI (?:really )?(like|love|enjoy|prefer)\s+(.+?)(?:[.!?]|$)/i);
  if (preferenceMatch) learned.push(memory("preference", preferenceMatch[1].toLowerCase(), preferenceMatch[2]));

  const dislikeMatch = cleaned.match(/\bI (?:really )?(?:dislike|hate|do not like|don't like)\s+(.+?)(?:[.!?]|$)/i);
  if (dislikeMatch) learned.push(memory("preference", "avoid", dislikeMatch[1]));

  const personPattern = /\bmy (mom|mother|dad|father|parents?|aunt|uncle|sister|brother|friend|partner|wife|husband|cousin)\s+(.+?)(?:[.!?]|$)/gi;
  for (const personMatch of cleaned.matchAll(personPattern)) {
    learned.push(memory("person", personMatch[1].toLowerCase(), personMatch[2]));
  }

  const achievementMatch = cleaned.match(/\bI (won|graduated|completed|finished|got accepted|was accepted|got the job|earned|passed)\s+(.+?)(?:[.!?]|$)/i);
  if (achievementMatch) learned.push(memory("milestone", "Achievement", `${achievementMatch[1]} ${achievementMatch[2]}`));

  const birthday = resolveBirthdayDate(cleaned, now) ?? resolveBirthdayCorrection(cleaned, currentBirthdayValue, now);
  if (birthday) learned.push(memory("milestone", "Birthday", birthday, true));

  const goalMatch = cleaned.match(/\bI(?:'m| am) (?:currently )?(?:working on|building|making|writing|training for|planning)\s+(.+?)(?:[.!?]|$)/i);
  if (goalMatch) learned.push(memory("goal", "Active project", goalMatch[1]));

  const reportingRetaliation = /\b(?:after|when|the (?:one )?time) I (?:told|reported|asked)\b.+\b(?:bullied|jumped|beat|beaten|attacked|hurt|retaliat)/i.test(cleaned)
    || /\breporting\b.+\b(?:made|got|caused|led)\b.+\b(?:worse|jumped|beat|beaten|attacked|hurt|retaliat)/i.test(cleaned);
  if (reportingRetaliation) learned.push(memory("boundary", "Reporting retaliation risk", cleaned, true));

  const reportingDeclined = /\b(?:do not|don't) (?:want to )?(?:tell|report|snitch)\b/i.test(cleaned)
    || /\b(?:i (?:do not|don't|wouldn't|would not) want to be|i(?:'m| am) not) (?:a )?snitch\b/i.test(cleaned)
    || /\b(?:telling|reporting|snitching) (?:does not|doesn't|would not|wouldn't|will not|won't) feel safe\b/i.test(cleaned)
    || /\bI (?:do not|don't) feel safe (?:telling|reporting)\b/i.test(cleaned);
  if (reportingDeclined) learned.push(memory("boundary", "Do not repeat reporting suggestion", cleaned, true));

  const lossMatch = cleaned.match(/\b(?:my\s+)?(grandmother|grandma|grandfather|grandpa|mother|mom|father|dad|aunt|uncle|sister|brother|friend|partner|wife|husband|pet)\s+(died|passed away)|\bI lost my\s+(grandmother|grandma|grandfather|grandpa|mother|mom|father|dad|aunt|uncle|sister|brother|friend|partner|wife|husband|pet)(?=[.!?]|$)/i);
  if (lossMatch) {
    const person = (lossMatch[1] ?? lossMatch[3]).toLowerCase();
    learned.push(memory("milestone", `Loss: ${person}`, cleaned, true));
  }

  const medicationMatch = cleaned.match(/\bI (?:take|am prescribed)\s+(.+?)(?=\s+(?:at\s+\d|every\b|in the\b|nightly\b|daily\b)|[.!?]|$)(?:\s+((?:at\s+\d.+?|every\s+.+?|in the\s+.+?|nightly|daily)))?(?:[.!?]|$)/i);
  if (medicationMatch) {
    const schedule = medicationMatch[2] ? ` — ${medicationMatch[2].trim()}` : "";
    learned.push(memory("medication", "Prescribed medication", `${medicationMatch[1].trim()}${schedule}`, true));
  }

  const appointmentMatch = cleaned.match(/\b(?:I have|my) (?:a |an )?(doctor(?:'s)? |therapy |medical )?appointment\s+(.+?)(?:[.!?]|$)/i);
  if (appointmentMatch) learned.push(memory("appointment", "Appointment", appointmentMatch[2], true));

  return dedupeMemories(learned);
}

export function dedupeMemories(memories: MemoryRecord[]): MemoryRecord[] {
  const seen = new Set<string>();
  return memories.filter((entry) => {
    const key = `${entry.kind}:${entry.label.toLowerCase()}:${entry.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeMemories(existing: MemoryRecord[], learned: MemoryRecord[]): MemoryRecord[] {
  const replacingBirthday = learned.some((entry) => entry.kind === "milestone" && entry.label === "Birthday");
  const replacingBirthdayAge = learned.some((entry) => entry.kind === "milestone" && entry.label === "Birthday age");
  const retained = existing.filter((entry) => {
    if (replacingBirthday && entry.kind === "milestone" && entry.label === "Birthday") return false;
    if (replacingBirthdayAge && entry.kind === "milestone" && entry.label === "Birthday age") return false;
    return true;
  });
  const keys = new Set(retained.map((entry) => `${entry.kind}:${entry.label.toLowerCase()}:${entry.value.toLowerCase()}`));
  return [...retained, ...learned.filter((entry) => !keys.has(`${entry.kind}:${entry.label.toLowerCase()}:${entry.value.toLowerCase()}`))];
}

export function defaultProfile(): CompanionProfile {
  return {
    preferredName: "",
    memories: [],
    medications: [],
    appointments: [],
    turns: [],
    voice: "soft-feminine",
    speechEnabled: true,
    learningEnabled: true,
    interestPacksEnabled: true,
    interests: [],
    affectCueEvidence: [],
  };
}

export function loadProfile(): CompanionProfile {
  if (typeof localStorage === "undefined") return defaultProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultProfile(), ...JSON.parse(raw) } : defaultProfile();
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: CompanionProfile): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function clearProfile(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
}
