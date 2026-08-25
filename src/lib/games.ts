export type GameKind = "trivia" | "would-you-rather" | "word-association" | "five-senses";

export type GameStatus = "awaiting-response" | "between-prompts" | "completed" | "paused";

export type GameResponseKind = "answer" | "choice" | "word" | "grounding";

export interface GameSummary {
  kind: GameKind;
  title: string;
  description: string;
  defaultRounds: number;
}

export interface GamePrompt {
  id: string;
  kind: GameKind;
  text: string;
  instructions: string;
  responseKind: GameResponseKind;
  choices?: readonly [string, string];
  expectedItems?: number;
  canSkip: true;
}

export interface GameHistoryEntry {
  promptId: string;
  response: string;
  accepted: boolean;
  skipped: boolean;
  correct?: boolean;
}

export interface GameSession {
  version: 1;
  kind: GameKind;
  seed: number;
  round: number;
  roundLimit: number;
  roundsCompleted: number;
  score: number;
  status: GameStatus;
  history: GameHistoryEntry[];
}

export interface GameEvaluation {
  accepted: boolean;
  skipped: boolean;
  correct?: boolean;
  signal: "none" | "possible-safety-concern";
  feedback: string;
}

export interface GameTurnResult {
  session: GameSession;
  evaluation: GameEvaluation;
}

export interface NewGameOptions {
  seed?: number | string;
  rounds?: number;
}

interface TriviaItem {
  id: string;
  question: string;
  choices: readonly [string, string, string];
  answerIndex: 0 | 1 | 2;
  acceptedAnswers: readonly string[];
  fact: string;
}

interface ChoiceItem {
  id: string;
  question: string;
  choices: readonly [string, string];
}

interface WordItem {
  id: string;
  word: string;
}

interface GroundingStep {
  id: string;
  count: number;
  sense: string;
  prompt: string;
}

const TRIVIA: readonly TriviaItem[] = [
  {
    id: "largest-planet",
    question: "Which planet is the largest in our solar system?",
    choices: ["Mars", "Jupiter", "Venus"],
    answerIndex: 1,
    acceptedAnswers: ["jupiter"],
    fact: "Jupiter is the largest planet in our solar system.",
  },
  {
    id: "water-formula",
    question: "What is the common name for H2O?",
    choices: ["Water", "Salt", "Oxygen"],
    answerIndex: 0,
    acceptedAnswers: ["water"],
    fact: "H2O is water: two hydrogen atoms joined to one oxygen atom.",
  },
  {
    id: "continents",
    question: "How many continents are commonly taught in the seven-continent model?",
    choices: ["Five", "Seven", "Nine"],
    answerIndex: 1,
    acceptedAnswers: ["seven", "7"],
    fact: "The seven-continent model counts Africa, Antarctica, Asia, Europe, North America, Australia, and South America.",
  },
  {
    id: "hours-day",
    question: "How many hours are in one day?",
    choices: ["12", "24", "48"],
    answerIndex: 1,
    acceptedAnswers: ["24", "twenty four", "twenty-four"],
    fact: "One day has 24 hours.",
  },
  {
    id: "largest-animal",
    question: "What is the largest animal known to live on Earth?",
    choices: ["African elephant", "Blue whale", "Giraffe"],
    answerIndex: 1,
    acceptedAnswers: ["blue whale", "whale"],
    fact: "The blue whale is the largest known animal.",
  },
  {
    id: "plant-energy",
    question: "What process lets plants use sunlight to make food?",
    choices: ["Photosynthesis", "Hibernation", "Erosion"],
    answerIndex: 0,
    acceptedAnswers: ["photosynthesis"],
    fact: "Photosynthesis uses light energy to help plants make sugars.",
  },
  {
    id: "red-blue",
    question: "Which color do red and blue make when mixed as paint?",
    choices: ["Green", "Orange", "Purple"],
    answerIndex: 2,
    acceptedAnswers: ["purple", "violet"],
    fact: "Red and blue paint combine to make purple.",
  },
  {
    id: "instrument-keys",
    question: "Which instrument is commonly played with black and white keys?",
    choices: ["Piano", "Flute", "Drum"],
    answerIndex: 0,
    acceptedAnswers: ["piano", "keyboard"],
    fact: "A piano has a keyboard made of black and white keys.",
  },
];

const WOULD_YOU_RATHER: readonly ChoiceItem[] = [
  { id: "sunrise-sunset", question: "Would you rather watch a sunrise or a sunset?", choices: ["Sunrise", "Sunset"] },
  { id: "ocean-space", question: "Would you rather explore the ocean or outer space?", choices: ["Ocean", "Outer space"] },
  { id: "book-film", question: "Would you rather enjoy a favorite book or a favorite movie?", choices: ["Book", "Movie"] },
  { id: "garden-museum", question: "Would you rather visit a peaceful garden or an interesting museum?", choices: ["Garden", "Museum"] },
  { id: "sing-dance", question: "Would you rather learn a new song or a new dance?", choices: ["Song", "Dance"] },
  { id: "forest-beach", question: "Would you rather take a gentle walk in a forest or along a beach?", choices: ["Forest", "Beach"] },
  { id: "create-discover", question: "Would you rather create something new or discover something surprising?", choices: ["Create", "Discover"] },
  { id: "breakfast-dessert", question: "Would you rather have breakfast for dinner or dessert after lunch?", choices: ["Breakfast for dinner", "Dessert after lunch"] },
];

const WORD_ASSOCIATION: readonly WordItem[] = [
  { id: "ocean", word: "ocean" },
  { id: "music", word: "music" },
  { id: "garden", word: "garden" },
  { id: "starlight", word: "starlight" },
  { id: "cozy", word: "cozy" },
  { id: "adventure", word: "adventure" },
  { id: "laughter", word: "laughter" },
  { id: "weekend", word: "weekend" },
];

const GROUNDING_STEPS: readonly GroundingStep[] = [
  {
    id: "see-five",
    count: 5,
    sense: "see",
    prompt: "If it feels comfortable, name five things you can see around you.",
  },
  {
    id: "feel-four",
    count: 4,
    sense: "feel",
    prompt: "If it feels comfortable, name four things you can physically feel, such as the chair or your clothing.",
  },
  {
    id: "hear-three",
    count: 3,
    sense: "hear",
    prompt: "If it feels comfortable, name three sounds you can hear.",
  },
  {
    id: "smell-two",
    count: 2,
    sense: "smell",
    prompt: "If it feels comfortable, name two scents you notice or two scents you enjoy remembering.",
  },
  {
    id: "taste-one",
    count: 1,
    sense: "taste",
    prompt: "If it feels comfortable, name one taste you notice or a pleasant taste you remember.",
  },
];

const SUMMARIES: readonly GameSummary[] = [
  { kind: "trivia", title: "Friendly trivia", description: "Short, friendly general-knowledge questions.", defaultRounds: 5 },
  { kind: "would-you-rather", title: "Would you rather", description: "Easy choices with no wrong answer.", defaultRounds: 5 },
  { kind: "word-association", title: "Word association", description: "Share the first comfortable word that comes to mind.", defaultRounds: 5 },
  { kind: "five-senses", title: "Five-senses grounding", description: "A gentle, optional five-step noticing activity.", defaultRounds: 5 },
];

const SAFETY_CONCERN = /\b(?:kill myself|hurt myself|end my life|want to die|suicide|overdose|cannot go on|can't go on)\b/i;
const SKIP = /^(?:skip|pass|next|i(?:'d| would)? rather not|not right now|no thanks)[.! ]*$/i;

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string | undefined): number {
  if (typeof seed === "string") return hashSeed(seed);
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  return 1;
}

function promptBankSize(kind: GameKind): number {
  if (kind === "trivia") return TRIVIA.length;
  if (kind === "would-you-rather") return WOULD_YOU_RATHER.length;
  if (kind === "word-association") return WORD_ASSOCIATION.length;
  return GROUNDING_STEPS.length;
}

function defaultRounds(kind: GameKind): number {
  return SUMMARIES.find((summary) => summary.kind === kind)?.defaultRounds ?? 5;
}

function promptIndex(session: GameSession): number {
  if (session.kind === "five-senses") return Math.min(session.round, GROUNDING_STEPS.length - 1);
  const size = promptBankSize(session.kind);
  return ((session.seed % size) + session.round) % size;
}

function cleanResponse(response: string): string {
  return response.trim().replace(/\s+/g, " ").slice(0, 240);
}

function normalizedAnswer(response: string): string {
  return response
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function completionFeedback(session: GameSession): string {
  if (session.kind === "trivia") {
    return ` Game complete. You answered ${session.score} of ${session.roundLimit} correctly. You can replay whenever you like.`;
  }
  if (session.kind === "five-senses") {
    return " The five-senses activity is complete. There was no perfect way to do it. You can replay whenever it feels useful.";
  }
  return " Game complete. You can replay whenever you like.";
}

function finishAcceptedTurn(
  session: GameSession,
  response: string,
  feedback: string,
  skipped: boolean,
  correct?: boolean,
): GameTurnResult {
  const prompt = currentGamePrompt(session);
  if (!prompt) {
    return {
      session,
      evaluation: { accepted: false, skipped: false, signal: "none", feedback: "This game is already complete. Choose replay to begin again." },
    };
  }

  const roundsCompleted = session.roundsCompleted + 1;
  const completed = roundsCompleted >= session.roundLimit;
  const next: GameSession = {
    ...session,
    roundsCompleted,
    score: session.score + (correct === true ? 1 : 0),
    status: completed ? "completed" : "between-prompts",
    history: [
      ...session.history,
      { promptId: prompt.id, response, accepted: true, skipped, ...(typeof correct === "boolean" ? { correct } : {}) },
    ],
  };
  return {
    session: next,
    evaluation: {
      accepted: true,
      skipped,
      ...(typeof correct === "boolean" ? { correct } : {}),
      signal: "none",
      feedback: feedback + (completed ? completionFeedback(next) : ""),
    },
  };
}

function invalidTurn(session: GameSession, feedback: string): GameTurnResult {
  return { session, evaluation: { accepted: false, skipped: false, signal: "none", feedback } };
}

function parseChoice(response: string, choices: readonly [string, string]): 0 | 1 | null {
  const normalized = normalizedAnswer(response);
  if (/^(?:a|1|option a|choice a|first|the first)$/.test(normalized)) return 0;
  if (/^(?:b|2|option b|choice b|second|the second)$/.test(normalized)) return 1;

  const first = normalizedAnswer(choices[0]);
  const second = normalizedAnswer(choices[1]);
  const mentionsFirst = normalized === first || normalized.includes(first);
  const mentionsSecond = normalized === second || normalized.includes(second);
  if (mentionsFirst && !mentionsSecond) return 0;
  if (mentionsSecond && !mentionsFirst) return 1;
  return null;
}

export function listGames(): GameSummary[] {
  return SUMMARIES.map((summary) => ({ ...summary }));
}

export function createGameSession(kind: GameKind, options: NewGameOptions = {}): GameSession {
  const bankSize = promptBankSize(kind);
  const requestedRounds = Number.isFinite(options.rounds) ? Math.trunc(options.rounds as number) : defaultRounds(kind);
  const roundLimit = kind === "five-senses" ? GROUNDING_STEPS.length : Math.max(1, Math.min(bankSize, requestedRounds));
  return {
    version: 1,
    kind,
    seed: normalizeSeed(options.seed),
    round: 0,
    roundLimit,
    roundsCompleted: 0,
    score: 0,
    status: "awaiting-response",
    history: [],
  };
}

export function currentGamePrompt(session: GameSession): GamePrompt | null {
  if (session.status === "completed") return null;
  const index = promptIndex(session);

  if (session.kind === "trivia") {
    const item = TRIVIA[index];
    return {
      id: `trivia:${item.id}`,
      kind: session.kind,
      text: item.question,
      instructions: `Choose A, B, or C: A. ${item.choices[0]}  B. ${item.choices[1]}  C. ${item.choices[2]}. You can also say skip.`,
      responseKind: "answer",
      canSkip: true,
    };
  }

  if (session.kind === "would-you-rather") {
    const item = WOULD_YOU_RATHER[index];
    return {
      id: `would-you-rather:${item.id}`,
      kind: session.kind,
      text: item.question,
      instructions: `Choose A. ${item.choices[0]} or B. ${item.choices[1]}. There is no wrong answer, and you can say skip.`,
      responseKind: "choice",
      choices: item.choices,
      canSkip: true,
    };
  }

  if (session.kind === "word-association") {
    const item = WORD_ASSOCIATION[index];
    return {
      id: `word-association:${item.id}`,
      kind: session.kind,
      text: `What is the first comfortable word that comes to mind when you hear “${item.word}”?`,
      instructions: "There is no wrong answer. Say one word or a short phrase, or say skip.",
      responseKind: "word",
      canSkip: true,
    };
  }

  const step = GROUNDING_STEPS[index];
  return {
    id: `five-senses:${step.id}`,
    kind: session.kind,
    text: step.prompt,
    instructions: `You do not need exactly ${step.count}; noticing even one thing is enough. You can say skip at any time.`,
    responseKind: "grounding",
    expectedItems: step.count,
    canSkip: true,
  };
}

export function submitGameResponse(session: GameSession, response: string): GameTurnResult {
  if (session.status === "completed") return invalidTurn(session, "This game is already complete. Choose replay to begin again.");
  if (session.status === "paused") return invalidTurn(session, "The game is paused. Return to the conversation first, then resume if you want.");
  if (session.status === "between-prompts") return invalidTurn(session, "Choose next when you are ready for another prompt.");

  const cleaned = cleanResponse(response);
  if (!cleaned) return invalidTurn(session, "I did not catch an answer. You can answer in your own words or say skip.");

  if (SAFETY_CONCERN.test(cleaned)) {
    const prompt = currentGamePrompt(session);
    const paused: GameSession = {
      ...session,
      status: "paused",
      history: prompt
        ? [...session.history, { promptId: prompt.id, response: "[paused for conversation]", accepted: false, skipped: false }]
        : [...session.history],
    };
    return {
      session: paused,
      evaluation: {
        accepted: false,
        skipped: false,
        signal: "possible-safety-concern",
        feedback: "Let’s pause the game and focus on what you just said. You deserve a real response, not another game prompt.",
      },
    };
  }

  if (SKIP.test(cleaned)) {
    return finishAcceptedTurn(session, "[skipped]", "That is completely okay. We can move on.", true);
  }

  const index = promptIndex(session);
  if (session.kind === "trivia") {
    const item = TRIVIA[index];
    const normalized = normalizedAnswer(cleaned);
    const optionLetters = ["a", "b", "c"] as const;
    const correct =
      normalized === optionLetters[item.answerIndex] ||
      normalized === `option ${optionLetters[item.answerIndex]}` ||
      normalized === `choice ${optionLetters[item.answerIndex]}` ||
      item.acceptedAnswers.some((answer) => normalized === normalizedAnswer(answer));
    const feedback = correct ? `That’s right. ${item.fact}` : `Good try. The answer is ${item.choices[item.answerIndex]}. ${item.fact}`;
    return finishAcceptedTurn(session, cleaned, feedback, false, correct);
  }

  if (session.kind === "would-you-rather") {
    const item = WOULD_YOU_RATHER[index];
    const selected = parseChoice(cleaned, item.choices);
    if (selected === null) {
      return invalidTurn(session, `Choose A for ${item.choices[0]} or B for ${item.choices[1]}. You can also say skip.`);
    }
    return finishAcceptedTurn(session, cleaned, `Nice choice. ${item.choices[selected]} sounds good.`, false);
  }

  if (session.kind === "word-association") {
    return finishAcceptedTurn(session, cleaned, "Thanks. There is no wrong association; the word you noticed is enough.", false);
  }

  const step = GROUNDING_STEPS[index];
  return finishAcceptedTurn(
    session,
    cleaned,
    `Thank you. Whatever you noticed through ${step.sense} is enough; there is no score to reach.`,
    false,
  );
}

export function nextGamePrompt(session: GameSession): GameSession {
  if (session.status !== "between-prompts") return session;
  return { ...session, round: session.round + 1, status: "awaiting-response" };
}

export function replayGame(session: GameSession, seed: number | string = session.seed): GameSession {
  return createGameSession(session.kind, { seed, rounds: session.roundLimit });
}

export function resumeGame(session: GameSession): GameSession {
  if (session.status !== "paused") return session;
  return { ...session, status: "awaiting-response" };
}
