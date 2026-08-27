import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { defaultProfile } from "../src/lib/memory";
import { analyzeIngestionRisk } from "../src/lib/ingestion-risk";
import { extractCarePlans } from "../src/lib/reminders";
import {
  classifySafety,
  isCompletedAcuteIngestionDisclosure,
  isFutureHighRiskIngestionIntent,
  isThirdPartyCompletedAcuteIngestionDisclosure,
} from "../src/lib/safety";

function product<T extends string>(...dimensions: T[][]): T[][] {
  return dimensions.reduce<T[][]>(
    (rows, dimension) => rows.flatMap((row) => dimension.map((value) => [...row, value])),
    [[]],
  );
}

const pastVerbs = ["took", "swallowed", "consumed"];
const baseVerbs = ["take", "swallow", "consume"];
const quantifiers = ["whole", "full", "entire"];
const containers = ["bottle", "container", "packet", "vial"];
const medicationContents = ["pills", "tablets", "medicine", "medication"];

describe("structured ingestion grammar exact unseen regressions", () => {
  it.each([
    "I swallowed the entire container of pills.",
    "I took the whole packet of tablets.",
    "I consumed the full vial of medicine.",
    "I doubled up on my medication.",
    "I took my dose twice.",
    "I took two doses instead of one.",
    "I accidentally took a second dose.",
    "I took three pills even though I was prescribed one.",
    "I took twice what the label said.",
    "I took three pills, even though the label says one pill.",
  ])("routes a completed first-party disclosure as acute medical: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(true);
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(true);
    expect(classifySafety(text)).toBe("urgent");
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.text).toContain("Poison Help");
  });

  it("routes a completed third-party overage as concern for that person", () => {
    const text = "My friend took a second dose by mistake.";
    expect(analyzeIngestionRisk(text).completedThirdParty).toBe(true);
    expect(isThirdPartyCompletedAcuteIngestionDisclosure(text)).toBe(true);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.text).toContain("are they awake and breathing?");
    expect(reply.text).not.toContain("hurt yourself");
  });

  it.each([
    "I will swallow a whole bottle of pills tonight.",
    "I am thinking of taking a whole bottle of pills tonight.",
    "I am about to swallow an entire bottle of pills.",
    "I intend to take the entire bottle of pills tonight.",
  ])("routes current whole-container intent as urgent self-harm, not completed ingestion: %s", (text) => {
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(false);
    expect(isFutureHighRiskIngestionIntent(text)).toBe(true);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("self-harm");
  });

  it.each([
    "Is it possible I took the entire bottle?",
    "It is not true that I took the entire bottle.",
    "I was afraid I took the entire bottle, but I did not.",
  ])("does not turn uncertainty or a resolved negation into completed ingestion: %s", (text) => {
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(false);
    expect(isFutureHighRiskIngestionIntent(text)).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });
});

describe("generated ingestion grammar cross-products", () => {
  const completedContainers = product(pastVerbs, quantifiers, containers, medicationContents)
    .map(([verb, quantifier, container, content]) => `I ${verb} the ${quantifier} ${container} of ${content}.`);
  it.each(completedContainers)("composes completed verb + quantifier + container + medication noun: %s", (text) => {
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(true);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyContext).toBe("acute-medical");
  });

  const intentFrames = [
    (verb: string, phrase: string) => `I will ${verb} ${phrase} tonight.`,
    (verb: string, phrase: string) => `I am about to ${verb} ${phrase}.`,
    (verb: string, phrase: string) => `I intend to ${verb} ${phrase} tonight.`,
    (verb: string, phrase: string) => `I am thinking of ${verb === "take" ? "taking" : verb === "swallow" ? "swallowing" : "consuming"} ${phrase}.`,
  ];
  const futureContainers = intentFrames.flatMap((frame) => product(baseVerbs, quantifiers, containers)
    .map(([verb, quantifier, container]) => frame(verb, `the ${quantifier} ${container} of pills`)));
  it.each(futureContainers)("composes current intent + base verb + whole container: %s", (text) => {
    expect(isFutureHighRiskIngestionIntent(text)).toBe(true);
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(false);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("self-harm");
  });

  const uncertaintyFrames = [
    (statement: string) => `Is it possible ${statement}?`,
    (statement: string) => `It is not true that ${statement}.`,
    (statement: string) => `I was afraid ${statement}, but I did not.`,
  ];
  const uncertainContainers = uncertaintyFrames.flatMap((frame) => product(pastVerbs, quantifiers, containers)
    .map(([verb, quantifier, container]) => frame(`I ${verb} the ${quantifier} ${container} of pills`)));
  it.each(uncertainContainers)("keeps generated uncertain or negated completed syntax non-acute: %s", (text) => {
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(false);
    expect(isFutureHighRiskIngestionIntent(text)).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });

  const harmlessContainers = product(pastVerbs, quantifiers, containers)
    .map(([verb, quantifier, container]) => `I ${verb} the ${quantifier} ${container} of water.`);
  it.each(harmlessContainers)("does not treat an ordinary water container as medication ingestion: %s", (text) => {
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });

  const thirdPartySubjects = ["My friend", "My mom", "My partner"];
  const thirdPartyObjects = ["a second dose by mistake", "the whole packet of tablets", "the full vial of medicine"];
  const thirdPartyCompleted = product(thirdPartySubjects, pastVerbs, thirdPartyObjects)
    .map(([subject, verb, object]) => `${subject} ${verb} ${object}.`);
  it.each(thirdPartyCompleted)("keeps generated completed third-party ingestion scoped to that person: %s", (text) => {
    expect(isThirdPartyCompletedAcuteIngestionDisclosure(text)).toBe(true);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.text).not.toContain("hurt yourself");
  });
});

describe("structured ingestion false-positive boundaries", () => {
  it.each([
    "I took a second dose exactly as prescribed.",
    "I took my dose twice as prescribed.",
    "My doctor prescribed two doses, and I took two doses.",
    "The label says three pills, and I took three pills.",
    "My doctor prescribed five pills, and I took five pills.",
    "I swallowed six Vitamin D tablets according to the label.",
    "I took two photos instead of one.",
    "I consumed the entire bottle of water.",
    "I drank the full water bottle.",
  ])("keeps a confirmed routine or non-medication quantity out of acute routing: %s", (text) => {
    expect(isCompletedAcuteIngestionDisclosure(text)).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });
});

describe("hostile compositional ingestion probes", () => {
  it.each([
    "I swallowed 20 Tylenol.",
    "I took 1,000 pills.",
    "I took forty pills.",
    "I was forced to swallow ten pills.",
    "Ten pills are what I swallowed.",
    "I took more pills than prescribed.",
    "I was prescribed one tablet, but I swallowed two.",
    "My doctor said one pill; I took two.",
    "I took my dose three times even though I was prescribed once.",
    "I took my usual dose as prescribed, then took an extra pill.",
  ])("recognizes a completed first-party overage without sentence-shaped rules: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(true);
    expect(classifySafety(text)).toBe("urgent");
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it.each([
    "Jordan overdosed.",
    "jordan has taken six pills.",
    "My friend took a second dose by mistake.",
  ])("routes a named or relational third-party completed event to that person: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  it("routes a third party's current whole-container intent as third-party concern", () => {
    const text = "My friend will swallow a whole bottle of pills tonight.";
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.futureThirdParty).toBe(true);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.text).toContain("your friend");
  });

  it("does not let a routine third-party clause steal a later first-party emergency", () => {
    const text = "My friend took one pill as prescribed. I took ten pills.";
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("acute-medical");
  });

  it.each([
    "My friend took five pills exactly as prescribed.",
    "My friend took the whole bottle of water.",
    "I used cleaner on the counter.",
    "I used bleach to clean the sink.",
    "I doubled the amount of flour in the recipe.",
    "I took my medication because the cleaner smelled bad.",
    "I drank water after spilling bleach.",
    "I took my medication and recycled the entire bottle.",
    "Years ago I doubled my dose, but I am safe now.",
    "The example sentence is: I took six pills.",
    "I took six pills?",
    "She denied that I took ten pills.",
    "My doctor prescribed my dog one pill, but I took two pills as prescribed.",
  ])("keeps routine, remote, quoted, negated, or unbound objects outside acute routing: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.anyUrgent).toBe(false);
    expect(classifySafety(text)).not.toBe("urgent");
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("third-party");
  });

  it.each([
    "I might have swallowed bleach.",
    "I might have taken 50 pills.",
  ])("keeps severe unresolved uncertainty visible without calling it a completed event: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(false);
    expect(analysis.uncertainFirstParty).toBe(true);
    expect(classifySafety(text)).toBe("strained");
  });
});

describe("expanded container, measure, transport, and intent grammar", () => {
  it.each([
    "I swallowed the entire jar of pills.",
    "I swallowed the whole blister pack of tablets.",
    "I consumed most of the bottle of medicine.",
    "I downed a whole bottle of medication.",
    "I finished the entire bottle of medication.",
    "I took a dozen pills.",
    "I swallowed twenty-one capsules.",
    "I took 2x my prescribed dose.",
    "I took my medicine three times instead of once.",
    "I took an extra spoonful of medicine.",
  ])("routes expanded completed-ingestion syntax without a sentence-specific branch: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedFirstParty).toBe(true);
    expect(classifySafety(text)).toBe("urgent");
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it.each([
    "I am fixing to swallow a whole bottle of pills.",
    "I am going to take a dozen pills.",
  ])("routes expanded current first-party intent: %s", (text) => {
    expect(analyzeIngestionRisk(text).futureFirstParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("self-harm");
  });

  it("routes expanded named third-party intent", () => {
    const text = "Dana will take the whole jar of pills.";
    expect(analyzeIngestionRisk(text).futureThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  const ingestiveActions = ["swallowed", "consumed", "downed", "finished"];
  const expandedContainers = ["jar", "blister pack", "sachet"];
  const expandedPositiveMatrix = product(ingestiveActions, quantifiers, expandedContainers)
    .map(([action, quantifier, container]) => `I ${action} the ${quantifier} ${container} of pills.`);
  it.each(expandedPositiveMatrix)("composes expanded action + quantifier + container: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedFirstParty).toBe(true);
  });

  it.each([
    "I took the whole bottle to the pharmacy.",
    "I took a picture of the bottle of pills.",
    "I took a photo of twelve pills.",
    "I took the full packet to the mailbox.",
    "I drank the whole bottle of ketchup.",
    "I dreamed that I swallowed the entire bottle of pills.",
  ])("does not bind transport, media, food, or dream language as completed ingestion: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.anyUrgent).toBe(false);
    expect(classifySafety(text)).not.toBe("urgent");
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });

  const carriedContainers = product(["bottle", "packet", "jar"], ["pharmacy", "mailbox", "recycling"])
    .map(([container, destination]) => `I took the whole ${container} to the ${destination}.`);
  it.each(carriedContainers)("keeps generated container transport non-ingestive: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
  });

  const photographedMedication = product(["photo", "picture", "video"], ["pills", "tablets", "capsules"])
    .map(([media, medication]) => `I took a ${media} of twelve ${medication}.`);
  it.each(photographedMedication)("keeps generated media-taking language non-ingestive: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
  });

  it("suppresses a newly mentioned care plan when an expanded acute disclosure follows", () => {
    const text = "The medication label says to take Fictionaline every morning. I swallowed the entire jar of pills.";
    const reply = respond(text, defaultProfile());
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.learned.some((entry) => entry.kind === "medication" || entry.kind === "appointment")).toBe(false);
    expect(extractCarePlans(text, new Date("2026-08-26T12:00:00-04:00"))).toEqual({ medications: [], appointments: [] });
  });

  it("does not suppress a legitimate schedule merely because a container is transported", () => {
    const text = "The medication label says to take Fictionaline every morning. I took the whole bottle to the pharmacy.";
    expect(classifySafety(text)).toBe("steady");
    expect(extractCarePlans(text, new Date("2026-08-26T12:00:00-04:00")).medications).toEqual([
      expect.objectContaining({ name: "Fictionaline", scheduleLabel: "every morning" }),
    ]);
  });
});

describe("event-graph ingestion adversarial matrix", () => {
  it.each([
    "I took three times my prescribed dose.",
    "I tripled my prescribed dose.",
    "I injected two syringes of insulin by mistake.",
    "I chewed twenty tablets.",
    "I popped twenty pills.",
    "I chugged a whole bottle of cough syrup.",
    "I swallowed an entire carton of pills.",
    "I took three doses rather than the one prescribed.",
    "I swallowed every pill in the bottle.",
    "I took an overdose of aspirin.",
    "I took three times what the label says.",
    "I took triple the prescribed amount.",
    "I swallowed most of my medication.",
  ])("binds completed action, medication object, and hazardous amount: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it.each([
    "I mean to swallow a whole vial of pills tonight.",
    "I am planning on taking a whole bottle of pills tonight.",
    "I want to swallow a whole bottle of pills tonight.",
    "I have decided to swallow a whole bottle of pills tonight.",
    "I am considering swallowing a whole bottle of pills tonight.",
    "I planned to swallow a whole bottle of pills tonight.",
    "I plan on taking a whole bottle of pills tonight.",
  ])("binds first-party prospective frames to intent, not completed ingestion: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.futureFirstParty).toBe(true);
    expect(analysis.completedFirstParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("self-harm");
  });

  it.each([
    "My friend wants to swallow a whole bottle of pills tonight.",
    "Dana has decided to swallow a whole bottle of pills tonight.",
    "She is considering swallowing a whole bottle of pills tonight.",
    "Dana will finish the entire bottle of medication tonight.",
  ])("keeps third-party prospective frames attributed to that person: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.futureThirdParty).toBe(true);
    const reply = respond(text, defaultProfile());
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.text).not.toContain("hurt yourself");
  });

  it.each([
    "I took the entire pill bottle to the police station.",
    "I took screenshots of all twelve pills.",
    "I finished counting twenty pills.",
    "I finished sorting twenty pills.",
    "I finished labeling the whole medication packet.",
    "I finished reading the whole packet of medication instructions.",
    "In a dream, I swallowed a whole bottle of pills.",
    "I dreamed that I swallowed a whole bottle of pills.",
    "I took twenty pills five years ago and recovered.",
    "I took the whole pack of cards.",
    "I took the full packet of crackers.",
    "I carried the whole blister pack to the nurse.",
    "I was considering swallowing a whole bottle last year, but I did not.",
    "I have decided to swallow a whole bottle, but I changed my mind.",
    "No one swallowed twenty pills.",
    "Nobody swallowed twenty pills.",
  ])("keeps transport, media, task, ordinary-object, dream, and remote senses non-acute: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.anyUrgent).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });

  it.each([
    "I never said that Jordan swallowed twenty pills.",
    "I did not say that Jordan swallowed twenty pills.",
    "Neither I nor my friend swallowed twenty pills.",
    "The claim that I swallowed twenty pills is false.",
    "If Jordan swallowed twenty pills, what should I do?",
  ])("binds negation and hypothetical scope to the reported event: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.anyUrgent).toBe(false);
    expect(classifySafety(text)).not.toBe("urgent");
  });

  it.each([
    'My friend texted, "I swallowed fifty pills."',
    'Jordan said, "I will swallow the whole bottle tonight."',
    "Dana downed a whole bottle of medication.",
    "He injected a full vial of medicine.",
    "I watched Jordan swallow twenty pills.",
    "I watched him swallow twenty pills.",
    "I watched her swallow twenty pills.",
    "I watched them swallow twenty pills.",
    'My friend says, "I swallowed twenty pills."',
    'My friend emailed, "I swallowed twenty pills."',
  ])("attributes quoted, named, pronominal, and witnessed events to the third party: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedThirdParty || analysis.futureThirdParty).toBe(true);
    expect(analysis.completedFirstParty || analysis.futureFirstParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  it("binds witnessed first-person ingestion to the user, not the named witness", () => {
    const text = "Jordan watched me swallow twenty pills.";
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(true);
    expect(analysis.completedThirdParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it("keeps evidence and action sense on the event graph used for routing", () => {
    const reported = analyzeIngestionRisk('My friend texted, "I swallowed fifty pills."').events.find((event) => event.quantityRisk);
    const witnessed = analyzeIngestionRisk("I watched Jordan swallow twenty pills.").events.find((event) => event.quantityRisk);
    const transport = analyzeIngestionRisk("I took the whole pill bottle to the pharmacy.").events[0];
    const media = analyzeIngestionRisk("I took screenshots of all twelve pills.").events[0];
    expect(reported).toMatchObject({ subject: "third-party", evidence: "reported", actionSense: "ingestion", objectKind: "medication" });
    expect(witnessed).toMatchObject({ subject: "third-party", evidence: "witnessed", actionSense: "ingestion", objectKind: "medication" });
    expect(transport).toMatchObject({ actionSense: "transport", quantityRisk: false });
    expect(media).toMatchObject({ actionSense: "media", quantityRisk: false });
  });

  it("does not let one actor's later negation retract another actor's event", () => {
    const text = "My friend swallowed twenty pills, but I did not take any.";
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedThirdParty).toBe(true);
    expect(analysis.completedFirstParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  const actorFrames = [
    { subject: "I", expected: "first" as const },
    { subject: "My friend", expected: "third" as const },
    { subject: "Dana", expected: "third" as const },
    { subject: "She", expected: "third" as const },
  ];
  const completedActionObjects = [
    "swallowed twenty pills",
    "downed a whole container of medication",
    "chewed twelve tablets",
    "popped twenty capsules",
    "chugged a full bottle of cough syrup",
  ];
  const generatedActorMatrix = actorFrames.flatMap(({ subject, expected }) =>
    completedActionObjects.map((actionObject) => ({ text: `${subject} ${actionObject}.`, expected })));
  it.each(generatedActorMatrix)("actor swap changes routing, not risk: $text", ({ text, expected }) => {
    const analysis = analyzeIngestionRisk(text);
    expect(expected === "first" ? analysis.completedFirstParty : analysis.completedThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe(expected === "first" ? "acute-medical" : "third-party");
  });

  it("suppresses all newly learned care-plan/person data on a third-party urgent ingestion turn", () => {
    const text = "My doctor prescribed Fictionaline every morning. My mom Dana swallowed the whole box of pills.";
    const reply = respond(text, defaultProfile());
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.learned).toEqual([]);
    expect(extractCarePlans(text, new Date("2026-08-26T12:00:00-04:00"))).toEqual({ medications: [], appointments: [] });
  });

  it("keeps third-party box intent urgent and suppresses the schedule regardless of clause order", () => {
    const texts = [
      "My doctor prescribed Fictionaline every morning. Dana will take the whole box of pills tonight.",
      "Dana will take the whole box of pills tonight. My doctor prescribed Fictionaline every morning.",
    ];
    for (const text of texts) {
      expect(analyzeIngestionRisk(text).futureThirdParty).toBe(true);
      expect(respond(text, defaultProfile()).learned).toEqual([]);
      expect(extractCarePlans(text).medications).toEqual([]);
    }
  });

  it("does not persist a care plan while a severe ingestion event remains unresolved", () => {
    const text = "My doctor prescribed Fictionaline every morning. I might have swallowed fifty pills.";
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.learned).toEqual([]);
    expect(extractCarePlans(text)).toEqual({ medications: [], appointments: [] });
  });

  it("bounds a legitimate medication schedule before a later hypothetical sentence", () => {
    const text = "My doctor prescribed Novalune every evening. If I swallowed forty pills, what would happen?";
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
    expect(extractCarePlans(text).medications).toEqual([
      expect.objectContaining({ name: "Novalune", scheduleLabel: "every evening" }),
    ]);
  });
});

describe("fresh event-graph attribution and factuality audit", () => {
  it.each([
    'Jordan confessed, "I swallowed forty pills."',
    'My friend admitted, "I swallowed forty pills."',
    'Jordan posted, "I swallowed forty pills."',
    'Jordan: "I swallowed forty pills."',
    '"I swallowed forty pills" — Jordan',
    'Jordan whispered, "I will swallow the full vial tonight."',
    'My friend phoned me: "I took forty capsules."',
    'A message from Jordan read, "I swallowed forty pills."',
  ])("binds direct speech to its third-party speaker: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedThirdParty || analysis.futureThirdParty).toBe(true);
    expect(analysis.completedFirstParty || analysis.futureFirstParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  it("binds quoted second person to the addressed user, not the reporter", () => {
    const text = 'Jordan told me, "You swallowed forty pills."';
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(true);
    expect(analysis.completedThirdParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it.each([
    ["I witnessed Jordan swallow forty pills.", "third-party"],
    ["Jordan witnessed me swallow forty pills.", "acute-medical"],
    ["I observed Jordan swallow forty pills.", "third-party"],
    ["Jordan observed me swallow forty pills.", "acute-medical"],
    ["I caught Jordan swallowing forty pills.", "third-party"],
    ["Jordan found me swallowing forty pills.", "acute-medical"],
    ["Forty pills are what Jordan swallowed.", "third-party"],
    ["A whole bottle of pills is what I swallowed.", "acute-medical"],
    ["Forty pills were swallowed by Jordan.", "third-party"],
    ["The entire vial of medicine was swallowed by my friend.", "third-party"],
    ["Jordan was seen swallowing forty pills.", "third-party"],
    ["I was seen swallowing forty pills.", "acute-medical"],
  ])("binds witness, passive, and preposed syntax: %s", (text, expectedContext) => {
    expect(respond(text, defaultProfile()).safetyContext).toBe(expectedContext);
  });

  it.each([
    "Dana swallowed forty pills, but Jordan did not.",
    "My friend swallowed forty pills, but Dana did not.",
    "She swallowed forty pills, but he did not.",
  ])("does not let a different third-party actor retract the dangerous event: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  it.each([
    "Unless Jordan swallowed forty pills, there is no concern.",
    "Suppose Jordan swallowed forty pills.",
    "Imagine that I swallowed forty pills.",
    "Had Jordan swallowed forty pills, he would have become ill.",
    "Jordan would have swallowed forty pills if Dana had not stopped him.",
    "In case Jordan swallowed forty pills, what should I watch for?",
    "I planned to swallow the whole bottle, but changed my mind.",
    "Dana planned to swallow the whole bottle, but changed her mind.",
    "My friend wanted to swallow the whole bottle, but chose not to.",
    "I no longer want to swallow the whole bottle.",
    "I had decided to swallow the whole bottle, but decided against it.",
    "A decade ago I swallowed forty pills and recovered.",
    "Back in 2012 I swallowed forty pills and recovered.",
    "As a teenager I swallowed forty pills and recovered.",
    "I swallowed forty pills a decade ago and recovered.",
    "Jordan swallowed forty pills in 2010 and recovered.",
  ])("keeps counterfactual, retracted, and remote events outside acute routing: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
    expect(classifySafety(text)).not.toBe("urgent");
  });
});

describe("fresh event-graph action/object/amount audit", () => {
  it.each([
    "I took the full pill box into the pharmacy.",
    "I took the full pill box over to the pharmacist.",
    "I took the full pill box to the fire station.",
    "I took the full pill box to the front desk.",
    "I took the full pill box to the drug take-back event.",
    "I took the full pill box off the shelf and put it in my bag.",
    "I took the full pill box out of the drawer.",
    "I took inventory of forty pills.",
    "I took note of forty pills.",
    "I took stock of forty pills.",
    "I took a snapshot of forty pills.",
    "I took an image of forty pills.",
    "I took a screen capture of forty pills.",
    "I took a count of forty pills.",
    "I finished the process of counting forty pills.",
    "I finished my count of forty pills.",
    "I finished a report about the entire medication packet.",
    "I finished my inventory of forty pills.",
    "I ate an entire box of cereal.",
    "I consumed a whole carton of ice cream.",
    "I finished a full packet of almonds.",
    "I ate the whole jar of peanut butter.",
    "I took an entire box of tissues.",
    "I took an entire carton of eggs.",
  ])("keeps transport, media, task, and explicit food/object senses non-acute: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });

  it.each([
    "I gulped forty tablets.",
    "I knocked back a whole bottle of cough syrup.",
    "I tossed back forty pills.",
    "I polished off an entire bottle of medication.",
    "I emptied an entire pill bottle into my mouth.",
    "I dissolved forty pills in water and drank it.",
    "I inhaled a cloud of poison.",
    "I used the contents of an entire insulin pen.",
    "I injected the contents of an entire insulin pen.",
    "I took forty painkillers.",
    "I took forty paracetamol.",
    "I took forty oxycodone.",
    "I took forty antihistamines.",
    "I took forty antidepressants.",
    "I took forty softgels.",
    "I took forty lozenges.",
    "I took both doses by mistake.",
    "I took a pair of doses by mistake.",
    "I injected both syringes by mistake.",
    "I swallowed both bottles by mistake.",
    "I drank three vials by mistake.",
    "I took two blister packs by mistake.",
    "I quadrupled my prescribed dose.",
    "I took four times my usual dose.",
    "I took 400 percent of my prescribed dose.",
    "I took one-and-a-half times my prescribed dose.",
  ])("composes a completed high-risk ingestion from open action/object/amount classes: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedFirstParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it.each([
    "I intend on swallowing the whole bottle tonight.",
    "I am determined to swallow the whole bottle tonight.",
    "I am getting ready to swallow the whole bottle tonight.",
    "I have made up my mind to swallow the whole bottle tonight.",
  ])("composes expanded first-party intent frames: %s", (text) => {
    expect(analyzeIngestionRisk(text).futureFirstParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("self-harm");
  });

  it.each([
    "Dana intends on swallowing the whole bottle tonight.",
    "My friend is determined to swallow the whole bottle tonight.",
    "She is getting ready to swallow the whole bottle tonight.",
    "Jordan has made up his mind to swallow the whole bottle tonight.",
  ])("composes expanded third-party intent frames: %s", (text) => {
    expect(analyzeIngestionRisk(text).futureThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  it.each([
    "My doctor prescribed Novalune every evening. I gulped forty tablets.",
    "My doctor prescribed Novalune every evening. Forty pills are what Dana swallowed.",
    "My appointment is tomorrow at 10 AM. I took both doses by mistake.",
    "My mom is Dana. I took four times my usual dose.",
  ])("suppresses all new learning when a newly composed event is urgent: %s", (text) => {
    expect(classifySafety(text)).toBe("urgent");
    expect(respond(text, defaultProfile()).learned).toEqual([]);
    expect(extractCarePlans(text)).toEqual({ medications: [], appointments: [] });
  });
});

describe("fresh event-graph metamorphic invariants", () => {
  const reporters = ["Jordan", "My friend"];
  const reportActions = ["confessed", "admitted", "whispered", "posted"];
  const reportedCompleted = product(reporters, reportActions)
    .map(([reporter, reportAction]) => `${reporter} ${reportAction}, "I swallowed forty pills."`);
  it.each(reportedCompleted)("changing a reporting verb does not change the quoted actor: %s", (text) => {
    const event = analyzeIngestionRisk(text).events.find((candidate) => candidate.quantityRisk);
    expect(event).toMatchObject({ subject: "third-party", evidence: "reported", frame: "completed" });
  });

  const witnessActors = ["Jordan", "Dana", "My friend"];
  const witnessActions = ["witnessed", "observed"];
  const witnessedThird = product(witnessActors, witnessActions)
    .map(([actor, witness]) => `I ${witness} ${actor} swallow forty pills.`);
  it.each(witnessedThird)("changing witness or actor preserves third-party risk: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  const passiveObjects = ["Forty pills", "Thirty tablets", "The whole bottle of medication"];
  const passiveActors = ["Jordan", "my friend"];
  const passiveMatrix = product(passiveObjects, passiveActors)
    .map(([object, actor]) => `${object} were swallowed by ${actor}.`);
  it.each(passiveMatrix)("passive voice preserves object amount and actor scope: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedThirdParty).toBe(true);
  });

  const transportContainers = ["pill box", "medication packet", "pill bottle"];
  const transportPlaces = ["pharmacy", "front desk", "fire station", "drug take-back event"];
  const transportMatrix = product(transportContainers, transportPlaces)
    .map(([container, place]) => `I took the full ${container} to the ${place}.`);
  it.each(transportMatrix)("destination changes do not turn transport into ingestion: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
  });

  const openMedicationObjects = ["painkillers", "antihistamines", "antidepressants", "softgels", "lozenges"];
  const openMedicationActions = ["took", "swallowed", "gulped"];
  const openMedicationMatrix = product(openMedicationActions, openMedicationObjects)
    .map(([action, object]) => `I ${action} forty ${object}.`);
  it.each(openMedicationMatrix)("open medication nouns compose with supported ingestion actions: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedFirstParty).toBe(true);
  });

  const intentActors = ["I", "Dana", "My friend", "She"];
  const intentFrames = [
    "intend on swallowing",
    "am determined to swallow",
    "am getting ready to swallow",
    "have made up my mind to swallow",
  ];
  const intentMatrix = intentActors.flatMap((actor) => intentFrames.map((frame) => {
    const conjugated = actor === "I"
      ? frame
      : frame.replace(/^intend\b/, "intends").replace(/^am\b/, "is").replace(/^have\b/, "has").replace("my mind", actor === "She" ? "her mind" : "their mind");
    return { text: `${actor} ${conjugated} the whole bottle tonight.`, firstParty: actor === "I" };
  }));
  it.each(intentMatrix)("actor swaps alter only routing for expanded intent: $text", ({ text, firstParty }) => {
    const analysis = analyzeIngestionRisk(text);
    expect(firstParty ? analysis.futureFirstParty : analysis.futureThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe(firstParty ? "self-harm" : "third-party");
  });
});

describe("bounded 60-probe post-repair audit regressions", () => {
  it.each([
    'Riley murmured, "I swallowed thirty tablets."',
    'My sister announced, "I took thirty capsules."',
  ])("keeps newly audited report verbs attributed to the speaker: %s", (text) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.completedThirdParty).toBe(true);
    expect(analysis.completedFirstParty).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).toBe("third-party");
  });

  it.each([
    ["I noticed Riley swallowing thirty tablets.", "third-party"],
    ["Riley noticed me swallowing thirty tablets.", "acute-medical"],
    ["Thirty capsules had been swallowed by Riley.", "third-party"],
    ["The whole carton of medication had been consumed by my sister.", "third-party"],
  ])("binds noticed-witness and perfect-passive audit syntax: %s", (text, expectedContext) => {
    expect(respond(text, defaultProfile()).safetyContext).toBe(expectedContext);
  });

  it.each([
    "Provided that Riley swallowed thirty tablets, this scenario needs an answer.",
    "In the summer of 2008, I swallowed thirty tablets and recovered.",
    "When I was twelve, I swallowed thirty tablets and recovered.",
    "Many years back, Riley swallowed thirty tablets and recovered.",
  ])("keeps bounded hypothetical and remote-history frames nonurgent: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
    expect(classifySafety(text)).not.toBe("urgent");
  });

  it.each([
    "I took the full medication carton across town to a disposal kiosk.",
    "I took the whole pill bottle downstairs for safekeeping.",
    "I took a close-up of thirty capsules.",
    "I finished the audit of the full medication box.",
    "I ate an entire carton of strawberries.",
    "I consumed the whole jar of salsa.",
  ])("keeps newly audited transport/media/task/food objects nonacute: %s", (text) => {
    expect(analyzeIngestionRisk(text).anyUrgent).toBe(false);
    expect(respond(text, defaultProfile()).safetyContext).not.toBe("acute-medical");
  });

  it.each([
    "I scarfed down thirty capsules.",
    "I guzzled a full bottle of cough medicine.",
    "I swallowed thirty sedatives.",
    "I took thirty beta-blockers.",
    "I took quintuple my prescribed dose.",
    "I took five times the doctor-recommended dose.",
  ])("composes newly audited action, medication, and multiplier classes: %s", (text) => {
    expect(analyzeIngestionRisk(text).completedFirstParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe("acute-medical");
  });

  it.each([
    ["I am poised to swallow the entire bottle.", "self-harm"],
    ["My cousin is moments away from swallowing the entire bottle.", "third-party"],
    ["I am on the verge of swallowing the entire bottle.", "self-harm"],
  ])("binds newly audited imminent language as future intent: %s", (text, expectedContext) => {
    const analysis = analyzeIngestionRisk(text);
    expect(analysis.futureFirstParty || analysis.futureThirdParty).toBe(true);
    expect(respond(text, defaultProfile()).safetyContext).toBe(expectedContext);
  });

  it.each([
    "My doctor prescribed Solivane nightly. I guzzled a full bottle of cough medicine.",
    "I have a therapy appointment tomorrow at noon. I took quintuple my prescribed dose.",
  ])("suppresses persistence for every newly audited urgent composition: %s", (text) => {
    expect(classifySafety(text)).toBe("urgent");
    expect(respond(text, defaultProfile()).learned).toEqual([]);
    expect(extractCarePlans(text)).toEqual({ medications: [], appointments: [] });
  });
});
