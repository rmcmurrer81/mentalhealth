import type { CompanionProfile, MemoryKind, MemoryRecord } from "./types";
import { medicationScheduleIntent } from "./reminders";
import { normalizeThemePreference } from "./theme";
import { DEFAULT_COMPANION_NAME, companionNameFromStoredProfile } from "./companion-name";

const STORAGE_KEY = "humanity-companion-profile-v1";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mem-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function memory(kind: MemoryKind, label: string, value: string, sensitive = false): MemoryRecord {
  const atomicValue = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .trim()
    .replace(/[.!?,;:—–…⋯。、؟،؛।॥‽！？，；：“”‘’«»〈〉《》「」『』【】〔〕〖〗〘〙〚〛]+$/u, "")
    .replace(/^[“”‘’«»]+/u, "")
    .trimEnd();
  return {
    id: newId(),
    kind,
    label,
    value: atomicValue,
    createdAt: new Date().toISOString(),
    sensitive,
    source: "conversation",
  };
}

const RELATIONSHIP_SOURCE = "mom|mother|dad|father|parents?|aunt|uncle|sister|brother|friend|partner|wife|husband|cousin";
const NEW_MEMORY_CLAUSE_SUBJECT_SOURCE = `(?:I\\b|we\\b|my\\s+(?:(?:${RELATIONSHIP_SOURCE})|birthday)\\b)`;
const MEMORY_VALUE_END_SOURCE = `(?=(?:[.!?;]|[,:—–](?=\\s*$)|\\s*[—–:]\\s*(?=${NEW_MEMORY_CLAUSE_SUBJECT_SOURCE})|,\\s*(?:(?:(?:and(?:\\s+then)?|but|while|then|plus)(?:\\s+also)?|&)\\s+)?${NEW_MEMORY_CLAUSE_SUBJECT_SOURCE}|\\s+(?:(?:and(?:\\s+then)?|but|while|then|plus)(?:\\s+also)?|&)\\s+${NEW_MEMORY_CLAUSE_SUBJECT_SOURCE}|$))`;
const PERSON_VALUE_NON_NAMES = new Set([
  "always", "often", "usually", "sometimes", "never", "really", "just", "still",
  "is", "was", "lives", "live", "works", "work", "likes", "like", "loves", "love",
  "enjoys", "enjoy", "has", "had", "gives", "gave", "listens", "helps", "calls",
  "visits", "teaches", "studies", "makes", "plays", "watches", "supports", "prefers",
  "collects", "grows", "wants", "needs", "can", "will", "would", "does", "did",
  "called", "texted", "messaged", "visited", "worked", "came", "left", "went",
  "phoned", "emailed", "drove", "lost", "cried", "sneezed", "coughed", "fell", "broke", "moved",
  "vomited", "tripped", "misplaced",
  "got", "started", "fought", "argued", "yelled",
  "named",
  "this", "that", "there", "who", "what",
]);

const PERSON_NAME_HARD_REJECTIONS = new Set([
  "a", "an", "the", "and", "but", "because", "while", "then", "plus", "also",
  "i", "we", "he", "she", "they", "it", "my", "your", "his", "her", "their",
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
  "has", "had", "have", "having", "named", "called", "texted", "messaged", "visited",
  "phoned", "emailed", "drove", "lost", "cried", "sneeze", "sneezes", "sneezed", "sneezing",
  "cough", "coughs", "coughed", "coughing", "fall", "falls", "fell", "fallen", "break", "breaks",
  "broke", "broken", "move", "moves", "moved", "moving", "vomit", "vomits", "vomited", "vomiting",
  "trip", "trips", "tripped", "tripping", "misplace", "misplaces", "misplaced", "misplacing",
  "came", "left", "went", "got", "started",
  "fought", "argued", "yelled", "lives", "live", "works", "work", "worked", "likes", "like",
  "loves", "love", "enjoys", "enjoy", "gives", "gave", "listens", "helps", "calls", "texts",
  "messages", "visits", "teaches", "studies", "makes", "plays", "watches", "supports", "prefers",
  "collects", "grows", "wants", "needs", "from", "to",
  "in", "on", "at", "with", "for", "of", "by", "about", "into", "out", "as", "who",
  "which", "that", "this", "there", "here", "always", "often", "usually", "sometimes",
  "never", "really", "just", "still", "very", "so", "not", "unfortunately", "fortunately",
  "sadly", "recently", "yesterday", "today", "currently", "suddenly", "apparently", "actually",
  "briefly", "finally", "meet", "introduce", "introducing", "please", "happen", "happens", "happened",
]);

const COPULAR_NON_NAME_WORDS = new Set([
  "sick", "ill", "patient", "impatient", "upset", "angry", "furious", "sad", "happy",
  "tired", "exhausted", "sleepy", "busy", "late", "early", "fine", "okay", "ok", "well",
  "better", "worse", "hurt", "afraid", "scared", "anxious", "worried", "depressed",
  "stressed", "lonely", "quiet", "kind", "nice", "mean", "helpful", "supportive",
  "available", "safe", "unsafe", "home", "away", "ready", "alive", "dead", "dying",
  "pregnant", "working", "visiting", "calling", "texting", "crying", "yelling", "arguing",
  "fighting", "sneezing", "coughing", "falling", "moving", "vomiting", "tripping", "misplacing",
  "missing", "gone",
]);

const PERSON_NAME_TOKEN_SOURCE = "\\p{L}[\\p{L}\\p{M}'’-]{0,40}";
const PERSON_NAME_CORE_SOURCE = `${PERSON_NAME_TOKEN_SOURCE}(?:\\s+${PERSON_NAME_TOKEN_SOURCE}){0,3}?`;
const PERSON_NAME_SOURCE = `(?:(?:Dr|Mr|Mrs|Ms|Mx|Prof)\\.\\s+)?${PERSON_NAME_CORE_SOURCE}`;

function normalizeConversationText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/。/g, ".")
    .replace(/、/g, ",")
    .replace(/[\u0964\u0965]/g, ".")
    .replace(/[\u061F\u203D]/g, "?")
    .replace(/،/g, ",")
    .replace(/؛/g, ";")
    .replace(/⋯/g, "...")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanPersonNameCandidate(value: string): string | null {
  const candidate = value.trim().replace(/^[,(—–\s]+|[,)—–.!?;:\s]+$/gu, "").replace(/\s+/g, " ");
  const honorific = /^(?:(?:Dr|Mr|Mrs|Ms|Mx|Prof)\.\s+)?(.+)$/iu.exec(candidate);
  const tokens = (honorific?.[1] ?? "").split(" ");
  if (!candidate || tokens.length > 4 || tokens.some((token) => !new RegExp(`^${PERSON_NAME_TOKEN_SOURCE}$`, "u").test(token))) return null;
  if (tokens.some((token) => PERSON_NAME_HARD_REJECTIONS.has(token.toLowerCase()))) return null;
  if (COPULAR_NON_NAME_WORDS.has(tokens[0].toLowerCase())) return null;
  return candidate;
}

const PERSON_DETAIL_VERB_SOURCE = [
  "is", "was", "lives?", "works?", "worked", "likes?", "loves?", "enjoys?", "has", "had",
  "gives?", "gave", "listens?", "helps?", "calls?", "called", "texts?", "texted",
  "messages?", "messaged", "visits?", "visited", "teaches?", "studies?", "makes?", "plays?",
  "watches?", "supports?", "prefers?", "collects?", "grows?", "wants?", "needs?", "can",
  "will", "would", "does", "did", "got", "started", "fought", "argued", "yelled", "came",
  "left", "went", "phones?", "phoned", "emails?", "emailed", "drives?", "drove", "loses?",
  "lost", "cries?", "cried",
  "sneezes?", "sneezed", "coughs?", "coughed", "falls?", "fell", "breaks?", "broke",
  "moves?", "moved", "vomits?", "vomited", "trips?", "tripped", "misplaces?", "misplaced",
].join("|");

function isTransientPersonDetail(value: string): boolean {
  return /^(?:(?:and|but|because|while|then|plus)(?:\s+also)?\s+(?:I|we|he|she|they)\b|(?:had|has|was having)\s+(?:a\s+)?(?:hard|rough|bad|long|difficult)\s+day\b|(?:had|has|got into|started)\s+(?:(?:a|an|the)\s+)?(?:fight|argument)\b|(?:called|texted|messaged|visited|phoned|emailed|drove|lost|cried|sneez(?:e[sd]?|ing)|cough(?:s|ed|ing)?|falls?|falling|fell|breaks?|breaking|broke|moves?|moving|moved|vomit(?:s|ed|ing)?|trips?|tripped|tripping|misplac(?:e[sd]?|ing)|came|left|went|fought|argued|yelled|passed out)\b|(?:is|was|has been|was feeling)\s+(?:very\s+|really\s+)?(?:sick|ill|patient|impatient|upset|angry|furious|sad|tired|exhausted|hurt|afraid|scared|anxious|worried|stressed|busy|late|away|sneezing|coughing|falling|moving|vomiting|tripping|misplacing|missing|gone)\b)/i.test(value.trim());
}

function durablePersonValue(value: string, explicitName?: string): string | null {
  const cleaned = value.trim().replace(/[.!?,;:—–…。、]+$/u, "").trim();
  if (!cleaned || /^[,):—–]/u.test(cleaned) || /^(?:and|but|because|while|then|plus)(?:\s+also)?\s*$/i.test(cleaned)) return null;

  if (explicitName) {
    const escapedName = explicitName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const namedDetail = new RegExp(`^${escapedName}(?:\\s+(.+))?$`, "iu").exec(cleaned);
    if (!namedDetail) return null;
    const detail = namedDetail[1]?.trim() ?? "";
    if (!detail || /^[,:—–]/u.test(detail) || isTransientPersonDetail(detail)) return null;
    return `${explicitName} ${detail}`;
  }

  if (isTransientPersonDetail(cleaned)) return null;
  return cleaned;
}

const PERSONAL_FACT_VERB_SOURCE = "(?:won|graduated|completed|finished|got accepted|was accepted|got the job|earned|passed|like|love|enjoy|prefer|dislike|hate|do not like|don't like)";

interface PersonalFactClause {
  text: string;
  factual: boolean;
}

function personalFactClauses(text: string): PersonalFactClause[] {
  const factStart = `(?:I\\s+)?(?:really\\s+)?${PERSONAL_FACT_VERB_SOURCE}\\b`;
  const factConnector = `(?:(?:and\\s+(?:then|afterwards?)|and|but|plus|then|afterwards?)(?:\\s+also)?|&)`;
  const factBoundary = new RegExp(
    `(?:\\s*(?:,|;|:|—|–|\\s-\\s)\\s*(?:${factConnector}\\s+)?|\\s+${factConnector}\\s+|\\s*&\\s*)(?=${factStart})`,
    "i",
  );
  const clauses: PersonalFactClause[] = [];

  for (const rawSentence of text.match(/[^.!?]+[.!?]*/g) ?? []) {
    const sentence = rawSentence.replace(/[.!?]+$/g, "");
    if (!sentence.trim()) continue;
    const sentenceIsHypothetical = /^\s*(?:if|unless|suppose|supposing|imagine|imagining|pretend|assuming|hypothetically|what if)\b/i.test(sentence);
    const sentenceIsQuestion = /\?/.test(rawSentence)
      || /^\s*(?:am|are|is|was|were|do|does|did|have|has|had|can|could|may|might|should|would|will)\b/i.test(sentence);
    const sentenceIsUncertain = /\b(?:doubt(?:ed|s|ing)?|suspect(?:ed|s|ing)?|unsure|uncertain|mistakenly|falsely|allegedly)\b|\brumou?r\s+has\s+it(?:\s+that)?\b|\b(?:I(?:'m| am| was)|could be|might be|may be)\s+(?:mistaken|wrong)\b|\b(?:not sure|do not know|don't know|cannot tell|can't tell)\b|\b(?:wonder(?:ed|s|ing)?|question(?:ed|s|ing)?)\s+(?:if|whether)\b|\bwhether\b|\b(?:false|incorrect|mistaken)\s+(?:claim|statement|memory)\b|\b(?:claim|statement|memory)\b.{0,120}\b(?:is|was|seems?)\s+(?:false|incorrect|mistaken|wrong)\b/i.test(sentence);
    let firstPersonFactSeen = false;
    for (const [fragmentIndex, fragment] of sentence.split(factBoundary).entries()) {
      const normalized = fragment.trim().replace(new RegExp(`^${factConnector}\\s+`, "i"), "");
      if (!normalized) continue;
      const directFact = new RegExp(`\\bI\\s+(?:really\\s+)?${PERSONAL_FACT_VERB_SOURCE}\\b`, "i").exec(normalized);
      const elidedFact: RegExpExecArray | null = fragmentIndex > 0 && firstPersonFactSeen
        ? new RegExp(`^(?:really\\s+)?${PERSONAL_FACT_VERB_SOURCE}\\b`, "i").exec(normalized)
        : null;
      const fact = directFact ?? elidedFact;
      const prefix = fact ? normalized.slice(0, fact.index) : normalized;
      const governedByNegationOrHypothesis = /\b(?:if|unless|suppose|supposing|imagine|imagining|pretend|assuming|hypothetically|maybe|perhaps|might|could|would|wish(?:ed)?|dream(?:ed|t)?|doubt(?:ed|s|ing)?|suspect(?:ed|s|ing)?|rumou?r|unsure|uncertain|mistaken|mistakenly|wrong|whether|wonder(?:ed|s|ing)?|question(?:ed|s|ing)?|false|falsely|incorrect|allegedly|deny|denied|not|never)\b|(?:isn't|wasn't|don't|doesn't|didn't|haven't|hasn't|hadn't|can't|cannot)\b/i.test(prefix);
      firstPersonFactSeen ||= Boolean(directFact || elidedFact);
      clauses.push({
        text: directFact && /^I\b/i.test(normalized) ? normalized : `I ${normalized}`,
        factual: Boolean(fact) && !sentenceIsHypothetical && !sentenceIsQuestion && !sentenceIsUncertain && !governedByNegationOrHypothesis,
      });
    }
  }
  return clauses;
}

interface NamedRelationshipFact {
  relationship: string;
  name: string;
  sensitive: boolean;
  introduced: boolean;
}

function namedRelationshipFacts(text: string): NamedRelationshipFact[] {
  const relationLink = `(?:(?:is|was)|happen(?:s|ed)?\\s+to\\s+be|turn(?:s|ed)?\\s+out\\s+to\\s+be)`;
  const patterns: Array<{ pattern: RegExp; relationshipIndex: number; nameIndex: number; introduced?: boolean }> = [
    { pattern: new RegExp(`\\b(?:this\\s+is|meet|introduce(?:\\s+you\\s+to)?|introducing)\\s+my\\s+(${RELATIONSHIP_SOURCE})\\s*[,;(:—–]?\\s*(${PERSON_NAME_SOURCE})(?=\\s+(?:${PERSON_DETAIL_VERB_SOURCE}|and|but|because|while|then)\\b|\\s*[,)—–.!?;:]|$)`, "giu"), relationshipIndex: 1, nameIndex: 2, introduced: true },
    { pattern: new RegExp(`\\b(?:this\\s+is|meet|introduce(?:\\s+you\\s+to)?|introducing)\\s+(${PERSON_NAME_SOURCE})\\s*[,;:(\u2014\u2013]\\s*(?:who\\s+(?:also\\s+)?${relationLink}\\s+)?my\\s+(${RELATIONSHIP_SOURCE})\\b`, "giu"), relationshipIndex: 2, nameIndex: 1, introduced: true },
    { pattern: new RegExp(`\\b(?:this\\s+is|meet|introduce(?:\\s+you\\s+to)?|introducing)\\s+(${PERSON_NAME_SOURCE})\\s*[,;:—–]\\s*(?:and\\s+)?(?:he|she|they)\\s+(?:also\\s+)?${relationLink}\\s+my\\s+(${RELATIONSHIP_SOURCE})\\b`, "giu"), relationshipIndex: 2, nameIndex: 1, introduced: true },
    { pattern: new RegExp(`(?:^|[.!?;]\\s*)(${PERSON_NAME_SOURCE})\\s*[,(\u2014\u2013]\\s*who\\s+(?:also\\s+)?${relationLink}\\s+my\\s+(${RELATIONSHIP_SOURCE})\\b`, "giu"), relationshipIndex: 2, nameIndex: 1 },
    { pattern: new RegExp(`(?:^|[.!?;]\\s*)(${PERSON_NAME_SOURCE})\\s*[,(\u2014\u2013]\\s*my\\s+(${RELATIONSHIP_SOURCE})\\b`, "giu"), relationshipIndex: 2, nameIndex: 1 },
    { pattern: new RegExp(`\\bmy\\s+(${RELATIONSHIP_SOURCE})\\s*[,(\u2014\u2013]\\s*(${PERSON_NAME_SOURCE})(?=\\s*[,)—–.!?;:]|$)`, "giu"), relationshipIndex: 1, nameIndex: 2 },
    { pattern: new RegExp(`\\bmy\\s+(${RELATIONSHIP_SOURCE})(?:'s|’s)\\s+name\\s+(?:is|was)\\s+(${PERSON_NAME_SOURCE})(?=\\s+(?:and|but|because|while|then)\\b|\\s*[,)—–.!?;:]|$)`, "giu"), relationshipIndex: 1, nameIndex: 2 },
    { pattern: new RegExp(`\\bmy\\s+(${RELATIONSHIP_SOURCE})\\s+named\\s+(${PERSON_NAME_SOURCE})(?=\\s+(?:${PERSON_DETAIL_VERB_SOURCE}|and|but|because|while|then)\\b|\\s*[,)—–.!?;:]|$)`, "giu"), relationshipIndex: 1, nameIndex: 2 },
    { pattern: new RegExp(`\\bmy\\s+(${RELATIONSHIP_SOURCE})\\s+(?:is|was)\\s+(${PERSON_NAME_SOURCE})(?=\\s+(?:and|but|because|while|then)\\b|\\s*[,)—–.!?;:]|$)`, "giu"), relationshipIndex: 1, nameIndex: 2 },
    { pattern: new RegExp(`(?:^|[.!?;]\\s*)(${PERSON_NAME_SOURCE})\\s+(?:is|was)\\s+my\\s+(${RELATIONSHIP_SOURCE})\\b`, "giu"), relationshipIndex: 2, nameIndex: 1 },
    { pattern: new RegExp(`\\bmy\\s+(${RELATIONSHIP_SOURCE})\\s+(${PERSON_NAME_SOURCE})(?=\\s+(?:${PERSON_DETAIL_VERB_SOURCE}|and|but|because|while|then)\\b|\\s*[.!?,;:—–]|$)`, "giu"), relationshipIndex: 1, nameIndex: 2 },
  ];
  const found: NamedRelationshipFact[] = [];
  for (const { pattern, relationshipIndex, nameIndex, introduced = false } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const relationship = match[relationshipIndex].toLowerCase();
      const name = cleanPersonNameCandidate(match[nameIndex]);
      if (!name) continue;
      const key = `${relationship}:${name.toLowerCase()}`;
      const existing = found.find((entry) => `${entry.relationship}:${entry.name.toLowerCase()}` === key);
      if (!existing) {
        found.push({ relationship, name, sensitive: true, introduced });
      } else if (introduced) {
        existing.introduced = true;
      }
    }
  }
  return found;
}

export function personNameFromMemoryValue(value: string): string | undefined {
  const cleaned = value.trim();
  const identity = new RegExp(`^(${PERSON_NAME_SOURCE})\\s+was\\s+(?:identified|introduced)\\s+in\\s+conversation$`, "iu").exec(cleaned);
  const detailed = new RegExp(`^(${PERSON_NAME_SOURCE})\\s+(?=(?:is|was|lives?|works?|worked|likes?|loves?|enjoys?|has|had|gives?|gave|listens?|helps?|calls?|visits?|teaches?|studies?|makes?|plays?|watches?|supports?|prefers?|collects?|grows?|wants?|needs?|can|will|would|does|did|always|often|usually|sometimes|never)\\b)`, "iu").exec(cleaned);
  return cleanPersonNameCandidate((identity ?? detailed)?.[1] ?? "") ?? undefined;
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
  const validAge = (value: string | undefined): number | null => {
    const age = Number(value ?? Number.NaN);
    return Number.isInteger(age) && age >= 1 && age <= 125 ? age : null;
  };
  const uniqueValidAges = (matches: RegExpMatchArray[]): number[] => [...new Set(matches
    .map((match) => validAge(match[1]))
    .filter((age): age is number => age !== null))];

  // An explicit correction is authoritative and mergeMemories replaces the
  // older birthday-age record. An unresolved alternative is held rather than
  // guessed.
  const correctionMatches = [...cleaned.matchAll(/\b(?:i\s+)?(?:mean|meant)(?:\s+to say)?\s+(\d{1,3})\b/gi)];
  if (correctionMatches.length > 0) {
    const corrected = correctionMatches.at(-1);
    if (corrected && new RegExp(`\\b${corrected[1]}\\b\\s+(?:or|maybe)\\s+\\d{1,3}\\b`, "i").test(cleaned.slice(corrected.index))) return null;
    return validAge(corrected?.[1]);
  }

  const futurePatterns = [
    /\bi(?:['’]m| am)\s+going to be\s+(\d{1,3})(?:\s+years? old)?\b/gi,
    /\bi(?:['’]ll| will)\s+be\s+(\d{1,3})(?:\s+years? old)?\b/gi,
    /\bi(?:['’]m| am)\s+turning\s+(\d{1,3})\b/gi,
  ];
  const futureMatches = futurePatterns.flatMap((pattern) => [...cleaned.matchAll(pattern)]);
  if (futureMatches.length > 0) {
    const futureAges = uniqueValidAges(futureMatches);
    const uncertainFuture = /\b(?:maybe|perhaps|probably|possibly|i\s+(?:think|guess|suppose))\b.{0,32}\bi(?:['’]m| am|['’]ll| will)\b/i.test(cleaned);
    const unresolvedAlternative = futureMatches.some((match) => new RegExp(`\\b${match[1]}\\b\\s+(?:or|maybe)\\s+\\d{1,3}\\b`, "i").test(cleaned.slice(match.index)));
    if (uncertainFuture || unresolvedAlternative || futureAges.length !== 1) return null;
    // A clear future birthday age outranks a separately stated current/prior
    // age, such as "I'm 21 now and I'm going to be 22."
    return futureAges[0];
  }

  const currentAges = uniqueValidAges([...cleaned.matchAll(/\bi(?:['’]m| am)\s+(\d{1,3})\s+years? old\b/gi)]);
  const explicit = currentAges.length === 1 ? currentAges[0] : null;
  const contextual = ageQuestionActive
    ? cleaned.match(/^(?:(?:i(?:['’]m| am| will be)|turning)\s+)?(\d{1,3})(?:\s+years? old)?(?:\s+is right)?[.!]?$/i)
    : null;
  return explicit ?? validAge(contextual?.[1]);
}

export function extractMemories(text: string, now = new Date(), currentBirthdayValue?: string): MemoryRecord[] {
  const learned: MemoryRecord[] = [];
  const cleaned = normalizeConversationText(text);

  const nameMatch = cleaned.match(new RegExp(
    `\\b(?:my name is|call me)\\s+(${PERSON_NAME_SOURCE})${MEMORY_VALUE_END_SOURCE}`,
    "iu",
  ));
  const preferredName = nameMatch ? cleanPersonNameCandidate(nameMatch[1]) : null;
  if (preferredName) learned.push(memory("identity", "Preferred name", preferredName));

  const personalClauses = personalFactClauses(cleaned);
  for (const clause of personalClauses) {
    if (!clause.factual) continue;
    const preferenceMatch = clause.text.match(new RegExp(
      `\\bI (?:really )?(like|love|enjoy|prefer)\\s+(.+?)${MEMORY_VALUE_END_SOURCE}`,
      "i",
    ));
    if (preferenceMatch) learned.push(memory("preference", preferenceMatch[1].toLowerCase(), preferenceMatch[2]));
    const dislikeMatch = clause.text.match(new RegExp(
      `\\bI (?:really )?(?:dislike|hate|do not like|don't like)\\s+(.+?)${MEMORY_VALUE_END_SOURCE}`,
      "i",
    ));
    if (dislikeMatch) learned.push(memory("preference", "avoid", dislikeMatch[1]));
  }

  const namedPeople = namedRelationshipFacts(cleaned);
  const personFacts: Array<{ relationship: string; value: string; sensitive: boolean }> = [];
  const factName = (value: string): string | undefined => personNameFromMemoryValue(value);
  const isIdentityOnly = (value: string): boolean => /\s+was\s+(?:identified|introduced)\s+in\s+conversation$/i.test(value);
  const isIntroducedIdentity = (value: string): boolean => /\s+was\s+introduced\s+in\s+conversation$/i.test(value);
  const addPersonFact = (relationship: string, value: string, sensitive = false) => {
    const name = factName(value);
    const samePersonIndex = name
      ? personFacts.findIndex((entry) => entry.relationship === relationship && factName(entry.value)?.toLowerCase() === name.toLowerCase())
      : -1;
    if (samePersonIndex >= 0) {
      const existing = personFacts[samePersonIndex];
      if (existing.value.toLowerCase() === value.toLowerCase()) return;
      if (isIdentityOnly(existing.value) && isIdentityOnly(value)) {
        if (!isIntroducedIdentity(existing.value) && isIntroducedIdentity(value)) {
          personFacts[samePersonIndex] = { relationship, value, sensitive: existing.sensitive || sensitive };
        }
        return;
      }
      if (isIdentityOnly(existing.value) && !isIdentityOnly(value)) {
        personFacts[samePersonIndex] = { relationship, value, sensitive: existing.sensitive || sensitive };
      }
      return;
    }
    personFacts.push({ relationship, value, sensitive });
  };
  for (const person of namedPeople) {
    addPersonFact(
      person.relationship,
      `${person.name} was ${person.introduced ? "introduced" : "identified"} in conversation`,
      person.sensitive,
    );
  }

  const personPattern = new RegExp(
    `\\bmy (${RELATIONSHIP_SOURCE})\\s+(.+?)${MEMORY_VALUE_END_SOURCE}`,
    "gi",
  );
  for (const personMatch of cleaned.matchAll(personPattern)) {
    const relationship = personMatch[1].toLowerCase();
    const rawValue = personMatch[2].trim();
    const namedForRelationship = namedPeople.find((entry) => entry.relationship === relationship
      && (new RegExp(`(?:^|[^\\p{L}\\p{M}])${entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{M}])`, "iu").test(rawValue)
        || (() => {
          const truncatedAtHonorific = rawValue.replace(/^(?:is|was|named)\s+/i, "").toLocaleLowerCase("en-US");
          return /^(?:dr|mr|mrs|ms|mx|prof)$/i.test(truncatedAtHonorific)
            && entry.name.toLocaleLowerCase("en-US").startsWith(`${truncatedAtHonorific}.`);
        })()));
    const value = durablePersonValue(rawValue, namedForRelationship?.name);
    if (!value) continue;
    addPersonFact(relationship, value, Boolean(namedForRelationship));
  }
  for (const person of personFacts) learned.push(memory("person", person.relationship, person.value, person.sensitive));

  for (const clause of personalClauses) {
    if (!clause.factual) continue;
    const achievementMatch = clause.text.match(new RegExp(
      `\\bI (won|graduated|completed|finished|got accepted|was accepted|got the job|earned|passed)\\s+(.+?)${MEMORY_VALUE_END_SOURCE}`,
      "i",
    ));
    if (achievementMatch && !/^(?:no|not|zero|none|nothing)\b/i.test(achievementMatch[2])
      && !(achievementMatch[1].toLowerCase() === "passed" && /^out\b/i.test(achievementMatch[2]))) {
      learned.push(memory("milestone", "Achievement", `${achievementMatch[1]} ${achievementMatch[2]}`));
    }
  }

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

  const medicationPlan = medicationScheduleIntent(cleaned);
  if (medicationPlan.status === "scheduled") {
    learned.push(memory("medication", "Prescribed medication", `${medicationPlan.name} — ${medicationPlan.scheduleLabel}`, true));
  }

  const appointmentMatch = cleaned.match(/\b(?:I have|my) (?:a |an )?(doctor(?:'s)? |therapy |medical )?appointment\s+((?:(?:Dr|Mr|Mrs|Ms|Mx|Prof)\.(?=\s+[A-Za-z])|[^.!?])+)(?:[.!?]|$)/i);
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
  const personIdentity = (entry: MemoryRecord): { key: string; introduced: boolean } | null => {
    if (entry.kind !== "person" || !/\s+was\s+(?:identified|introduced)\s+in\s+conversation$/i.test(entry.value)) return null;
    const name = personNameFromMemoryValue(entry.value);
    return name
      ? { key: `${entry.label.toLowerCase()}:${name.toLowerCase()}`, introduced: /\s+was\s+introduced\s+in\s+conversation$/i.test(entry.value) }
      : null;
  };
  const introducedKeys = new Set(learned.flatMap((entry) => {
    const identity = personIdentity(entry);
    return identity?.introduced ? [identity.key] : [];
  }));
  const normalizedLearned = learned.filter((entry) => {
    const identity = personIdentity(entry);
    return !identity || identity.introduced || !introducedKeys.has(identity.key);
  });
  const replacingBirthday = learned.some((entry) => entry.kind === "milestone" && entry.label === "Birthday");
  const replacingBirthdayAge = learned.some((entry) => entry.kind === "milestone" && entry.label === "Birthday age");
  const retained = existing.filter((entry) => {
    if (replacingBirthday && entry.kind === "milestone" && entry.label === "Birthday") return false;
    if (replacingBirthdayAge && entry.kind === "milestone" && entry.label === "Birthday age") return false;
    const identity = personIdentity(entry);
    if (identity && !identity.introduced && introducedKeys.has(identity.key)) return false;
    return true;
  });
  const keys = new Set(retained.map((entry) => `${entry.kind}:${entry.label.toLowerCase()}:${entry.value.toLowerCase()}`));
  const identityKeys = new Set(retained.flatMap((entry) => {
    const identity = personIdentity(entry);
    return identity ? [identity.key] : [];
  }));
  const additions = normalizedLearned.filter((entry) => {
    const key = `${entry.kind}:${entry.label.toLowerCase()}:${entry.value.toLowerCase()}`;
    const identity = personIdentity(entry);
    if (keys.has(key) || (identity && identityKeys.has(identity.key))) return false;
    keys.add(key);
    if (identity) identityKeys.add(identity.key);
    return true;
  });
  return [...retained, ...additions];
}

function normalizedIdentityValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedPrivacyText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTextContainsPhrase(turnText: string, phrase: string): boolean {
  const normalizedTurn = normalizedPrivacyText(turnText);
  const normalizedDetail = normalizedPrivacyText(phrase);
  if (!normalizedTurn || !normalizedDetail) return false;
  return ` ${normalizedTurn} `.includes(` ${normalizedDetail} `);
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function turnContainsRelationshipEcho(turnText: string, forgotten: MemoryRecord, personName: string): boolean {
  const normalizedTurn = normalizedPrivacyText(turnText);
  const normalizedRelationship = normalizedPrivacyText(forgotten.label);
  const normalizedName = normalizedPrivacyText(personName);
  if (!normalizedTurn || !normalizedRelationship || !normalizedName) return false;
  const relationship = escapedRegex(normalizedRelationship);
  const name = escapedRegex(normalizedName);
  return [
    new RegExp(`\\b(?:my|your)\\s+${relationship}\\s+${name}\\b`, "u"),
    new RegExp(`\\b${name}\\s+(?:is|was)\\s+(?:my|your)\\s+${relationship}\\b`, "u"),
    new RegExp(`\\b${name}\\s+(?:sounds|seems)(?:\\s+like)?\\s+(?:someone|a person)\\s+(?:important|close)\\s+(?:to|for)\\s+you\\b`, "u"),
  ].some((pattern) => pattern.test(normalizedTurn));
}

function turnContainsForgottenMemory(turnText: string, forgotten: MemoryRecord): boolean {
  if (normalizedTextContainsPhrase(turnText, forgotten.value)) return true;
  if (forgotten.kind !== "person") return false;
  const personName = personNameFromMemoryValue(forgotten.value);
  return Boolean(personName && turnContainsRelationshipEcho(turnText, forgotten, personName));
}

export function forgetMemory(profile: CompanionProfile, memoryId: string): CompanionProfile {
  const forgotten = profile.memories.find((entry) => entry.id === memoryId);
  if (!forgotten) return profile;

  const forgetsCurrentPreferredName = forgotten.kind === "identity"
    && normalizedIdentityValue(forgotten.label) === "preferred name"
    && normalizedIdentityValue(forgotten.value) === normalizedIdentityValue(profile.preferredName);

  return {
    ...profile,
    preferredName: forgetsCurrentPreferredName ? "" : profile.preferredName,
    memories: profile.memories.filter((entry) => entry.id !== memoryId),
    turns: profile.turns.filter((turn) => {
      if (turn.learnedMemoryIds?.includes(memoryId) || turn.groundedMemoryIds?.includes(memoryId)) return false;
      return !turnContainsForgottenMemory(turn.text, forgotten);
    }),
  };
}

export function defaultProfile(): CompanionProfile {
  return {
    onboardingCompleted: false,
    preferredName: "",
    companionName: DEFAULT_COMPANION_NAME,
    memories: [],
    medications: [],
    appointments: [],
    turns: [],
    voice: "soft-feminine",
    theme: "medium",
    speechEnabled: true,
    speechPreferenceSet: false,
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
    if (!raw) return defaultProfile();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultProfile();
    const stored = parsed as Partial<CompanionProfile>;
    return {
      ...defaultProfile(),
      ...stored,
      onboardingCompleted: stored.onboardingCompleted === true,
      companionName: companionNameFromStoredProfile(stored.companionName),
      theme: normalizeThemePreference(stored.theme),
      // Older packages stored a false value without recording whether the user
      // chose mute or merely inherited an old default. Migrate that ambiguous
      // state to the new default-on behavior once. A later explicit click is
      // marked and therefore remains off across restarts.
      speechEnabled: stored.speechPreferenceSet === true ? stored.speechEnabled !== false : true,
      speechPreferenceSet: stored.speechPreferenceSet === true,
    };
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
