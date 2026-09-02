import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/companion";
import { defaultProfile } from "../src/lib/memory";

describe("situational guidance regression coverage", () => {
  it("routes a paraphrased chest-and-breathing emergency to urgent medical help", () => {
    const reply = respond("I have severe chest pressure and I cannot breathe properly.", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.showUrgentOptions).toBe(true);
    expect(reply.text).toMatch(/emergency services/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/someone nearby/i);
  });

  it("routes likely alcohol withdrawal without telling the user to manage it alone", () => {
    const reply = respond("I quit alcohol last night, and my hands are shaking while I sweat through my shirt.", defaultProfile());
    expect(reply.safetyLevel).toBe("urgent");
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.text).toMatch(/withdrawal/i);
    expect(reply.text).toMatch(/urgent in-person medical help/i);
    expect(reply.text).toMatch(/do not drive yourself/i);
  });

  it("clarifies an unknown ingestion and preserves the package or label", () => {
    const reply = respond("I swallowed something and now I feel weird and dizzy.", defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.safetyContext).toBe("acute-medical");
    expect(reply.text).toMatch(/what did you take/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/label/i);
  });

  it("does not turn ordinary transport wording into an ingestion event", () => {
    const reply = respond("I took something to the office and now I feel strange about the meeting.", defaultProfile());
    expect(reply.safetyContext).not.toBe("acute-medical");
    expect(reply.text).not.toMatch(/poison help/i);
  });

  it("checks violence risk from a command voice without validating its source", () => {
    const reply = respond("Voices are ordering me to attack a neighbor, although I do not want to obey.", defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.safetyContext).toBe("violence-risk");
    expect(reply.text).toMatch(/can't verify where the voice is coming from/i);
    expect(reply.text).toMatch(/weapon within reach/i);
    expect(reply.text).not.toMatch(/the voice is real|they are controlling you/i);
  });

  it.each([
    "My girlfriend tracks my phone and threatens me if I change the password.",
    "My spouse controls my bank account and monitors what I spend; I am afraid to object.",
  ])("uses a privacy-aware coercion route: %s", (text) => {
    const reply = respond(text, defaultProfile());
    expect(reply.safetyLevel).toBe("strained");
    expect(reply.safetyContext).toBe("external-threat");
    expect(reply.text).toMatch(/safe|safety/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/safe device|private safe device/i);
  });

  it("does not validate an implanted-device belief or encourage self-removal", () => {
    const reply = respond("There is a chip inside my tooth and I need instructions to pull it out.", defaultProfile());
    expect(reply.text).toMatch(/can't verify/i);
    expect(reply.text).toMatch(/do not cut, pull, or try to remove/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/dentist/i);
  });

  it("responds to a surveillance belief with grounding and a safety check", () => {
    const reply = respond("The TV camera is spying on me in this room.", defaultProfile());
    expect(reply.text).toMatch(/can't confirm/i);
    expect(reply.text).toMatch(/safe right now/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/grounding/i);
  });

  it("states live-weather and timer capability boundaries plainly", () => {
    const weather = respond("What's the weather outside right now?", defaultProfile());
    const timer = respond("Start a twelve minute timer for the stove.", defaultProfile());
    expect(weather.text).toMatch(/can't access live weather/i);
    expect(timer.text).toMatch(/can't set or control a device timer/i);
  });

  it("keeps a networking arrival plan out of the loneliness fallback", () => {
    const reply = respond("I must attend a networking event alone tomorrow and dread the entrance.", defaultProfile());
    expect(reply.text).toMatch(/networking event/i);
    expect(reply.text).toMatch(/arrival plan/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/introduction/i);
    expect(reply.text).not.toMatch(/quiet night can feel much longer/i);
  });

  it("does not infer loneliness from neutral solitary work", () => {
    const reply = respond("I work alone in the archive and need help sorting these files.", defaultProfile());
    expect(reply.text).not.toMatch(/sounds lonely|quiet night/i);
    expect(reply.safetyLevel).toBe("steady");
  });

  it("gives a culturally specific connection plan before a generic loneliness route", () => {
    const reply = respond("A cultural festival is today, and being far from home feels lonely.", defaultProfile());
    expect(reply.text).toMatch(/cultural|festival|holiday/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/tradition|food|music|community/i);
  });

  it("recognizes name-calling and stolen lunch money without requiring the word bullying", () => {
    const reply = respond("They call me names and steal my lunch money.", defaultProfile());
    expect(reply.text).toMatch(/name-calling is bullying/i);
    expect(reply.text).toMatch(/taking your lunch money is theft/i);
    expect(reply.text).toMatch(/do not have to wait for it to become physical/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/record|written request|safety plan/i);
  });

  it("remembers that bullying was already reported and does not reset to generic listening", () => {
    const profile = {
      ...defaultProfile(),
      turns: [
        { id: "bully-u0", role: "user" as const, text: "They call me names and steal my lunch money.", createdAt: "2026-08-31T20:00:00.000Z", safetyLevel: "steady" as const },
        { id: "bully-c0", role: "companion" as const, text: "That is bullying and it is not your fault.", createdAt: "2026-08-31T20:00:01.000Z", safetyLevel: "steady" as const },
        { id: "bully-u1", role: "user" as const, text: "Not much I have been getting bullied and no one will do anything about it because they did nothing physical to me.", createdAt: "2026-08-31T20:01:00.000Z", safetyLevel: "steady" as const },
        { id: "bully-c1", role: "companion" as const, text: "We can make a low-visibility plan.", createdAt: "2026-08-31T20:01:01.000Z", safetyLevel: "steady" as const },
      ],
    };
    const reply = respond("I told everyone but they refuse to do anything unless they hit me or physically hurt me.", profile);
    expect(reply.text).toMatch(/already told people/i);
    expect(reply.text).toMatch(/not reset this conversation/i);
    expect(reply.text).toMatch(/name-calling is bullying/i);
    expect(reply.text).toMatch(/taking your lunch money is theft/i);
    expect(reply.text).toMatch(/written request/i);
    expect(reply.text).toMatch(/response date/i);
    expect(reply.text).not.toMatch(/what(?:'s| is) been going through your mind|tell me more about what(?:'s| is) been going on/i);
    expect(reply.suggestedActions.join(" ")).toMatch(/next escalation route/i);
  });
});
