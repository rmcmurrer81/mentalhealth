export type IngestionSubject = "first-party" | "third-party";
export type IngestionFrame = "completed" | "future-intent" | "uncertain" | "hypothetical" | "negated";

export interface IngestionRiskEvent {
  subject: IngestionSubject;
  /** Stable actor key used to keep attribution and later negation scoped. */
  actor: string;
  frame: IngestionFrame;
  action: string;
  evidence: "direct" | "reported" | "witnessed";
  actionSense: "ingestion" | "transport" | "media" | "task" | "ordinary-object";
  objectKind: "medication" | "container" | "toxic" | "measure" | "ordinary" | "unspecified";
  quantityRisk: boolean;
}

export interface IngestionRiskAnalysis {
  events: IngestionRiskEvent[];
  completedFirstParty: boolean;
  completedThirdParty: boolean;
  futureFirstParty: boolean;
  futureThirdParty: boolean;
  uncertainFirstParty: boolean;
  uncertainThirdParty: boolean;
  anyUrgent: boolean;
}

interface Token {
  value: string;
  raw: string;
  start: number;
  end: number;
}

interface SubjectMention {
  subject: IngestionSubject;
  actor: string;
  index: number;
  next: number;
  evidence: IngestionRiskEvent["evidence"];
}

interface ParsedPredicate extends SubjectMention {
  action: string;
  actionIndex: number;
  frame: IngestionFrame;
}

const relationNouns = new Set([
  "friend", "mom", "mother", "dad", "father", "parent", "partner", "wife", "husband",
  "sister", "brother", "aunt", "uncle", "cousin", "neighbor", "classmate", "coworker",
  "student", "child", "teen", "person",
]);

const thirdPartyPronouns = new Set(["he", "she", "they", "someone"]);
const witnessVerbs = new Set([
  "watch", "watched", "see", "saw", "seen", "hear", "heard", "witness", "witnessed",
  "observe", "observed", "catch", "caught", "find", "found",
  "notice", "noticed",
]);
const reportVerbs = new Set([
  "say", "says", "said", "tell", "tells", "told", "report", "reports", "reported",
  "text", "texts", "texted", "message", "messages", "messaged", "write", "writes", "wrote",
  "email", "emails", "emailed", "confess", "confesses", "confessed", "admit", "admits", "admitted",
  "whisper", "whispers", "whispered", "phone", "phones", "phoned", "call", "calls", "called",
  "post", "posts", "posted", "read", "reads",
  "murmur", "murmurs", "murmured", "announce", "announces", "announced",
]);
const actionBase = new Set(["take", "swallow", "consume", "ingest", "drink", "inject", "overdose", "down", "finish", "chew", "eat", "pop", "chug", "snort", "triple", "quadruple", "quintuple", "gulp", "guzzle", "scarf", "knock", "toss", "polish", "empty", "dissolve", "inhale", "use"]);
const actionPast = new Set(["took", "swallowed", "consumed", "ingested", "drank", "injected", "overdosed", "doubled", "downed", "finished", "chewed", "ate", "popped", "chugged", "snorted", "tripled", "quadrupled", "quintupled", "gulped", "guzzled", "scarfed", "knocked", "tossed", "polished", "emptied", "dissolved", "inhaled", "used"]);
const actionParticiples = new Set(["taken", "swallowed", "consumed", "ingested", "drunk", "injected", "overdosed", "downed", "finished", "chewed", "eaten", "popped", "chugged", "snorted", "tripled", "quadrupled", "quintupled", "gulped", "guzzled", "scarfed", "knocked", "tossed", "polished", "emptied", "dissolved", "inhaled", "used"]);
const actionGerunds = new Set(["taking", "swallowing", "consuming", "ingesting", "drinking", "injecting", "overdosing", "downing", "finishing", "chewing", "eating", "popping", "chugging", "snorting", "tripling", "quadrupling", "quintupling", "gulping", "guzzling", "scarfing", "knocking", "tossing", "polishing", "emptying", "dissolving", "inhaling", "using"]);
const medicationUnits = new Set(["pill", "pills", "tablet", "tablets", "capsule", "capsules", "dose", "doses", "caplet", "caplets", "gelcap", "gelcaps", "softgel", "softgels", "lozenge", "lozenges", "painkiller", "painkillers", "antihistamine", "antihistamines", "antidepressant", "antidepressants", "sedative", "sedatives", "beta-blocker", "beta-blockers", "tab", "tabs"]);
const medicationNouns = new Set([
  ...medicationUnits,
  "medicine", "medication", "medications", "meds", "insulin",
  "ibuprofen", "acetaminophen", "tylenol", "aspirin", "advil", "motrin",
  "naproxen", "benadryl", "sertraline", "fluoxetine", "prescription",
  "painkiller", "painkillers", "paracetamol", "oxycodone", "antihistamine", "antihistamines", "sedative", "sedatives", "beta-blocker", "beta-blockers",
  "antidepressant", "antidepressants", "softgel", "softgels", "lozenge", "lozenges", "cough", "syrup",
]);
const containerNouns = new Set(["bottle", "bottles", "container", "containers", "packet", "packets", "vial", "vials", "jar", "jars", "pack", "packs", "sachet", "sachets", "tube", "tubes", "carton", "cartons", "box", "boxes", "pen", "pens"]);
const containerQuantifiers = new Set(["whole", "full", "entire", "most"]);
const measureNouns = new Set(["spoonful", "spoonfuls", "teaspoon", "teaspoons", "tablespoon", "tablespoons", "syringe", "syringes"]);
const toxicNouns = new Set(["bleach", "poison", "antifreeze", "cleaner", "chemical", "chemicals"]);
const ordinaryBottleContents = new Set(["water", "juice", "milk", "soda", "tea", "coffee", "beer", "wine", "ketchup", "salsa", "sauce", "dressing", "shampoo", "card", "cards", "cracker", "crackers", "cookie", "cookies", "candy", "cereal", "cream", "strawberry", "strawberries", "almond", "almonds", "butter", "tissue", "tissues", "egg", "eggs"]);
const transportDestinations = new Set(["pharmacy", "pharmacist", "mailbox", "store", "shop", "counter", "desk", "kiosk", "kitchen", "office", "clinic", "doctor", "nurse", "hospital", "trash", "garbage", "recycling", "police", "fire", "station", "school", "home", "car", "event", "shelf", "drawer", "bag"]);
const mediaObjects = new Set(["photo", "photos", "photograph", "photographs", "picture", "pictures", "video", "videos"]);
const mediaTakingObjects = new Set([...mediaObjects, "screenshot", "screenshots", "snapshot", "snapshots", "close-up", "close-ups", "image", "images", "scan", "scans", "inventory", "inventories", "note", "notes", "stock", "count", "counts", "capture", "captures"]);
const harmlessCountUnits = new Set(["photo", "photos", "picture", "pictures", "screenshot", "screenshots", "snapshot", "snapshots", "image", "images", "scan", "scans", "vitamin", "vitamins"]);
const ignorablePredicateWords = new Set(["just", "already", "accidentally", "mistakenly", "unintentionally", "actually", "really"]);

const countWords = new Map<string, number>([
  ["zero", 0], ["one", 1], ["once", 1], ["first", 1], ["two", 2], ["twice", 2], ["second", 2], ["three", 3], ["third", 3],
  ["four", 4], ["fourth", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15],
  ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["thirty", 30],
  ["dozen", 12], ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90], ["hundred", 100],
]);

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/\bI'm\b/gi, "I am")
    .replace(/\bI've\b/gi, "I have")
    .replace(/\bI'd\b/gi, "I had")
    .replace(/\b(?:he|she)'s\b/gi, (value) => `${value.slice(0, -2)} has`)
    .replace(/\b(?:he|she|they)'ve\b/gi, (value) => `${value.slice(0, -3)} have`)
    .replace(/\bdidn't\b/gi, "did not")
    .replace(/\b(?:haven't|hasn't|hadn't)\b/gi, (value) => `${value.slice(0, value.indexOf("n"))} not`)
    .replace(/\b(?:isn't|aren't|wasn't|weren't)\b/gi, (value) => `${value.slice(0, value.indexOf("n"))} not`)
    .replace(/\b(?:don't|doesn't)\b/gi, (value) => `${value.startsWith("does") ? "does" : "do"} not`)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}]+(?:-[\p{L}]+)*|\d{1,4}/gu)) {
    if (match.index === undefined) continue;
    tokens.push({ value: match[0].toLowerCase(), raw: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function countAt(tokens: Token[], index: number): number | null {
  const value = tokens[index]?.value;
  if (!value) return null;
  if (/^\d{1,4}$/.test(value)) return Number(value);
  if (value === "one-and-a-half") return 1.5;
  if (value.includes("-")) {
    const parts = value.split("-");
    if (parts.length === 2) {
      const left = countWords.get(parts[0]);
      const right = countWords.get(parts[1]);
      if (left !== undefined && right !== undefined && left >= 20 && right > 0 && right < 10) return left + right;
    }
  }
  return countWords.get(value) ?? null;
}

function subjectAt(tokens: Token[], index: number): SubjectMention | null {
  const token = tokens[index];
  if (!token) return null;
  if (token.value === "i") return { subject: "first-party", actor: "user", index, next: index + 1, evidence: "direct" };
  if (token.value === "you") {
    const prefix = tokens.slice(Math.max(0, index - 8), index).map((candidate) => candidate.value);
    const addressedToUser = hasSequence(prefix, ["told", "me"])
      || hasSequence(prefix, ["said", "to", "me"])
      || hasSequence(prefix, ["reported", "to", "me"]);
    if (addressedToUser) return { subject: "first-party", actor: "user", index, next: index + 1, evidence: "reported" };
  }
  if (token.value === "me" && witnessVerbs.has(tokens[index - 1]?.value ?? "")) {
    return { subject: "first-party", actor: "user", index, next: index + 1, evidence: "witnessed" };
  }
  if (["him", "her", "them"].includes(token.value)
    && witnessVerbs.has(tokens[index - 1]?.value ?? "")) {
    return { subject: "third-party", actor: token.value, index, next: index + 1, evidence: "witnessed" };
  }
  if (thirdPartyPronouns.has(token.value)) return { subject: "third-party", actor: token.value, index, next: index + 1, evidence: "direct" };
  if (["my", "a", "the"].includes(token.value) && relationNouns.has(tokens[index + 1]?.value)) {
    const evidence = witnessVerbs.has(tokens[index - 1]?.value ?? "") ? "witnessed" : "direct";
    return { subject: "third-party", actor: `${token.value} ${tokens[index + 1].value}`, index, next: index + 2, evidence };
  }
  const excludedLead = new Set([
    "it", "what", "if", "is", "did", "have", "could", "would", "should", "can", "may", "might", "years", "the", "an", "a", "my", "no", "none", "nobody",
    "in", "neither", "nor", "that", "this", "claim", "example", "sentence", "doctor", "label", "instructions", "prescription",
    "yesterday", "today", "tonight", "tomorrow", "once", "twice",
  ]);
  const followsAsPredicate = tokens.slice(index + 1, Math.min(tokens.length, index + 6)).some((candidate) =>
    actionBase.has(candidate.value) || actionPast.has(candidate.value) || actionParticiples.has(candidate.value) || actionGerunds.has(candidate.value));
  if (excludedLead.has(token.value)) return null;
  const looksLikeName = /^\p{Lu}[\p{L}'-]{1,40}$/u.test(token.raw)
    || (index === 0 && /^\p{Ll}[\p{L}'-]{1,40}$/u.test(token.raw) && !excludedLead.has(token.value) && followsAsPredicate);
  const evidence = witnessVerbs.has(tokens[index - 1]?.value ?? "") ? "witnessed" : "direct";
  return looksLikeName ? { subject: "third-party", actor: token.raw, index, next: index + 1, evidence } : null;
}

function lastContrastBefore(tokens: Token[], index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (["but", "however"].includes(tokens[cursor].value)) return cursor + 1;
  }
  return 0;
}

function hasSequence(values: string[], sequence: string[]): boolean {
  return values.some((_, index) => sequence.every((value, offset) => values[index + offset] === value));
}

function explicitActorAt(values: string[], index: number): { actor: string; next: number; subject: IngestionSubject } | null {
  const value = values[index];
  if (value === "i") return { actor: "user", next: index + 1, subject: "first-party" };
  if (thirdPartyPronouns.has(value)) return { actor: value, next: index + 1, subject: "third-party" };
  if (["my", "a", "the"].includes(value) && relationNouns.has(values[index + 1] ?? "")) {
    return { actor: `${value} ${values[index + 1]}`, next: index + 2, subject: "third-party" };
  }
  if (value && !["changed", "chose", "decided", "stopped", "did", "have", "had", "no"].includes(value)) {
    return { actor: value, next: index + 1, subject: "third-party" };
  }
  return null;
}

function actorMatchesRetraction(event: SubjectMention, actor: { actor: string; subject: IngestionSubject }): boolean {
  if (event.subject !== actor.subject) return false;
  if (event.subject === "first-party") return true;
  return event.actor.toLowerCase() === actor.actor.toLowerCase();
}

function postActionRetraction(tokens: Token[], actionIndex: number, event: SubjectMention): boolean {
  for (let index = actionIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].value !== "but") continue;
    const tail = tokens.slice(index + 1).map((token) => token.value);
    if (hasSequence(tail, ["that", "was", "not", "true"])
      || hasSequence(tail, ["i", "was", "wrong"])
      || hasSequence(tail, ["i", "stopped"])
      || hasSequence(tail, ["i", "changed", "my", "mind"])
      || hasSequence(tail, ["i", "decided", "against", "it"])
      || hasSequence(tail, ["i", "chose", "not", "to"])) return event.subject === "first-party";

    const explicitActor = explicitActorAt(tail, 0);
    const predicateStart = explicitActor?.next ?? 0;
    if (explicitActor && !actorMatchesRetraction(event, explicitActor)) continue;
    const implicitRetraction = !explicitActor && (
      hasSequence(tail, ["changed", event.subject === "first-party" ? "my" : "their", "mind"])
      || tail[0] === "changed" && ["my", "his", "her", "their"].includes(tail[1]) && tail[2] === "mind"
      || hasSequence(tail, ["chose", "not", "to"])
      || hasSequence(tail, ["decided", "not", "to"])
      || hasSequence(tail, ["decided", "against", "it"])
      || tail[0] === "stopped"
    );
    if (implicitRetraction) return true;

    const didNot = tail[predicateStart] === "did" && tail[predicateStart + 1] === "not";
    const haveNot = ["have", "had"].includes(tail[predicateStart]) && tail[predicateStart + 1] === "not";
    if (!didNot && !haveNot) continue;
    const remainder = tail.slice(predicateStart + 2);
    if (remainder.length === 0 || actionBase.has(remainder[0]) || ["do", "it", "that", "so"].includes(remainder[0])) return true;
  }
  return false;
}

function historicalContext(values: string[]): boolean {
  if (values.includes("historically")) return true;
  if (values.some((value, index) => value === "ago" && values.slice(Math.max(0, index - 3), index)
    .some((candidate) => /^(?:\d{1,4}|year|years|decade|decades)$/.test(candidate)))) return true;
  if (hasSequence(values, ["last", "year"]) || hasSequence(values, ["in", "the", "past"])) return true;
  if (hasSequence(values, ["years", "back"]) || hasSequence(values, ["year", "back"])) return true;
  if (values.some((value, index) => /^(?:19|20)\d{2}$/.test(value)
    && (["in", "back"].includes(values[index - 1] ?? "")
      || (values[index - 2] === "back" && values[index - 1] === "in")
      || values.slice(Math.max(0, index - 4), index).some((candidate) => ["summer", "winter", "spring", "autumn", "fall"].includes(candidate))))) return true;
  if (values.some((value, index) => (countWords.has(value) || /^\d{1,3}$/.test(value))
    && hasSequence(values.slice(Math.max(0, index - 4), index), ["when", "i", "was"]))) return true;
  return values.some((value, index) => ["child", "teen", "teenager"].includes(value)
    && (values[index - 1] === "a" || hasSequence(values.slice(Math.max(0, index - 4), index + 1), ["when", "i", "was", "a", value])));
}

function frameFor(tokens: Token[], subject: SubjectMention, actionIndex: number, futureMarker: boolean, completedForm: boolean, questionLike: boolean): IngestionFrame | null {
  const between = subject.next <= actionIndex ? tokens.slice(subject.next, actionIndex).map((token) => token.value) : [];
  const scopeAnchor = Math.min(subject.index, actionIndex);
  const segmentStart = lastContrastBefore(tokens, scopeAnchor);
  const prefix = tokens.slice(segmentStart, subject.index).map((token) => token.value);
  const preAction = tokens.slice(lastContrastBefore(tokens, actionIndex), actionIndex).map((token) => token.value);
  const reportedNegation = (prefix.includes("never") || hasSequence(prefix, ["did", "not"]))
    && prefix.some((value) => ["say", "said", "report", "reported", "claim", "claimed", "tell", "told"].includes(value));
  const neitherScope = prefix.includes("neither") && prefix.includes("nor");
  const negatedPrefix = hasSequence(prefix, ["not", "true", "that"])
    || hasSequence(prefix, ["false", "that"])
    || prefix.includes("denied")
    || reportedNegation
    || neitherScope;
  const negatedPredicate = between.includes("not") || between.includes("never") || between.includes("almost")
    || hasSequence(between, ["not", "yet"]) || hasSequence(between, ["no", "longer"]);
  const tail = tokens.slice(actionIndex + 1).map((token) => token.value);
  const negatedTail = hasSequence(tail, ["is", "false"])
    || hasSequence(tail, ["was", "false"])
    || hasSequence(tail, ["is", "not", "true"])
    || hasSequence(tail, ["was", "not", "true"]);
  if (negatedPrefix || negatedPredicate || negatedTail || postActionRetraction(tokens, actionIndex, subject)) return "negated";

  const historicalPrefix = historicalContext(preAction) || historicalContext(prefix);
  const historicalTail = historicalContext(tail);
  const quotedOrExamplePrefix = prefix.includes("example") || prefix.includes("sentence") || prefix.includes("quoted") || prefix.includes("quote");
  const hypotheticalPrefix = preAction.includes("if") || preAction.includes("unless") || hasSequence(preAction, ["in", "case"])
    || hasSequence(preAction, ["provided", "that"])
    || preAction.includes("suppose") || preAction.includes("supposing") || preAction.includes("imagine") || preAction.includes("imagining")
    || preAction.includes("dream") || preAction.includes("dreamed") || preAction.includes("dreamt") || preAction.includes("dreaming")
    || hasSequence(between, ["would", "have"])
    || preAction[0] === "had"
    || hasSequence(prefix, ["what", "if"]) || hasSequence(prefix, ["is", "it", "possible"])
    || (["did", "have", "could", "would", "should", "can", "may", "might"].includes(prefix[0]) && prefix.length <= 12);
  const uncertainPrefix = prefix.includes("maybe") || prefix.includes("perhaps") || prefix.includes("possibly")
    || prefix.includes("afraid") || prefix.includes("worried") || prefix.includes("wonder") || prefix.includes("wondering")
    || prefix.includes("whether") || prefix.includes("unsure") || prefix.includes("think") || prefix.includes("guess") || hasSequence(prefix, ["not", "sure"]);
  const uncertainPredicate = between.includes("might") || between.includes("may") || between.includes("could")
    || between.includes("possibly") || between.includes("perhaps") || between.includes("maybe");
  if (historicalPrefix || historicalTail || quotedOrExamplePrefix || hypotheticalPrefix || questionLike) return "hypothetical";
  if (uncertainPrefix || uncertainPredicate) return "uncertain";
  if (futureMarker) return "future-intent";
  return completedForm ? "completed" : null;
}

function quoteSpanAt(clause: string, position: number): { start: number; end: number } | null {
  const quoteIndexes = [...clause.matchAll(/["“”]/gu)].flatMap((match) => match.index === undefined ? [] : [match.index]);
  for (let index = 0; index + 1 < quoteIndexes.length; index += 2) {
    if (quoteIndexes[index] < position && position < quoteIndexes[index + 1]) {
      return { start: quoteIndexes[index], end: quoteIndexes[index + 1] };
    }
  }
  return null;
}

function lastThirdPartySubject(tokens: Token[], before: number): SubjectMention | null {
  for (let index = before - 1; index >= 0; index -= 1) {
    const candidate = subjectAt(tokens, index);
    if (candidate?.subject === "third-party") return candidate;
  }
  return null;
}

function attributedSubject(tokens: Token[], subject: SubjectMention, clause: string): SubjectMention {
  if (subject.subject !== "first-party" || subject.actor !== "user") return subject;
  // Quoted "you" in a report addressed to the user remains the user; only
  // quoted first-person language inherits the speaker outside the quote.
  if (tokens[subject.index]?.value === "you") return subject;
  const quoteSpan = quoteSpanAt(clause, tokens[subject.index]?.start ?? -1);
  if (quoteSpan) {
    const beforeQuote = clause.slice(0, quoteSpan.start);
    const afterQuote = clause.slice(quoteSpan.end + 1);
    const prefixTokens = tokenize(beforeQuote);
    const suffixTokens = tokenize(afterQuote);
    let reporterVerbIndex = -1;
    for (let index = prefixTokens.length - 1; index >= 0; index -= 1) {
      if (!reportVerbs.has(prefixTokens[index].value)) continue;
      reporterVerbIndex = index;
      break;
    }
    if (reporterVerbIndex >= 0) {
      const reporter = lastThirdPartySubject(prefixTokens, reporterVerbIndex);
      if (reporter) return { ...subject, actor: reporter.actor, subject: "third-party", evidence: "reported" };
    }
    // Name/relation labels before a colon (Jordan: "I...") and trailing
    // attributions ("I..." — Jordan) are direct-speech speaker markers.
    if (/[:]\s*$/u.test(beforeQuote)) {
      const label = lastThirdPartySubject(prefixTokens, prefixTokens.length);
      if (label) return { ...subject, actor: label.actor, subject: "third-party", evidence: "reported" };
    }
    const trailing = subjectAt(suffixTokens, 0);
    if (trailing?.subject === "third-party") {
      return { ...subject, actor: trailing.actor, subject: "third-party", evidence: "reported" };
    }
  }
  if (subject.index === 0) return subject;
  const prefix = tokens.slice(Math.max(0, subject.index - 12), subject.index);
  let reportingIndex = -1;
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    if (reportVerbs.has(prefix[index].value)) {
      reportingIndex = index;
      break;
    }
  }
  if (reportingIndex < 0) return subject;
  const reportingToken = prefix[reportingIndex];
  const gap = clause.slice(reportingToken.end, tokens[subject.index].start);
  const indirectReport = /\bthat\b/i.test(gap);
  const crossedClauseBoundary = /[;.!?]/.test(gap);
  const directMessageVerb = /^(?:text|texts|texted|message|messages|messaged|write|writes|wrote|email|emails|emailed)$/i.test(reportingToken.value);
  const directSpeechMarker = /["“”,:]/u.test(gap);
  if (indirectReport || crossedClauseBoundary || (!directMessageVerb && !directSpeechMarker)) return subject;
  for (let index = reportingIndex - 1; index >= 0; index -= 1) {
    const reporter = subjectAt(prefix, index);
    if (reporter?.subject === "third-party") return { ...subject, actor: reporter.actor, subject: "third-party", evidence: "reported" };
  }
  return subject;
}

function predicateFor(tokens: Token[], subject: SubjectMention, questionLike: boolean, clause: string): ParsedPredicate | null {
  const effectiveSubject = attributedSubject(tokens, subject, clause);
  const limit = Math.min(tokens.length, subject.next + 12);
  for (let index = subject.next; index < limit; index += 1) {
    if (index > subject.next && subjectAt(tokens, index)) return null;
    const value = tokens[index].value;
    if (!actionBase.has(value) && !actionPast.has(value) && !actionParticiples.has(value) && !actionGerunds.has(value)) continue;

    const between = tokens.slice(subject.next, index).map((token) => token.value);
    const hasCurrentAuxiliary = between.includes("am") || between.includes("is") || between.includes("are");
    const futureMarker = between.includes("will")
      || (between.some((word) => ["intend", "intends"].includes(word)) && between.includes("to"))
      || (between.some((word) => ["intend", "intends"].includes(word)) && between.includes("on"))
      || (between.includes("plan") && between.includes("to"))
      || (between.includes("plan") && between.includes("on"))
      || (between.includes("planned") && between.includes("to"))
      || (between.includes("mean") && between.includes("to"))
      || (between.includes("fixing") && between.includes("to"))
      || (between.includes("determined") && between.includes("to"))
      || (between.includes("poised") && between.includes("to"))
      || (between.includes("ready") && between.includes("to") && (between.includes("getting") || between.includes("is") || between.includes("are") || between.includes("am")))
      || (between.includes("moments") && between.includes("away") && between.includes("from"))
      || (between.includes("verge") && between.includes("of"))
      || (between.includes("made") && between.includes("up") && between.includes("mind") && between.includes("to"))
      || (between.some((word) => ["want", "wants", "wanted", "decide", "decides", "decided", "choose", "chooses", "chose"].includes(word)) && between.includes("to"))
      || (hasCurrentAuxiliary && between.includes("considering") && actionGerunds.has(value))
      || (between.includes("planning") && between.includes("on"))
      || (hasCurrentAuxiliary && ((between.includes("about") && between.includes("to"))
        || (between.includes("going") && between.includes("to"))
        || (between.includes("planning") && between.includes("to"))
        || (between.includes("planning") && between.includes("on"))
        || (between.includes("thinking") && (between.includes("of") || between.includes("about")))));
    const perfect = (between.includes("have") || between.includes("has") || between.includes("had")) && actionParticiples.has(value);
    const emphaticPast = between.includes("did") && actionBase.has(value);
    const activeIngestion = hasCurrentAuxiliary && actionGerunds.has(value) && !between.includes("thinking");
    const forcedIngestion = between.includes("forced") && between.includes("to") && actionBase.has(value);
    const witnessedAction = (actionBase.has(value) || actionGerunds.has(value))
      && tokens.slice(Math.max(0, subject.index - 4), subject.index).some((token) => witnessVerbs.has(token.value));
    const passiveWitness = actionGerunds.has(value)
      && between.some((word) => ["seen", "observed", "witnessed", "found", "caught"].includes(word))
      && between.some((word) => ["was", "were", "been"].includes(word));
    const completedForm = actionPast.has(value) || perfect || emphaticPast || activeIngestion || forcedIngestion || witnessedAction || passiveWitness;
    const frame = frameFor(tokens, effectiveSubject, index, futureMarker, completedForm, questionLike);
    if (!frame) return null;
    return { ...effectiveSubject, action: value, actionIndex: index, frame };
  }
  return null;
}

function passivePredicates(tokens: Token[], questionLike: boolean): ParsedPredicate[] {
  const predicates: ParsedPredicate[] = [];
  for (let actionIndex = 0; actionIndex < tokens.length; actionIndex += 1) {
    const action = tokens[actionIndex].value;
    if (!actionParticiples.has(action)) continue;
    const auxiliary = tokens.slice(Math.max(0, actionIndex - 4), actionIndex).some((token) => ["was", "were", "is", "are", "been"].includes(token.value));
    if (!auxiliary) continue;
    const byIndex = tokens.slice(actionIndex + 1, Math.min(tokens.length, actionIndex + 6)).findIndex((token) => token.value === "by");
    if (byIndex < 0) continue;
    const actorIndex = actionIndex + 1 + byIndex + 1;
    const actor = subjectAt(tokens, actorIndex);
    if (!actor) continue;
    const frame = frameFor(tokens, actor, actionIndex, false, true, questionLike);
    if (!frame) continue;
    predicates.push({ ...actor, action, actionIndex, frame, evidence: "witnessed" });
  }
  return predicates;
}

function routineAssertion(values: string[]): boolean {
  return hasSequence(values, ["as", "prescribed"])
    || hasSequence(values, ["according", "to", "the", "label"])
    || hasSequence(values, ["according", "to", "label"])
    || hasSequence(values, ["according", "to", "the", "instructions"])
    || hasSequence(values, ["per", "my", "doctor"]);
}

function instructionCounts(tokens: Token[], event: ParsedPredicate): number[] {
  const counts: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    const directPrescription = ["prescribed", "instructed"].includes(value);
    const sourceInstruction = ["label", "instructions", "prescription", "doctor", "prescriber", "pharmacist"].includes(value)
      && tokens.slice(index + 1, index + 5).some((token) => ["say", "says", "said", "told", "instructed", "prescribed"].includes(token.value));
    if (!directPrescription && !sourceInstruction) continue;
    for (let cursor = index + 1; cursor < Math.min(tokens.length, index + 9); cursor += 1) {
      const count = countAt(tokens, cursor);
      if (count === null) continue;
      const instructionTarget = tokens.slice(index + 1, cursor).map((token) => token.value);
      const explicitlyThirdParty = instructionTarget.some((value, targetIndex) =>
        ["my", "his", "her", "their"].includes(value)
        && ["dog", "cat", "pet", ...relationNouns].includes(instructionTarget[targetIndex + 1] ?? ""));
      if (event.subject === "first-party" && explicitlyThirdParty) break;
      counts.push(count);
      break;
    }
  }
  return counts;
}

function countAndUnit(tokens: Token[], start: number, end: number): Array<{ count: number; index: number; unitIndex: number }> {
  const matches: Array<{ count: number; index: number; unitIndex: number }> = [];
  for (let index = start; index < end; index += 1) {
    const count = countAt(tokens, index);
    if (count === null) continue;
    for (let unitIndex = index + 1; unitIndex < Math.min(end, index + 4); unitIndex += 1) {
      if (harmlessCountUnits.has(tokens[unitIndex].value)) break;
      if (!medicationUnits.has(tokens[unitIndex].value)) continue;
      matches.push({ count, index, unitIndex });
      break;
    }
  }
  return matches;
}

function wholeContainerRisk(tokens: Token[], start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (!containerQuantifiers.has(tokens[index].value)) continue;
    for (let containerIndex = index + 1; containerIndex < Math.min(end, index + 4); containerIndex += 1) {
      if (!containerNouns.has(tokens[containerIndex].value)) continue;
      const between = tokens.slice(index + 1, containerIndex).map((token) => token.value);
      if (between.some((value) => ordinaryBottleContents.has(value))) return false;
      const content = tokens.slice(containerIndex + 1, Math.min(end, containerIndex + 5)).map((token) => token.value);
      if (content.slice(0, 3).some((value) => ordinaryBottleContents.has(value))) return false;
      return true;
    }
  }
  return false;
}

function nonIngestiveTakeObject(tokens: Token[], event: ParsedPredicate, end: number): boolean {
  if (!["take", "took", "taken", "taking"].includes(event.action)) return false;
  const values = tokens.slice(event.actionIndex + 1, end).map((token) => token.value);
  const mediaIndex = values.findIndex((value) => mediaTakingObjects.has(value));
  const medicationIndex = values.findIndex((value) => medicationNouns.has(value));
  if (mediaIndex >= 0 && (medicationIndex < 0 || mediaIndex < medicationIndex)) return true;

  const containerIndex = values.findIndex((value) => containerNouns.has(value));
  if (containerIndex < 0) return false;
  const destinationIndex = values.findIndex((value, index) => index > containerIndex
    && transportDestinations.has(value)
    && values.slice(containerIndex + 1, index).some((candidate) => ["to", "into", "onto"].includes(candidate)));
  const movementParticle = values.slice(containerIndex + 1).some((value, index, tail) =>
    ["into", "onto"].includes(value)
    || (value === "over" && tail[index + 1] === "to")
    || (value === "off" && tail[index + 1] === "the")
    || (value === "out" && tail[index + 1] === "of")
    || ["downstairs", "upstairs"].includes(value));
  const preservationPurpose = hasSequence(values.slice(containerIndex + 1), ["for", "safekeeping"]);
  return destinationIndex >= 0 || movementParticle || preservationPurpose;
}

function nonIngestiveProcessObject(tokens: Token[], event: ParsedPredicate, end: number): boolean {
  if (!["finish", "finished", "finishing"].includes(event.action)) return false;
  const values = tokens.slice(event.actionIndex + 1, end).map((token) => token.value);
  const taskHeads = new Set(["process", "count", "counting", "report", "audit", "inventory", "stock", "note", "notes", "list", "listing", "sorting", "labeling", "labelling", "reading"]);
  const firstContent = values.find((value) => !["the", "a", "an", "my", "our", "entire", "whole", "full"].includes(value)) ?? "";
  return taskHeads.has(firstContent) || (/ing$/.test(firstContent) && !actionGerunds.has(firstContent));
}

function eventObjectEnd(tokens: Token[], event: ParsedPredicate, requestedEnd: number): number {
  const hardBoundaries = new Set(["because", "after", "before", "while", "where", "when", "since", "although", "unless", "whereas"]);
  for (let index = event.actionIndex + 1; index < requestedEnd; index += 1) {
    const value = tokens[index].value;
    if (hardBoundaries.has(value)) return index;
    if (value === "then") return index;
    if (value !== "and") continue;
    const next = tokens[index + 1]?.value ?? "";
    const introducesAnotherAction = actionBase.has(next) || actionPast.has(next) || actionParticiples.has(next) || actionGerunds.has(next)
      || /(?:ed|ing|ize|ise|s)$/.test(next);
    if (introducesAnotherAction && !["prescribed", "instructed", "labeled", "labelled", "says"].includes(next)) return index;
  }
  return requestedEnd;
}

function boundObjectSemantics(tokens: Token[], event: ParsedPredicate, requestedEnd: number): Pick<IngestionRiskEvent, "actionSense" | "objectKind"> {
  const end = eventObjectEnd(tokens, event, requestedEnd);
  const postActionValues = tokens.slice(event.actionIndex + 1, end).map((token) => token.value);
  const preActionValues = tokens.slice(Math.max(0, event.actionIndex - 14), event.actionIndex).map((token) => token.value);
  const hasPreposedObject = preActionValues.includes("what")
    || preActionValues.some((value, index) => ["was", "were", "been"].includes(value) && index >= preActionValues.length - 5);
  const objectValues = hasPreposedObject ? [...preActionValues, ...postActionValues] : postActionValues;
  const hasMedication = objectValues.some((value) => medicationNouns.has(value));
  const hasToxic = objectValues.some((value) => toxicNouns.has(value));
  const hasMeasure = objectValues.some((value) => measureNouns.has(value));
  const hasContainer = objectValues.some((value) => containerNouns.has(value));
  const hasOrdinary = objectValues.some((value) => ordinaryBottleContents.has(value));
  const mediaTaking = ["take", "took", "taken", "taking"].includes(event.action)
    && objectValues.some((value) => mediaTakingObjects.has(value));
  const transportTaking = !mediaTaking && nonIngestiveTakeObject(tokens, event, end);
  const taskCompletion = nonIngestiveProcessObject(tokens, event, end);
  const actionSense: IngestionRiskEvent["actionSense"] = mediaTaking
    ? "media"
    : transportTaking
      ? "transport"
      : taskCompletion
        ? "task"
        : hasOrdinary && !hasMedication && !hasToxic
          ? "ordinary-object"
          : "ingestion";
  const objectKind: IngestionRiskEvent["objectKind"] = hasMedication
    ? "medication"
    : hasToxic
      ? "toxic"
      : hasMeasure
        ? "measure"
        : hasContainer
          ? "container"
          : hasOrdinary
            ? "ordinary"
            : "unspecified";
  return { actionSense, objectKind };
}

function preposedQuantityRisk(tokens: Token[], event: ParsedPredicate): boolean {
  const before = countAndUnit(tokens, Math.max(0, event.actionIndex - 12), event.actionIndex);
  if (!before.length) return false;
  const bridge = tokens.slice(before[0].unitIndex + 1, event.actionIndex).map((token) => token.value);
  const preposedSyntax = bridge.includes("what") || bridge.some((value) => ["was", "were", "been"].includes(value));
  return before[0].count >= 5 && preposedSyntax;
}

function preposedWholeContainerRisk(tokens: Token[], event: ParsedPredicate): boolean {
  const start = Math.max(0, event.actionIndex - 14);
  const before = tokens.slice(start, event.actionIndex);
  const bridgeValues = before.map((token) => token.value);
  if (!bridgeValues.includes("what") && !bridgeValues.some((value) => ["was", "were", "been"].includes(value))) return false;
  return wholeContainerRisk(tokens, start, event.actionIndex);
}

function quantityRisk(tokens: Token[], event: ParsedPredicate, end: number): boolean {
  const start = event.actionIndex;
  const objectEnd = eventObjectEnd(tokens, event, end);
  const values = tokens.slice(start, end).map((token) => token.value);
  const objectValues = tokens.slice(start, objectEnd).map((token) => token.value);
  if (event.action === "overdosed") return true;
  if (nonIngestiveTakeObject(tokens, event, objectEnd) || nonIngestiveProcessObject(tokens, event, objectEnd)) return false;
  const allAfterAction = tokens.slice(event.actionIndex + 1).map((token) => token.value);
  if (["dissolve", "dissolved", "dissolving"].includes(event.action)
    && !allAfterAction.some((value) => ["drink", "drank", "swallow", "swallowed", "consume", "consumed"].includes(value))) return false;
  if (["empty", "emptied", "emptying"].includes(event.action)
    && !allAfterAction.includes("mouth")
    && !allAfterAction.some((value) => ["drink", "drank", "swallow", "swallowed", "consume", "consumed"].includes(value))) return false;
  if (["knock", "knocked", "knocking", "toss", "tossed", "tossing"].includes(event.action)
    && tokens[event.actionIndex + 1]?.value !== "back") return false;
  if (["polish", "polished", "polishing"].includes(event.action)
    && tokens[event.actionIndex + 1]?.value !== "off") return false;
  if (["use", "used", "using"].includes(event.action)
    && !(objectValues.includes("contents") && objectValues.some((value) => medicationNouns.has(value)))) return false;
  if (wholeContainerRisk(tokens, start, objectEnd)) return true;
  if (preposedWholeContainerRisk(tokens, event)) return true;
  if (preposedQuantityRisk(tokens, event)) return true;
  const ingestiveToxicAction = ["took", "take", "swallowed", "swallow", "consumed", "consume", "ingested", "ingest", "drank", "drink", "downed", "down", "finished", "finish", "inhaled", "inhale", "gulped", "gulp"].includes(event.action);
  if (ingestiveToxicAction && objectValues.some((value) => toxicNouns.has(value))) return true;
  if (ingestiveToxicAction && hasSequence(objectValues, ["cough", "syrup"])) return true;
  if ((objectValues.includes("all") || objectValues.includes("every") || objectValues.includes("most") || objectValues.includes("handful")) && objectValues.some((value) => medicationNouns.has(value))) return true;
  if (objectValues.includes("overdose") && objectValues.some((value) => medicationNouns.has(value))) return true;
  if ((hasSequence(objectValues, ["too", "much"]) || hasSequence(objectValues, ["too", "many"]))
    && objectValues.some((value) => medicationNouns.has(value))) return true;

  const assertedRoutine = routineAssertion(values);
  const explicitMultiplier = values.some((value, index) => {
    const count = countWords.get(value) ?? (/^\d+$/.test(value) ? Number(value) : null);
    return count !== null && count > 1 && values[index + 1] === "x";
  }) && values.some((value) => ["prescribed", "label", "instructions", "dose", "doses", "amount"].includes(value));
  if (explicitMultiplier) return true;
  const timesMultiplier = values.some((value, index) => {
    const count = countAt(tokens, start + index);
    return count !== null && count > 1 && values[index + 1] === "times";
  }) && (values.includes("prescribed") || values.includes("usual") || values.includes("label") || values.includes("instructions")
    || values.some((value) => value === "recommended" || value.endsWith("-recommended")));
  if (timesMultiplier) return true;
  const percentMultiplier = values.some((value, index) => /^\d{1,4}$/.test(value)
    && Number(value) > 100 && values[index + 1] === "percent")
    && values.some((value) => ["prescribed", "usual", "dose", "amount"].includes(value));
  if (percentMultiplier) return true;
  const comparativeOverage = (values.includes("twice") || values.includes("double") || values.includes("doubled") || values.includes("triple") || values.includes("tripled"))
    && (values.includes("much") || values.includes("more") || values.includes("what"))
    && (values.includes("prescribed") || values.includes("label") || values.includes("instructions"));
  if (comparativeOverage) return true;
  if (assertedRoutine && !values.includes("then")) return false;
  const expected = instructionCounts(tokens, event);
  const actualCounts = countAndUnit(tokens, start, objectEnd);
  const explicitInstead = actualCounts.find((actual) => {
    const after = tokens.slice(actual.unitIndex + 1, Math.min(end, actual.unitIndex + 6)).map((token) => token.value);
    const insteadIndex = after.indexOf("instead");
    const ratherIndex = after.indexOf("rather");
    const comparisonIndex = insteadIndex >= 0 && after[insteadIndex + 1] === "of"
      ? insteadIndex + 2
      : ratherIndex >= 0 && after[ratherIndex + 1] === "than"
        ? ratherIndex + 2
        : -1;
    if (comparisonIndex < 0) return false;
    let comparison: number | null = null;
    for (let cursor = comparisonIndex; cursor < Math.min(after.length, comparisonIndex + 3); cursor += 1) {
      comparison = countWords.get(after[cursor]) ?? (/^\d+$/.test(after[cursor] ?? "") ? Number(after[cursor]) : null);
      if (comparison !== null) break;
    }
    return comparison !== null && actual.count > comparison;
  });
  if (explicitInstead) return true;

  const bareActual = (() => {
    for (let index = start + 1; index < Math.min(end, start + 6); index += 1) {
      const count = countAt(tokens, index);
      if (count === null) continue;
      const next = tokens[index + 1]?.value;
      if (next && !["already", "instead", "of", "by", "accident", "mistake"].includes(next)) return null;
      return count;
    }
    return null;
  })();

  const actual = actualCounts[0];
  if (actual && expected.length > 0) {
    if (actual.count > Math.min(...expected)) return true;
    if (actual.count <= Math.max(...expected)) return false;
  }

  if (bareActual !== null && expected.length > 0 && bareActual > Math.min(...expected)) return true;

  const actualFrequencies: number[] = [];
  for (let index = start + 1; index < objectEnd; index += 1) {
    const count = countAt(tokens, index);
    if (count !== null && tokens[index + 1]?.value === "times") actualFrequencies.push(count);
  }
  if (actualFrequencies.some((count) => count > 1)
    && (values.includes("prescribed") || (values.includes("what") && values.some((value) => ["label", "instructions", "doctor", "prescriber"].includes(value))))) return true;
  if (actualFrequencies.length > 0 && expected.length > 0 && Math.max(...actualFrequencies) > Math.min(...expected)) return true;
  if (actualFrequencies.length > 0) {
    const insteadIndex = values.indexOf("instead");
    if (insteadIndex >= 0 && values[insteadIndex + 1] === "of") {
      const comparison = countWords.get(values[insteadIndex + 2]) ?? (/^\d+$/.test(values[insteadIndex + 2] ?? "") ? Number(values[insteadIndex + 2]) : null);
      if (comparison !== null && Math.max(...actualFrequencies) > comparison) return true;
    }
  }

  const measuredCounts: number[] = [];
  for (let index = start + 1; index < objectEnd; index += 1) {
    const count = countAt(tokens, index);
    if (count !== null && measureNouns.has(tokens[index + 1]?.value)) measuredCounts.push(count);
  }
  const measuredMedication = objectValues.some((value) => medicationNouns.has(value));
  const measuredAccident = objectValues.some((value) => ["mistake", "accident"].includes(value))
    || tokens.slice(Math.max(0, event.index - 3), objectEnd).some((token) => ["accidentally", "mistakenly"].includes(token.value));
  if (measuredMedication && measuredCounts.some((count) => count >= 2) && measuredAccident) return true;

  const bothOrPair = objectValues.includes("both") || hasSequence(objectValues, ["a", "pair", "of"]);
  if (bothOrPair && (objectValues.some((value) => medicationUnits.has(value))
    || objectValues.some((value) => measureNouns.has(value))
    || objectValues.some((value) => containerNouns.has(value)))) return true;
  const countedContainers = objectValues.some((value, index) => {
    const count = countAt(tokens, start + index);
    if (count === null || count < 2) return false;
    return objectValues.slice(index + 1, index + 4).some((candidate) => containerNouns.has(candidate));
  });
  const countedContainerAccident = tokens.slice(Math.max(0, event.index - 4), objectEnd)
    .some((token) => ["accidentally", "mistakenly", "unintentionally", "mistake", "accident"].includes(token.value));
  if (countedContainers && (countedContainerAccident
    || objectValues.some((value) => medicationNouns.has(value))
    || ["swallow", "swallowed", "drink", "drank", "inject", "injected"].includes(event.action))) return true;

  const hasMedication = values.some((value) => medicationNouns.has(value));
  const doubledVerb = event.action === "doubled" && (hasMedication || values.includes("up"));
  const tripledVerb = ["tripled", "quadrupled", "quintupled"].includes(event.action) && (hasMedication || values.includes("prescribed") || values.includes("label") || values.includes("usual"));
  const twiceDose = (values.includes("twice") || hasSequence(values, ["two", "times"]))
    && (hasMedication || values.includes("label") || values.includes("prescribed") || (values.includes("amount") && (values.includes("label") || values.includes("prescribed"))));
  const explicitDouble = (values.includes("double") || values.includes("doubled") || values.includes("triple") || values.includes("tripled") || values.includes("quadruple") || values.includes("quadrupled") || values.includes("quintuple") || values.includes("quintupled"))
    && (hasMedication || values.includes("prescribed") || values.includes("label"));
  if (assertedRoutine) return false;
  if (doubledVerb || tripledVerb || twiceDose || explicitDouble) return true;

  const extraDose = values.some((value) => ["extra", "additional", "another", "second"].includes(value))
    && (values.some((value) => medicationNouns.has(value)) || values.some((value) => measureNouns.has(value)));
  if (extraDose) return true;
  const relativeOverage = values.includes("more")
    && values.some((value) => medicationUnits.has(value))
    && values.some((value) => ["label", "instructions", "prescription", "doctor", "prescriber", "prescribed", "instructed"].includes(value));
  if (relativeOverage) return true;
  const prescribedComparisonOverage = values.includes("more")
    && values.includes("than")
    && values.includes("prescribed")
    && values.indexOf("more") < values.indexOf("than")
    && values.indexOf("than") < values.lastIndexOf("prescribed");
  if (prescribedComparisonOverage) return true;

  const nearbyAccident = tokens.slice(Math.max(0, event.index - 4), end).some((token) => ["accidentally", "mistakenly", "unintentionally", "mistake", "accident"].includes(token.value));
  if (actual && ((nearbyAccident && actual.count >= 2) || actual.count >= 5)) return true;
  for (let index = start + 1; index < objectEnd; index += 1) {
    const count = countAt(tokens, index);
    if (count === null || count < 5) continue;
    const next = tokens[index + 1];
    if (!next || medicationNouns.has(next.value) || (/^[A-Z]/.test(next.raw) && !harmlessCountUnits.has(next.value))) return true;
  }
  return false;
}

function inheritedPredicates(tokens: Token[], root: ParsedPredicate, questionLike: boolean): ParsedPredicate[] {
  const inherited: ParsedPredicate[] = [];
  for (let index = root.actionIndex + 1; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (!actionPast.has(value) && !actionParticiples.has(value)) continue;
    const nearby = tokens.slice(Math.max(root.actionIndex + 1, index - 3), index).map((token) => token.value);
    if (!nearby.some((word) => ["then", "but", "and"].includes(word))) continue;
    const hasNewSubject = tokens.slice(root.actionIndex + 1, index).some((_, subjectIndex) =>
      Boolean(subjectAt(tokens, root.actionIndex + 1 + subjectIndex)));
    if (hasNewSubject) continue;
    inherited.push({
      subject: root.subject,
      actor: root.actor,
      index,
      next: index,
      evidence: root.evidence,
      action: value,
      actionIndex: index,
      frame: questionLike ? "hypothetical" : "completed",
    });
  }
  return inherited;
}

/**
 * Parses ingestion language as subject + temporal frame + action + quantity.
 * Lexical sets are deliberately independent, so new combinations of supported
 * verbs, containers, medication nouns, subjects, and quantifiers compose without
 * adding a sentence-shaped rule for every utterance.
 */
export function analyzeIngestionRisk(text: string): IngestionRiskAnalysis {
  const normalized = normalize(text);
  const clauses = normalized.split(/(?<=[.!?])\s+|[\r\n]+/u).filter(Boolean);
  const events: IngestionRiskEvent[] = [];
  for (const clause of clauses) {
    const tokens = tokenize(clause);
    const questionLike = clause.trim().endsWith("?") && !/\b(?:what|how|where|when|why)\s+(?:do|should|can)\s+i\b/i.test(clause);
    const predicates: ParsedPredicate[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const subject = subjectAt(tokens, index);
      if (!subject) continue;
      const predicate = predicateFor(tokens, subject, questionLike, clause);
      if (predicate) predicates.push(predicate, ...inheritedPredicates(tokens, predicate, questionLike));
    }
    predicates.push(...passivePredicates(tokens, questionLike));
    predicates.sort((left, right) => left.actionIndex - right.actionIndex);
    const uniquePredicates = predicates.filter((predicate, index) =>
      index === 0 || predicate.actionIndex !== predicates[index - 1].actionIndex
        || predicate.subject !== predicates[index - 1].subject
        || predicate.actor.toLowerCase() !== predicates[index - 1].actor.toLowerCase());
    for (let index = 0; index < uniquePredicates.length; index += 1) {
      const predicate = uniquePredicates[index];
      const end = uniquePredicates[index + 1]?.index ?? tokens.length;
      const semantics = boundObjectSemantics(tokens, predicate, end);
      events.push({
        subject: predicate.subject,
        actor: predicate.actor,
        frame: predicate.frame,
        action: predicate.action,
        evidence: predicate.evidence,
        ...semantics,
        quantityRisk: quantityRisk(tokens, predicate, end),
      });
    }
  }
  const completedFirstParty = events.some((event) => event.subject === "first-party" && event.frame === "completed" && event.quantityRisk);
  const completedThirdParty = events.some((event) => event.subject === "third-party" && event.frame === "completed" && event.quantityRisk);
  const futureFirstParty = events.some((event) => event.subject === "first-party" && event.frame === "future-intent" && event.quantityRisk);
  const futureThirdParty = events.some((event) => event.subject === "third-party" && event.frame === "future-intent" && event.quantityRisk);
  const uncertainFirstParty = events.some((event) => event.subject === "first-party" && event.frame === "uncertain" && event.quantityRisk);
  const uncertainThirdParty = events.some((event) => event.subject === "third-party" && event.frame === "uncertain" && event.quantityRisk);
  return {
    events,
    completedFirstParty,
    completedThirdParty,
    futureFirstParty,
    futureThirdParty,
    uncertainFirstParty,
    uncertainThirdParty,
    anyUrgent: completedFirstParty || completedThirdParty || futureFirstParty || futureThirdParty,
  };
}
