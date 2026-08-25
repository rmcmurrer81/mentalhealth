import type { CompanionProfile, InterestFact, InterestPack, InterestProgress } from "./types";

const MAX_INTERESTS = 24;
const MAX_FAVORITES = 12;

type CuratedPack = {
  title: string;
  aliases: string[];
  facts: InterestFact[];
};

const curatedPacks: CuratedPack[] = [
  {
    title: "Miraculous: Tales of Ladybug & Cat Noir",
    aliases: ["miraculous", "miraculous ladybug", "ladybug and cat noir", "ladybug & cat noir"],
    facts: [
      {
        id: "miraculous-marinette-premise",
        text: "Marinette Dupain-Cheng is a student who becomes Ladybug and grows through courage, responsibility, and teamwork.",
        sourceLabel: "Official Miraculous character profile",
        sourceUrl: "https://www.miraculousladybug.com/characters/ladybug/",
        spoilerLevel: "premise",
      },
      {
        id: "miraculous-origin-bullying",
        text: "In the official Origins synopsis, Chloé bullies Marinette, while Marinette struggles with confidence about becoming Ladybug.",
        sourceLabel: "Official Miraculous Season 1 Origins synopsis",
        sourceUrl: "https://www.miraculousladybug.com/season-1-episode-22-ladybug-cat-noir/",
        spoilerLevel: "episode",
        minimumProgress: { season: 1, episode: 22 },
      },
    ],
  },
  {
    title: "My Little Pony: Friendship Is Magic",
    aliases: ["my little pony", "friendship is magic", "mlp"],
    facts: [
      {
        id: "mlp-friendship-premise",
        text: "The series follows six pony friends through adventures and lessons about friendship, kindness, acceptance, and what makes each person unique.",
        sourceLabel: "Hasbro franchise description",
        sourceUrl: "https://newsroom.hasbro.com/news-releases/news-release-details/my-little-pony-brand-celebrates-international-day-friendship",
        spoilerLevel: "premise",
      },
      {
        id: "mlp-elements-premise",
        text: "Hasbro associates Pinkie Pie with laughter, Fluttershy with kindness, Applejack with honesty, Rainbow Dash with loyalty, Rarity with generosity, and Twilight Sparkle with the magic of friendship.",
        sourceLabel: "Hasbro Friendship Day parent guide",
        sourceUrl: "https://www.hasbro.com/common/assets/html5/MyLittlePony/friendshipDay_2015/documents/en-us/pg_twilight.pdf",
        spoilerLevel: "premise",
      },
    ],
  },
];

const normalize = (value: string) => value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const newId = (topic: string) => `interest-${normalize(topic).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic"}`;

function curatedFor(text: string): CuratedPack | undefined {
  const normalized = normalize(text);
  return curatedPacks.find((pack) => pack.aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized)));
}

function safeTopic(value: string): string {
  return value.replace(/\b(?:later|again|a lot|so much)\b.*$/i, "").replace(/[.!?].*$/, "").trim().slice(0, 80);
}

function packFromTopic(topic: string, existing?: InterestPack): InterestPack {
  const curated = curatedFor(topic);
  const title = curated?.title ?? safeTopic(topic);
  return {
    id: existing?.id ?? newId(title),
    title,
    normalizedTitle: normalize(title),
    favoriteCharacters: existing?.favoriteCharacters ?? [],
    progressLabel: existing?.progressLabel,
    progress: existing?.progress,
    spoilerBoundaryKnown: existing?.spoilerBoundaryKnown ?? false,
    facts: curated?.facts.slice(0, 16) ?? existing?.facts ?? [],
    updatedAt: new Date().toISOString(),
  };
}

function parsedProgress(label: string, completed: boolean): InterestProgress {
  const seasonValue = label.match(/\bseason\s*(\d{1,3})\b/i)?.[1];
  const episodeValue = label.match(/\bepisode\s*(\d{1,4})\b/i)?.[1];
  const season = seasonValue ? Number.parseInt(seasonValue, 10) : undefined;
  const episode = episodeValue ? Number.parseInt(episodeValue, 10) : undefined;
  return {
    season,
    episode,
    completedThroughSeason: completed && season !== undefined && episode === undefined ? season : undefined,
  };
}

function progressReachesFact(pack: InterestPack, fact: InterestFact): boolean {
  if (fact.spoilerLevel === "premise") return true;
  if (!fact.minimumProgress || !pack.progress) return false;
  const required = fact.minimumProgress;
  const progress = pack.progress;
  if ((progress.completedThroughSeason ?? 0) >= required.season) return true;
  if (progress.season === undefined) return false;
  if (progress.season > required.season) return true;
  return progress.season === required.season
    && progress.episode !== undefined
    && progress.episode >= required.episode;
}

export function mergeInterestPacks(existing: InterestPack[], updates: InterestPack[]): InterestPack[] {
  const merged = new Map(existing.map((pack) => [pack.normalizedTitle, pack]));
  for (const update of updates) {
    const previous = merged.get(update.normalizedTitle);
    merged.set(update.normalizedTitle, previous ? {
      ...previous,
      ...update,
      favoriteCharacters: [...new Set([...previous.favoriteCharacters, ...update.favoriteCharacters])].slice(0, MAX_FAVORITES),
      facts: update.facts.length ? update.facts.slice(0, 16) : previous.facts,
    } : update);
  }
  return [...merged.values()].slice(-MAX_INTERESTS);
}

export function learnInterestSignals(text: string, existing: InterestPack[]): InterestPack[] {
  const cleaned = text.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_000);
  if (!cleaned) return [];
  const updates: InterestPack[] = [];
  const curated = curatedFor(cleaned);
  const likeMatch = cleaned.match(/\b(?:i (?:really )?(?:like|love|enjoy)|i(?:'m| am) (?:a )?fan of|i watch)\s+(.+?)(?:[.!?]|$)/i);
  const topic = curated?.title ?? (likeMatch ? safeTopic(likeMatch[1]) : "");
  if (topic) {
    const normalizedTopic = normalize(curated?.title ?? topic);
    const previous = existing.find((pack) => pack.normalizedTitle === normalizedTopic || curated?.aliases.some((alias) => pack.normalizedTitle.includes(normalize(alias))));
    updates.push(packFromTopic(topic, previous));
  }

  const target = updates[0] ?? (curated ? packFromTopic(curated.title, existing.find((pack) => pack.normalizedTitle === normalize(curated.title))) : existing.at(-1));
  if (!target) return updates;

  const favorite = cleaned.match(/\b(?:my )?favou?rite (?:character|pony|hero)(?: (?:in|from) [^.!?]+?)? is\s+([A-Za-z][A-Za-z0-9' -]{0,48})(?:[.!?,]|$)/i);
  const progress = cleaned.match(/\b(?:i(?:'m| am) (?:on|up to|at)|i (?:just )?(finished|watched|completed))\s+((?:season|series|book|episode|chapter|movie)\s*[A-Za-z0-9 .:-]{1,48})(?:[.!?,]|$)/i);
  const progressLabel = progress?.[2]?.trim().replace(/[.!?,]+$/, "");
  const enriched: InterestPack = {
    ...target,
    favoriteCharacters: favorite ? [...new Set([...target.favoriteCharacters, favorite[1].trim()])].slice(0, MAX_FAVORITES) : target.favoriteCharacters,
    progressLabel: progressLabel ?? target.progressLabel,
    progress: progressLabel ? parsedProgress(progressLabel, Boolean(progress?.[1])) : target.progress,
    spoilerBoundaryKnown: Boolean(progressLabel) || target.spoilerBoundaryKnown,
    updatedAt: new Date().toISOString(),
  };
  return mergeInterestPacks(updates.filter((pack) => pack.normalizedTitle !== enriched.normalizedTitle), [enriched]);
}

export function factsSafeForConversation(pack: InterestPack): InterestFact[] {
  return pack.facts.filter((fact) => progressReachesFact(pack, fact));
}

export function interestConversation(text: string, profile: CompanionProfile): { text: string; actions: string[] } | null {
  if (!profile.interestPacksEnabled) return null;
  const learnedNow = learnInterestSignals(text, profile.interests);
  const interests = mergeInterestPacks(profile.interests, learnedNow);
  const mentioned = curatedFor(text);
  const pack = mentioned
    ? interests.find((interest) => interest.normalizedTitle === normalize(mentioned.title))
    : interests.at(-1);
  const isBullying = /\b(?:bully|bullied|bullying|picking on me|picked on me|harassing me)\b/i.test(text);

  if (isBullying) {
    const miraculous = interests.find((interest) => interest.normalizedTitle === normalize("Miraculous: Tales of Ladybug & Cat Noir"));
    const userAlreadyInvokedMarinette = /\b(?:marinette|ladybug)\b/i.test(text);
    const originBullyingFactIsSafe = miraculous
      ? factsSafeForConversation(miraculous).some((fact) => fact.id === "miraculous-origin-bullying")
      : false;
    const reportingBoundary = [...profile.memories].reverse().find((memory) => memory.kind === "boundary" && (memory.label === "Reporting retaliation risk" || memory.label === "Do not repeat reporting suggestion"));
    const severeThreat = /\b(?:death threat|threaten(?:ed|ing|s)? to kill|said (?:they|he|she) (?:will|would|is going to) kill|weapon|gun|knife|planned attack|waiting for me after school|stalk(?:ing|ed|s)?)\b/i.test(text);
    const analogy = miraculous && (originBullyingFactIsSafe || userAlreadyInvokedMarinette)
      ? " Marinette faced Chloé’s bullying while struggling to find her confidence as Ladybug. We can use that as a private decision lens—not as a promise that fiction has an easy answer."
      : "";
    const rememberedRisk = reportingBoundary
      ? " I remember that reporting feels unsafe or has led to retaliation before, so I will not keep presenting it as a simple or risk-free answer."
      : "";
    if (severeThreat) {
      return {
        text: `This sounds materially more dangerous than ordinary bullying because you described a specific threat, weapon, stalking, or planned attack.${rememberedRisk} Preserve the exact message or details if you can do that safely, move toward a safer or more public place, and seriously consider bringing in a carefully chosen safe adult or police. If the threat is happening now, use local emergency services. I will keep talking with you while you decide the safest next move.`,
        actions: ["Get somewhere safer", "Preserve exact evidence", "Think through who could intervene", "Keep talking"],
      };
    }
    const reportingOption = reportingBoundary
      ? ""
      : " If you want, we can also think about one carefully chosen person who might help without exposing you; if you say no, I will remember and not keep asking.";
    return {
      text: `That sounds hurtful, and it is not your fault.${rememberedRisk}${analogy} I will not force you to report it or call you a snitch. What consequence are you most worried about if anyone finds out? We can keep talking, make a low-visibility plan for tomorrow, rehearse a response, save evidence privately, or switch to homework for a calmer next step.${reportingOption} If you are in immediate physical danger, getting to a safer place comes first.`,
      actions: ["Keep it private and talk", "Quiet plan for tomorrow", "Rehearse a response", "Help with homework"],
    };
  }

  if (/\bwhat would\s+.+?\s+do\b/i.test(text)) {
    const favorite = pack?.favoriteCharacters.at(-1);
    return {
      text: `Let's use ${favorite ?? "that character"} as a values lens, without pretending powers, wealth, or plot armor are available. Which quality matters most here—patience, courage, evidence, protecting someone, setting a boundary, or simply making it through today? Then we can turn that quality into one realistic step you control.`,
      actions: ["Courage", "Patience", "Evidence", "A boundary", "Just get through today"],
    };
  }

  if (pack && (mentioned || /\b(?:favorite character|where (?:are you|am i) in|talk about)\b/i.test(text))) {
    const favorite = pack.favoriteCharacters.at(-1);
    const progress = pack.progressLabel;
    const fact = factsSafeForConversation(pack)[0];
    const remembered = [favorite ? `your favorite is ${favorite}` : "", progress ? `you are around ${progress}` : ""].filter(Boolean).join(" and ");
    return {
      text: `${remembered ? `I remember ${remembered}. ` : ""}${fact ? `${fact.text} ` : ""}${!favorite ? "Who is your favorite character? " : ""}${!progress ? "Where are you in the series so I can avoid spoilers?" : "What part would be fun to talk about right now?"}`.trim(),
      actions: [favorite ? `Why I like ${favorite}` : "My favorite character", progress ? "Talk without spoilers" : "Where I am in the series", "Use a character as a decision lens"],
    };
  }

  return null;
}

export function validateInterestSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}
