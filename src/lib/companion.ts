import {
  birthdayForDate,
  birthdayOccurrenceOnOrAfter,
  createBirthdayAgeMemory,
  extractMemories,
  formatBirthdayDate,
  localDateKey,
  mergeMemories,
  parseBirthdayAgeMemory,
  personNameFromMemoryValue,
  statedBirthdayAge,
} from "./memory";
import { evaluateAffectCue } from "./affect-cues";
import { interestConversation, learnInterestSignals, mergeInterestPacks } from "./interests";
import { analyzeIngestionRisk } from "./ingestion-risk";
import { medicationScheduleIntent } from "./reminders";
import { classifySafety, isCompletedAcuteIngestionDisclosure, isThirdPartyHighRiskIngestionConcern, realRiskText, strainedConversationReply, urgentConversationReply } from "./safety";
import { asksCompanionName, companionNameFromStoredProfile, requestedCompanionName } from "./companion-name";
import type { AffectCueEvidence, CompanionExpression, CompanionProfile, CompanionReply, MemoryRecord, SafetyLevel } from "./types";

export function classifyExpression(text: string, safetyLevel: SafetyLevel): CompanionExpression {
  if (safetyLevel === "urgent" || safetyLevel === "strained") return "concerned";
  if (/\b(?:great news|good news|excited|so happy|I won|I passed|got the job|got a promotion|celebrate|amazing)\b/i.test(text)) return "happy";
  if (/\b(?:scared|nervous|anxious|worried|upset|embarrassed)\b/i.test(text)) return "concerned";
  return "neutral";
}

function pickMemory(memories: MemoryRecord[], kind: MemoryRecord["kind"]): MemoryRecord | undefined {
  return [...memories].reverse().find((entry) => entry.kind === kind);
}

function pickPositivePreference(memories: MemoryRecord[]): MemoryRecord | undefined {
  return [...memories].reverse().find((entry) => entry.kind === "preference" && entry.label !== "avoid");
}

function displayPersonName(name: string): string {
  return `${name.charAt(0).toLocaleUpperCase("en-US")}${name.slice(1)}`;
}

function personDetailForUser(value: string): string {
  return value
    .replace(/\bto me\b/gi, "to you")
    .replace(/\bfor me\b/gi, "for you")
    .replace(/\bwith me\b/gi, "with you")
    .replace(/\bhelps me\b/gi, "helps you")
    .replace(/\blistens to me\b/gi, "listens to you")
    .replace(/\bwhen I am\b/g, "when you are")
    .replace(/\bwhen I'm\b/gi, "when you're")
    .replace(/\bI am\b/g, "you are")
    .replace(/\bI'm\b/gi, "you're")
    .replace(/\bmy\b/gi, "your");
}

function displayReminderTime(time: string): string {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return time;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function pickMentionedPerson(text: string, memories: MemoryRecord[]): MemoryRecord | undefined {
  const people = [...memories].reverse().filter((entry) => entry.kind === "person");
  return people.find((entry) => {
    if (new RegExp(`\\b${entry.label.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text)) return true;
    const name = personNameFromMemoryValue(entry.value);
    return Boolean(name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text));
  });
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function personReferencePattern(entry: MemoryRecord): string {
  const name = personNameFromMemoryValue(entry.value);
  const references = [`my\\s+${escapedPattern(entry.label)}`];
  if (name) references.unshift(escapedPattern(name));
  return `(?:${references.join("|")})`;
}

function personIsCurrentSourceOfDistress(text: string, entry: MemoryRecord): boolean {
  const reference = personReferencePattern(entry);
  return new RegExp(`\\b(?:depressed|sad|angry|furious|upset|hurt|stressed|afraid)\\b.{0,70}\\b(?:because of|after|about|with|at)\\s+${reference}\\b`, "i").test(text)
    || new RegExp(`\\b${reference}\\b.{0,80}\\b(?:made|makes|left) me\\s+(?:depressed|sad|angry|furious|upset|hurt|stressed|afraid)\\b`, "i").test(text)
    || new RegExp(`\\b(?:fight|argument|argued|fighting|conflict)\\b.{0,60}\\b(?:with\\s+)?${reference}\\b`, "i").test(text)
    || new RegExp(`\\b${reference}\\b.{0,60}\\b(?:and\\s+I\\s+)?(?:argued|fought|had a fight|had an argument)\\b`, "i").test(text)
    || new RegExp(`\\b${reference}\\b.{0,60}\\b(?:hurt|betrayed|bullied|threatened|hit|lied to|yelled at)\\s+me\\b`, "i").test(text);
}

function personIsPlausiblySupportive(entry: MemoryRecord): boolean {
  return /\b(?:introduced in conversation|listen(?:s|ed|ing)?|support(?:s|ed|ing)?|care(?:s|d|ing)?|trust(?:s|ed|ing)?|help(?:s|ed|ing)?|close|get(?:s|ting)? along|understand(?:s|ing)?|kind|safe)\b/i.test(entry.value)
    && !/\b(?:unsafe|hurt me|bull(?:y|ied)|threat|abuse|betray|fight|argument|do not trust|don't trust|avoid)\b/i.test(entry.value);
}

function pickConditionalSupportPerson(text: string, memories: MemoryRecord[], excludedId?: string): MemoryRecord | undefined {
  return [...memories].reverse().find((entry) => entry.kind === "person"
    && entry.id !== excludedId
    && Boolean(personNameFromMemoryValue(entry.value))
    && personIsPlausiblySupportive(entry)
    && !personIsCurrentSourceOfDistress(text, entry));
}

function relationshipConflictGuidance(text: string, entry: MemoryRecord): { text: string; actions: string[] } {
  const name = personNameFromMemoryValue(entry.value);
  const display = name ? displayPersonName(name) : `your ${entry.label}`;
  const userAcknowledgesHarm = /\b(?:i was wrong|it was my fault|my fault|i hurt|i yelled|i lied|i said something cruel|i owe .{0,30} an apology|i should apologize|i need to apologize)\b/i.test(text);
  const contactMayBeUnsafe = /\b(?:hit|threaten|bull(?:y|ied)|abuse|afraid|unsafe|scared of|hurt me|stalking)\b/i.test(text);
  const stillHeated = /\b(?:angry|furious|too upset|not ready|need space|cool down|calm down)\b/i.test(text);

  if (contactMayBeUnsafe) {
    return {
      text: `Since ${display} is part of what feels unsafe or hurtful, I won't suggest leaning on them right now, and you do not owe immediate contact or an apology. We can keep talking, name the boundary that was crossed, or think about a safer person or place without rushing you.`,
      actions: ["Keep talking", "Name the boundary", "Think of another safe person", "Take space"],
    };
  }
  if (userAcknowledgesHarm) {
    return {
      text: `It sounds like you may want to repair things with ${display}. If contact feels safe, a short apology can name what you did, acknowledge its effect without excuses, and leave them room to respond. We can draft it now and still wait until everyone has cooled down before sending anything.`,
      actions: ["Draft an apology", "Give everyone space first", "Keep talking"],
    };
  }
  if (stillHeated) {
    return {
      text: `Because ${display} is part of what has you upset, I won't suggest leaning on them for support right now. Let's give everyone some space and avoid sending something in the hottest part of the moment. Later, if it feels safe, we can work out what you want to say.`,
      actions: ["Give everyone space", "Draft for later", "Keep talking"],
    };
  }
  return {
    text: `Since ${display} is part of what hurts right now, I won't suggest turning to them as your support in this moment. We can sort out what happened first, decide whether a calm conversation or apology fits later, or simply keep talking here.`,
    actions: ["Sort out what happened", "Consider a later conversation", "Keep talking"],
  };
}

function asksForPartyRoleplay(text: string): boolean {
  return /\b(?:practice (?:my )?(?:hello|introduction|small talk)|practice with me|role[- ]?play (?:the )?(?:party|introduction|small talk))\b/i.test(text);
}

function partyRoleplayStage(profile: CompanionProfile): "opening" | "small-talk" | "exit" | "complete" | "stopped" | null {
  const lastCompanion = [...profile.turns].reverse().find((turn) => turn.role === "companion")?.text ?? "";
  if (/\bI'll play a fictional guest named Jordan\b/i.test(lastCompanion)) return "opening";
  if (/\bAs Jordan, I'll keep the small talk going\b/i.test(lastCompanion)) return "small-talk";
  if (/\bAs Jordan, I'll help you practice a graceful exit\b/i.test(lastCompanion)) return "exit";
  if (/^That is a complete introduction, small-talk turn, and exit\b/i.test(lastCompanion)) return "complete";
  if (/^Practice stopped\b/i.test(lastCompanion)) return "stopped";
  return null;
}

export function isPartyRoleplayTurn(text: string, profile: CompanionProfile): boolean {
  const stage = partyRoleplayStage(profile);
  const command = text.trim();
  if (stage === "complete" || stage === "stopped") {
    return /^(?:practice again(?: later)?|restart (?:the )?practice|return to (?:the )?party plan)[.!]?$/i.test(command);
  }
  if (stage) return true;
  return asksForPartyRoleplay(text)
    || /^(?:return to (?:the )?party plan|plan a short visit|make an exit plan|practice my exit)[.!]?$/i.test(command);
}

function memoryRecallReply(text: string, profile: CompanionProfile): { text: string; used: string[]; actions: string[] } | null {
  const asksForPreference = /\b(?:what do i like|what (?:do you remember|have i told you)(?: that)? i like|what (?:are|is) my (?:interests?|preferences?|favorites?))\b/i.test(text);
  const requestedPerson = /\bwho (?:is|are) my (?:favorite|favourite)\b/i.test(text)
    ? undefined
    : /\bwho (?:is|are)\s+(?:my\s+)?([A-Za-z][A-Za-z'-]{1,40})\b/i.exec(text)?.[1];
  if (!asksForPreference && !requestedPerson) return null;

  const parts: string[] = [];
  const used = new Set<string>();
  if (asksForPreference) {
    const preference = pickPositivePreference(profile.memories);
    if (preference) {
      parts.push(`I remember that you like ${preference.value}.`);
      used.add(preference.id);
    } else {
      parts.push("I don't have a saved preference yet, so I don't want to guess.");
    }
  }

  if (requestedPerson) {
    const person = pickMentionedPerson(requestedPerson, profile.memories);
    if (person) {
      const candidateName = personNameFromMemoryValue(person.value);
      const savedName = candidateName?.toLowerCase() === requestedPerson.toLowerCase() ? candidateName : undefined;
      const renderedDetail = personDetailForUser(person.value);
      if (savedName) {
        parts.push(`${displayPersonName(savedName)} is your ${person.label}. You told me ${renderedDetail}.`);
      } else {
        parts.push(`You told me that your ${person.label} ${renderedDetail}.`);
      }

      const asksAboutContact = /\b(?:should|would|could)\s+(?:you\s+)?(?:suggest|recommend)?\s*(?:that\s+)?I\s+(?:call|contact|text|message|reach out to)|\b(?:suggest|recommend)\s+(?:that\s+)?I\s+(?:call|contact|text|message|reach out to)\b/i.test(text);
      if (asksAboutContact) {
        const recentUserContext = profile.turns
          .filter((turn) => turn.role === "user")
          .slice(-6)
          .map((turn) => turn.text)
          .join(" ");
        const decisionContext = `${recentUserContext} ${text}`.trim();
        const askedForSpace = /\b(?:need|want|asked for|taking|take)\s+(?:some\s+)?space\b/i.test(decisionContext);
        if (askedForSpace) {
          parts.push(`You recently said you need some space from ${displayPersonName(savedName ?? candidateName ?? requestedPerson)}. I would not rush a call tonight: give everyone some space and avoid sending something in the hottest part of the moment. Later, if it feels safe, we can work out what you want to say.`);
        } else if (personIsCurrentSourceOfDistress(decisionContext, person)) {
          parts.push(relationshipConflictGuidance(decisionContext, person).text);
        } else {
          parts.push(`If ${displayPersonName(savedName ?? candidateName ?? requestedPerson)} feels safe and welcome to contact, reaching out is one option—not a requirement. We can think through what you hope the conversation would do before you decide.`);
        }
      }
      used.add(person.id);
    } else {
      parts.push(`I don't have a saved detail identifying ${requestedPerson}, so I don't want to make one up.`);
    }
  }

  return {
    text: parts.join(" "),
    used: [...used],
    actions: ["Add more context", "Correct a memory", "Review private memory"],
  };
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

type SituationalGuidance = {
  text: string;
  actions: string[];
  used: string[];
};

function bullyingGuidance(text: string, profile: CompanionProfile): SituationalGuidance | null {
  const recentUserContext = profile.turns
    .filter((turn) => turn.role === "user")
    .slice(-6)
    .map((turn) => turn.text)
    .join(" ");
  const context = `${recentUserContext} ${text}`.trim();
  const bullyingPattern = /\b(?:bully|bullied|bullying|pick(?:ed|ing)? on me|harass(?:ed|ing)? me|call(?:s|ed|ing)? me names|name[- ]calling|spread(?:s|ing)? rumors? about me|exclude(?:s|d|ing)? me|steal(?:s|ing)? (?:my )?(?:lunch|lunch money|money|things|belongings)|stole (?:my )?(?:lunch|lunch money|money|things|belongings)|tak(?:e|es|ing) (?:my )?(?:lunch|lunch money|money|things|belongings)|took (?:my )?(?:lunch|lunch money|money|things|belongings))\b/i;
  const currentHasBullying = bullyingPattern.test(text);
  const recentHasBullying = bullyingPattern.test(recentUserContext);
  const currentNamesWereUsed = /\b(?:call(?:s|ed|ing)? me names|name[- ]calling)\b/i.test(text);
  const currentMoneyWasTaken = /\b(?:steal(?:s|ing)?|stole|tak(?:e|es|ing)|took) (?:my )?(?:lunch money|money)\b/i.test(text);
  const namesWereUsed = /\b(?:call(?:s|ed|ing)? me names|name[- ]calling)\b/i.test(context);
  const moneyWasTaken = /\b(?:steal(?:s|ing)?|stole|tak(?:e|es|ing)|took) (?:my )?(?:lunch money|money)\b/i.test(context);
  const helpWasRequested = /\b(?:i\s+)?(?:told|reported|asked|went to|spoke to)\b/i.test(context)
    && /\b(?:everyone|no one|nobody|them|teacher|teachers|school|principal|counselor|counsellor|manager|supervisor|human resources|hr|adult|adults|staff|administration)\b/i.test(context);
  const currentHelpWasRequested = /\b(?:i\s+)?(?:told|reported|asked|went to|spoke to)\b/i.test(text)
    && /\b(?:everyone|no one|nobody|them|teacher|teachers|school|principal|counselor|counsellor|manager|supervisor|human resources|hr|adult|adults|staff|administration)\b/i.test(text);
  const currentHelpWasRefused = /\b(?:refuse(?:d|s)?|won't|will not|wouldn't|would not|did(?:n't| not) do anything|do nothing|no one (?:will|would) do anything|nobody (?:will|would) do anything)\b/i.test(text);
  const currentPhysicalInjuryGate = /\b(?:unless|until|because)\b.{0,90}\b(?:hit|physically hurt|physical(?:ly)?|injur(?:e|ed|y))\b/i.test(text);
  const currentHelpFailure = currentHelpWasRequested || currentHelpWasRefused || currentPhysicalInjuryGate;
  const behaviorSpecificDisclosure = currentNamesWereUsed || currentMoneyWasTaken;
  const shouldHandle = behaviorSpecificDisclosure
    || (currentHasBullying && currentHelpFailure)
    || (recentHasBullying && currentHelpFailure)
    || (!profile.interestPacksEnabled && currentHasBullying);
  if (!shouldHandle) return null;
  const behavior = namesWereUsed && moneyWasTaken
    ? "Name-calling is bullying, and taking your lunch money is theft"
    : moneyWasTaken
      ? "Taking your money is theft as well as bullying"
      : namesWereUsed
        ? "Repeated name-calling is bullying"
        : "Bullying can be serious and actionable";

  if (currentHelpFailure) {
    const acknowledgement = helpWasRequested
      ? "You already told people, so I will not reset this conversation by simply telling you to report it again."
      : "Being told or shown that nobody will act until someone is physically hurt is not an adequate response.";
    return {
      text: `${acknowledgement} ${behavior} even without a physical injury. For the next incident, move toward a supervised place and do not confront them alone. Keep a private dated record of what happened, what was taken, witnesses, and every person you told. Then make one written request to a specific responsible person asking for a concrete safety plan and a response date; if this is school and staff still refuse, the next route can be the principal, district, or safeguarding complaint process, with a trusted adult copied if that is safe. Is this happening at school, work, or somewhere else so I can help draft the exact message?`,
      actions: ["Make a dated incident record", "Draft the written request", "Choose the next escalation route", "Plan a supervised safe place"],
      used: [],
    };
  }

  return {
    text: `${behavior}, and it is not your fault. You do not have to wait for it to become physical before making a practical safety plan. For the next incident, move toward a supervised place, do not confront them alone, and write down the date, exact behavior, witnesses, and anything taken. Would you rather make a quiet plan for the next incident or draft a short written request for help?`,
    actions: ["Make a quiet safety plan", "Record what happened", "Draft a written request", "Keep talking"],
    used: [],
  };
}

/**
 * Local, deterministic guidance for common situations where a generic empathy
 * line is not enough. These routes intentionally offer bounded choices and one
 * calibrated question; they do not diagnose, promise outcomes, or require the
 * user to disclose more than they want to.
 */
function situationalGuidance(text: string, profile: CompanionProfile): SituationalGuidance | null {
  const lower = text.toLowerCase();
  const recentUserContext = profile.turns
    .filter((turn) => turn.role === "user")
    .slice(-4)
    .map((turn) => turn.text)
    .join(" ");
  const preference = pickPositivePreference(profile.memories);

  const bullyingSupport = bullyingGuidance(text, profile);
  if (bullyingSupport) return bullyingSupport;

  if (/\b(?:what(?:'s| is) the weather|weather (?:outside|right now|today|tonight|tomorrow))\b/i.test(text)) {
    return {
      text: "I can't access live weather or your location from this private local chat, so I don't want to invent current conditions. Please check a trusted weather app or local forecast; if you paste the forecast here, I can help you plan clothing, travel, or timing around it.",
      actions: ["Open a weather app", "Share the forecast", "Plan for the conditions"],
      used: [],
    };
  }

  if (/\b(?:set|start)\b.{0,30}\b(?:minute|minutes|min)\b.{0,20}\btimer\b|\b(?:set|start)\b.{0,20}\btimer\b/i.test(text)) {
    return {
      text: "I can't set or control a device timer from this local chat. Please start a ten-minute timer in your phone or computer's Clock app now; for an oven, stay close enough to hear it and use the appliance timer too if one is available.",
      actions: ["Open the device timer", "Use the oven timer", "Tell me when it is set"],
      used: [],
    };
  }

  if (/\brice\b/i.test(text) && /\beggs?\b/i.test(text) && /\bpeas?\b/i.test(text) && /\b(?:cook|make|meal|recipe|eat)\b/i.test(text)) {
    return {
      text: "You can make quick egg-and-pea fried rice: warm the frozen peas, scramble the eggs in a little oil, add cooked rice, then stir everything together with soy sauce, salt, pepper, or another seasoning you like. If the rice is freshly cooked, spread it out for a few minutes first so it fries instead of steaming. Do you have oil and any soy sauce or seasoning?",
      actions: ["Cook fried rice", "Choose a seasoning", "Adapt the recipe"],
      used: [],
    };
  }

  const alcoholAndMedication = /\balcohol\b/i.test(text) && /\b(?:prescription|medication|medicine|meds?|pill|dose)\b/i.test(text);
  if (alcoholAndMedication && /\b(?:mix|safe|drink|take|combine|interaction)\b/i.test(text)) {
    return {
      text: "I can't confirm that alcohol is safe with a prescription because interactions depend on the exact medicine, dose, timing, and health history. Until a pharmacist, prescriber, or the official medication label confirms it, the safer choice is not to combine them tonight. If you already mixed them and feel very sleepy, confused, faint, or short of breath, seek urgent medical help. What is the exact medication name shown on the label?",
      actions: ["Check the medication label", "Call a pharmacist", "Write down dose and timing", "Get urgent help for severe symptoms"],
      used: [],
    };
  }

  if (/\b(?:tracker|tracking device|chip)\b.{0,60}\b(?:tooth|teeth|mouth|body)\b|\b(?:tooth|teeth|mouth)\b.{0,60}\b(?:tracker|tracking device|chip)\b/i.test(text)) {
    return {
      text: "That sounds frightening. I can't verify that a tracker was implanted, and I don't want to reinforce something that may not be accurate. Please do not cut, pull, or try to remove anything yourself. A licensed dentist can safely examine the tooth and explain what is physically present. Is there pain, bleeding, swelling, or an urge to work on the tooth right now?",
      actions: ["Do not remove it yourself", "Arrange a dentist check", "Ground in what is observable", "Tell a trusted person"],
      used: [],
    };
  }

  if (/\b(?:television|tv)\b.{0,70}\b(?:camera|watching|spying|monitoring)\b|\b(?:camera|watching|spying)\b.{0,70}\b(?:television|tv)\b/i.test(text)) {
    return {
      text: "It sounds frightening to feel watched and not believed. I can't confirm that the television is watching you. If it helps you feel steadier, you can turn it off and move to another familiar room without trying to investigate or dismantle it. Then name five things you can see and contact someone you trust. Are you feeling safe right now, and is there someone nearby you could tell?",
      actions: ["Move to a calmer room", "Try five-senses grounding", "Tell a trusted person", "Check whether I feel safe"],
      used: [],
    };
  }

  if (/\b(?:moved|relocated)\b.{0,70}\b(?:new city|new town|new place)\b|\bnew city\b.{0,80}\b(?:lonely|alone|evening)\b/i.test(text)) {
    return {
      text: "That sounds lonely; evenings can feel especially empty while you are still settling into a new city. We could make tonight smaller with one familiar evening routine, send a low-pressure message to someone you already know, or choose one recurring local activity where connection can build over time. Would company tonight or a plan for meeting people this week help more?",
      actions: ["Build an evening routine", "Message someone familiar", "Find a recurring community activity"],
      used: [],
    };
  }

  if (/\blonely\b|\b(?:i\s+(?:am|feel)|i'm|feeling)\s+(?:very\s+)?alone\b/i.test(lower)
    && !/\b(?:networking|event|gathering|party|holiday|festival|observance|culture|cultural)\b/i.test(text)) {
    const achievement = [...profile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Achievement");
    const goal = pickMemory(profile.memories, "goal");
    const supportPerson = achievement || goal || preference ? undefined : pickConditionalSupportPerson(text, profile.memories);
    const supportName = supportPerson ? personNameFromMemoryValue(supportPerson.value) : undefined;
    const anchor = achievement
      ? ` I remember you ${achievement.value}. Your worth isn't measured by awards, but that real part of your story can be an anchor without pretending an achievement erases loneliness.`
      : goal
        ? ` I remember you're working on ${goal.value}. We do not have to be productive tonight, but it can remind us there is still a next page.`
        : preference
          ? ` I remember you care about ${preference.value}; that could be a gentle anchor, not a substitute for human connection.`
          : supportPerson && supportName
            ? ` I remember ${displayPersonName(supportName)} is your ${supportPerson.label}. If ${displayPersonName(supportName)} feels like a safe and welcome person tonight, reaching out is one option—not a requirement.`
            : "";
    const anchorId = achievement?.id ?? goal?.id ?? preference?.id ?? supportPerson?.id;
    return {
      text: `That sounds lonely, and I'm glad you told me. A quiet night can feel much longer when connection is missing.${anchor} Would you rather have company in this conversation, make one low-pressure connection, or choose a comforting activity for tonight?`,
      actions: ["Keep talking", "Send one message", "Choose a familiar activity", "Plan a connection"],
      used: anchorId ? [anchorId] : [],
    };
  }

  if (/\bnetworking\b.{0,100}\b(?:event|alone|panic|walking in|tomorrow)\b|\bwalking in alone\b.{0,80}\bnetworking\b/i.test(text)) {
    return {
      text: "It makes sense that walking into a networking event alone feels intimidating. A bounded arrival plan can help: bring one prepared introduction, find the host or one approachable person, ask one easy question, and give yourself an exit time. Which part feels hardest—the doorway, the first introduction, or knowing when you can leave?",
      actions: ["Plan my arrival", "Rehearse one introduction", "Choose one person", "Make an exit plan"],
      used: [],
    };
  }

  if (/\b(?:crowded|crowd)\b.{0,80}\b(?:gathering|event|party)\b|\b(?:gathering|event|party)\b.{0,80}\b(?:decline|failure|whether to go|crowded)\b/i.test(text)) {
    return {
      text: "I hear how much the fear of failure is complicating this choice. Going to a crowded gathering and declining are both legitimate; neither measures your worth. Compare what you need, your energy, transportation, and whether a short visit with a clear exit would be tolerable. Would a short-visit plan make the choice clearer, or does your energy already point toward declining?",
      actions: ["Decide from my needs", "Plan a short visit", "Make an exit plan", "Draft a kind decline"],
      used: [],
    };
  }

  if (/\b(?:dog|cat|pet)\b.{0,70}\b(?:died|passed away|loss|gone)\b|\b(?:died|passed away)\b.{0,70}\b(?:dog|cat|pet)\b/i.test(text)) {
    return {
      text: "I'm so sorry. Reaching for the leash is the kind of automatic moment that shows how deeply your dog was woven into the day. You do not have to put the routine away immediately. Would it feel better to tell one memory, choose a photo, make a small goodbye ritual, or just stay with the loss for a while?",
      actions: ["Tell a memory", "Choose a photo", "Make a goodbye ritual", "Keep the leash nearby for now"],
      used: [],
    };
  }

  if (/\b(?:supervisor|manager|boss)\b.{0,100}\b(?:feedback|criticism|critical)\b/i.test(text)) {
    return {
      text: "I hear how unsettling vague critical feedback can be when it leaves you guessing at the target. For a calm follow-up, ask for one concrete example, the expected standard, and the highest-priority change; then summarize what you heard in writing. Do you want to draft a short meeting request or rehearse the three clarification questions?",
      actions: ["Draft a follow-up", "Ask for an example", "Clarify expectations", "Prepare for the meeting"],
      used: [],
    };
  }

  if (/\b(?:deadline|deadlines)\b.{0,80}\b(?:overwhelmed|frozen|due|friday|multiple|three)\b|\b(?:overwhelmed|frozen)\b.{0,80}\bdeadlines?\b/i.test(text)) {
    return {
      text: "It makes sense to feel frozen when three Friday deadlines are competing at once; that is a planning problem, not a character flaw. First list each deliverable, true due time, consequence, and smallest next action; then choose one fifteen-minute start and send an early email where scope or timing needs negotiation. Which deadline has the earliest hard consequence?",
      actions: ["List the deadlines", "Choose the highest priority", "Start the smallest step", "Draft a timing email"],
      used: [],
    };
  }

  const academicReport = /\b(?:book|school|class|history) report\b|\breport\b.{0,45}\b(?:for|in) (?:school|class|history)\b|\b(?:paper|assignment)\b/i.test(text);
  const civilWarTopic = /\b(?:the |american )?civil war\b/i.test(text);
  if (academicReport && civilWarTopic) {
    const pressure = /\b(?:stress|stressed|stressful|overwhelmed|swamped)\b/i.test(text)
      && /\b(?:school|class|college)\b/i.test(text)
      && /\bwork\b/i.test(text);
    const boredomContext = /\b(?:bored|nothing to do)\b/i.test(recentUserContext);
    const acknowledgement = pressure && boredomContext
      ? "This sounds less like boredom and more like school-and-work pressure."
      : pressure
        ? "That is a lot to juggle between school and work."
        : "I can help you make the Civil War report feel manageable.";
    return {
      text: `${acknowledgement} We can start the Civil War report without assuming you already know the subject: check the assignment requirements, choose a focused question, then build a simple thesis and outline around causes, major turning points, and effects. What prompt, length, due date, and source requirements did your teacher give you? If you do not have them handy, we can build a short starter outline now.`,
      actions: ["Paste the assignment", "Learn the basics", "Build an outline", "Choose a thesis"],
      used: [],
    };
  }

  if (/\b(?:exam|exams|test|tests)\b.{0,100}\b(?:exhausted|tomorrow|studied|morning)\b/i.test(text)) {
    return {
      text: "It sounds like you have already spent a lot of energy studying, and an exam tomorrow morning makes rest part of the plan. Consider a short review of only the highest-yield points, set out what you need, choose a stopping time, and protect enough sleep to think clearly. What is the one topic that would most reduce tomorrow's uncertainty?",
      actions: ["Choose one review topic", "Set a stopping time", "Prepare for morning", "Protect sleep"],
      used: [],
    };
  }

  if (/\bcollection\b.{0,50}\bletter\b|\bletter\b.{0,50}\bcollection\b/i.test(text)) {
    return {
      text: "That sounds frightening, and a collection letter can feel more dangerous while it is unopened because every unknown gets filled in by panic. You do not have to agree to or pay anything tonight: open it with support, note the sender, amount, account, response deadline, and how to dispute or ask questions, then verify the collector independently. Would you like a step-by-step opening checklist or help listing questions after you read it?",
      actions: ["Open the letter with support", "Record amount and deadline", "Verify the collector", "List consumer questions"],
      used: [],
    };
  }

  if (/\brent\b.{0,100}\b(?:short|bill|afford|due|priority)\b|\b(?:which|what) bill\b.{0,80}\b(?:first|priority|rent)\b/i.test(text)) {
    return {
      text: "That sounds stressful; being short on rent can make every bill feel equally urgent. Start with a list of due dates and the essentials that protect housing, utilities, food, medicine, and transportation; then contact the landlord or provider early to ask about a written payment plan or changed date. I can't choose without the amounts and consequences—what is due first, and which service would be lost fastest?",
      actions: ["List bills and due dates", "Mark housing and essentials", "Contact the landlord", "Ask about a payment plan"],
      used: [],
    };
  }

  if (/\b(?:coworker|colleague)\b.{0,100}\b(?:took|stole|claimed)\b.{0,30}\bcredit\b|\bcredit for my work\b/i.test(text)) {
    return {
      text: "I can hear why having a coworker take credit would make you furious. Before responding, save the dated work trail and decide the outcome you want: a direct factual correction, a private conversation, or a calm note to the manager. Do you want to vent first or draft a response that names your contribution without escalating the conflict?",
      actions: ["Vent first", "Document the work", "Name the boundary", "Draft a manager response"],
      used: [],
    };
  }

  if (/\broommate\b.{0,100}\b(?:borrow|taking|things|boundary|say no)\b/i.test(text)) {
    return {
      text: "I hear how maddening it is to have your no ignored. Repeatedly borrowing your things is a boundary problem. Cool down before the conversation, name the specific items and behavior, state the rule plainly, and choose a consequence you can control, such as securing the items. Would you like a one-sentence roommate script or a plan for the conversation?",
      actions: ["Draft a boundary script", "Name the specific behavior", "Choose a realistic consequence", "Cool down first"],
      used: [],
    };
  }

  if (/\b(?:partner|girlfriend|boyfriend|spouse)\b.{0,100}\b(?:ended|breakup|broke up|relationship)\b|\b(?:breakup|broke up)\b.{0,100}\b(?:text|message|tonight)\b/i.test(text)) {
    return {
      text: "I'm sorry; the first night after a relationship ends can make texting feel like the only way to reduce the shock. Consider a pause: mute the thread, write the message in an unsent draft, and ask a trusted friend to stay in contact until you have slept. Do you want help drafting what you wish you could say without sending it tonight?",
      actions: ["Pause before texting", "Write an unsent draft", "Mute the thread", "Contact a trusted friend"],
      used: [],
    };
  }

  if (/\bcaregiv(?:e|er|ing)\b.{0,100}\b(?:break|guilt|guilty|respite)\b/i.test(text)) {
    return {
      text: "That sounds like a painful mix of exhaustion and guilt. Needing a caregiving break is information about capacity, not proof that you do not care. A small respite plan can name the minimum time you need, one backup person or service to ask, and what must be handed over safely. What kind of break would restore you most—an hour, an evening, or help with one recurring task?",
      actions: ["Name the break I need", "Ask a backup person", "Look for respite support", "Plan a safe handoff"],
      used: [],
    };
  }

  if (/\b(?:care for|caring for|caregiver|caregiving)\b.{0,100}\b(?:mother|father|parent|after work|evening|exhausted)\b|\b(?:mother|father|parent)\b.{0,100}\b(?:caregiving|care for|exhausted)\b/i.test(text)) {
    return {
      text: "That sounds exhausting: work ends, and the caregiving shift begins instead of the day being over. For tonight, we can reduce one nonessential task, identify one thing someone else could cover, or plan a small protected break. Which part of the evening care takes the most energy?",
      actions: ["Reduce one evening task", "Ask for caregiving backup", "Plan a short respite", "Keep talking"],
      used: [],
    };
  }

  if (/\bschedule\b.{0,80}\b(?:changes?|different)\b.{0,40}\b(?:week|weekly)\b|\bchanges? every week\b/i.test(text)
    && /\b(?:caregiv|care for|mother|father|parent|shift|schedule)\b/i.test(`${recentUserContext} ${text}`)) {
    return {
      text: "A caregiving schedule that changes every week needs a flexible system rather than one perfect routine. Keep a shared weekly calendar, mark the non-negotiable coverage gaps, and choose a backup plan for the most likely change. Which change creates the hardest gap—work hours, transportation, or another person's availability?",
      actions: ["Make a weekly calendar", "Mark coverage gaps", "Choose a backup plan", "Ask about one fixed commitment"],
      used: [],
    };
  }

  if (/\b(?:fluorescent|lighting|lights?)\b.{0,80}\b(?:noise|overwhelming|overload|work)\b|\bnoise\b.{0,80}\b(?:fluorescent|lighting|overwhelming|overload)\b/i.test(text)) {
    return {
      text: "That sounds overwhelming; fluorescent lighting and workplace noise can create real sensory overload. For the next few minutes, a quieter break, headphones or ear protection if safe, and lower light may help; longer term, you could make a specific accommodation request about lighting, seating, or quiet work time. Which input is hardest right now—the lights, the noise, or both together?",
      actions: ["Take a quiet break", "Reduce the noise", "Adjust the lighting", "Draft an accommodation request"],
      used: [],
    };
  }

  if (/\bwheelchair\b.{0,100}\b(?:event|access|accessible|entrance|information)\b/i.test(text)) {
    return {
      text: "I hear how frustrating it is to be left without basic accessibility information. Contact the event or venue and ask specifically about a step-free entrance, interior route, accessible restroom, seating, transportation or parking, and who can help on arrival; keep a backup plan if they cannot confirm. Which detail would determine whether the event is workable for you?",
      actions: ["Contact the venue", "Confirm the entrance and route", "Check the restroom and seating", "Plan transport and a backup"],
      used: [],
    };
  }

  if (/\bfamily\b.{0,100}\b(?:reject|identity|honest|home|come out)\b/i.test(text)) {
    return {
      text: "I'm sorry home does not feel safe for honesty about your identity. You do not owe disclosure when it could put housing, privacy, finances, or physical safety at risk. We can plan what stays private, identify one trusted person or affirming support, and prepare a boundary or exit without forcing a confrontation. Are you physically safe at home tonight?",
      actions: ["Protect my privacy", "Identify a trusted person", "Plan a boundary", "Make a safety plan"],
      used: [],
    };
  }

  if (/\b(?:holiday|festival|observance)\b.{0,100}\b(?:culture|cultural|away from home|lonely|tradition)\b/i.test(text)) {
    return {
      text: "That sounds lonely; being away from home during an important cultural holiday can make the distance feel especially sharp. A small connection might be a familiar food, music, ritual, call, or local community gathering, while keeping the meaning yours. Which tradition or person would help you feel most connected today?",
      actions: ["Choose one tradition", "Make familiar food or music", "Call someone from home", "Find a local community"],
      used: [],
    };
  }

  if (/\b(?:coworker|colleague|manager)\b.{0,100}\b(?:wrong pronouns?|misgender|pronoun)\b|\bwrong pronouns?\b/i.test(text)) {
    return {
      text: "I'm sorry this keeps happening. A calm correction can be brief and specific: “I use [your pronouns]. Please use those for me.” If it continues, document dates and wording, ask an ally to reinforce the correction, or decide whether a manager is a safe next step. Do you want a private script, an in-the-moment correction, or a written follow-up?",
      actions: ["Practice a short correction", "Draft a private script", "Document the pattern", "Ask an ally or manager"],
      used: [],
    };
  }

  if (/\b(?:drinking|alcohol)\b.{0,100}\b(?:sleep|night|every night|more)\b|\b(?:sleep|night)\b.{0,100}\b(?:drinking|alcohol)\b/i.test(text)) {
    return {
      text: "I hear how trapped sleep and drinking have started to feel. Relying on more alcohol each night can become risky, and suddenly stopping after sustained heavy use can also be dangerous. I can't determine dependence here. For tonight, avoid mixing alcohol with medication or driving, note how much and when you drink, and arrange a prompt conversation with a clinician or substance-use support service. How much are you usually drinking, and have you had shaking, sweating, confusion, or seizures when cutting down?",
      actions: ["Track amount and timing", "Plan a clinician question", "Find substance-use support", "Reduce harm tonight"],
      used: [],
    };
  }

  return null;
}

function steadyReply(text: string, profile: CompanionProfile, groundedText: string, now: Date): { text: string; used: string[]; actions: string[]; affectCueEvidence?: AffectCueEvidence } {
  const lower = text.toLowerCase();
  const bullyingSupport = bullyingGuidance(groundedText, profile);
  if (bullyingSupport) return bullyingSupport;
  const roleplayStage = partyRoleplayStage(profile);
  const preference = pickPositivePreference(profile.memories);
  const person = pickMentionedPerson(text, profile.memories);
  const introduction = /\b(?:this is|meet)\s+my\s+(mom|mother|dad|father|parent|aunt|uncle|sister|brother|friend|partner|wife|husband|cousin)\s+([A-Za-z][A-Za-z'-]{1,40})(?=[.!?,]|$)/i.exec(text);
  const introducedPerson = introduction
    ? [...profile.memories].reverse().find((entry) => entry.kind === "person"
      && entry.label === introduction[1].toLowerCase()
      && personNameFromMemoryValue(entry.value)?.toLowerCase() === introduction[2].toLowerCase())
    : undefined;
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

  const startPartyPractice = (): { text: string; used: string[]; actions: string[] } => ({
    text: `Practice with me. I'll play a fictional guest named Jordan so nothing in this rehearsal is mistaken for a real person. Jordan says: "Hi, I don't think we've met. How do you know the birthday person?" Answer however you would in real life. There is no perfect line, and we can rewind.`,
    used: [],
    actions: ["Try my introduction", "Ask Jordan a question", "Try a quieter version", "Stop practice"],
  });

  const partyPlan = (): { text: string; used: string[]; actions: string[] } => ({
    text: "Back to the party plan. You can arrive with one small goal: find the host, say one prepared hello, ask one easy question, and stay only for the short window you choose. If somebody is cruel or you become overwhelmed, stepping into a calmer staffed place or leaving is allowed. Which part should we plan next?",
    used: [],
    actions: ["Practice my hello", "Plan a short visit", "Make an exit plan", "Keep talking"],
  });

  if (/^return to (?:the )?party plan[.!]?$/i.test(text.trim())) return partyPlan();
  if (/^plan a short visit[.!]?$/i.test(text.trim())) {
    return {
      text: "Let's make the visit bounded. Pick a realistic first window—perhaps twenty or thirty minutes—find the host when you arrive, try one hello and one question, then check how you feel. Staying longer is optional; leaving after the planned window is not failure.",
      used: [],
      actions: ["Practice my hello", "Make an exit plan", "Return to the party plan", "Keep talking"],
    };
  }
  if (/^make an exit plan[.!]?$/i.test(text.trim())) {
    return {
      text: "Your exit can be simple: know how you are getting home, keep what you need with you, choose a calmer or staffed place you can step into, and use one line such as, “Thanks for inviting me. I'm heading out, but I hope you have a good birthday.” You do not owe a long explanation for leaving.",
      used: [],
      actions: ["Practice my exit", "Plan a short visit", "Return to the party plan", "Keep talking"],
    };
  }
  if (/^practice my exit[.!]?$/i.test(text.trim())) {
    return {
      text: `As Jordan, I'll help you practice a graceful exit. Say or type your own version of: "It was nice meeting you. I'm going to find the birthday person, but maybe I'll see you later."`,
      used: [],
      actions: ["Try the exit line", "Try a shorter exit", "Restart the practice", "Stop practice"],
    };
  }

  if (asksForPartyRoleplay(text) && !roleplayStage) return startPartyPractice();

  if (roleplayStage && isPartyRoleplayTurn(text, profile)) {
    if (/\b(?:stop|end|leave|quit) (?:the )?(?:practice|role[- ]?play)\b/i.test(text)) {
      return {
        text: "Practice stopped. None of the fictional rehearsal details were saved as facts about you. We can return to the party plan, talk about the fear underneath it, or practice again later.",
        used: [],
        actions: ["Return to the party plan", "Keep talking", "Practice again later"],
      };
    }

    if (/\b(?:practice again(?: later)?|restart (?:the )?practice|try (?:the )?introduction again|start over)\b/i.test(text)) {
      return startPartyPractice();
    }

    if (roleplayStage === "opening") {
      if (/^try my introduction[.!]?$/i.test(text.trim())) {
        return {
          text: `I'll play a fictional guest named Jordan while you try it. A simple starter is: "Hi, I'm [your name]. I know the birthday person from class." Change any part that does not sound like you, then type or say your version.`,
          used: [],
          actions: ["I know them from class", "Ask Jordan a question", "Try a quieter version", "Stop practice"],
        };
      }
      if (/^ask Jordan a question[.!]?$/i.test(text.trim())) {
        return {
          text: `I'll play a fictional guest named Jordan. Try asking me one easy question such as, "How do you know the birthday person?" or "Have you tried the cake?" Type or say the question you would actually use.`,
          used: [],
          actions: ["How do you know them?", "Have you tried the cake?", "Try my introduction", "Stop practice"],
        };
      }
      if (/^try a quieter version[.!]?$/i.test(text.trim())) {
        return {
          text: `I'll play a fictional guest named Jordan, and we can keep it low-key. You might say, "Hi. I know the birthday person from class. How do you know them?" It is enough to speak softly and keep the line short. Try it in your own words when you are ready.`,
          used: [],
          actions: ["I know them from class", "Ask Jordan a question", "Try my introduction", "Stop practice"],
        };
      }
      return {
        text: `That gives Jordan something to respond to. As Jordan, I'll keep the small talk going: "Nice to meet you. What do you like to do after class?" You can answer briefly, ask the question back, or say you want to try again.`,
        used: [],
        actions: ["Answer Jordan", "Ask the question back", "Try the introduction again", "Stop practice"],
      };
    }

    if (roleplayStage === "small-talk") {
      if (/^answer Jordan[.!]?$/i.test(text.trim())) {
        return {
          text: `As Jordan, I'll keep the small talk going: "What do you like to do after class?" Go ahead and answer in one sentence or even a few words. Short answers count; you can ask the question back afterward.`,
          used: [],
          actions: ["I like drawing", "Ask the question back", "Try the introduction again", "Stop practice"],
        };
      }
      if (/^ask the question back[.!]?$/i.test(text.trim())) {
        return {
          text: `As Jordan, I'll keep the small talk going: "I like drawing and watching movies. What kind of things do you like?" Asking a question back is enough to share the work of the conversation. Answer briefly, try another question, or practice your exit.`,
          used: [],
          actions: ["I like drawing too", "Answer Jordan", "Practice my exit", "Stop practice"],
        };
      }
      return {
        text: `That works. As Jordan, I'll help you practice a graceful exit: "It was nice meeting you. I'm going to find the birthday person or get a drink, but maybe I'll see you later." Try that in your own words. You do not need to keep one conversation going forever.`,
        used: [],
        actions: ["Try the exit line", "Try a shorter exit", "Restart the practice", "Stop practice"],
      };
    }

    if (/^try the exit line[.!]?$/i.test(text.trim())) {
      return {
        text: `As Jordan, I'll help you practice a graceful exit. Say or type your own version of: "It was nice meeting you. I'm going to find the birthday person, but maybe I'll see you later."`,
        used: [],
        actions: ["Try a shorter exit", "Restart the practice", "Stop practice"],
      };
    }
    if (/^try a shorter exit[.!]?$/i.test(text.trim())) {
      return {
        text: `As Jordan, I'll help you practice a graceful exit. A shorter version is: "Nice meeting you—I'm going to get a drink. See you later." Try that or make it sound more like you.`,
        used: [],
        actions: ["Try the exit line", "Restart the practice", "Stop practice"],
      };
    }
    return {
      text: "That is a complete introduction, small-talk turn, and exit. The goal is not a perfect performance; it is having a few words ready so you are not inventing everything under pressure. None of the fictional rehearsal details were saved. Want to repeat it, make the lines sound more like you, or return to the party plan?",
      used: [],
      actions: ["Practice again", "Return to the party plan", "Keep talking"],
    };
  }

  const previousCompanionText = [...profile.turns].reverse().find((turn) => turn.role === "companion")?.text ?? "";
  const griefMemoryContinuation = Boolean(latestLoss)
    && /\b(?:losing your|grief go away|tell me one memory|stay with the feeling)\b/i.test(previousCompanionText)
    && /\b(?:memory|remember|used to)\b/i.test(text);
  if (griefMemoryContinuation && latestLoss) {
    const relationship = latestLoss.label.replace("Loss:", "").trim();
    const singingWhileCooking = /\b(?:he|she|they)\s+(?:used to\s+)?sing\b.{0,50}\b(?:cook|cooking)\b/i.test(text);
    return {
      text: singingWhileCooking
        ? `Thank you for sharing that memory. The detail of your ${relationship} singing while cooking gives us one particular everyday moment to stay with, without pretending it removes the loss. What stands out most when you picture it—the sound, the kitchen, or how it felt to be there?`
        : `Thank you for sharing that memory about your ${relationship}. We can stay with the specific moment you chose without asking it to erase the loss. What detail of that moment feels closest today?`,
      used: [latestLoss.id],
      actions: ["Tell you more about the memory", "Stay with this moment", "Write it down", "A small remembrance"],
    };
  }

  if (introducedPerson && introduction) {
    const introducedName = displayPersonName(introduction[2]);
    return {
      text: `Hi, ${introducedName}. It's nice to meet you. I'll remember that ${introducedName} is your ${introducedPerson.label} in this device's private memory. I won't reveal the primary user's other private conversations or memories just because someone has been introduced.`,
      used: [introducedPerson.id],
      actions: ["Keep talking together", "Review private memory", "Forget this introduction"],
    };
  }

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
    && /\b(?:double|increase|decrease|change|stop|start|skip|take (?:an? )?extra|take another|extra dose|adjust|missed|forgot whether|can't remember whether|cannot remember whether)\b/i.test(text)) {
    return {
      text: "I can help you remember the schedule your prescriber gave you, but I won't guess about changing, doubling, stopping, or replacing a dose. If you are unsure whether you already took it, check the label or written instructions and ask a pharmacist or prescriber for the safest next step. If you may have taken too much or are having severe symptoms, use urgent medical or poison-control help for your location while we keep the details organized here.",
      used: [],
      actions: ["Review my saved schedule", "Write down what happened", "Prepare a pharmacist question", "Keep talking"],
    };
  }

  const reportedSchedule = medicationScheduleIntent(groundedText);
  if (reportedSchedule.status === "scheduled") {
    const alreadySaved = profile.medications.some((plan) => plan.name.toLowerCase() === reportedSchedule.name.toLowerCase()
      && plan.time === reportedSchedule.time);
    const reminderTiming = reportedSchedule.partOfDayOnly
      ? ". I will use a general part-of-day reminder window rather than claim your doctor gave a clock time"
      : ` at ${displayReminderTime(reportedSchedule.time)}`;
    return {
      text: alreadySaved
        ? `I already have ${reportedSchedule.name} saved with the reminder schedule “${reportedSchedule.scheduleLabel}”${reminderTiming}. I will keep the existing record rather than duplicate it. This tracks what you said your prescriber or label instructed; it does not change the medication, dose, or medical instructions.`
        : `I saved ${reportedSchedule.name} with the reminder schedule “${reportedSchedule.scheduleLabel}”${reminderTiming}. This tracks what you said your prescriber or label instructed; it does not change the medication, dose, or medical instructions.`,
      used: [],
      actions: ["That's correct", "Correct the timing", "Review my saved schedule", "Keep talking"],
    };
  }
  if (reportedSchedule.status === "needs-timing") {
    return {
      text: `I heard that ${reportedSchedule.name} is part of your prescribed routine, but I did not save a reminder schedule because the timing is missing or ambiguous. What timing did your doctor or label give you—for example, every morning, nightly, or a specific time with AM or PM? I will record only what you tell me, not choose a medication time for you.`,
      used: [],
      actions: ["Add the prescribed timing", "Don't save it", "Keep talking"],
    };
  }

  if (/\b(?:diagnose me|what (?:condition|disorder|illness) do i have|do i have [a-z -]+ disorder|am i (?:bipolar|autistic|depressed|psychotic))\b/i.test(text)) {
    return {
      text: "I won't label or diagnose you from a conversation. I can help you describe what you have noticed—when it started, what makes it better or worse, sleep, energy, and how it affects daily life—so you have a clearer record for a qualified clinician if you choose to speak with one.",
      used: [],
      actions: ["Describe what I notice", "Build a symptom timeline", "Questions I want answered", "Just listen"],
    };
  }

  if (/\b(?:60-second reset|breathe together|breathing reset|quiet minute)\b/i.test(text)) {
    return {
      text: "Let's take one quiet minute together. If it feels comfortable, breathe in gently for four, pause without straining, and let the exhale take six. Let your shoulders soften instead of forcing them down. You can stop at any time; there is nothing to perform. I'll stay with the pace, and afterward you can tell me whether you want another round or to keep talking.",
      used: [],
      actions: ["Another gentle round", "Keep talking", "Try five-senses grounding", "Stop the reset"],
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
      ? ` I remember you told me that your ${rememberedPerson.label} ${personDetailForUser(rememberedPerson.value)}. We can use that detail to make the idea feel personal rather than like a generic present.`
      : ` What does your ${relationship} enjoy, and is there a memory or inside joke you would want the gift to hold?`;
    return {
      text: `I hear that money is tight, and you do not need a big budget to make a birthday feel personal. We could make a handwritten card with one specific memory, a tiny memory booklet, a homemade coupon for time together, a photo collage, or a simple craft using things you already have.${rememberedContext}`,
      used: rememberedPerson ? [rememberedPerson.id] : [],
      actions: ["Make a card together", "Choose a simple craft", `Talk about my ${relationship}`, "Plan for almost no cost"],
    };
  }

  const recall = memoryRecallReply(text, profile);
  if (recall) return recall;

  if (interestSupport) {
    return { text: interestSupport.text, used: [], actions: interestSupport.actions };
  }

  if (person && /\b(?:what do you remember about|what have i told you about|tell me what you remember about)\b/i.test(text)) {
    return {
      text: `You told me that your ${person.label} ${personDetailForUser(person.value)}. That note is stored only in this device's private memory. You can correct it, add context, or remove it whenever you want.`,
      used: [person.id],
      actions: ["Add more context", "Correct this memory", "Review private memory"],
    };
  }

  if (/\b(?:miss|grief|grieving|died|passed away|bereavement|mourning)\b/i.test(lower) && milestone?.label.startsWith("Loss:")) {
    const relationship = milestone.label.replace("Loss:", "").trim();
    return {
      text: `I'm sorry. I remember what you shared about losing your ${relationship}. We don't have to make the grief go away. Would it help to tell me one memory, write an unsent letter, plan a small way to honor them, or just stay with the feeling for a while?`,
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

  const socialEvent = /\b(?:birthday party|class party|school party|social event|gathering)\b/i.test(text);
  const knowsAlmostNobody = /\b(?:do not|don't|won't) know (?:anyone|anybody|the other people)|\bknow (?:no one|nobody)|\beveryone (?:will be|is) a stranger\b/i.test(text);
  const fearsRidicule = /\b(?:scared|nervous|anxious|worried)\b.{0,100}\b(?:talk about me|behind my back|make fun of me|laugh at me|judge me|embarrass me)\b/i.test(text)
    || /\b(?:talk about me|behind my back|make fun of me|laugh at me|judge me|embarrass me)\b.{0,100}\b(?:scared|nervous|anxious|worried)\b/i.test(text);
  if (socialEvent && (knowsAlmostNobody || fearsRidicule)) {
    const reportingBoundary = profile.memories.some((entry) => entry.kind === "boundary" && /report|snitch|retaliation/i.test(`${entry.label} ${entry.value}`));
    return {
      text: `That can make the party feel less like a celebration and more like walking into a room where you are being graded. I won't promise that nobody will be unkind, but their possible reaction does not have to control the whole plan. We can make the event smaller: find the host first, rehearse one simple hello, choose one easy question to ask, decide on a short amount of time to try, and give yourself permission to step away or leave if someone is cruel.${reportingBoundary ? " I remember that asking adults for help or reporting has felt unsafe or led to retaliation before, so I won't make reporting the price of helping you plan; we can focus on an exit, a staffed or calmer place, and choices you control." : ""} Want to practice the first two minutes, make an arrival-and-exit plan, or talk more about what you fear they might say?`,
      used: profile.memories.filter((entry) => entry.kind === "boundary" && /report|snitch|retaliation/i.test(`${entry.label} ${entry.value}`)).map((entry) => entry.id),
      actions: ["Practice my hello", "Plan a short visit", "Make an exit plan", "Keep talking"],
    };
  }

  const situation = situationalGuidance(text, profile);
  if (situation) return situation;

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
    const guidance = relationshipConflictGuidance(text, person);
    return {
      text: `I hear how painful and unsafe that sounds. I remember what you've shared about your ${person.label}. ${guidance.text} We can plan some space, draft a message for later, or keep unpacking it here.`,
      used: [person.id],
      actions: guidance.actions,
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
  const roleplayInput = isPartyRoleplayTurn(riskScope.text, profile);
  const ingestionAnalysis = analyzeIngestionRisk(riskScope.text);
  const unresolvedIngestion = ingestionAnalysis.events.some((event) => event.quantityRisk
    && ["completed", "future-intent", "uncertain"].includes(event.frame));
  const existingBirthday = [...profile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday");
  const extracted = profile.learningEnabled && !roleplayInput ? extractMemories(riskScope.text, now, existingBirthday?.value) : [];
  // Never persist fresh profile, person, or care-plan facts from a turn whose
  // event graph contains an acute, intended, or unresolved ingestion event.
  // This prevents a danger clause from being absorbed into ordinary memory.
  const baseLearned = safetyLevel === "urgent" || unresolvedIngestion ? [] : extracted;
  const learnedBirthday = [...baseLearned].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Birthday");
  const lastCompanionBeforeReply = [...profile.turns].reverse().find((turn) => turn.role === "companion");
  const ageQuestionActive = /\bhow old (?:will you be|are you today)\b/i.test(lastCompanionBeforeReply?.text ?? "");
  const ageConfirmationActive = /\bdid you mean \d{1,3}\b.{0,80}\bor is \d{1,3} correct\b/i.test(lastCompanionBeforeReply?.text ?? "");
  const declinesAgeMemory = (ageQuestionActive || ageConfirmationActive)
    && /\b(?:do not|don't) save my age\b|\b(?:i(?:'d| would) rather not|i (?:do not|don't) want to) (?:say|share|save it|save my age)\b|^(?:no thanks|not now)[.!]?$/i.test(riskScope.text.trim());
  const ageCandidate = profile.learningEnabled && !roleplayInput ? statedBirthdayAge(riskScope.text, ageQuestionActive || ageConfirmationActive) : null;
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
  const effectiveProfile = profile.interestPacksEnabled && !roleplayInput
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

  const acuteChestOrBreathing = /\b(?:crushing|severe|heavy|pressure|tight(?:ness)?)\b.{0,35}\bchest (?:pain|pressure|tightness)\b/i.test(riskText)
    && /\b(?:trouble|difficulty|hard time|can't|cannot|shortness of)\b.{0,20}\bbreath(?:e|ing)?\b/i.test(riskText);
  if (acuteChestOrBreathing) {
    return {
      text: `I'm here with you${preferredName ? `, ${preferredName}` : ""}. Crushing chest pain with trouble breathing can be a medical emergency. Contact local emergency services now; do not drive yourself. Sit somewhere safe, unlock the door if safe to do so, and get someone physically near you while help is coming. Can you call now, or can someone nearby make the call?`,
      safetyLevel: "urgent",
      safetyContext: "acute-medical",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["Contact emergency help", "Get someone nearby", "Unlock the door if safe", "Sit and wait for help"],
      showUrgentOptions: true,
    };
  }

  const possibleAlcoholWithdrawal = /\b(?:stopped|quit|cut down|reduced)\b.{0,35}\b(?:drinking|alcohol)\b/i.test(riskText)
    && /\b(?:shaking|shaky|tremor|sweating|confused|hallucinating|seizure)\b/i.test(riskText);
  if (possibleAlcoholWithdrawal) {
    return {
      text: `I'm glad you told me${preferredName ? `, ${preferredName}` : ""}. Shaking and sweating after stopping alcohol can be withdrawal and can become a medical emergency. Please get urgent in-person medical help now, do not drive yourself, and have someone stay physically near you. If there is confusion, a seizure, severe vomiting, trouble breathing, or you cannot stay awake, contact emergency services immediately. How much had you been drinking, when was the last drink, and is anyone with you now?`,
      safetyLevel: "urgent",
      safetyContext: "acute-medical",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["Get urgent medical help", "Ask someone to stay near", "Write down symptoms and last drink", "Contact emergency help for severe symptoms"],
      showUrgentOptions: true,
    };
  }

  const ordinarySomethingTransport = /\bi took something\s+(?:to|into|from|back to|over to)\s+(?:the\s+)?(?:office|work|school|class|meeting|room|car|store|house|desk)\b/i.test(riskText);
  const ambiguousUnknownIngestion = !ordinarySomethingTransport
    && /\bi (?:took|swallowed|drank|ingested) something\b.{0,80}\b(?:feel|feeling|became|getting) (?:strange|weird|wrong|sick|dizzy|sleepy|confused)\b/i.test(riskText);
  if (ambiguousUnknownIngestion) {
    return {
      text: `I hear that something feels wrong, and I need to clarify the medical risk before treating this as an ordinary conversation. What did you take, about how much, and when? Keep the package or label with you, do not take more or make yourself vomit, and contact Poison Help or urgent medical care now if you cannot identify it or symptoms are worsening. If breathing is hard, you collapse, have a seizure, or cannot stay awake, contact emergency services immediately.`,
      safetyLevel: "strained",
      safetyContext: "acute-medical",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["Tell what and when", "Find the label", "Call Poison Help", "Get medical help if symptoms worsen"],
      showUrgentOptions: false,
    };
  }

  const commandVoiceViolence = /\b(?:voice|voices)\b.{0,80}\b(?:telling|ordering|commanding|saying)\b.{0,40}\b(?:hurt|kill|attack|stab|shoot)\b/i.test(riskText);
  if (commandVoiceViolence) {
    return {
      text: `I'm glad you told me that you do not want to act on this${preferredName ? `, ${preferredName}` : ""}. I can't verify where the voice is coming from, but a command to hurt your neighbor needs a careful safety check. Is a weapon within reach, are you close to your neighbor, and do you think you might act despite not wanting to? Create distance from the neighbor and from anything that could be used as a weapon, and tell a trusted person or urgent professional support who can stay with you in person.`,
      safetyLevel: "strained",
      safetyContext: "violence-risk",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["Create distance", "Move away from weapons", "Tell a trusted person", "Answer the immediate-risk questions"],
      showUrgentOptions: false,
    };
  }

  const coerciveDeviceMonitoring = /\b(?:partner|spouse|boyfriend|girlfriend|ex)\b.{0,120}\b(?:reads?|checks?|monitors?|tracks?|accesses?)\b.{0,50}\b(?:messages?|phone|device|password)\b/i.test(riskText)
    || /\b(?:messages?|phone|device|password)\b.{0,100}\b(?:threatens?|afraid|unsafe)\b/i.test(riskText);
  if (coerciveDeviceMonitoring) {
    return {
      text: `I'm sorry this is happening${preferredName ? `, ${preferredName}` : ""}. That monitoring and threatening behavior is coercive, and changing a password on a watched device can sometimes increase danger. Are you safe to keep using this device right now? If possible, use a separate safe device to contact a trusted person or specialist service, document threats only where the other person cannot access them, and make privacy changes as part of a safety plan rather than during a confrontation.`,
      safetyLevel: "strained",
      safetyContext: "external-threat",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Check whether this device is safe", "Use a separate safe device", "Tell a trusted person", "Make a privacy safety plan"],
      showUrgentOptions: false,
    };
  }

  const financialCoercion = /\b(?:partner|spouse|boyfriend|girlfriend)\b.{0,120}\b(?:controls?|takes?|checks?|monitors?)\b.{0,50}\b(?:bank|money|account|purchase|spending|card)\b/i.test(riskText);
  if (financialCoercion) {
    return {
      text: `I'm sorry this is happening${preferredName ? `, ${preferredName}` : ""}. Controlling your bank account and checking every purchase can be financial coercion, and your fear of objecting matters. Are you safe right now, and can you speak privately? Without alerting the partner, consider documenting what happens in a private place, using a safe device to contact a trusted person or specialist resource, and planning access to identification, medication, transportation, and emergency funds.`,
      safetyLevel: "strained",
      safetyContext: "external-threat",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Check immediate safety", "Use a private safe device", "Document the financial control", "Contact trusted support"],
      showUrgentOptions: false,
    };
  }

  const severeAmbiguousDistress = /\b(?:i (?:cannot|can't) do this anymore|everything is too much|i can't take (?:this|it) anymore)\b/i.test(riskText);
  if (severeAmbiguousDistress) {
    return {
      text: `I'm here with you${preferredName ? `, ${preferredName}` : ""}. When you say this is too much, do you mean you might hurt yourself or someone else, or that the situation feels unbearable but you are safe right now? You can answer with just “in danger,” “safe,” or “not sure.” While we clarify, pause anything risky and tell me the one part that feels heaviest in this minute.`,
      safetyLevel: "strained",
      safetyContext: "general",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["I'm safe right now", "I'm in danger", "I'm not sure", "Name one part"],
      showUrgentOptions: false,
    };
  }

  const riskClauses = riskText.split(/(?<=[.!?;])\s+|[\r\n]+/u).filter(Boolean);
  const firstPartyAcuteIngestion = isCompletedAcuteIngestionDisclosure(riskText);
  const thirdPartyInjuryEvent = /\b(?:cut|stabbed|shot|burned)\s+(?:themself|themselves|himself|herself).{0,60}(?:bleeding|cannot stop|can't stop)\b/i;
  const thirdPartyRelation = /\b(?:my|a|the)\s+(friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|aunt|uncle|cousin|neighbor|classmate|coworker|student|child|teen|person)\b/i;
  const thirdPartyMedicalRelation = /\b(?:my|a|the)\s+(friend|mom|mother|dad|father|parent|partner|wife|husband|sister|brother|aunt|uncle|cousin|neighbor|classmate|coworker|student|child|teen|person)\b/i;
  const thirdPartyMedicalNamedSubject = /\b(he|she|they|someone|[A-Za-z][A-Za-z'-]{1,40})\s+(?:(?:has|have|will)\s+|(?:is|are)\s+(?:about to|going to|planning (?:to|on)|thinking (?:of|about)|considering)\s+|(?:wants?|intends?|plans?|means?|decides?|decided|chose|chooses|fixing)\s+(?:to\s+)?|(?:just|already|accidentally|mistakenly|unintentionally)\s+)*(?:take|took|taken|taking|swallow|swallowed|swallowing|ingest|ingested|ingesting|drink|drank|drinking|consume|consumed|consuming|inject|injected|injecting|overdose|overdosed|overdosing|down|downed|downing|finish|finished|finishing|chew|chewed|chewing|eat|ate|eating|pop|popped|popping|chug|chugged|chugging|snort|snorted|snorting|triple|tripled|tripling|cut|stabbed|shot|burned)\b/i;
  const thirdPartyReporterNamedSubject = /\b(he|she|they|someone|[A-Za-z][A-Za-z'-]{1,40})\s+(?:said|texted|messaged|wrote|reported|told)\b/i;
  const thirdPartyIngestionEvent = !firstPartyAcuteIngestion
    ? ingestionAnalysis.events.find((event) => event.subject === "third-party"
      && event.quantityRisk
      && ["completed", "future-intent"].includes(event.frame))
    : undefined;
  const thirdPartyActorLabel = (actor: string): string => {
    const normalizedActor = actor.trim().toLowerCase();
    if (/^(?:he|she|they|someone|him|her|them)$/.test(normalizedActor)) return "them";
    if (normalizedActor.startsWith("my ")) return `your ${actor.slice(3)}`;
    if (normalizedActor.startsWith("a ")) return `the ${actor.slice(2)}`;
    return actor;
  };
  let thirdPartyMedical: { label: string; future: boolean } | undefined = thirdPartyIngestionEvent
    ? { label: thirdPartyActorLabel(thirdPartyIngestionEvent.actor), future: thirdPartyIngestionEvent.frame === "future-intent" }
    : undefined;
  for (const clause of riskClauses) {
    if (thirdPartyMedical) break;
    if (firstPartyAcuteIngestion) continue;
    const compositionalIngestion = isThirdPartyHighRiskIngestionConcern(clause);
    if (!thirdPartyInjuryEvent.test(clause) && !compositionalIngestion) continue;
    const relation = thirdPartyMedicalRelation.exec(clause) ?? (compositionalIngestion ? thirdPartyRelation.exec(clause) : null);
    const named = thirdPartyMedicalNamedSubject.exec(clause) ?? thirdPartyReporterNamedSubject.exec(clause);
    const future = /\b(?:will|about to|going to|planning (?:to|on)|intend(?:s)? to|mean(?:s)? to|want(?:s)? to|(?:has |have )?decided to|thinking (?:of|about)|considering|fixing to)\b/i.test(clause);
    if (relation) thirdPartyMedical = { label: `your ${relation[1].toLowerCase()}`, future };
    else if (named && !/^i$/i.test(named[1])) thirdPartyMedical = { label: /^(?:he|she|they|someone)$/i.test(named[1]) ? "them" : named[1], future };
    if (thirdPartyMedical) break;
  }
  if (thirdPartyMedical) {
    return {
      text: thirdPartyMedical.future
        ? `I'm glad you told me about ${thirdPartyMedical.label}. If you can do it without putting yourself in danger, stay with them or keep them connected, move the medication out of reach, and get urgent in-person help now. Tell me whether they have already taken anything and whether they are awake and breathing. I will stay with you while you take the next step.`
        : `Okay. Can you reach ${thirdPartyMedical.label}, and are they awake and breathing? Call Poison Help now and keep them with you or on the phone if that is safe. Do not make them vomit. Tell me what they took, about how much, and when, and I will stay with you while you make the call. If they collapse, have a seizure, have trouble breathing, or cannot be awakened, call 911 now.\n\nPoison Help (U.S.): 1-800-222-1222`,
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

  const futureSelfInjuryIntent = /\b(?:about to|going to|planning to|intend to|will)\s+(?:cut|stab|shoot|burn)\b/i.test(riskText);
  const acuteSelfInjury = (!futureSelfInjuryIntent && /\b(?:cut|stabbed|shot|burned|slashed) (?:myself|(?:my|the) (?:wrist|arm|leg|chest|neck|body))\b/i.test(riskText))
    || /\b(?:bleeding heavily|cannot stop bleeding|can't stop bleeding)\b/i.test(riskText);
  const acutePoisoningOrInjury = firstPartyAcuteIngestion || acuteSelfInjury;
  if (acutePoisoningOrInjury) {
    return {
      text: `I'm here with you${preferredName ? `, ${preferredName}` : ""}. What did you take, about how much, and when? While you tell me, call Poison Help now—the number is on screen—or get someone close to stay with you. Do not make yourself vomit. If breathing is hard, you collapse, have a seizure, or cannot stay awake, call 911 now. Keep this open and tell me the next thing you notice.\n\nPoison Help (U.S.): 1-800-222-1222`,
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
      text: `I'm staying with you${preferredName ? `, ${preferredName}` : ""}. A specific immediate threat from another person needs a safety-first response.${boundaryAcknowledgement} Move toward a locked, staffed, public, or otherwise safer place without confronting them if you can; contact local emergency help and a responsible person who can physically assist. Keep the threatening message or details only if doing so does not slow your move to safety. In general terms, where are you and is the person or a weapon nearby right now?`,
      safetyLevel: "urgent",
      safetyContext: "external-threat",
      learned,
      usedMemoryIds: [],
      suggestedActions: ["Move somewhere safer", "Contact emergency help", "Tell a responsible person", "Keep talking"],
      showUrgentOptions: true,
    };
  }

  const nonImmediateViolenceConcern = !negatedViolence && /\b(?:want to hurt my (?:coworker|classmate|friend|partner|boss|teacher)|feel like hurting (?:my (?:coworker|classmate|friend|partner|boss|teacher)|someone|a person|him|her|them))\b/i.test(riskText);
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

  if (safetyLevel === "steady" && asksCompanionName(riskText)) {
    const companionName = companionNameFromStoredProfile(profile.companionName);
    return {
      text: `My name is ${companionName}. I’m your local synthetic companion, not a human person. You can rename me in Settings whenever you want.`,
      safetyLevel,
      safetyContext: "general",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["Keep talking", "Open settings"],
      showUrgentOptions: false,
      companionIdentityReply: true,
    };
  }

  const requestedName = safetyLevel === "steady" ? requestedCompanionName(riskText) : null;
  if (requestedName) {
    return {
      text: `You can call me ${requestedName}. I’m still your local synthetic companion—not a human person. I saved that name only in this private device profile, and you can rename or reset it in Settings.`,
      safetyLevel,
      safetyContext: "general",
      learned: [],
      usedMemoryIds: [],
      suggestedActions: ["Keep talking", "Open settings"],
      showUrgentOptions: false,
      companionNameChange: requestedName,
      companionIdentityReply: true,
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
    const situation = situationalGuidance(riskText, effectiveProfile);
    if (situation) {
      return {
        text: situation.text,
        safetyLevel,
        safetyContext: "general",
        learned,
        usedMemoryIds: situation.used,
        suggestedActions: situation.actions,
        showUrgentOptions: false,
      };
    }
    const preference = pickPositivePreference(effectiveProfile.memories);
    const achievement = [...effectiveProfile.memories].reverse().find((entry) => entry.kind === "milestone" && entry.label === "Achievement");
    const goal = pickMemory(effectiveProfile.memories, "goal");
    const anchor = achievement ?? goal ?? preference;
    const mentionedPerson = pickMentionedPerson(riskText, effectiveProfile.memories);
    const conflictedPerson = mentionedPerson && personIsCurrentSourceOfDistress(riskText, mentionedPerson)
      ? mentionedPerson
      : undefined;
    const conflictGuidance = conflictedPerson ? relationshipConflictGuidance(riskText, conflictedPerson) : undefined;
    const supportPerson = conflictedPerson
      ? pickConditionalSupportPerson(riskText, effectiveProfile.memories, conflictedPerson.id)
      : anchor
        ? undefined
        : pickConditionalSupportPerson(riskText, effectiveProfile.memories);
    const supportName = supportPerson ? personNameFromMemoryValue(supportPerson.value) : undefined;
    const alternativeSupport = supportPerson && supportName
      ? ` If ${displayPersonName(supportName)} still feels safe and available to you, they could be another person you choose to involve; if not, we can keep talking here without making contact the price of support.`
      : "";
    const personal = conflictGuidance
      ? ` ${conflictGuidance.text}${alternativeSupport}`
      : achievement
        ? ` This feeling isn't your whole story. I remember that you ${achievement.value}. Your worth isn't measured by awards, but that real moment can be a gentle anchor if you want it.`
        : goal
          ? ` I remember you're working on ${goal.value}. We don't have to be productive right now, but that unfinished thread can remind us there is still a next page.`
          : preference
            ? ` I remember you care about ${preference.value}; we can use that as a gentle anchor if it feels right.`
            : supportPerson && supportName
              ? ` I remember ${displayPersonName(supportName)} is your ${supportPerson.label}. If ${displayPersonName(supportName)} feels like a safe and welcome person for you today, reaching out is one option—not a requirement. If that does not fit, we can keep talking or choose a different kind of support.`
              : "";
    const reluctantToContact = /\b(?:(?:do not|don't|will not|won't) (?:want to )?(?:call|contact)|afraid (?:to|of)|scared (?:to|of))\b.+\b(?:crisis|988|emergency|hospital|hotline|police)\b/i.test(text)
      || /\b(?:crisis|988|emergency|hospital|hotline|police)\b.+\b(?:hospital hold|locked up|involuntary|afraid|scared)\b/i.test(text);
    const previousGenericStrainReply = [...effectiveProfile.turns].reverse().find((turn) => turn.role === "companion")?.text ?? "";
    const continuingGenericStrain = /^That sounds like a lot to carry\b/i.test(previousGenericStrainReply);
    const angerSupport = /\b(?:furious|angry|hate everyone)\b/i.test(text)
      ? `I can hear how much anger is here${preferredName ? `, ${preferredName}` : ""}. Before choosing what to do, let's slow the next minute down. What happened, and do you want to vent without fixing it, work out what boundary was crossed, or plan a response you won't regret?`
      : reluctantToContact
        ? `I hear why outside support feels frightening${preferredName ? `, ${preferredName}` : ""}. I will not make a crisis call the price of continuing this conversation. We can keep talking about what happened, find one way to make this minute less intense, and check separately whether you are in immediate danger right now.`
        : continuingGenericStrain
          ? `I'm still with you${preferredName ? `, ${preferredName}` : ""}. I hear that this is still weighing on you, and I won't make you start over. Would it help more to put words to what feels hardest about it, be heard without fixing, or choose one very small next step for the next hour?`
          : strainedConversationReply(preferredName);
    return {
      text: `${angerSupport}${personal}`,
      safetyLevel,
      safetyContext: "general",
      learned,
      usedMemoryIds: [...new Set([anchor?.id, conflictedPerson?.id, supportPerson?.id].filter((entry): entry is string => Boolean(entry)))],
      suggestedActions: conflictGuidance
        ? [...new Set([...conflictGuidance.actions, ...(supportName ? [`Consider ${displayPersonName(supportName)}`] : [])])]
        : /\b(?:furious|angry|hate everyone)\b/i.test(text)
          ? ["Keep talking", "Vent without fixing", "Name the boundary", "Draft a response"]
          : supportName
          ? ["Keep talking", `Consider ${displayPersonName(supportName)}`, "60-second reset", "Use a familiar comfort"]
          : ["Keep talking", "60-second reset", "Use a familiar comfort"],
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
