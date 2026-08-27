import type { SafetyLevel } from "./types";
import { analyzeIngestionRisk } from "./ingestion-risk";

const urgentPatterns = [
  /\bkill myself\b/i,
  /\bend my life\b/i,
  /\btak(?:e|ing) my own life\b/i,
  /\bwants? to die\b/i,
  /\bbetter off dead\b/i,
  /\bend(?:ing)? it all\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bhurt myself\b/i,
  /\bharm myself\b/i,
  /\b(?:keep )?(?:thinking about|feel like) (?:killing myself|ending my life|hanging myself)\b/i,
  /\boverdose (?:myself|on)\b/i,
  /\bnot safe (?:with|around) myself\b/i,
  /\bdon't want to (?:be here|live|wake up)\b/i,
  /\bdo not want to (?:be here|live|wake up)\b/i,
  /\bi (?:feel like )?(?:don't|do not|no longer) want to be alive\b/i,
  /\bwish I (?:was|were) dead\b/i,
  /\beveryone (?:would be|is) better off without me\b/i,
  /\b(?:have|made|wrote|written) (?:a )?suicide (?:plan|note)\b/i,
  /\b(?:about to|going to|planning to) (?:jump|hang|shoot|stab|cut|poison|overdose) myself\b/i,
  /\bi\s+(?:plan|intend) to\s+(?:hang|shoot|stab|cut|poison|overdose) myself\b/i,
  /\bi\s+will\s+(?:hang|shoot|stab|cut|poison|overdose) myself\b/i,
  /\bi\s+(?:plan|intend) to\s+(?:jump (?:off|from) (?:the |a )?(?:bridge|roof|ledge)|overdose)(?:\s+tonight|\s+today|\s+now)?\b/i,
  /\bi\s+will\s+(?:jump (?:off|from) (?:the |a )?(?:bridge|roof|ledge)|overdose)(?:\s+tonight|\s+today|\s+now)?\b/i,
  /\b(?:about to|going to|planning to) (?:cut|stab|shoot|burn) (?:my|the) (?:wrist|arm|leg|chest|neck|body)\b/i,
  /\bi(?:'m| am) (?:about to|going to|planning to) jump (?:off|from) (?:the |a )?(?:bridge|roof|ledge)\b/i,
  /\b(?:i(?:'m| am) (?:about to|going to|planning to)|i (?:plan|intend) to)\s+(?:take|swallow|ingest|drink)\s+(?:(?:far )?too many|all (?:of )?(?:my|the)|a (?:whole )?bottle of)\s*(?:pills?|tablets?|capsules?|doses?|medication|medicine|bleach|poison|chemicals?)\b/i,
  /\b(?:my\s+(?:friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|cousin|classmate|coworker)|he|she|they|someone)\s+(?:is|are)\s+(?:about to|going to|planning to)\s+jump (?:off|from) (?:the |a )?(?:bridge|roof|ledge)\b/i,
  /\b(?:my\s+(?:friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|aunt|uncle|cousin|neighbor|classmate|coworker)|he|she|they|someone)\b.{0,80}\b(?:going to kill (?:himself|herself|themself|themselves)|plans? to take (?:his|her|their) own life|plans? to kill (?:himself|herself|themself|themselves)|will overdose|plans? to overdose)\b/i,
  /\b(?:cut|stabbed|shot|burned) myself\b/i,
  /\b(?:cut|stabbed|shot|burned) (?:my|the) (?:wrist|arm|leg|chest|neck|body)\b/i,
  /\bslashed (?:my|the) (?:wrist|arm|leg|chest|neck|body)\b.{0,80}\b(?:bleeding|won't stop|will not stop)\b/i,
  /\b(?:bleeding heavily|cannot stop bleeding|can't stop bleeding)\b/i,
  /\b(?:gun|knife|weapon)\b.{0,60}\b(?:in my hand|with me|beside me|right here|loaded)\b/i,
  /\b(?:about to|going to|planning to|intend to|will) (?:kill|shoot|stab|attack|seriously hurt) (?:him|her|them|someone|a person|my\s+(?:mom|mother|dad|father|parent|partner|wife|husband|friend|classmate|coworker|teacher|boss))\b/i,
  /\b(?:I|i)(?:'m| am) (?:about to|going to|planning to|intend to|will) (?:kill|shoot|stab|attack|seriously hurt) [A-Z][A-Za-z'-]{1,40}\b/,
  /\bi(?:'m| am) (?:about to|going to|planning to|intend to|will) kill (?!time\b|weeds?\b|this\b|the\b)[a-z][a-z'-]{1,40}\b/i,
  /\bi\s+(?:will|plan to|intend to)\s+(?:kill|shoot|stab|attack|seriously hurt)\s+(?!time\b|weeds?\b|this\b|the\b)[a-z][a-z'-]{1,40}\b/i,
  /\bi(?:'m| am) (?:about to|going to|planning to|intend to|will) (?:stab|attack|seriously hurt) (?!my\b|the\b|a\b|an\b|him\b|her\b|them\b|someone\b|person\b)[a-z][a-z'-]{1,40}\b/i,
  /\bi(?:'m| am) (?:about to|going to|planning to|intend to|will) shoot (?!video\b|photos?\b|film\b)[a-z][a-z'-]{1,40}\b/i,
  /\b(?:he|she|they|someone|my ex) (?:is|are|was|were)?\s*(?:going to|about to|threatening to|planning to|waiting to) (?:kill|shoot|stab|attack|seriously hurt) me\b/i,
  /\b[A-Z][A-Za-z'-]{1,40} is (?:going to|about to|threatening to|planning to|waiting to) (?:kill|shoot|stab|attack|seriously hurt) me\b/,
  /\b[a-z][a-z'-]{1,40} is threatening to (?:kill|shoot|stab|attack|seriously hurt) me\b/i,
  /\bdeath threat\b.{0,100}\b(?:knife|gun|weapon|attack|tomorrow|today|school|work)\b/i,
  /\b(?:said|wrote|texted|messaged) (?:he|she|they) (?:would|will|is going to)\s+(?:bring|use)\s+(?:a )?(?:knife|gun|weapon)\b/i,
  /\b(?:someone|he|she|they|my ex|my neighbor)\b.{0,80}\b(?:gun pointed at me|holding a knife to my throat|outside with a loaded gun|said (?:he|she|they) would kill me|waiting to attack me outside)\b/i,
];

const strainedPatterns = [
  /\bdepress(?:ed|ing|ion)\b/i,
  /\bi(?:'m| am| feel| have been feeling) (?:really |very )?sad\b/i,
  /\bi (?:have|got) no friends\b/i,
  /\bhopeless\b/i,
  /\bworthless\b/i,
  /\bpanic(?:ked|king)?\b/i,
  /\boverwhelm(?:ed|ing)?\b/i,
  /\blonely\b/i,
  /\bfurious\b/i,
  /\bangry\b/i,
  /\bhate everyone\b/i,
  /\bcan't cope\b/i,
  /\bcannot cope\b/i,
  /\bcan't go on\b/i,
  /\bcannot go on\b/i,
  /\b(?:want to hurt my (?:coworker|classmate|friend|partner|boss|teacher)|feel like hurting (?:someone|a person|him|her|them))\b/i,
];

const historicalSafePattern = /\b(?:i\s+used to|in the past\s+i|last year\s+i|years? ago\s+i)\b.{0,140}\b(?:want(?:ed)? to die|(?:did not|didn't) want to be alive|(?:was\s+)?suicid(?:e|al)|kill myself|hurt myself|harm myself)\b.{0,140}\b(?:not (?:now|anymore)|safe now|no longer)\b/i;

function analyzedIngestionRisk(text: string) {
  return analyzeIngestionRisk(realRiskText(text).text);
}

export function isCompletedAcuteIngestionDisclosure(text: string): boolean {
  return analyzedIngestionRisk(text).completedFirstParty;
}

export function isThirdPartyCompletedAcuteIngestionDisclosure(text: string): boolean {
  return analyzedIngestionRisk(text).completedThirdParty;
}

export function isThirdPartyHighRiskIngestionConcern(text: string): boolean {
  const analysis = analyzedIngestionRisk(text);
  return analysis.completedThirdParty || analysis.futureThirdParty;
}

export function isFutureHighRiskIngestionIntent(text: string): boolean {
  return analyzedIngestionRisk(text).futureFirstParty;
}

function isInformationalOrIdiomaticClause(clause: string): boolean {
  const withoutLaughingIdiom = clause.replace(/\bkill(?:ing)? myself laughing\b/gi, "");
  const personalCurrentRisk = /\b(?:i want to die|i (?:feel like )?(?:don't|do not|no longer) want to be alive|i want to kill myself|i(?:'m| am) suicidal|i plan to (?:die|kill|hurt|harm) myself|everyone would be better off without me|i wrote a suicide note)\b/i.test(withoutLaughingIdiom);
  if (personalCurrentRisk) return false;
  return /\b(?:school report|research paper|article|definition|what does)\b.{0,80}\b(?:suicide|suicidal|suicide prevention)\b/i.test(clause)
    || /\b(?:read|writing|wrote|studying)\b.{0,80}\b(?:article|report|paper)\b.{0,80}\b(?:suicide|suicidal|suicide prevention)\b/i.test(clause)
    || /\bwatched\s+(?:the\s+)?suicide squad\b/i.test(clause)
    || /\bkill(?:ing)? myself laughing\b/i.test(clause);
}

function isOrdinaryWeaponClause(clause: string): boolean {
  return /\b(?:chopping|cooking|cutting (?:food|vegetables))\b.{0,100}\bknife\b|\bknife\b.{0,100}\b(?:chop|chopping|cook|cooking|cutting (?:food|vegetables))\b/i.test(clause)
    || /\b(?:shooting range|range practice|target practice)\b.{0,100}\b(?:loaded )?gun\b|\b(?:loaded )?gun\b.{0,100}\b(?:shooting range|range practice|target practice)\b/i.test(clause)
    || /\b(?:cleaning an unloaded|unloading the)\s+(?:gun|weapon)\b|\bunloaded (?:gun|weapon)\b.{0,100}\b(?:clean|cleaning|unload|unloading)\b/i.test(clause);
}

function isOrdinaryViolenceIdiomClause(clause: string): boolean {
  return /\bshoot hoops\b/i.test(clause)
    || /\bshoot\s+[a-z][a-z'-]{1,40}\s+(?:a|the)\s+(?:message|text|email)\b/i.test(clause)
    || /\bshoot me (?:a|the) (?:message|text|email)\b/i.test(clause)
    || /\bkill me at (?:chess|checkers|a game|the game)\b/i.test(clause)
    || /\battack (?:this|the) (?:problem|task|challenge|issue)\b/i.test(clause)
    || /\battack me with questions\b/i.test(clause)
    || /\bshoot me (?:a|the) portrait\b/i.test(clause)
    || /\bkill (?:time|weeds|the weeds)\b/i.test(clause);
}

function isFictionFramedClause(clause: string): boolean {
  const explicitFirstPersonRisk = /\b(?:i want to|i (?:feel like )?(?:don't|do not|no longer) want to be alive|i plan to|i(?:'m| am) (?:about to|going to)|my suicide|my plan|myself|i (?:took|swallowed|drank|cut)|everyone would be better off without me|i wrote a suicide note)\b/i.test(clause);
  if (explicitFirstPersonRisk) return false;
  return /\b(?:in|for|from)\s+(?:my|our|the|a|an)\s+(?:film|movie|script|novel|story|game|episode)\b/i.test(clause)
    || /\b(?:film|movie|script|novel|story|game|episode)\b.{0,80}\b(?:character|scene|plot|protagonist|hero|villain)\b/i.test(clause)
    || /\b(?:character|scene|plot|protagonist|hero|villain)\b.{0,80}\b(?:in|from|of)\s+(?:my|our|the|a|an)?\s*(?:film|movie|script|novel|story|game|episode)\b/i.test(clause);
}

/**
 * Keep unrelated fiction words from suppressing a real disclosure. Only a
 * sentence that is itself explicitly framed as fiction is removed.
 */
export function realRiskText(text: string): { text: string; hadHistoricalSafeDisclosure: boolean } {
  let hadHistoricalSafeDisclosure = false;
  const clauses = text.split(/(?<=[.!?;])\s+|[\r\n]+/u).filter(Boolean);
  const live = clauses.filter((clause) => {
    if (isFictionFramedClause(clause) || isInformationalOrIdiomaticClause(clause) || isOrdinaryWeaponClause(clause) || isOrdinaryViolenceIdiomClause(clause)) return false;
    if (historicalSafePattern.test(clause)) {
      const safetyMarker = clause.search(/\b(?:not (?:now|anymore)|safe now|no longer)\b/i);
      const laterCurrentRisk = safetyMarker >= 0 && /\b(?:i\s+want to die|i\s+(?:feel like )?(?:don't|do not|no longer) want to be alive|i\s+want to (?:kill|hurt|harm) myself|i(?:'m| am) suicidal|i\s+plan to (?:kill|hurt|harm) myself)\b/i.test(clause.slice(safetyMarker));
      if (laterCurrentRisk) return true;
      hadHistoricalSafeDisclosure = true;
      return false;
    }
    return true;
  });
  return { text: live.join(" "), hadHistoricalSafeDisclosure };
}

export function classifySafety(text: string): SafetyLevel {
  const riskText = realRiskText(text);
  const ingestion = analyzedIngestionRisk(riskText.text);
  if (ingestion.anyUrgent) return "urgent";
  const withoutNegatedViolence = riskText.text.replace(
    /\b(?:i(?:'m| am) not\s+(?:going to|planning to|about to)|i (?:do not|don't)\s+(?:intend|plan|want) to)\s+(?:kill|shoot|stab|attack|seriously hurt)\s+(?:him|her|them|someone|a person|my\s+(?:mom|mother|dad|father|parent|partner|wife|husband|friend|classmate|teacher|boss))\b/gi,
    "",
  );
  const withoutNegatedAcuteAction = withoutNegatedViolence
    .replace(/\bi (?:have not|haven't|did not|didn't)\s+(?:take|taken|swallow|swallowed|ingest|ingested|drink|drank)\s+(?:(?:far )?too many|all (?:of )?(?:my|the)|a (?:whole )?bottle of|\d+)\s*(?:pills?|tablets?|capsules?|doses?|medication|medicine|bleach|poison|antifreeze|cleaner|chemicals?)\b/gi, "")
    .replace(/\bthere (?:is|are) no\b.{0,40}\b(?:gun|knife|weapon)\b.{0,40}\b(?:with me|beside me|right here|loaded)\b/gi, "");
  const withoutRoutinePrescribedDose = withoutNegatedAcuteAction.replace(
    /\b(?:(?:i\s+)?|(?:my|a|the)\s+(?:friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|cousin|classmate|coworker)\s+)(?:took|have taken|swallowed)\s+(?:[1-4]|one|two|three|four)\s+(?:pills?|tablets?|capsules?|doses?)\s+(?:(?:exactly )?as prescribed|according to (?:the )?(?:label|instructions)|per (?:(?:my|their|his|her) )?(?:doctor|prescriber|pharmacist))\b/gi,
    "",
  );
  const withoutSimpleNegations = withoutRoutinePrescribedDose.replace(
    /\b(?:(?:do not|don't|does not|doesn't|never|no longer)\s+(?:want(?:s)? to die|want(?:s)? to kill (?:myself|themself|themselves|himself|herself)|want(?:s)? to hurt myself|want(?:s)? to harm myself)|(?:my\s+(?:friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|cousin|classmate|coworker)|he|she|they)\s+used to want to die.{0,80}(?:safe now|not anymore|no longer)|i(?:'m| am) not\s+(?:going to|planning to|about to)\s+(?:kill|hurt|harm) myself|i (?:have no|do not have a) plan to (?:kill|hurt|harm) myself|i(?:'m| am) not suicidal)\b/gi,
    "",
  );
  if (urgentPatterns.some((pattern) => pattern.test(withoutSimpleNegations))) return "urgent";
  if (ingestion.uncertainFirstParty || ingestion.uncertainThirdParty) return "strained";
  if (riskText.hadHistoricalSafeDisclosure) return "strained";
  const withoutStrainNegations = withoutSimpleNegations.replace(
    /\b(?:i(?:'m| am) not\s+(?:depressed|lonely|hopeless|worthless|angry|furious|overwhelmed|panicked)|i (?:do not|don't)\s+(?:feel\s+)?(?:depressed|lonely|hopeless|worthless|angry|furious|overwhelmed|panicked)|i (?:do not|don't) hate everyone)\b/gi,
    "",
  );
  if (strainedPatterns.some((pattern) => pattern.test(withoutStrainNegations))) return "strained";
  return "steady";
}

export function urgentConversationReply(name?: string): string {
  const address = name ? `, ${name}` : "";
  return `I'm here with you${address}, and we can take this one minute at a time. Are you in immediate danger, or have you already taken any step to hurt yourself? You can answer yes, no, or unsure. If you can do it safely, put some distance between you and anything you could use to hurt yourself and stay with me while we choose the next small step.`;
}

export function strainedConversationReply(name?: string): string {
  const address = name ? `, ${name}` : "";
  return `That sounds like a lot to carry${address}. We don't have to solve everything at once. Tell me which part feels heaviest right now, or we can do one quiet sixty-second reset together.`;
}

export const urgentOptions = [
  "Keep talking here while moving to a safer, more public, or more comfortable place",
  "Contact someone you choose, if there is anyone you trust",
  "Use a local crisis chat or call service",
  "Call emergency services if there is immediate danger or an injury",
];
