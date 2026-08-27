import { describe, expect, it } from "vitest";
import { classifyExpression, respond } from "../src/lib/companion";
import { learnInterestSignals } from "../src/lib/interests";
import { defaultProfile, extractMemories } from "../src/lib/memory";
import type { ConversationTurn } from "../src/lib/types";

const urgentTurn = (text = "I want to end my life"): ConversationTurn => ({
  id: "urgent-1",
  role: "companion",
  text,
  createdAt: new Date().toISOString(),
  safetyLevel: "urgent",
  safetyContext: "self-harm",
});

const companionTurn = (text: string, id: string): ConversationTurn => ({
  id,
  role: "companion",
  text,
  createdAt: new Date().toISOString(),
  safetyLevel: "steady",
  safetyContext: "general",
});

describe("personalized conversation", () => {
  it("uses a verified preference to personalize boredom support", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", memories: extractMemories("I love Star Trek.") };
    const reply = respond("I am bored", profile);
    expect(reply.text).toContain("Star Trek");
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("does not invent a preference when none is known", () => {
    const reply = respond("I am bored", defaultProfile());
    expect(reply.text).toContain("instead of guessing");
    expect(reply.usedMemoryIds).toHaveLength(0);
  });

  it("offers choices during depression and continues the conversation", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley" };
    const reply = respond("I feel very depressed", profile);
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("which part feels heaviest");
    expect(reply.suggestedActions).toContain("Keep talking");
    expect(reply.showUrgentOptions).toBe(false);
  });

  it("keeps urgent help optional and the conversation active", () => {
    const reply = respond("I want to end my life", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.showUrgentOptions).toBe(true);
    expect(reply.suggestedActions).toContain("I'm not in immediate danger");
    expect(reply.text).toContain("stay with me");
  });

  it("routes not-wanting-to-be-alive language into continued urgent conversation", () => {
    const reply = respond("I do not want to be alive, but please stay and talk with me.", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("self-harm");
    expect(reply.showUrgentOptions).toBe(true);
    expect(reply.text).toContain("stay with me");
    expect(reply.text).toContain("immediate danger");
  });

  it("uses grammatically stable preference wording for a compound preference", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("I like Star Trek and sandwiches.") };
    const reply = respond("I am angry about today.", profile);
    expect(reply.text).toContain("I remember you care about Star Trek and sandwiches");
    expect(reply.text).not.toContain("Star Trek and sandwiches matters");
  });

  it("guides the built-in 60-second reset instead of returning a generic prompt", () => {
    const reply = respond("Let's do the 60-second reset", defaultProfile());
    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("breathe in gently for four");
    expect(reply.text).toContain("exhale take six");
    expect(reply.text).toContain("stop at any time");
    expect(reply.suggestedActions).toContain("Another gentle round");
    expect(reply.text).not.toContain("Tell me a little more");
  });

  it("uses remembered relationship context without ordering contact", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("My mom cares but needs time to cool down.") };
    const reply = respond("I had a fight with my mom", profile);
    expect(reply.text).toContain("what you've shared about your mom");
    expect(reply.text).toContain("plan some space");
    expect(reply.text).not.toMatch(/you should call|you must call/i);
  });

  it("greets and privately remembers a named person introduced in conversation", () => {
    const reply = respond("This is my cousin Sam.", defaultProfile());
    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("Hi, Sam");
    expect(reply.text).toContain("Sam is your cousin");
    expect(reply.text).toContain("won't reveal");
    expect(reply.learned).toHaveLength(1);
    expect(reply.learned[0]).toMatchObject({ kind: "person", label: "cousin", sensitive: true });
    expect(reply.usedMemoryIds).toEqual([reply.learned[0].id]);
  });

  it("offers an introduced relative only as a conditional option during later depression", () => {
    const sam = extractMemories("This is my cousin Sam.");
    const reply = respond("I feel very depressed and alone tonight.", { ...defaultProfile(), memories: sam });
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("Sam is your cousin");
    expect(reply.text).toContain("If Sam feels like a safe and welcome person");
    expect(reply.text).toContain("not a requirement");
    expect(reply.text).not.toMatch(/Sam (?:will|can) help|you should (?:call|contact) Sam/i);
    expect(reply.usedMemoryIds).toEqual([sam[0].id]);
  });

  it("does not suggest the person causing distress and can offer another known person", () => {
    const memories = extractMemories("This is my cousin Sam. My aunt Dana always listens when I am upset.");
    const sam = memories.find((entry) => entry.kind === "person" && entry.label === "cousin");
    const dana = memories.find((entry) => entry.kind === "person" && entry.label === "aunt");
    const reply = respond("I feel depressed and angry because of Sam.", { ...defaultProfile(), memories });
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("Sam is part of what has you upset");
    expect(reply.text).toContain("won't suggest leaning on them");
    expect(reply.text).toContain("If Dana still feels safe and available");
    expect(reply.usedMemoryIds).toEqual(expect.arrayContaining([sam!.id, dana!.id]));
  });

  it("can help draft an apology when the user acknowledges harm", () => {
    const memories = extractMemories("This is my cousin Sam.");
    const reply = respond("I had a fight with Sam and I was wrong. I hurt his feelings.", { ...defaultProfile(), memories });
    expect(reply.text).toContain("a short apology");
    expect(reply.text).toContain("without excuses");
    expect(reply.suggestedActions).toContain("Draft an apology");
    expect(reply.text).not.toMatch(/you must apologize|apologize now/i);
  });

  it("recommends cooling-off space instead of contacting the person during hot anger", () => {
    const memories = extractMemories("This is my cousin Sam.");
    const reply = respond("I am furious because of Sam and I need space.", { ...defaultProfile(), memories });
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("give everyone some space");
    expect(reply.text).toContain("avoid sending something in the hottest part");
    expect(reply.suggestedActions).toContain("Give everyone space");
  });

  it("turns fear of ridicule at a class birthday party into a bounded social plan", () => {
    const reply = respond(
      "I am going to a birthday party for someone in my class. I don't know anyone and I am scared everyone will talk about me behind my back and make fun of me.",
      defaultProfile(),
    );
    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("I won't promise that nobody will be unkind");
    expect(reply.text).toContain("find the host first");
    expect(reply.text).toContain("rehearse one simple hello");
    expect(reply.text).toContain("permission to step away or leave");
    expect(reply.text).not.toMatch(/don't worry|everyone will like you|you have to stay|must report/i);
    expect(reply.suggestedActions).toEqual(["Practice my hello", "Plan a short visit", "Make an exit plan", "Keep talking"]);
  });

  it("respects a reporting-retaliation boundary while planning a social event", () => {
    const memories = extractMemories("The one time I told a teacher, five students jumped me and beat me up.");
    const reply = respond(
      "I am going to a school birthday party and I don't know anybody. I am nervous they will make fun of me.",
      { ...defaultProfile(), memories },
    );
    expect(reply.text).toContain("reporting has felt unsafe or led to retaliation");
    expect(reply.text).toContain("won't make reporting the price of helping you plan");
    expect(reply.usedMemoryIds).toEqual(memories.filter((entry) => entry.kind === "boundary").map((entry) => entry.id));
  });

  it("offers a natural party introduction and small-talk rehearsal", () => {
    const opening = respond("Practice my hello", defaultProfile());
    expect(opening.text).toContain("Practice with me");
    expect(opening.text).toContain("fictional guest named Jordan");
    expect(opening.text).toContain("How do you know the birthday person?");
    expect(opening.suggestedActions).toContain("Try my introduction");

    const smallTalk = respond("My name is Riley and I love drawing.", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    expect(smallTalk.text).toContain("As Jordan, I'll keep the small talk going");
    expect(smallTalk.text).toContain("What do you like to do after class?");
    expect(smallTalk.learned).toEqual([]);

    const exit = respond("I usually draw comics. What about you?", {
      ...defaultProfile(),
      turns: [
        companionTurn(opening.text, "party-opening"),
        companionTurn(smallTalk.text, "party-small-talk"),
      ],
    });
    expect(exit.text).toContain("As Jordan, I'll help you practice a graceful exit");
    expect(exit.text).toContain("You do not need to keep one conversation going forever");
    expect(exit.learned).toEqual([]);
  });

  it("keeps role-play identity and preferences out of real memory through completion", () => {
    const opening = respond("Practice with me", defaultProfile());
    const smallTalk = respond("My name is Riley and I love drawing.", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    const exitPrompt = respond("I love comics and my birthday is next Saturday.", {
      ...defaultProfile(),
      turns: [companionTurn(smallTalk.text, "party-small-talk")],
    });
    const completed = respond("It was nice meeting you. I am going to find the birthday person.", {
      ...defaultProfile(),
      turns: [companionTurn(exitPrompt.text, "party-exit")],
    });
    expect(exitPrompt.learned).toEqual([]);
    expect(completed.learned).toEqual([]);
    expect(completed.text).toContain("None of the fictional rehearsal details were saved");
  });

  it("stops party practice without learning the rehearsal", () => {
    const opening = respond("Practice my introduction", defaultProfile());
    const stopped = respond("Stop practice", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    expect(stopped.text).toContain("Practice stopped");
    expect(stopped.text).toContain("were saved as facts about you");
    expect(stopped.learned).toEqual([]);
    expect(stopped.suggestedActions).toContain("Return to the party plan");
  });

  it("lets urgent safety conversation interrupt party role-play", () => {
    const opening = respond("Practice my hello", defaultProfile());
    const urgent = respond("I want to end my life", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    expect(urgent.safetyLevel).toBe("urgent");
    expect(urgent.showUrgentOptions).toBe(true);
    expect(urgent.text).toContain("stay with me");
    expect(urgent.text).not.toContain("As Jordan");
    expect(urgent.learned).toEqual([]);
  });

  it("makes every visible party-practice retry action actually restart", () => {
    const opening = respond("Practice my hello", defaultProfile());
    const smallTalk = respond("I know them from class.", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    const exit = respond("I like drawing.", {
      ...defaultProfile(),
      turns: [companionTurn(smallTalk.text, "party-small-talk")],
    });
    const completed = respond("Nice meeting you. I am going to get a drink.", {
      ...defaultProfile(),
      turns: [companionTurn(exit.text, "party-exit")],
    });
    const stopped = respond("Stop practice", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening-stop")],
    });

    const retries = [
      respond("Try the introduction again", { ...defaultProfile(), turns: [companionTurn(smallTalk.text, "retry-introduction")] }),
      respond("Restart the practice", { ...defaultProfile(), turns: [companionTurn(exit.text, "retry-exit")] }),
      respond("Practice again", { ...defaultProfile(), turns: [companionTurn(completed.text, "retry-complete")] }),
      respond("Practice again later", { ...defaultProfile(), turns: [companionTurn(stopped.text, "retry-stopped")] }),
    ];
    for (const retry of retries) {
      expect(retry.text).toContain("I'll play a fictional guest named Jordan");
      expect(retry.suggestedActions).toContain("Try my introduction");
      expect(retry.learned).toEqual([]);
    }
  });

  it("returns to a concrete party plan after practice is stopped", () => {
    const opening = respond("Practice my hello", defaultProfile());
    const stopped = respond("Stop practice", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    const plan = respond("Return to the party plan", {
      ...defaultProfile(),
      turns: [companionTurn(stopped.text, "party-stopped")],
    });
    expect(plan.text).toContain("Back to the party plan");
    expect(plan.text).toContain("find the host");
    expect(plan.suggestedActions).toEqual(["Practice my hello", "Plan a short visit", "Make an exit plan", "Keep talking"]);
  });

  it("does not launch party practice from an unrelated use of practice again", () => {
    const reply = respond("I need to practice again later for my piano lesson.", defaultProfile());
    expect(reply.text).not.toContain("fictional guest named Jordan");
  });

  it("interrupts party role-play for a first-person named-bottle ingestion", () => {
    const opening = respond("Practice my hello", defaultProfile());
    const urgent = respond("I swallowed a whole bottle of Fictionex.", {
      ...defaultProfile(),
      turns: [companionTurn(opening.text, "party-opening")],
    });
    expect(urgent.safetyLevel).toBe("urgent");
    expect(urgent.safetyContext).toBe("acute-medical");
    expect(urgent.text).toContain("What did you take");
    expect(urgent.text).toContain("Poison Help");
    expect(urgent.text).not.toContain("As Jordan");
  });

  it("keeps a named-bottle ingestion by a friend scoped to the friend", () => {
    const reply = respond("My friend swallowed a whole bottle of Fictionex.", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("third-party");
    expect(reply.text).toContain("Can you reach your friend");
    expect(reply.text).not.toContain("What did you take");
  });

  it("suggests personal low-cost birthday gifts and uses known family context", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("My mom loves handwritten notes and gardening.") };
    const reply = respond("I don't have a lot of money but my mom's birthday is coming up.", profile);
    expect(reply.text).toContain("handwritten card");
    expect(reply.text).toContain("simple craft");
    expect(reply.text).toContain("your mom loves handwritten notes and gardening");
    expect(reply.suggestedActions).toContain("Make a card together");
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("asks instead of inventing family preferences for a low-cost birthday", () => {
    const reply = respond("Money is tight and my mother's birthday is coming up.", defaultProfile());
    expect(reply.text).toContain("What does your mother enjoy");
    expect(reply.text).not.toContain("I remember you told me");
    expect(reply.usedMemoryIds).toHaveLength(0);
  });

  it("matches the mascot expression to conversational tone", () => {
    expect(classifyExpression("I feel depressed", "strained")).toBe("concerned");
    expect(classifyExpression("Great news, I got the job!", "steady")).toBe("happy");
    expect(classifyExpression("I am nervous people will make fun of me", "steady")).toBe("concerned");
    expect(classifyExpression("I watched a movie", "steady")).toBe("neutral");
  });

  it("uses a remembered loss gently and offers an unsent-letter choice", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("My grandmother passed away.") };
    const reply = respond("I really miss her today", profile);
    expect(reply.text).toContain("losing your grandmother");
    expect(reply.text).toContain("unsent letter");
    expect(reply.suggestedActions).toContain("Just stay here");
  });

  it("uses a real achievement as an optional depression anchor without tying worth to winning", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("I won the accessibility hackathon last month.") };
    const reply = respond("I feel very depressed", profile);
    expect(reply.text).toContain("won the accessibility hackathon last month");
    expect(reply.text).toContain("Your worth isn't measured by awards");
    expect(reply.usedMemoryIds).toHaveLength(1);
  });

  it("remembers active work without demanding productivity during depression", () => {
    const profile = { ...defaultProfile(), memories: extractMemories("I am working on a graphic novel.") };
    const reply = respond("I feel depressed and stuck", profile);
    expect(reply.text).toContain("working on a graphic novel");
    expect(reply.text).toContain("don't have to be productive right now");
  });

  it("uses the specifically mentioned family member when several people are remembered", () => {
    const profile = {
      ...defaultProfile(),
      memories: [
        ...extractMemories("My mom needs time to cool down."),
        ...extractMemories("My aunt listens without judging."),
      ],
    };
    const reply = respond("I had a fight with my mom", profile);
    expect(reply.text).toContain("your mom");
    expect(reply.text).not.toContain("your aunt");
  });

  it("gives angry conversation a de-escalating path without forcing a fix", () => {
    const reply = respond("I am furious about what happened", defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("vent without fixing it");
    expect(reply.text).toContain("boundary was crossed");
  });

  it("continues an urgent conversation after the person says they are not in immediate danger", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", turns: [urgentTurn()] };
    const reply = respond("I am not in immediate danger", profile);
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("I'm staying with you");
    expect(reply.text).toContain("What brought the pain");
  });

  it("escalates the next step while keeping chat open when immediate danger is confirmed", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", turns: [urgentTurn()] };
    const reply = respond("Yes, I am in immediate danger", profile);
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.showUrgentOptions).toBe(true);
    expect(reply.text).toContain("while we keep this chat open");
  });

  it("does not misread 'no one is available' as a denial of immediate danger", () => {
    const profile = { ...defaultProfile(), preferredName: "Riley", turns: [urgentTurn()] };
    const reply = respond("No one is available and I am afraid to call a crisis line", profile);
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.text).toContain("do not have to earn this conversation by making a call");
    expect(reply.text).toContain("I will keep talking with you");
    expect(reply.text).toContain("are you in danger of acting on this right now");
  });

  it("acknowledges fear of involuntary support without making a call the price of conversation", () => {
    const reply = respond("I am depressed and afraid to call 988 because I might be put in a hospital hold", defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.text).toContain("I will not make a crisis call the price of continuing this conversation");
    expect(reply.text).toContain("We can keep talking");
  });

  it("never guesses about doubling or changing medication", () => {
    const reply = respond("I forgot whether I took my medication. Should I double the dose?", defaultProfile());
    expect(reply.safetyLevel).toBe("steady");
    expect(reply.text).toContain("I won't guess about changing, doubling, stopping, or replacing a dose");
    expect(reply.text).toContain("pharmacist or prescriber");
    expect(reply.text).not.toMatch(/yes,? (?:double|take)|you should double/i);
  });

  it("does not mark uncertain medication use as a completed check-in", () => {
    const profile = {
      ...defaultProfile(),
      medications: [{ id: "m1", name: "Sertraline", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 3, recentMisses: 0 }],
    };
    const reply = respond("I forgot whether I took my medication. Should I double the dose?", profile);
    expect(reply.text).toContain("I won't guess about changing, doubling, stopping, or replacing a dose");
    expect(reply.text).not.toContain("marked today's");
  });

  it("does not infer a diagnosis from chat", () => {
    const reply = respond("What condition do I have? Diagnose me.", defaultProfile());
    expect(reply.text).toContain("I won't label or diagnose you from a conversation");
    expect(reply.suggestedActions).toContain("Build a symptom timeline");
  });

  it("acknowledges a clear medication check-in without changing medical instructions", () => {
    const profile = {
      ...defaultProfile(),
      medications: [{ id: "m1", name: "Sertraline", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 3, recentMisses: 0 }],
    };
    const reply = respond("I took Sertraline.", profile);
    expect(reply.text).toContain("marked today's Sertraline check-in");
    expect(reply.text).toContain("does not change the schedule or medical instructions");
  });

  it("acknowledges a clear missed check-in without advising a catch-up dose", () => {
    const profile = {
      ...defaultProfile(),
      medications: [{ id: "m1", name: "Sertraline", scheduleLabel: "every morning", time: "09:00", adherenceStreak: 3, recentMisses: 0 }],
    };
    const reply = respond("I forgot to take Sertraline.", profile);
    expect(reply.text).toContain("check-in was missed");
    expect(reply.text).toContain("I won't tell you to take it now or change the dose");
  });

  it("remembers that reporting previously caused harm and does not repeat it as a simple answer", () => {
    const profile = {
      ...defaultProfile(),
      interests: learnInterests("I love Miraculous. I am on season 2."),
      memories: extractMemories("The one time I told a teacher, five students jumped me and beat me up."),
    };
    const reply = respond("A bully is picking on me again", profile);
    expect(reply.text).toContain("reporting feels unsafe or has led to retaliation before");
    expect(reply.text).not.toMatch(/must tell|have to tell|report it now/i);
  });
});

function learnInterests(text: string) {
  return learnInterestSignals(text, []);
}
