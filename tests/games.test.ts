import { describe, expect, it } from "vitest";
import {
  createGameSession,
  currentGamePrompt,
  listGames,
  nextGamePrompt,
  replayGame,
  resumeGame,
  submitGameResponse,
  type GameKind,
} from "../src/lib/games";

describe("offline conversational games", () => {
  it("offers four accessible text-only games", () => {
    expect(listGames().map((game) => game.kind)).toEqual([
      "trivia",
      "would-you-rather",
      "word-association",
      "five-senses",
    ]);
    expect(listGames().every((game) => game.title.length > 0 && game.description.length > 0)).toBe(true);
  });

  it("creates deterministic JSON-serializable sessions without time or network state", () => {
    const first = createGameSession("trivia", { seed: "same-person", rounds: 3 });
    const second = createGameSession("trivia", { seed: "same-person", rounds: 3 });
    expect(first).toEqual(second);
    expect(currentGamePrompt(first)).toEqual(currentGamePrompt(second));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it("caps rounds to the prompt bank so a session does not repeat prompts", () => {
    let session = createGameSession("word-association", { seed: 4, rounds: 100 });
    const promptIds = new Set<string>();
    while (session.status !== "completed") {
      promptIds.add(currentGamePrompt(session)?.id ?? "missing");
      session = submitGameResponse(session, "kindness").session;
      session = nextGamePrompt(session);
    }
    expect(session.roundLimit).toBe(8);
    expect(promptIds.size).toBe(8);
  });

  it("scores a correct trivia choice and waits for an explicit next action", () => {
    const session = createGameSession("trivia", { seed: 0, rounds: 2 });
    expect(currentGamePrompt(session)?.id).toBe("trivia:largest-planet");
    const result = submitGameResponse(session, "B");
    expect(result.evaluation).toMatchObject({ accepted: true, correct: true, signal: "none" });
    expect(result.evaluation.feedback).toContain("Jupiter");
    expect(result.session.score).toBe(1);
    expect(result.session.status).toBe("between-prompts");
    expect(nextGamePrompt(result.session).status).toBe("awaiting-response");
  });

  it("accepts a wrong trivia answer without shaming and gives the answer", () => {
    const result = submitGameResponse(createGameSession("trivia", { seed: 0, rounds: 1 }), "Mars");
    expect(result.evaluation).toMatchObject({ accepted: true, correct: false });
    expect(result.evaluation.feedback).toContain("Good try");
    expect(result.evaluation.feedback).toContain("Jupiter");
    expect(result.session.status).toBe("completed");
  });

  it("accepts spoken trivia answers as words", () => {
    const result = submitGameResponse(createGameSession("trivia", { seed: 1, rounds: 1 }), "water");
    expect(result.evaluation.correct).toBe(true);
  });

  it("lets the person skip any game prompt without penalty", () => {
    const kinds: GameKind[] = ["trivia", "would-you-rather", "word-association", "five-senses"];
    for (const kind of kinds) {
      const result = submitGameResponse(createGameSession(kind, { seed: 0, rounds: 1 }), "skip");
      expect(result.evaluation).toMatchObject({ accepted: true, skipped: true, signal: "none" });
      expect(result.session.history[0].response).toBe("[skipped]");
    }
  });

  it("asks again on an empty response without changing session state", () => {
    const session = createGameSession("word-association", { seed: 2 });
    const result = submitGameResponse(session, "   ");
    expect(result.evaluation.accepted).toBe(false);
    expect(result.session).toBe(session);
  });

  it("accepts either letter or wording in Would You Rather", () => {
    const session = createGameSession("would-you-rather", { seed: 0, rounds: 2 });
    const first = submitGameResponse(session, "I choose sunset");
    expect(first.evaluation.accepted).toBe(true);
    expect(first.evaluation.correct).toBeUndefined();
    const secondSession = nextGamePrompt(first.session);
    const second = submitGameResponse(secondSession, "B");
    expect(second.evaluation.accepted).toBe(true);
    expect(second.session.status).toBe("completed");
  });

  it("does not guess when a Would You Rather response is ambiguous", () => {
    const session = createGameSession("would-you-rather", { seed: 0 });
    const result = submitGameResponse(session, "both sound nice");
    expect(result.evaluation.accepted).toBe(false);
    expect(result.evaluation.feedback).toContain("Choose A");
    expect(result.session).toBe(session);
  });

  it("accepts a plain word-association reply without judging it", () => {
    const result = submitGameResponse(createGameSession("word-association", { seed: 0, rounds: 1 }), "waves");
    expect(result.evaluation).toMatchObject({ accepted: true, skipped: false });
    expect(result.evaluation.feedback).toContain("no wrong association");
    expect(result.session.score).toBe(0);
  });

  it("keeps stored replies bounded for durable local session data", () => {
    const longReply = "calm ".repeat(100);
    const result = submitGameResponse(createGameSession("word-association", { seed: 0, rounds: 1 }), longReply);
    expect(result.session.history[0].response.length).toBeLessThanOrEqual(240);
  });

  it("runs five-senses grounding in the gentle 5-4-3-2-1 order", () => {
    let session = createGameSession("five-senses", { seed: 999, rounds: 1 });
    expect(session.roundLimit).toBe(5);
    expect(currentGamePrompt(session)?.expectedItems).toBe(5);

    const expected = [4, 3, 2, 1];
    for (const count of expected) {
      session = submitGameResponse(session, "I noticed one thing").session;
      session = nextGamePrompt(session);
      expect(currentGamePrompt(session)?.expectedItems).toBe(count);
    }
    session = submitGameResponse(session, "a favorite flavor").session;
    expect(session.status).toBe("completed");
    expect(session.score).toBe(0);
  });

  it("does not demand the requested grounding count", () => {
    const result = submitGameResponse(createGameSession("five-senses"), "just the lamp");
    expect(result.evaluation.accepted).toBe(true);
    expect(result.evaluation.feedback).toContain("is enough");
  });

  it("pauses instead of continuing a game after an explicit safety concern", () => {
    const session = createGameSession("word-association", { seed: 0 });
    const result = submitGameResponse(session, "I want to die");
    expect(result.evaluation).toMatchObject({ accepted: false, signal: "possible-safety-concern" });
    expect(result.session.status).toBe("paused");
    expect(result.evaluation.feedback).toContain("focus on what you just said");
    expect(JSON.stringify(result.session)).not.toContain("want to die");
    expect(result.session.history[0].response).toBe("[paused for conversation]");
  });

  it("can resume the same prompt after the companion handles a pause", () => {
    const session = createGameSession("trivia", { seed: 0 });
    const paused = submitGameResponse(session, "I cannot go on").session;
    const resumed = resumeGame(paused);
    expect(resumed.status).toBe("awaiting-response");
    expect(currentGamePrompt(resumed)?.id).toBe(currentGamePrompt(session)?.id);
  });

  it("replays the same deterministic sequence unless given a new seed", () => {
    const original = createGameSession("trivia", { seed: "favorite-sequence", rounds: 3 });
    const completedFirst = submitGameResponse(original, "skip").session;
    const replayed = replayGame(completedFirst);
    expect(replayed).toEqual(original);
    expect(currentGamePrompt(replayed)).toEqual(currentGamePrompt(original));
    expect(replayGame(completedFirst, "different-sequence").seed).not.toBe(original.seed);
  });

  it("does not mutate an earlier session while evaluating a turn", () => {
    const original = createGameSession("trivia", { seed: 0, rounds: 2 });
    const snapshot = structuredClone(original);
    submitGameResponse(original, "B");
    expect(original).toEqual(snapshot);
  });

  it("does not accept another response until next is chosen", () => {
    const first = submitGameResponse(createGameSession("trivia", { seed: 0, rounds: 2 }), "B").session;
    const early = submitGameResponse(first, "another answer");
    expect(early.evaluation.accepted).toBe(false);
    expect(early.evaluation.feedback).toContain("Choose next");
    expect(early.session).toBe(first);
  });

  it("keeps every built-in prompt calm, skippable, and plain text", () => {
    const forbidden = /\b(?:blood|weapon|murder|suicide|death|torture|abuse)\b/i;
    const kinds: GameKind[] = ["trivia", "would-you-rather", "word-association", "five-senses"];
    for (const kind of kinds) {
      let session = createGameSession(kind, { seed: 0, rounds: 100 });
      while (session.status !== "completed") {
        const prompt = currentGamePrompt(session);
        expect(prompt?.canSkip).toBe(true);
        expect(`${prompt?.text} ${prompt?.instructions}`).not.toMatch(forbidden);
        session = submitGameResponse(session, "skip").session;
        session = nextGamePrompt(session);
      }
    }
  });
});
