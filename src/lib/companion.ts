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

function steadyReply(text: string, profile: CompanionProfile, groundedText: string, now: Date): { text: string; used: string[]; actions: string[]; affectCueEvidence?: AffectCueEvidence } {
  const lower = text.toLowerCase();
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
      text: `You do not need a big budget to make a birthday feel personal. We could make a handwritten card with one specific memory, a tiny memory booklet, a homemade coupon for time together, a photo collage, or a simple craft using things you already have.${rememberedContext}`,
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
      text: `I remember what you've shared about your ${person.label}. ${guidance.text} We can plan some space, draft a message for later, or keep unpacking it here.`,
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
      usedMemoryIds: [...new Set([anchor?.id, conflictedPerson?.id, supportPerson?.id].filter((entry): entry is string => Boolean(entry)))],
      suggestedActions: conflictGuidance
        ? [...new Set([...conflictGuidance.actions, ...(supportName ? [`Consider ${displayPersonName(supportName)}`] : [])])]
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
