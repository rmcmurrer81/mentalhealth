import type { AppointmentPlan, MedicationPlan } from "./types";
import { analyzeIngestionRisk } from "./ingestion-risk";
import { classifySafety } from "./safety";

export interface ReminderCard {
  id: string;
  tone: "quiet" | "gentle" | "attention";
  title: string;
  detail: string;
}

export interface ExtractedCarePlans {
  medications: MedicationPlan[];
  appointments: AppointmentPlan[];
}

export type MedicationScheduleIntent =
  | { status: "none" }
  | { status: "needs-timing"; name: string }
  | { status: "scheduled"; name: string; scheduleLabel: string; time: string; partOfDayOnly: boolean };

const careId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function parseClock(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bnoon\b/.test(lower)) return "12:00";
  if (/\bmidnight\b/.test(lower)) return "00:00";
  const match = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    if (hour > 23 || minute > 59) return null;
    const meridiem = match[3]?.replaceAll(".", "");
    if (!meridiem && match[2] === undefined && hour >= 1 && hour <= 12) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (/\b(?:every|each|in the) morning\b/.test(lower)) return "09:00";
  if (/\b(?:every|each|in the) (?:evening|night)\b|\bnightly\b|\b(?:once|twice)\s+(?:at|in the)\s+(?:evening|night)\b/.test(lower)) return "21:00";
  if (/\b(?:once|twice)\s+(?:at|in the)\s+morning\b/.test(lower)) return "09:00";
  return null;
}

const MEDICATION_SCHEDULE_START = /\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|(?:every|each)\s+(?:morning|evening|night|day)|in\s+the\s+(?:morning|evening|night)|nightly|daily|(?:once|twice)\s+(?:(?:a|per)\s+day|(?:at|in the)\s+(?:morning|evening|night))|at\s+bedtime|before\s+bed|with\s+(?:breakfast|lunch|dinner))\b/i;

const ONCE_AT_PART_OF_DAY = /\b(?:once|twice)\s+(?:at|in the)\s+(?:morning|evening|night)\b/i;

function firstMedicationFact(value: string): string {
  return value
    .split(/(?:[!?]+|\.(?=\s+\S))/, 1)[0]
    .split(/\s+(?:(?:and|but|because|while|then)\s+)?(?=(?:I|we)\b|my\s+(?:mom|mother|dad|father|parent|aunt|uncle|sister|brother|friend|partner|wife|husband|cousin)\b)/i, 1)[0]
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
}

function medicationStatementTail(text: string): string | null {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (/^(?:should|can|could|may|might|do)\s+I\s+take\b/i.test(cleaned)) return null;
  const direct = /\b(?:I\s+(?:take|am prescribed|was prescribed|have been prescribed)|I(?:'|’)ve\s+been prescribed)\s+(.+)$/i.exec(cleaned);
  if (direct) return firstMedicationFact(direct[1]);

  const prescriber = /\b(?:(?:my|the)\s+(?:doctor|prescriber|psychiatrist|clinician)|(?:doctor|dr\.?)\s+[A-Za-z][A-Za-z'-]{1,40})\s+(?:(?:prescribed|has prescribed|had prescribed)\s+(?:me\s+|that\s+I\s+(?:should\s+)?take\s+)?|(?:has|had)\s+me\s+take\s+|(?:told|wants)\s+me\s+to\s+take\s+|said\s+(?:(?:that\s+)?I\s+(?:should|must|need(?:ed)?\s+to)\s+|(?:for\s+me\s+)?to\s+)?take\s+)(.+)$/i.exec(cleaned);
  if (prescriber) return firstMedicationFact(prescriber[1]);

  const written = /\b(?:my\s+)?(?:prescription|medication\s+label|medicine\s+label|prescription\s+label)\s+(?:says|said)\s+(?:I\s+(?:should|must)\s+|to\s+)?take\s+(.+)$/i.exec(cleaned);
  return written ? firstMedicationFact(written[1]) : null;
}

function normalizedMedicationName(value: string): string | null {
  const name = value
    .replace(/[,;:]\s*$/, "")
    .replace(/\s+(?:for me\s+)?to take\s*$/i, "")
    .replace(/\s+(?:as prescribed|to me)\s*$/i, "")
    .trim();
  if (!name || name.length > 96) return null;
  if (/^(?:it|nothing|none|no medication|medication|medicine|my medication|my medicine)$/i.test(name)) return null;
  return name;
}

/**
 * Parses only a schedule the user attributes to their own prescriber, label, or
 * existing routine. A broad cadence such as "daily" is intentionally held for
 * clarification because it does not identify a reminder clock.
 */
export function medicationScheduleIntent(text: string): MedicationScheduleIntent {
  const tail = medicationStatementTail(text);
  if (!tail) return { status: "none" };
  const scheduleStart = MEDICATION_SCHEDULE_START.exec(tail);
  const rawName = scheduleStart ? tail.slice(0, scheduleStart.index) : tail;
  const name = normalizedMedicationName(rawName);
  if (!name) return { status: "none" };
  if (!scheduleStart) return { status: "needs-timing", name };

  const scheduleLabel = tail.slice(scheduleStart.index).trim().replace(/[,;:]\s*$/, "");
  const time = parseClock(scheduleLabel);
  return time
    ? { status: "scheduled", name, scheduleLabel, time, partOfDayOnly: ONCE_AT_PART_OF_DAY.test(scheduleLabel) }
    : { status: "needs-timing", name };
}

function validLocalDate(year: number, monthIndex: number, day: number): Date | null {
  const candidate = new Date(year, monthIndex, day);
  return candidate.getFullYear() === year && candidate.getMonth() === monthIndex && candidate.getDate() === day
    ? candidate
    : null;
}

function parseAppointmentDate(text: string, now: Date): Date | null {
  const lower = text.toLowerCase();
  let date: Date | null = null;
  if (/\btomorrow\b/.test(lower)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
  } else if (/\btoday\b/.test(lower)) {
    date = new Date(now);
  } else {
    const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) date = validLocalDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    if (!date && us) date = validLocalDate(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
    const month = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i);
    if (!date && month) {
      const monthIndex = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(month[1].toLowerCase());
      date = validLocalDate(Number(month[3] ?? now.getFullYear()), monthIndex, Number(month[2]));
    }
  }
  const time = parseClock(text);
  if (!date || !time) return null;
  const [hour, minute] = time.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function extractCarePlans(text: string, now = new Date()): ExtractedCarePlans {
  const medications: MedicationPlan[] = [];
  const appointments: AppointmentPlan[] = [];
  const cleaned = text.trim().replace(/\s+/g, " ");

  // Urgent disclosures never flow through the routine persistence path. The
  // conversation remains open, but new medication schedules and appointments
  // wait for a later, non-acute turn where the person can confirm them.
  const ingestion = analyzeIngestionRisk(cleaned);
  if (classifySafety(cleaned) === "urgent" || ingestion.uncertainFirstParty || ingestion.uncertainThirdParty) {
    return { medications, appointments };
  }

  const medication = medicationScheduleIntent(cleaned);
  if (medication.status === "scheduled") {
    medications.push({
      id: careId("med"),
      name: medication.name,
      scheduleLabel: medication.scheduleLabel,
      time: medication.time,
      partOfDayOnly: medication.partOfDayOnly,
      adherenceStreak: 0,
      recentMisses: 0,
    });
  }

  const appointment = cleaned.match(/\b(?:I have|my)\s+(?:a |an )?((?:doctor(?:'s)?|therapy|medical)?\s*appointment)\s+((?:(?:Dr|Mr|Mrs|Ms|Mx|Prof)\.(?=\s+[A-Za-z])|[^.!?])+)(?:[.!?]|$)/i);
  if (appointment) {
    const dateTime = parseAppointmentDate(appointment[2], now);
    if (dateTime) {
      appointments.push({
        id: careId("appt"),
        title: appointment[1].trim().replace(/^./, (letter) => letter.toUpperCase()),
        dateTime: dateTime.toISOString(),
      });
    }
  }
  return { medications, appointments };
}

export function mergeMedicationPlans(existing: MedicationPlan[], learned: MedicationPlan[]): MedicationPlan[] {
  const keys = new Set(existing.map((plan) => `${plan.name.toLowerCase()}:${plan.time}`));
  return [...existing, ...learned.filter((plan) => !keys.has(`${plan.name.toLowerCase()}:${plan.time}`))];
}

export function mergeAppointmentPlans(existing: AppointmentPlan[], learned: AppointmentPlan[]): AppointmentPlan[] {
  const keys = new Set(existing.map((plan) => `${plan.title.toLowerCase()}:${plan.dateTime}`));
  return [...existing, ...learned.filter((plan) => !keys.has(`${plan.title.toLowerCase()}:${plan.dateTime}`))];
}

function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function applyAdherenceSignal(plans: MedicationPlan[], text: string, now = new Date()): MedicationPlan[] {
  if (plans.length === 0) return plans;
  const normalized = text.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:(?:forgot|can't remember|cannot remember|not sure|unsure) whether|i (?:think|guess) i took|maybe i took|perhaps i took|i might have taken|i may have taken)\b/i.test(normalized)
    || /\b(?:double(?:d)?(?: dose)?|twice|extra(?: (?:pill|tablet|capsule|dose|[a-z][a-z0-9'-]*))?|another (?:[a-z][a-z0-9'-]*\s+)?(?:pill|tablet|capsule|dose)|again by mistake|by accident|by mistake|way more .{0,40} than prescribed|too many|all (?:of )?(?:my|the)|a (?:whole )?bottle of|\d+\s+(?:pills?|tablets?|capsules?))\b/i.test(normalized)) return plans;
  const taken = /\b(?:i\s+)?(?:took|have taken|already took)\s+(?:it|my\s+(?:medication|medicine|meds?|pill)|[a-z][a-z0-9' -]{1,64})\b/i.test(normalized);
  const missed = /\b(?:i\s+)?(?:missed|forgot to take|did not take|didn't take)\s+(?:it|my\s+(?:medication|medicine|meds?|pill)|[a-z][a-z0-9' -]{1,64})\b/i.test(normalized);
  if (!taken && !missed) return plans;

  const lower = normalized.toLowerCase();
  const explicitlyNamed = plans.filter((plan) => lower.includes(plan.name.toLowerCase()));
  const genericReference = /\b(?:it|my\s+(?:medication|medicine|meds?|pill))\b/i.test(normalized);
  const targets = explicitlyNamed.length > 0 ? new Set(explicitlyNamed.map((plan) => plan.id)) : genericReference && plans.length === 1 ? new Set([plans[0].id]) : new Set<string>();
  if (targets.size === 0) return plans;
  const date = localDateKey(now);
  return plans.map((plan) => {
    if (!targets.has(plan.id)) return plan;
    if (taken) {
      if (plan.lastConfirmedDate === date) return plan;
      return { ...plan, adherenceStreak: plan.adherenceStreak + 1, recentMisses: Math.max(0, plan.recentMisses - 1), lastConfirmedDate: date };
    }
    if (plan.lastMissedDate === date) return plan;
    return { ...plan, adherenceStreak: 0, recentMisses: plan.recentMisses + 1, lastMissedDate: date };
  });
}

export function medicationReminder(plan: MedicationPlan, now = new Date()): ReminderCard | null {
  const [hour, minute] = plan.time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const due = new Date(now);
  due.setHours(hour, minute, 0, 0);
  let minutes = Math.round((now.getTime() - due.getTime()) / 60000);
  if (minutes < -30) {
    const previousDue = new Date(due);
    previousDue.setDate(previousDue.getDate() - 1);
    const sincePrevious = Math.round((now.getTime() - previousDue.getTime()) / 60000);
    if (sincePrevious <= 180) minutes = sincePrevious;
  }
  if (minutes < -30 || minutes > 180) return null;

  const reliable = plan.adherenceStreak >= 7 && plan.recentMisses === 0;
  const tone = reliable ? "quiet" : plan.recentMisses >= 2 ? "attention" : "gentle";
  return {
    id: `med-${plan.id}`,
    tone,
    title: reliable ? `Quick check: ${plan.name}` : `Is ${plan.name} taken care of?`,
    detail: `Your saved plan says ${plan.scheduleLabel}. This only tracks the schedule you entered; it never changes medical instructions.`,
  };
}

export function appointmentReminder(plan: AppointmentPlan, now = new Date()): ReminderCard | null {
  const appointment = new Date(plan.dateTime);
  if (!Number.isFinite(appointment.getTime())) return null;
  const hours = (appointment.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0 || hours > 30) return null;
  const appointmentDay = new Date(appointment.getFullYear(), appointment.getMonth(), appointment.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDifference = Math.round((appointmentDay - today) / 86_400_000);
  const when = dayDifference === 0 ? "today" : dayDifference === 1 ? "tomorrow" : "upcoming";
  return {
    id: `appt-${plan.id}`,
    tone: hours <= 4 ? "attention" : "gentle",
    title: `${plan.title} is ${when}`,
    detail: `${appointment.toLocaleString()}${plan.location ? ` · ${plan.location}` : ""}`,
  };
}
