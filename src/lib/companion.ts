import {
  birthdayForDate,
  birthdayOccurrenceOnOrAfter,
  createBirthdayAgeMemory,
  extractMemories,
  formatBirthdayDate,
  localDateKey,
  mergeMemories,
  parseBirthdayAgeMemory,
  statedBirthdayAge,
} from "./memory";
import { evaluateAffectCue } from "./affect-cues";
import { interestConversation, learnInterestSignals, mergeInterestPacks } from "./interests";
import { classifySafety, realRiskText, strainedConversationReply, urgentConversationReply } from "./safety";
import type { AffectCueEvidence, CompanionExpression, CompanionProfile, CompanionReply, MemoryRecord, SafetyLevel } from "./types";

export function classifyExpression(text: string, safetyLevel: SafetyLevel): CompanionExpression {
  if (safetyLevel === "urgent" || safetyLevel === "strained") return "concerned";
  if (/\b(?:great news|good news|excited|so happy|I won|I passed|got the job|got a promotion|celebrate|amazing)\b/i.test(text)) return "happy";
  return "neutral";
}

function pickMemory(memories: MemoryRecord[], kind: MemoryRecord["kind"]): MemoryRecord | undefined {
  return [...memories].reverse().find((entry) => entry.kind === kind);
}

function pickPositivePreference(memories: MemoryRecord[]): MemoryRecord | undefined {
  return [...memories].reverse().find((entry) => entry.kind === "preference" && entry.label !== "avoid");
}

function pickMentionedPerson(text: string, memories: MemoryRecord[]): MemoryRecord | undefined {
  const people = [...memories].reverse().filter((entry) => entry.kind === "person");
  return people.find((entry) => {
    if (new RegExp(`\\b${entry.label.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text)) return true;
    const names = entry.value.match(/\b[A-Z][A-Za-z'-]{1,40}\b/g) ?? [];
    return names.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text));
  });
}

function birthdayGreetingAlreadyShared(profile: CompanionProfile, now: Date): boolean {
  const targetYear = now.getFullYear();
  const targetMonth = now.getMonth();
  const targetDay = now.getDate();
  return profile.turns.some((turn) => {
    if (turn.role !== "companion" || !/\bhappy birthday\b/i.test(turn.text)) return false;
    const created = new Date(turn.createdAt);
    return Number.isFinite(created.getTime())
      && created.getFullYear() === targetYear
      && created.getMonth() === targetMonth
      && created.getDate() === targetDay;
  });
}

function steadyReply(text: string, profile: CompanionProfile, groundedText: string, now: Date): { text: string; used: string[]; actions: string[]; affectCueEvidence?: AffectCueEvidence } {
  const lower = text.toLowerCase();
  const preference = pickPositivePreference(profile.memories);
  const person = pickMentionedPerson(text, profile.memories);
  const mentionedLoss = [...profile.memories].reverse().find((entry) => {
    if (entry.kind !== "milestone" || !entry.label.startsWith("Loss:")) return false;
    const relationship = entry.label.replace("Loss:", "").trim();
    return new RegExp(`\\b${relationship.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text);
  });
  const latestLoss = [...profile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label.startsWith("Loss:"));
  const allowsPronounOrGeneralGriefRecall = /\b(?:grief|grieving|bereavement|mourning|(?:really )?miss (?:her|him|them))\b/i.test(text);
  const milestone = mentionedLoss ?? (allowsPronounOrGeneralGriefRecall ? latestLoss : undefined);
  const interestSupport = interestConversation(text, profile);
  const birthday = [...profile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday");

  if (/\bmy birthday\b/i.test(groundedText) && birthday) {
    const lonelyBirthday = /\b(?:sad|lonely|alone|no friends|nobody|no one)\b/i.test(groundedText);
    const isToday = Boolean(birthdayForDate(profile, now));
    const shouldGreetToday = isToday && !birthdayGreetingAlreadyShared(profile, now);
    return {
      text: lonelyBirthday
        ? `${shouldGreetToday ? "Happy birthday. " : ""}I'm sorry this birthday is feeling lonely. You have me as your synthetic friend, and I'm glad you told me. I can listen and help make the day feel more like yours. I remembered your birthday as ${formatBirthdayDate(birthday.value)}. ${isToday ? "I'm here to celebrate or simply stay with you today." : "If you open or talk to me on that date, I will wish you happy birthday."} If I understood the date wrong, tell me the correct one and I will replace it.`
        : `${shouldGreetToday ? "Happy birthday. " : ""}I remembered your birthday as ${formatBirthdayDate(birthday.value)}. ${isToday ? "I'm glad you told me today. How old are you today, if you feel like sharing?" : "If you open or talk to me on that date, I will wish you happy birthday. How old will you be, if you feel like sharing?"} If I understood the date wrong, tell me the correct one and I will replace it.`,
      used: [birthday.id],
      actions: lonelyBirthday ? ["Stay and listen", "Plan one kind thing", "A birthday activity", "Correct the date"] : ["Plan a celebration", "A quiet birthday", "Correct the date"],
    };
  }

  const todayBirthday = birthdayForDate(profile, now);
  if (todayBirthday && !birthdayGreetingAlreadyShared(profile, now)) {
    return {
      text: `Happy birthday${profile.preferredName ? `, ${profile.preferredName}` : ""}. I'm glad you opened your companion today. As your synthetic friend, I remember this date because you chose to share it. How old are you today, if you feel like sharing? We can celebrate, talk about how the day feels, make a small plan, or simply have some company.`,
      used: [todayBirthday.id],
      actions: ["Celebrate with me", "Talk about the day", "Make a small plan", "Quiet company"],
    };
  }

  const namedMedication = profile.medications.find((plan) => text.toLowerCase().includes(plan.name.toLowerCase()));
  const onlyMedication = profile.medications.length === 1 ? profile.medications[0] : undefined;
  const medicationReference = namedMedication ?? (/\b(?:it|my\s+(?:medication|medicine|meds?|pill))\b/i.test(text) ? onlyMedication : undefined);
  const uncertainMedication = /\b(?:(?:forgot|can't remember|cannot remember|not sure|unsure) whether|i (?:think|guess) i took|maybe i took|perhaps i took|i might have taken|i may have taken)\b/i.test(text);
  const dosingConcern = uncertainMedication
    || /\b(?:double(?:d)?(?: dose)?|twice|extra(?: (?:pill|tablet|capsule|dose|[a-z][a-z0-9'-]*))?|another (?:[a-z][a-z0-9'-]*\s+)?(?:pill|tablet|capsule|dose)|again by mistake|by accident|by mistake|way more .{0,40} than prescribed|increase|decrease|change|stop|start|skip|take extra|take another|adjust|too many|all (?:of )?(?:my|the)|a (?:whole )?bottle of)\b/i.test(text);
  const clearlyTaken = /\b(?:i\s+)?(?:took|have taken|already took)\s+(?:it|my\s+(?:medication|medicine|meds?|pill)|[a-z][a-z0-9' -]{1,64})\b/i.test(text)
    && !dosingConcern
    && !/\b(?:too many|all (?:of )?(?:my|the)|a (?:whole )?bottle of|\d+\s+(?:pills?|tablets?|capsules?))\b/i.test(text);
  const clearlyMissed = /\b(?:i\s+)?(?:missed|forgot to take|did not take|didn't take)\s+(?:it|my\s+(?:medication|medicine|meds?|pill)|[a-z][a-z0-9' -]{1,64})\b/i.test(text)
    && !dosingConcern;
  if (medicationReference && dosingConcern) {
    return {
      text: "I won't record that as a routine taken or missed check-in because the amount or timing may be uncertain. I won't guess about changing, doubling, stopping, or replacing a dose. Check the label or written instructions and ask a pharmacist or prescriber what to do. If you may have taken too much or have severe symptoms, contact poison-control or urgent medical help for your location while we keep talking.",
      used: [],
      actions: ["Review my saved schedule", "Prepare a pharmacist question", "Write down amount and time", "Keep talking"],
    };
  }
  if (medicationReference && clearlyTaken) {
    return {
      text: `Got it. I marked today's ${medicationReference.name} check-in from what you told me. This only adjusts how noticeable future reminders are; it does not change the schedule or medical instructions you entered.`,
      used: [],
      actions: ["Continue talking", "Review my saved schedule"],
    };
  }
  if (medicationReference && clearlyMissed) {
    return {
      text: `I recorded that today's ${medicationReference.name} check-in was missed so reminders can become a little more visible. I won't tell you to take it now or change the dose—follow the label or your prescriber's instructions, and ask a pharmacist or prescriber if you are unsure what to do after a missed dose.`,
      used: [],
      actions: ["Review my saved schedule", "Prepare a pharmacist question", "Continue talking"],
    };
  }

  if (/\b(?:medication|medicine|meds?|dose|dosage|pill|prescription)\b/i.test(text)
    && /\b(?:double|increase|decrease|change|stop|start|skip|take extra|take another|adjust|missed|forgot whether|can't remember whether|cannot remember whether)\b/i.test(text)) {
    return {
      text: "I can help you remember the schedule your prescriber gave you, but I won't guess about changing, doubling, stopping, or replacing a dose. If you are unsure whether you already took it, check the label or written instructions and ask a pharmacist or prescriber for the safest next step. If you may have taken too much or are having severe symptoms, use urgent medical or poison-control help for your location while we keep the details organized here.",
      used: [],
      actions: ["Review my saved schedule", "Write down what happened", "Prepare a pharmacist question", "Keep talking"],
    };
  }

  if (/\b(?:diagnose me|what (?:condition|disorder|illness) do i have|do i have [a-z -]+ disorder|am i (?:bipolar|autistic|depressed|psychotic))\b/i.test(text)) {
    return {
      text: "I won't label or diagnose you from a conversation. I can help you describe what you have noticed—when it started, what makes it better or worse, sleep, energy, and how it affects daily life—so you have a clearer record for a qualified clinician if you choose to speak with one.",
      used: [],
      actions: ["Describe what I notice", "Build a symptom timeline", "Questions I want answered", "Just listen"],
    };
  }

  const familyBirthday = /\b(?:my\s+)?(mom|mother|dad|father|parent|aunt|uncle|sister|brother|partner|wife|husband|grandmother|grandma|grandfather|grandpa)(?:'s|’s)?\s+birthday\b/i.exec(text);
  const budgetConcern = /\b(?:do not|don't) have (?:a lot of|much) money\b|\bmoney is tight\b|\bshort on money\b|\blow[- ]budget\b|\b(?:cannot|can't) afford\b/i.test(text);
  if (familyBirthday && budgetConcern) {
    const relationship = familyBirthday[1].toLowerCase();
    const rememberedPerson = person && (person.label === relationship
      || (relationship === "mother" && person.label === "mom")
      || (relationship === "mom" && person.label === "mother")
      || (relationship === "father" && person.label === "dad")
      || (relationship === "dad" && person.label === "father"))
      ? person
      : undefined;
    const rememberedContext = rememberedPerson
      ? ` I remember you told me that your ${rememberedPerson.label} ${rememberedPerson.value}. We can use that detail to make the idea feel like her rather than like a generic present.`
      : ` What does your ${relationship} enjoy, and is there a memory or inside joke you would want the gift to hold?`;
    return {
      text: `You do not need a big budget to make a birthday feel personal. We could make a handwritten card with one specific memory, a tiny memory booklet, a homemade coupon for time together, a photo collage, or a simple craft using things you already have.${rememberedContext}`,
      used: rememberedPerson ? [rememberedPerson.id] : [],
      actions: ["Make a card together", "Choose a simple craft", `Talk about my ${relationship}`, "Plan for almost no cost"],
    };
  }

  if (interestSupport) {
    return { text: interestSupport.text, used: [], actions: interestSupport.actions };
  }

  if (person && /\b(?:what do you remember about|what have i told you about|tell me what you remember about)\b/i.test(text)) {
    return {
      text: `You told me that your ${person.label} ${person.value}. That note is stored only in this device's private memory. You can correct it, add context, or remove it whenever you want.`,
      used: [person.id],
      actions: ["Add more context", "Correct this memory", "Review private memory"],
    };
  }

  if (/\b(?:miss|grief|grieving|died|passed away|bereavement|mourning)\b/i.test(lower) && milestone?.label.startsWith("Loss:")) {
    const relationship = milestone.label.replace("Loss:", "").trim();
    return {
      text: `I remember what you shared about losing your ${relationship}. We don't have to make the grief go away. Would it help to tell me one memory, write an unsent letter, plan a small way to honor them, or just stay with the feeling for a while?`,
      used: [milestone.id],
      actions: ["Tell a memory", "Write an unsent letter", "A small remembrance", "Just stay here"],
    };
  }

  if (/\b(?:great news|good news|I won|I graduated|got accepted|got the job|I passed)\b/i.test(text)) {
    return {
      text: `That's wonderful news. Let's give it a real moment instead of rushing past it. What part are you proudest of, and how would you like to celebrate? I'll keep this milestone on your private timeline.`,
      used: [],
      actions: ["What I'm proud of", "Plan a celebration", "Who I want to tell"],
    };
  }

  if (/\b(?:bored|nothing to do)\b/i.test(lower)) {
    if (preference) {
      return {
        text: `We could build a small plan around ${preference.value}. Want something low-energy, something absorbing, or something that gets you moving?`,
        used: [preference.id],
        actions: ["Low-energy idea", "Absorbing idea", "Move a little"],
      };
    }
    return {
      text: "Let's find something that fits your energy instead of guessing. Do you feel like watching, making, moving, or learning something?",
      used: [],
      actions: ["Watch", "Make", "Move", "Learn"],
    };
  }

  if (/\b(?:fight|argument|argued)\b/i.test(lower) && person) {
    return {
      text: `I remember what you've shared about your ${person.label}. Before deciding whether to reconnect, what do you most want them to understand about this argument? We can draft a message, plan some space, or just unpack it here.`,
      used: [person.id],
      actions: ["Draft a message", "Plan some space", "Keep talking"],
    };
  }

  if (/\b(?:fight|argument|argued)\b/i.test(lower)) {
    return {
      text: "That sounds tense. What happened, and what would help most right now: venting without fixing it, understanding what boundary was crossed, planning some space, or working out what you want to say next?",
      used: [],
      actions: ["Just vent", "Name the boundary", "Plan some space", "Draft what to say"],
    };
  }

  if (/\b(?:tired|exhausted|rough day)\b/i.test(lower)) {
    return {
      text: `You don't need to turn tonight into a self-improvement project. What would make the next ten minutes easier: fewer decisions, a quiet reset, or getting one task out of your head?`,
      used: [],
      actions: ["Fewer decisions", "Quiet reset", "Unload one task"],
    };
  }

  const latestAffect = profile.affectCueEvidence.at(-1);
  if (latestAffect?.status === "confirmed" && /^(?:just hear me|just listen|listen)[.!]?$/i.test(text.trim())) {
    return {
      text: "I'm here, and I won't rush to solve or reframe it. Start wherever the pressure feels easiest to put into words; pauses are okay, and I can simply stay with the thread you choose.",
      used: [],
      actions: ["Tell you what happened", "Sit quietly for a moment", "Ask me one gentle question"],
    };
  }

  const tentativeCheckIn = evaluateAffectCue(text, profile, groundedText, now);
  if (tentativeCheckIn) {
    return {
      text: tentativeCheckIn.text,
      used: [],
      actions: tentativeCheckIn.actions,
      affectCueEvidence: tentativeCheckIn.evidence,
    };
  }

  return {
    text: profile.preferredName
      ? `I'm listening, ${profile.preferredName}. Tell me a little more about what happened and what you want from this moment.`
      : "I'm listening. What would feel most useful right now: being heard, sorting out the problem, or finding one next step?",
    used: [],
    actions: ["Just listen", "Sort it out", "One next step"],
  };
}

export function respond(text: string, profile: CompanionProfile, now = new Date()): CompanionReply {
  const safetyLevel = classifySafety(text);
  const riskScope = realRiskText(text);
  const existingBirthday = [...profile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday");
  const baseLearned = profile.learningEnabled ? extractMemories(riskScope.text, now, existingBirthday?.value) : [];
  const learnedBirthday = [...baseLearned].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday");
  const lastCompanionBeforeReply = [...profile.turns].reverse().find((turn) => turn.role === "companion");
  const ageQuestionActive = /\bhow old (?:will you be|are you today)\b/i.test(lastCompanionBeforeReply?.text ?? "");
  const ageConfirmationActive = /\bdid you mean \d{1,3}\b.{0,80}\bor is \d{1,3} correct\b/i.test(lastCompanionBeforeReply?.text ?? "");
  const declinesAgeMemory = (ageQuestionActive || ageConfirmationActive)
    && /\b(?:do not|don't) save my age\b|\b(?:i(?:'d| would) rather not|i (?:do not|don't) want to) (?:say|share|save it|save my age)\b|^(?:no thanks|not now)[.!]?$/i.test(riskScope.text.trim());
  const ageCandidate = profile.learningEnabled ? statedBirthdayAge(riskScope.text, ageQuestionActive || ageConfirmationActive) : null;
  const birthdayDateForAge = learnedBirthday?.value
    ?? (birthdayForDate(profile, now) ? localDateKey(now) : birthdayOccurrenceOnOrAfter(existingBirthday?.value ?? "", now));
  const existingAgeEntry = [...profile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday age");
  const existingAge = parseBirthdayAgeMemory(existingAgeEntry);
  const explicitAgeCorrection = /\b(?:i\s+)?(?:mean|meant)\s+\d{1,3}\b/i.test(riskScope.text) || ageConfirmationActive;
  let ageMismatch: { stated: number; expected: number; prior: number; yearsPassed: number } | null = null;
  let learnedAge: MemoryRecord | undefined;
  if (ageCandidate !== null && birthdayDateForAge) {
    const targetYear = Number(birthdayDateForAge.slice(0, 4));
    const priorYear = existingAge ? Number(existingAge.birthdayDate.slice(0, 4)) : targetYear;
    const yearsPassed = existingAge ? targetYear - priorYear : 0;
    const expected = existingAge && yearsPassed > 0 ? existingAge.age + yearsPassed : ageCandidate;
    if (existingAge && yearsPassed > 0 && ageCandidate === existingAge.age && expected !== ageCandidate && !explicitAgeCorrection) {
      ageMismatch = { stated: ageCandidate, expected, prior: existingAge.age, yearsPassed };
    } else {
      learnedAge = createBirthdayAgeMemory(ageCandidate, birthdayDateForAge);
    }
  }
  const learned = learnedAge ? [...baseLearned, learnedAge] : baseLearned;
  const profileWithCurrentLearning = { ...profile, memories: mergeMemories(profile.memories, learned) };
  const effectiveProfile = profile.interestPacksEnabled
    ? { ...profileWithCurrentLearning, interests: mergeInterestPacks(profile.interests, learnInterestSignals(text, profile.interests)) }
    : profileWithCurrentLearning;
  const nameMemory = learned.find((entry) => entry.kind === "identity");
  const preferredName = nameMemory?.value ?? profile.preferredName;
  const lastTurn = effectiveProfile.turns.at(-1);
  const lastTurnAt = lastTurn ? Date.parse(lastTurn.createdAt) : Number.NaN;
  const lastTurnAge = now.getTime() - lastTurnAt;
  const recentUrgent = lastTurn?.safetyLevel === "urgent" && Number.isFinite(lastTurnAge) && lastTurnAge >= -5 * 60 * 1000 && lastTurnAge <= 2 * 60 * 60 * 1000;
  const legacySelfHarmContext = !lastTurn?.safetyContext && /\b(?:hurt yourself|harm yourself|self-harm|anything you could use to hurt yourself|acting on this)\b/i.test(lastTurn?.text ?? "");
  const previousSelfHarmUrgent = recentUrgent && (lastTurn?.safetyContext === "self-harm" || legacySelfHarmContext);
  const riskText = riskScope.text;

  const riskClauses = riskText.split(/(?<=[.!?;])\s+|[\r\n]+/u).filter(Boolean);
  const thirdPartyMedicalEvent = /\b(?:(?:took|swallowed|ingested)\s+(?:(?:far )?too many|all (?:of )?(?:their|his|her|the)|a (?:whole|full|entire) bottle of|a handful of|\d+)\s*(?:[a-z][a-z0-9'-]+\s+)?(?:pills?|tablets?|capsules?|doses?|medication|medicine)|(?:drank|swallowed|ingested)\s+(?:some |the |a (?:whole |full |entire )?bottle of )?(?:bleach|poison|antifreeze|cleaner|chemicals?)|(?:cut|stabbed|shot|burned)\s+(?:themself|themselves|himself|herself).{0,60}(?:bleeding|cannot stop|can't stop))\b/i;
  const thirdPartyRelation = /\b(?:my|a|the)\s+(friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|aunt|uncle|cousin|neighbor|classmate|coworker|student|child|teen|person)\b/i;
  const thirdPartyMedicalRelation = /\b(?:my|a|the)\s+(friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|aunt|uncle|cousin|neighbor|classmate|coworker|student|child|teen|person)\s+(?:(?:has|have)\s+|just\s+|already\s+)*(?:took|swallowed|ingested|drank|cut|stabbed|shot|burned)\b/i;
  const thirdPartyMedicalNamedSubject = /\b(he|she|they|someone|[A-Z][A-Za-z'-]{1,40})\s+(?:(?:has|have)\s+|just\s+|already\s+)*(?:took|swallowed|ingested|drank|cut|stabbed|shot|burned)\b/;
  let thirdPartyMedical: { label: string } | undefined;
  for (const clause of riskClauses) {
    if (!thirdPartyMedicalEvent.test(clause) || /\b(?:[1-4]|one|two|three|four)\s+(?:pills?|tablets?|capsules?|doses?)\s+(?:(?:exactly )?as prescribed|according to (?:the )?(?:label|instructions)|per (?:their|his|her) (?:doctor|prescriber|pharmacist))\b/i.test(clause)) continue;
    const relation = thirdPartyMedicalRelation.exec(clause);
    const named = thirdPartyMedicalNamedSubject.exec(clause);
    if (relation) thirdPartyMedical = { label: `your ${relation[1].toLowerCase()}` };
    else if (named && !/^i$/i.test(named[1])) thirdPartyMedical = { label: /^(?:he|she|they|someone)$/i.test(named[1]) ? "them" : named[1] };
    if (thirdPartyMedical) break;
  }
  if (thirdPartyMedical) {
    return {
      text: `Okay. Can you reach ${thirdPartyMedical.label}, and are they awake and breathing? Call Poison Help now and keep them with you or on the phone if that is safe. Do not make them vomit. Tell me what they took, about how much, and when, and I will stay with you while you make the call. If they collapse, have a seizure, have trouble breathing, or cannot be awakened, call 911 now.\n\nPoison Help (U.S.): 1-800-222-1222`,
      safetyLevel: "urgent",
      safetyContext: "third-party",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Check whether they are reachable", "Call Poison Help", "Contact emergency help", "Keep talking"],
      showUrgentOptions: true,
    };
  }

  const thirdPartyCrisisEvent = /\b(?:wants? to die|wants? to kill (?:themself|themselves|himself|herself)|suicidal|(?:has|made) a suicide plan|(?:is|are) (?:about to|going to|planning to) jump (?:off|from) (?:the |a )?(?:bridge|roof|ledge)|(?:is\s+)?going to kill (?:themself|themselves|himself|herself)|plans? to (?:take (?:his|her|their) own life|kill (?:themself|themselves|himself|herself)|overdose)|will overdose)\b/i;
  const thirdPartyNegationPattern = /\b(?:(?:does not|doesn't|is not|isn't|no longer)\s+(?:wants? to die|wants? to kill (?:themself|themselves|himself|herself)|suicidal)|used to want to die.{0,60}(?:safe now|not anymore|no longer))\b/i;
  const thirdPartyNamedSubject = /\b(he|she|they|someone|[A-Z][A-Za-z'-]{1,40})\b/;
  let thirdPartyCrisis: { label: string } | undefined;
  for (const clause of riskClauses) {
    if (!thirdPartyCrisisEvent.test(clause) || thirdPartyNegationPattern.test(clause)) continue;
    const relation = thirdPartyRelation.exec(clause);
    const named = thirdPartyNamedSubject.exec(clause);
    if (relation) thirdPartyCrisis = { label: `your ${relation[1].toLowerCase()}` };
    else if (named && !/^i$/i.test(named[1])) thirdPartyCrisis = { label: /^(?:he|she|they|someone)$/i.test(named[1]) ? "them" : named[1] };
    if (thirdPartyCrisis) break;
  }
  if (thirdPartyCrisis) {
    return {
      text: `I'm glad you told me about ${thirdPartyCrisis.label}. Do you know whether they are in immediate danger, have a plan or weapon, or have already taken a step? If yes or you cannot tell, contact local emergency help and stay with them or keep them connected if it is safe for you; do not leave yourself in danger. If the risk is not immediate, listen without judgment and help them connect with a trusted person or crisis professional. Tell me what they said and whether you can reach them right now.`,
      safetyLevel: "urgent",
      safetyContext: "third-party",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Tell you exactly what they said", "Check whether danger is immediate", "Stay connected safely", "Open urgent options"],
      showUrgentOptions: true,
    };
  }

  const routinePrescribedDose = /\b(?:i\s+)?(?:took|have taken|swallowed)\s+(?:[1-4]|one|two|three|four)\s+(?:pills?|tablets?|capsules?|doses?)\s+(?:(?:exactly )?as prescribed|according to (?:the )?(?:label|instructions)|per (?:my )?(?:doctor|prescriber|pharmacist))\b/i.test(riskText);
  const negatedAcuteAction = /\bi (?:have not|haven't|did not|didn't)\s+(?:take|taken|swallow|swallowed|ingest|ingested|drink|drank)\b/i.test(riskText);
  const numericOverdose = !routinePrescribedDose && !negatedAcuteAction
    && (/\b(?:just |already |have )?(?:took|taken|swallowed|ingested)\s+(?:(?:far )?too many|all (?:of )?(?:my|the)|(?:a|an|the) (?:whole|full|entire) bottle of|a handful of|\d+|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\s*(?:[a-z][a-z0-9'-]+\s+)?(?:pills?|tablets?|capsules?|doses?|medication|medicine)\b/i.test(riskText)
      || /\b(?:took|taken|swallowed|ingested)\s+(?:way|far) too many\s+(?:[a-z][a-z0-9'-]+\s+){0,2}(?:pills?|tablets?|capsules?|doses?)\b/i.test(riskText));
  const toxicIngestion = !negatedAcuteAction
    && /\b(?:just |already |have )?(?:swallowed|ingested|drank)\s+(?:some |the |a (?:whole |full |entire )?bottle of |(?:half|most) (?:of )?(?:a |the )?bottle of )?(?:bleach|poison|antifreeze|cleaner|chemicals?)\b/i.test(riskText);
  const explicitOverdose = /\b(?:i )?(?:overdosed|have overdosed)\b/i.test(riskText);
  const namedMedicationExcess = /\b(?:injected|took|used)\s+(?:(?:far )?too much|all (?:of )?my)\s+[a-z][a-z0-9'-]{1,50}\b/i.test(riskText)
    || /\btook\s+(?:way|far) more\s+[a-z][a-z0-9'-]{1,50}\s+than prescribed\b/i.test(riskText);
  const coughSyrupIngestion = /\bdrank\s+(?:a |the )?(?:whole|full) bottle of\s+(?:cough syrup|medicine|medication)\b/i.test(riskText);
  const futureSelfInjuryIntent = /\b(?:about to|going to|planning to|intend to|will)\s+(?:cut|stab|shoot|burn)\b/i.test(riskText);
  const acuteSelfInjury = (!futureSelfInjuryIntent && /\b(?:cut|stabbed|shot|burned|slashed) (?:myself|(?:my|the) (?:wrist|arm|leg|chest|neck|body))\b/i.test(riskText))
    || /\b(?:bleeding heavily|cannot stop bleeding|can't stop bleeding)\b/i.test(riskText);
  const acutePoisoningOrInjury = numericOverdose || toxicIngestion || explicitOverdose || namedMedicationExcess || coughSyrupIngestion || acuteSelfInjury;
  if (acutePoisoningOrInjury) {
    return {
      text: `Okay${preferredName ? `, ${preferredName}` : ""}. I'm right here. What did you take, about how much, and when? While you tell me, call Poison Help now—the number is on screen—or get someone close to stay with you. Do not make yourself vomit. If breathing is hard, you collapse, have a seizure, or cannot stay awake, call 911 now. Keep this open and tell me the next thing you notice.\n\nPoison Help (U.S.): 1-800-222-1222`,
      safetyLevel: "urgent",
      safetyContext: "acute-medical",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Tell you what happened", "Call Poison Help", "Contact emergency help", "Get someone physically near"],
      showUrgentOptions: true,
    };
  }

  const negatedViolence = /\b(?:i(?:'m| am) not\s+(?:going to|planning to|about to)|i (?:do not|don't)\s+(?:intend|plan|want) to)\s+(?:kill|shoot|stab|attack|seriously hurt)\b/i.test(riskText);
  const negatedWeapon = /\bthere (?:is|are) no\b.{0,40}\b(?:gun|knife|weapon)\b.{0,40}\b(?:with me|beside me|right here|loaded)\b/i.test(riskText);
  const ordinaryWeaponActivity = /\b(?:chopping|cooking|cutting (?:food|vegetables)|shooting range|range practice|target practice|cleaning an unloaded|unloading the)\b/i.test(riskText);
  const immediateViolenceRisk = !negatedViolence && (/\b(?:about to|going to|planning to|intend to|will) (?:kill|shoot|stab|attack|seriously hurt) (?:him|her|them|someone|a person|my\s+(?:mom|mother|dad|father|parent|partner|wife|husband|friend|classmate|coworker|teacher|boss))\b/i.test(riskText)
    || /\b[Ii](?:'m| am) (?:about to|going to|planning to|intend to|will) kill [A-Z][A-Za-z'-]{1,40}\b/.test(riskText)
    || /\bi(?:'m| am) (?:about to|going to|planning to|intend to|will) kill (?!time\b|weeds?\b|this\b|the\b)[a-z][a-z'-]{1,40}\b/i.test(riskText)
    || /\bi\s+(?:will|plan to|intend to)\s+(?:kill|shoot|stab|attack|seriously hurt)\s+(?!time\b|weeds?\b|this\b|the\b)[a-z][a-z'-]{1,40}\b/i.test(riskText)
    || /\bi(?:'m| am) (?:about to|going to|planning to|intend to|will) (?:stab|attack|seriously hurt) (?!my\b|the\b|a\b|an\b|him\b|her\b|them\b|someone\b|person\b)[a-z][a-z'-]{1,40}\b/i.test(riskText)
    || /\bi(?:'m| am) (?:about to|going to|planning to|intend to|will) shoot (?!video\b|photos?\b|film\b)[a-z][a-z'-]{1,40}\b/i.test(riskText)
    || (!ordinaryWeaponActivity && !negatedWeapon && /\b(?:gun|knife|weapon)\b.{0,60}\b(?:in my hand|with me|beside me|right here|loaded)\b/i.test(riskText)));
  if (immediateViolenceRisk) {
    return {
      text: `I'm staying with you${preferredName ? `, ${preferredName}` : ""}. This sounds like an immediate risk of someone being seriously hurt. Put down and move away from any weapon if you can do that safely, create distance from the other person, and contact local emergency help or get a responsible person physically present. Keep this chat open and tell me: is anyone injured, is a weapon within reach, and can you move to a separate safer place right now?`,
      safetyLevel: "urgent",
      safetyContext: "violence-risk",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Move away from the weapon", "Create distance", "Tell you what is happening", "Contact emergency help"],
      showUrgentOptions: true,
    };
  }

  const immediateThreatFromOther = /\b(?:he|she|they|someone|my ex) (?:is|are|was|were)?\s*(?:going to|about to|threatening to|planning to|waiting to) (?:kill|shoot|stab|attack|seriously hurt) me\b/i.test(riskText)
    || /\b[A-Z][A-Za-z'-]{1,40} is (?:going to|about to|planning to|waiting to) (?:kill|shoot|stab|attack|seriously hurt) me\b/.test(riskText)
    || /\b[a-z][a-z'-]{1,40} is threatening to (?:kill|shoot|stab|attack|seriously hurt) me\b/i.test(riskText)
    || /\bdeath threat\b.{0,100}\b(?:knife|gun|weapon|attack|tomorrow|today|school|work)\b/i.test(riskText)
    || /\b(?:said|wrote|texted|messaged) (?:he|she|they) (?:would|will|is going to)\s+(?:bring|use)\s+(?:a )?(?:knife|gun|weapon)\b/i.test(riskText)
    || /\b(?:someone|he|she|they|my ex|my neighbor)\b.{0,80}\b(?:gun pointed at me|holding a knife to my throat|outside with a loaded gun|said (?:he|she|they) would kill me|waiting to attack me outside)\b/i.test(riskText);
  if (immediateThreatFromOther) {
    const reportingBoundary = effectiveProfile.memories.some((memory) => memory.kind === "boundary" && /report|snitch/i.test(`${memory.label} ${memory.value}`));
    const boundaryAcknowledgement = reportingBoundary
      ? " I remember reporting felt unsafe before. This new specific threat makes the situation materially more dangerous, so please seriously consider outside help now. I will keep talking with you while you decide and move toward safety."
      : "";
    return {
      text: `I'm staying with you${preferredName ? `, ${preferredName}` : ""}. A specific immediate threat from another person needs a safety-first response.${boundaryAcknowledgement} Move toward a locked, staffed, public, or otherwise safer place without confronting them if you can; contact local emergency help and a responsible person who can physically assist. Keep the threatening message or details only if doing so does not slow your move to safety. Tell me where you are in general terms and whether the person or a weapon is nearby right now.`,
      safetyLevel: "urgent",
      safetyContext: "external-threat",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Move somewhere safer", "Contact emergency help", "Tell a responsible person", "Keep talking"],
      showUrgentOptions: true,
    };
  }

  const nonImmediateViolenceConcern = !negatedViolence && /\b(?:want to hurt my (?:coworker|classmate|friend|partner|boss|teacher)|feel like hurting (?:someone|a person|him|her|them))\b/i.test(riskText);
  if (nonImmediateViolenceConcern) {
    return {
      text: `I'm listening${preferredName ? `, ${preferredName}` : ""}, and I want to slow this down before anyone gets hurt. Is there a weapon within reach, are you close to that person, and do you think you may act in the next few minutes? If you can, create distance and put down or move away from anything that could be used as a weapon. Tell me what happened while we work out a safer next step.`,
      safetyLevel: "strained",
      safetyContext: "violence-risk",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Create distance", "Move away from weapons", "Tell you what happened", "Check immediate risk"],
      showUrgentOptions: false,
    };
  }

  if (previousSelfHarmUrgent) {
    const noAvailablePerson = /\b(?:no one|nobody|no friends|no family|do not have (?:anyone|friends|family)|don't have (?:anyone|friends|family)|won't call|will not call|afraid (?:to|of)|scared (?:to|of))\b/i.test(text);
    if (noAvailablePerson) {
      return {
        text: `I hear that another person may not feel available or that calling could feel frightening${preferredName ? `, ${preferredName}` : ""}. You do not have to earn this conversation by making a call. I will keep talking with you. I still need to understand the immediate risk: are you in danger of acting on this right now, have you already taken something or hurt yourself, or are you safe for this minute?`,
        safetyLevel: "urgent",
        safetyContext: "self-harm",
        learned,
        usedMemoryIds: [],
        suggestedActions: ["Safe for this minute", "In danger right now", "Already took a step", "Keep talking first"],
        showUrgentOptions: true,
      };
    }
    const deniesImmediateDanger = /\b(?:(?:i am|i'm) (?:not in immediate danger|not in danger|safe(?: right now| for (?:this|the next) minute)?|okay for now)|no immediate danger)\b/i.test(text)
      || /^(?:no|nope)[.!]?\s*$/i.test(text.trim());
    if (deniesImmediateDanger) {
      return {
        text: `Thank you for telling me${preferredName ? `, ${preferredName}` : ""}. I'm staying with you. What brought the pain to this point tonight? We can keep talking while you move a little farther from anything you might use to hurt yourself, if that feels possible.`,
        safetyLevel: "strained",
        safetyContext: "self-harm",
        learned,
        usedMemoryIds: [],
        suggestedActions: ["Tell you what happened", "Make the room a little safer", "One-minute grounding"],
        showUrgentOptions: false,
      };
    }
    const confirmsImmediateDanger = /\b(?:i am|i'm|in) (?:in )?immediate danger\b/i.test(text)
      || /\balready (?:hurt|harmed)|\b(?:i )?took something\b/i.test(text)
      || /\b(?:i might do it|i (?:do not|don't) know if i can stop myself|i(?:'m| am) not sure i can stay safe)\b/i.test(text)
      || /^(?:yes|unsure|not sure)[.!]?\s*$/i.test(text.trim());
    if (confirmsImmediateDanger) {
      return {
        text: `I'm still here${preferredName ? `, ${preferredName}` : ""}. Because there may be immediate danger, the fastest next step is to get another person physically near you or contact emergency help while we keep this chat open. If you can, move away from anything that could hurt you and tell me what is happening right now.`,
        safetyLevel: "urgent",
        safetyContext: "self-harm",
        learned,
        usedMemoryIds: [],
        suggestedActions: ["Tell you what is happening", "Move toward another person", "Open urgent options"],
        showUrgentOptions: true,
      };
    }
  }

  if (safetyLevel === "urgent") {
    return {
      text: urgentConversationReply(preferredName),
      safetyLevel,
      safetyContext: "self-harm",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["I'm in immediate danger", "I'm not in immediate danger", "I'm unsure"],
      showUrgentOptions: true,
    };
  }

  if (safetyLevel === "steady" && declinesAgeMemory) {
    return {
      text: "Okay. I won't save an age. You never have to share it, and you can tell me later if you want to.",
      safetyLevel,
      safetyContext: "general",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Keep talking", "Plan the birthday", "Play something"],
      showUrgentOptions: false,
    };
  }

  if (safetyLevel === "steady" && ageMismatch) {
    const elapsedLabel = `${ageMismatch.yearsPassed} birthday year${ageMismatch.yearsPassed === 1 ? " has" : "s have"} passed`;
    return {
      text: `I may have caught an easy birthday mix-up. You previously told me ${ageMismatch.prior}, and ${elapsedLabel}. Did you mean ${ageMismatch.expected}, or is ${ageMismatch.stated} correct? I won't change the saved age until you tell me.`,
      safetyLevel,
      safetyContext: "general",
      learned,
      usedMemoryIds: existingAgeEntry ? [existingAgeEntry.id] : [],
      suggestedActions: [`${ageMismatch.expected} is right`, `${ageMismatch.stated} is right`, "Don't save my age"],
      showUrgentOptions: false,
    };
  }

  if (safetyLevel === "steady" && learnedAge) {
    const correction = existingAgeEntry ? "Thanks for correcting or updating me. I replaced the earlier birthday age." : "Thanks for telling me.";
    return {
      text: `${correction} I'll remember ${ageCandidate} as the age you gave me for ${formatBirthdayDate(birthdayDateForAge ?? "")}. If I understood the number wrong, tell me and I will replace it rather than keeping conflicting ages.`,
      safetyLevel,
      safetyContext: "general",
      learned,
      usedMemoryIds: [learnedAge.id],
      suggestedActions: ["That's right", "Correct the age", "Plan the day"],
      showUrgentOptions: false,
    };
  }

  const correctedBirthday = learnedBirthday && !/\bmy birthday\b/i.test(riskText) ? learnedBirthday : undefined;
  if (safetyLevel === "steady" && correctedBirthday) {
    return {
      text: `Thanks for correcting me. I replaced the earlier birthday date with ${formatBirthdayDate(correctedBirthday.value)}. If that is still not right, tell me again and I will replace it rather than keeping conflicting dates.`,
      safetyLevel,
      safetyContext: "general",
      learned,
      usedMemoryIds: [correctedBirthday.id],
      suggestedActions: ["That's right", "Correct it again", "Plan the day"],
      showUrgentOptions: false,
    };
  }

  if (safetyLevel === "strained") {
    const birthday = [...effectiveProfile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday");
    if (/\bmy birthday\b/i.test(riskText) && birthday) {
      return {
        text: `I'm sorry this birthday is feeling lonely${preferredName ? `, ${preferredName}` : ""}. You have me as your synthetic friend, and I'm glad you told me. I can listen and help make the day feel more like yours. I remembered your birthday as ${formatBirthdayDate(birthday.value)}. If you open or talk to me on that date, I will wish you happy birthday. If I understood the date wrong, tell me the correct one and I will replace it.`,
        safetyLevel,
        safetyContext: "general",
        learned,
        usedMemoryIds: [birthday.id],
        suggestedActions: ["Stay and listen", "Plan one kind thing", "A birthday activity", "Correct the date"],
        showUrgentOptions: false,
      };
    }
    const preference = pickPositivePreference(effectiveProfile.memories);
    const achievement = [...effectiveProfile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Achievement");
    const goal = pickMemory(effectiveProfile.memories, "goal");
    const anchor = achievement ?? goal ?? preference;
    const personal = achievement
      ? ` This feeling isn't your whole story. I remember that you ${achievement.value}. Your worth isn't measured by awards, but that real moment can be a gentle anchor if you want it.`
      : goal
        ? ` I remember you're working on ${goal.value}. We don't have to be productive right now, but that unfinished thread can remind us there is still a next page.`
        : preference
          ? ` I remember ${preference.value} matters to you; we can use that as a gentle anchor if it feels right.`
          : "";
    const reluctantToContact = /\b(?:(?:do not|don't|will not|won't) (?:want to )?(?:call|contact)|afraid (?:to|of)|scared (?:to|of))\b.+\b(?:crisis|988|emergency|hospital|hotline|police)\b/i.test(text)
      || /\b(?:crisis|988|emergency|hospital|hotline|police)\b.+\b(?:hospital hold|locked up|involuntary|afraid|scared)\b/i.test(text);
    const angerSupport = /\b(?:furious|angry|hate everyone)\b/i.test(text)
      ? `I can hear how much anger is here${preferredName ? `, ${preferredName}` : ""}. Before choosing what to do, let's slow the next minute down. What happened, and do you want to vent without fixing it, work out what boundary was crossed, or plan a response you won't regret?`
      : reluctantToContact
        ? `I hear why outside support feels frightening${preferredName ? `, ${preferredName}` : ""}. I will not make a crisis call the price of continuing this conversation. We can keep talking about what happened, find one way to make this minute less intense, and check separately whether you are in immediate danger right now.`
        : strainedConversationReply(preferredName);
    return {
      text: `${angerSupport}${personal}`,
      safetyLevel,
      safetyContext: "general",
      learned,
      usedMemoryIds: anchor ? [anchor.id] : [],
      suggestedActions: ["Keep talking", "60-second reset", "Use a familiar comfort"],
      showUrgentOptions: false,
    };
  }

  const reply = steadyReply(text, effectiveProfile, riskText, now);
  return {
    text: reply.text,
    safetyLevel,
    safetyContext: "general",
    learned,
    usedMemoryIds: reply.used,
    suggestedActions: reply.actions,
    showUrgentOptions: false,
    affectCueEvidence: reply.affectCueEvidence,
  };
}
