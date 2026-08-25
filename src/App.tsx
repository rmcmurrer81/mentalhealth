import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedMascot } from "./components/AnimatedMascot";
import { classifyExpression, respond } from "./lib/companion";
import {
  createGameSession,
  currentGamePrompt,
  listGames,
  nextGamePrompt,
  replayGame,
  resumeGame,
  submitGameResponse,
  type GameKind,
  type GamePrompt,
  type GameSession,
} from "./lib/games";
import { learnInterestSignals, mergeInterestPacks } from "./lib/interests";
import { enhanceSteadyReply } from "./lib/local-model";
import { nextMemoryGeneration, resolveWithProfileGenerations } from "./lib/memory-generation";
import {
  detachRecognitionHandlersBeforeStop,
  finalRecognitionTranscript,
  handsFreeStatus,
  recognitionCallbackIsCurrent,
  recognitionErrorIsRecoverable,
  type RecognitionResultLike,
} from "./lib/hands-free";
import { birthdayForDate, clearProfile, defaultProfile, forgetMemory, loadProfile, localDateKey, mergeMemories, saveProfile } from "./lib/memory";
import { appendAffectCueEvidence } from "./lib/affect-cues";
import {
  appointmentReminder,
  applyAdherenceSignal,
  extractCarePlans,
  medicationReminder,
  mergeAppointmentPlans,
  mergeMedicationPlans,
  type ReminderCard,
} from "./lib/reminders";
import { realRiskText, urgentOptions } from "./lib/safety";
import {
  createVault,
  hasVault,
  loadVaultEnvelope,
  openVault,
  resealVault,
  saveVaultEnvelope,
  type VaultRole,
  type VaultSession,
} from "./lib/privacy-vault";
import { PrivacySessionEpochGuard } from "./lib/privacy-session";
import type { CompanionExpression, CompanionProfile, ConversationTurn, MemoryRecord } from "./lib/types";
import { createLocalVoiceOutput, type VoiceOutput } from "./lib/voice";
import { approvedVoicePreview } from "./lib/voice-preview";

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type RecognitionConstructor = new () => RecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

const id = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const defaultConversationActions = ["Tell you my name", "Talk about today", "Play together", "See how memory works"];

const openingTurn = (): ConversationTurn => ({
  id: id(),
  role: "companion",
  text: "Hi. I’m a synthetic companion. If that feels right to you, I can be your synthetic friend—someone who listens, remembers what you choose to share, and never pretends to be biological. What would you like me to call you?",
  createdAt: new Date().toISOString(),
  safetyLevel: "steady",
});

const guardianOpeningTurn = (): ConversationTurn => ({
  id: id(),
  role: "companion",
  text: "Guardian space is open. I know I’m speaking with a parent or legal guardian. This is a separate conversation and I will not reveal the primary user’s private conversations or memories.",
  createdAt: new Date().toISOString(),
  safetyLevel: "steady",
});

function ensureOpening(profile: CompanionProfile, role: VaultRole, now = new Date()): CompanionProfile {
  const normalized = {
    ...defaultProfile(),
    ...profile,
    affectCueEvidence: Array.isArray(profile.affectCueEvidence) ? profile.affectCueEvidence : [],
  };
  const opened = normalized.turns.length
    ? normalized
    : { ...normalized, turns: [role === "guardian" ? guardianOpeningTurn() : openingTurn()] };
  if (role !== "primary" || !birthdayForDate(opened, now)) return opened;
  const dateKey = localDateKey(now);
  if (opened.turns.some((turn) => turn.id === `birthday-${dateKey}`)) return opened;
  return {
    ...opened,
    turns: [...opened.turns, {
      id: `birthday-${dateKey}`,
      role: "companion",
      text: `Happy birthday${opened.preferredName ? `, ${opened.preferredName}` : ""}. I'm glad you opened your companion today. As your synthetic friend, I remember this date because you chose to share it. How old are you today, if you feel like sharing? We can celebrate, talk about how the day feels, make a small plan, or simply have some company.`,
      createdAt: now.toISOString(),
      safetyLevel: "steady",
      safetyContext: "general",
    }],
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function gamePromptText(prompt: GamePrompt): string {
  return `${prompt.text} ${prompt.instructions}`;
}

function gamePromptActions(prompt: GamePrompt): string[] {
  if (prompt.kind === "trivia") return ["A", "B", "C", "Skip", "Stop game"];
  if (prompt.kind === "would-you-rather") return ["A", "B", "Skip", "Stop game"];
  return ["Skip", "Stop game"];
}

export default function App() {
  const startsLockedRef = useRef(hasVault("primary"));
  const [profile, setProfileState] = useState<CompanionProfile>(() => {
    const loaded = startsLockedRef.current ? defaultProfile() : loadProfile();
    return ensureOpening(loaded, "primary");
  });
  const [locked, setLocked] = useState(startsLockedRef.current);
  const [accessRole, setAccessRole] = useState<VaultRole>("primary");
  const [unlockRole, setUnlockRole] = useState<VaultRole>("primary");
  const [privacyConfigured, setPrivacyConfigured] = useState(() => hasVault("primary"));
  const [guardianConfigured, setGuardianConfigured] = useState(() => hasVault("guardian"));
  const [unlockPassword, setUnlockPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [guardianPassword, setGuardianPassword] = useState("");
  const [guardianConfirmPassword, setGuardianConfirmPassword] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessProblem, setAccessProblem] = useState("");
  const [input, setInput] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [waving, setWaving] = useState(true);
  const [expression, setExpression] = useState<CompanionExpression>("neutral");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [lastLearned, setLastLearned] = useState<MemoryRecord[]>([]);
  const [actions, setActions] = useState<string[]>(() => [...defaultConversationActions]);
  const [showUrgent, setShowUrgent] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [modelNotice, setModelNotice] = useState("Deterministic offline core ready");
  const [modelBusy, setModelBusy] = useState(false);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const handsFreeRef = useRef(false);
  const voiceProcessingRef = useRef(false);
  const speakingRef = useRef(false);
  const modelBusyRef = useRef(false);
  const profileRef = useRef(profile);
  const lockedRef = useRef(startsLockedRef.current);
  const memoryGenerationRef = useRef(0);
  const privacySessionGuardRef = useRef(new PrivacySessionEpochGuard());
  const accessRoleRef = useRef(accessRole);
  const accessBusyRef = useRef(false);
  const sendSequenceRef = useRef(0);
  const activeSendRef = useRef<number | null>(null);
  const restartListeningTimerRef = useRef<number | null>(null);
  const speechStartTimerRef = useRef<number | null>(null);
  const startRecognitionRef = useRef<() => void | Promise<void>>(() => undefined);
  const voiceOutputRef = useRef<VoiceOutput | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const vaultSessionRef = useRef<VaultSession | null>(null);
  const vaultWriteVersionRef = useRef(0);
  const turnsRef = useRef<HTMLDivElement | null>(null);
  const memoryDrawerRef = useRef<HTMLElement | null>(null);
  const settingsDrawerRef = useRef<HTMLElement | null>(null);
  const gameDrawerRef = useRef<HTMLElement | null>(null);

  profileRef.current = profile;
  accessRoleRef.current = accessRole;

  if (!voiceOutputRef.current) voiceOutputRef.current = createLocalVoiceOutput(window.wellbeingDesktop?.localVoice);

  function commitProfile(next: CompanionProfile) {
    profileRef.current = next;
    setProfileState(next);
  }

  function updateProfile(updater: (current: CompanionProfile) => CompanionProfile): CompanionProfile {
    if (!profileMutationAllowed()) return profileRef.current;
    const next = updater(profileRef.current);
    commitProfile(next);
    return next;
  }

  function finishActiveSend(sendToken: number): boolean {
    if (activeSendRef.current !== sendToken) return false;
    activeSendRef.current = null;
    modelBusyRef.current = false;
    setModelBusy(false);
    return true;
  }

  function detachRecognitionInstance(recognition = recognitionRef.current, stop = true) {
    if (!recognition) return;
    detachRecognitionHandlersBeforeStop(recognition, () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    }, stop);
  }

  function quiesceConversationForPrivacyTransition(message: string) {
    activeSendRef.current = null;
    modelBusyRef.current = false;
    setModelBusy(false);
    handsFreeRef.current = false;
    setHandsFree(false);
    voiceProcessingRef.current = false;
    if (restartListeningTimerRef.current !== null) window.clearTimeout(restartListeningTimerRef.current);
    restartListeningTimerRef.current = null;
    detachRecognitionInstance();
    window.wellbeingDesktop?.disarmMicrophone();
    setListening(false);
    stopVoicePreview(false);
    cancelSpokenReply(false);
    setVoiceNotice(message);
  }

  function clearTransientConversationState() {
    quiesceConversationForPrivacyTransition("");
    setInput("");
    setLastLearned([]);
    setActions([...defaultConversationActions]);
    setShowUrgent(false);
    setExpression("neutral");
    setGuiding(false);
    setModelNotice("Deterministic offline core ready");
    setVoiceNotice("");
    setGameOpen(false);
    setGameSession(null);
    setListening(false);
    setSpeaking(false);
  }

  function profileMutationAllowed(): boolean {
    return !lockedRef.current
      && privacySessionGuardRef.current.canMutateProfile()
      && !accessBusyRef.current;
  }

  function beginAsyncPrivacyTransition(message: string): number | null {
    if (accessBusyRef.current || privacySessionGuardRef.current.isTransitioning()) return null;
    accessBusyRef.current = true;
    setAccessBusy(true);
    const token = privacySessionGuardRef.current.beginTransition();
    quiesceConversationForPrivacyTransition(message);
    return token;
  }

  function endAsyncPrivacyTransition(token: number, completed: boolean) {
    if (completed) privacySessionGuardRef.current.completeTransition(token);
    else privacySessionGuardRef.current.abortTransition(token);
    accessBusyRef.current = false;
    setAccessBusy(false);
  }

  useEffect(() => {
    if (locked) return;
    const session = vaultSessionRef.current;
    if (!session) {
      if (accessRole === "primary") saveProfile(profile);
      return;
    }
    const writeVersion = ++vaultWriteVersionRef.current;
    void resealVault(profile, session)
      .then((envelope) => {
        if (vaultSessionRef.current === session && vaultWriteVersionRef.current === writeVersion) {
          saveVaultEnvelope(envelope);
        }
      })
      .catch(() => setAccessProblem("The encrypted vault could not be updated. Lock the app and try again before adding private information."));
  }, [profile, locked, accessRole]);
  useEffect(() => {
    const turns = turnsRef.current;
    turns?.scrollTo({ top: turns.scrollHeight, behavior: "smooth" });
  }, [profile.turns]);
  useEffect(() => {
    const drawer = memoryOpen ? memoryDrawerRef.current : settingsOpen ? settingsDrawerRef.current : gameOpen ? gameDrawerRef.current : null;
    drawer?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled])")?.focus();
  }, [memoryOpen, settingsOpen, gameOpen]);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaving(false), 4_500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => () => {
    handsFreeRef.current = false;
    if (restartListeningTimerRef.current !== null) window.clearTimeout(restartListeningTimerRef.current);
    if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
    detachRecognitionInstance();
    window.wellbeingDesktop?.disarmMicrophone();
    voiceOutputRef.current?.dispose();
    const preview = previewAudioRef.current;
    previewAudioRef.current = null;
    if (preview) {
      preview.pause();
      preview.removeAttribute("src");
      preview.load();
    }
  }, []);

  const reminders = useMemo<ReminderCard[]>(() => {
    return [
      ...profile.medications.map((plan) => medicationReminder(plan)).filter((item): item is ReminderCard => Boolean(item)),
      ...profile.appointments.map((plan) => appointmentReminder(plan)).filter((item): item is ReminderCard => Boolean(item)),
    ];
  }, [profile.medications, profile.appointments]);

  const lastSafety = profile.turns.at(-1)?.safetyLevel ?? "steady";
  const mascotAssets = profile.voice === "calm-masculine"
    ? {
        neutral: "/companion-light-blue-v2-solid.png",
        concerned: "/companion-light-blue-concerned-v2-solid.png",
        happy: "/companion-light-blue-happy-v2-solid.png",
        wave: "/companion-light-blue-wave-v2-solid.png",
      }
    : {
        neutral: "/companion-warm-plum-v2-solid.png",
        concerned: "/companion-warm-plum-concerned-v2-solid.png",
        happy: "/companion-warm-plum-happy-v2-solid.png",
        wave: "/companion-warm-plum-wave-v2-solid.png",
      };
  const mascot = waving ? mascotAssets.wave : mascotAssets[expression];
  const selectedVoicePreview = approvedVoicePreview(profile.voice);

  function finishSpokenReply(source: "typed" | "hands-free") {
    speakingRef.current = false;
    setSpeaking(false);
    if (source === "hands-free") {
      voiceProcessingRef.current = false;
      scheduleHandsFreeListening();
    }
  }

  function queueSpokenReply(text: string, source: "typed" | "hands-free" = "typed") {
    if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
    speechStartTimerRef.current = window.setTimeout(() => {
      speechStartTimerRef.current = null;
      voiceOutputRef.current?.speak({
        text,
        profile: profile.voice,
        enabled: profile.speechEnabled,
        onStart: () => {
          speakingRef.current = true;
          setSpeaking(true);
        },
        onUnavailable: () => setVoiceNotice(source === "hands-free"
          ? "The selected local voice is not connected yet. Text remains visible and listening will resume."
          : "The selected local voice is not connected yet. This reply remains visible as text."),
        onEnd: () => finishSpokenReply(source),
      });
    }, 50);
  }

  function cancelSpokenReply(resumeHandsFree: boolean) {
    if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
    speechStartTimerRef.current = null;
    voiceOutputRef.current?.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    if (resumeHandsFree && handsFreeRef.current) {
      voiceProcessingRef.current = false;
      scheduleHandsFreeListening();
    }
  }

  function setSpokenRepliesEnabled(enabled: boolean) {
    if (!profileMutationAllowed()) {
      setVoiceNotice("Private-space protection is being updated. Voice settings will be available when it finishes.");
      return;
    }
    if (!enabled) {
      stopVoicePreview(true);
      cancelSpokenReply(true);
      setVoiceNotice(handsFreeRef.current
        ? "Spoken replies are muted. Hands-free listening stays on."
        : "Spoken replies are muted. Text remains visible.");
    } else {
      setVoiceNotice("Spoken replies are enabled for a compatible local provider. Text always remains visible.");
    }
    updateProfile((current) => ({ ...current, speechEnabled: enabled }));
  }

  function stopVoicePreview(resumeHandsFree: boolean) {
    const preview = previewAudioRef.current;
    previewAudioRef.current = null;
    if (!preview) return;
    preview.onended = null;
    preview.onerror = null;
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    speakingRef.current = false;
    setSpeaking(false);
    voiceProcessingRef.current = false;
    if (resumeHandsFree && handsFreeRef.current) scheduleHandsFreeListening();
  }

  function previewSelectedVoice() {
    if (!profileMutationAllowed()) {
      setVoiceNotice("Private-space protection is being updated. Voice preview will be available when it finishes.");
      return;
    }
    if (!selectedVoicePreview) {
      setVoiceNotice("This preset does not have an approved preview yet. No substitute voice was used.");
      return;
    }
    if (!profile.speechEnabled) {
      setVoiceNotice("Turn on spoken replies before playing a voice preview.");
      return;
    }
    cancelSpokenReply(false);
    stopVoicePreview(false);
    if (handsFreeRef.current) {
      voiceProcessingRef.current = true;
      detachRecognitionInstance();
      setListening(false);
    }
    const preview = new Audio(selectedVoicePreview.file);
    preview.preload = "auto";
    previewAudioRef.current = preview;
    const finish = (message: string) => {
      if (previewAudioRef.current !== preview) return;
      previewAudioRef.current = null;
      speakingRef.current = false;
      setSpeaking(false);
      voiceProcessingRef.current = false;
      setVoiceNotice(message);
      if (handsFreeRef.current) scheduleHandsFreeListening();
    };
    preview.onended = () => finish(`${selectedVoicePreview.productLabel} preview finished.`);
    preview.onerror = () => finish("The approved preview could not be played. Text remains available.");
    speakingRef.current = true;
    setSpeaking(true);
    setVoiceNotice(`Playing the owner-approved ${selectedVoicePreview.productLabel.toLowerCase()} sample.`);
    void preview.play().catch(() => finish("The approved preview could not be played. Text remains available."));
  }

  function scheduleHandsFreeListening(delay = 350) {
    if (restartListeningTimerRef.current !== null) window.clearTimeout(restartListeningTimerRef.current);
    if (!handsFreeRef.current) return;
    restartListeningTimerRef.current = window.setTimeout(() => {
      restartListeningTimerRef.current = null;
      if (handsFreeRef.current && !voiceProcessingRef.current && !speakingRef.current) {
        void startRecognitionRef.current();
      }
    }, delay);
  }

  async function send(raw: string, source: "typed" | "hands-free" = "typed") {
    const text = raw.trim();
    if (!text || modelBusyRef.current) return;
    if (!profileMutationAllowed()) {
      if (source === "hands-free") voiceProcessingRef.current = false;
      setModelNotice("Private-space protection is being updated · no message was saved");
      return;
    }
    if (/^(?:play together|play another game|open games)[.!]?$/i.test(text)) {
      setGameOpen(true);
      return;
    }
    modelBusyRef.current = true;
    setModelBusy(true);
    const sendToken = ++sendSequenceRef.current;
    activeSendRef.current = sendToken;
    if (source === "hands-free") voiceProcessingRef.current = true;
    setInput("");
    const replyProfileAtStart = profileRef.current;
    const capturedMemoryGeneration = memoryGenerationRef.current;
    const capturedPrivacySessionGeneration = privacySessionGuardRef.current.capture();
    const deterministicReply = respond(text, replyProfileAtStart);

    if (gameSession && /^(?:stop|end|quit)(?: the)? game[.!]?$/i.test(text)) {
      const now = new Date().toISOString();
      const gameReplyText = "Okay, we can stop here. There is no score you need to protect. We can talk, choose another game, or come back to this later.";
      setGameSession(null);
      updateProfile((current) => ({
        ...current,
        turns: [
          ...current.turns,
          { id: id(), role: "user", text, createdAt: now, safetyLevel: "steady", safetyContext: "general" },
          { id: id(), role: "companion", text: gameReplyText, createdAt: now, safetyLevel: "steady", safetyContext: "general" },
        ],
      }));
      setActions(["Play another game", "Keep talking"]);
      setLastLearned([]);
      setShowUrgent(false);
      setModelNotice("Offline game ended · no network used");
      if (finishActiveSend(sendToken)) queueSpokenReply(gameReplyText, source);
      return;
    }

    if (gameSession?.status === "awaiting-response" && deterministicReply.safetyLevel === "steady" && !deterministicReply.showUrgentOptions) {
      const result = submitGameResponse(gameSession, text);
      if (result.evaluation.signal === "none") {
        let nextSession = result.session;
        let gameReplyText = result.evaluation.feedback;
        if (nextSession.status === "between-prompts") {
          nextSession = nextGamePrompt(nextSession);
          const nextPrompt = currentGamePrompt(nextSession);
          if (nextPrompt) gameReplyText = `${gameReplyText}\n\n${gamePromptText(nextPrompt)}`;
        }
        const nextPrompt = currentGamePrompt(nextSession);
        const now = new Date().toISOString();
        setGameSession(nextSession);
        updateProfile((current) => ({
          ...current,
          turns: [
            ...current.turns,
            { id: id(), role: "user", text, createdAt: now, safetyLevel: "steady", safetyContext: "general" },
            { id: id(), role: "companion", text: gameReplyText, createdAt: now, safetyLevel: "steady", safetyContext: "general" },
          ],
        }));
        setActions(nextPrompt ? gamePromptActions(nextPrompt) : ["Play another game", "Keep talking"]);
        setLastLearned([]);
        setShowUrgent(false);
        setExpression("happy");
        setModelNotice("Offline game · no network used");
        if (finishActiveSend(sendToken)) queueSpokenReply(gameReplyText, source);
        return;
      }
      setGameSession(result.session);
    } else if (gameSession?.status === "awaiting-response" && deterministicReply.safetyLevel !== "steady") {
      setGameSession({ ...gameSession, status: "paused" });
    }

    const resolvedReply = await resolveWithProfileGenerations(
      capturedPrivacySessionGeneration,
      () => privacySessionGuardRef.current.capture(),
      capturedMemoryGeneration,
      () => memoryGenerationRef.current,
      async () => {
        const enhancement = await enhanceSteadyReply(text, deterministicReply, replyProfileAtStart.turns, window.wellbeingDesktop);
        return {
          reply: { ...deterministicReply, text: enhancement.text },
          replyProfile: replyProfileAtStart,
          notice: enhancement.notice,
        };
      },
      () => {
        const currentProfile = profileRef.current;
        return {
          reply: respond(text, currentProfile),
          replyProfile: currentProfile,
          notice: "Memory changed while this reply was pending · refreshed without forgotten details",
        };
      },
    );
    if (resolvedReply.status === "discarded") {
      if (finishActiveSend(sendToken) && source === "hands-free") {
        voiceProcessingRef.current = false;
        if (handsFreeRef.current) scheduleHandsFreeListening();
      }
      return;
    }
    const { reply, replyProfile, notice } = resolvedReply.value;
    if (activeSendRef.current !== sendToken) return;
    setModelNotice(notice);
    const groundedText = realRiskText(text).text;
    const interestUpdates = replyProfile.interestPacksEnabled ? learnInterestSignals(groundedText, replyProfile.interests) : [];
    const carePlans = extractCarePlans(groundedText);
    setExpression(classifyExpression(text, reply.safetyLevel));
    if (/\b(?:hi|hello|good morning|good evening|great news|good news)\b/i.test(text)) {
      setWaving(true);
      window.setTimeout(() => setWaving(false), 3_500);
    }
    const learnedMemoryIds = reply.learned.map((learned) => replyProfile.memories.find((saved) => (
      saved.kind === learned.kind
      && saved.label.trim().toLocaleLowerCase("en-US") === learned.label.trim().toLocaleLowerCase("en-US")
      && saved.value.trim().toLocaleLowerCase("en-US") === learned.value.trim().toLocaleLowerCase("en-US")
    ))?.id ?? learned.id);
    const userTurn: ConversationTurn = {
      id: id(),
      role: "user",
      text,
      createdAt: new Date().toISOString(),
      safetyLevel: reply.safetyLevel,
      safetyContext: reply.safetyContext,
      learnedMemoryIds,
    };
    const companionTurn: ConversationTurn = {
      id: id(),
      role: "companion",
      text: reply.text,
      createdAt: new Date().toISOString(),
      safetyLevel: reply.safetyLevel,
      safetyContext: reply.safetyContext,
      groundedMemoryIds: [...new Set([...reply.usedMemoryIds, ...learnedMemoryIds])],
    };
    const learnedName = reply.learned.find((entry) => entry.kind === "identity")?.value;
    updateProfile((current) => {
      const next = {
        ...current,
        preferredName: learnedName ?? current.preferredName,
        memories: mergeMemories(current.memories, reply.learned),
        medications: applyAdherenceSignal(mergeMedicationPlans(current.medications, carePlans.medications), groundedText),
        appointments: mergeAppointmentPlans(current.appointments, carePlans.appointments),
        interests: mergeInterestPacks(current.interests, interestUpdates),
        affectCueEvidence: appendAffectCueEvidence(current.affectCueEvidence, reply.affectCueEvidence),
        turns: [...current.turns, userTurn, companionTurn],
      };
      return next;
    });
    setLastLearned(reply.learned);
    setActions(reply.suggestedActions);
    setShowUrgent(reply.showUrgentOptions);
    if (!finishActiveSend(sendToken)) return;
    if (/60-second reset|breathe|breathing/i.test(text)) {
      setGuiding(true);
      window.setTimeout(() => setGuiding(false), 12_000);
    }
    queueSpokenReply(reply.text, source);
  }

  function announceGame(session: GameSession, introduction: string) {
    if (!profileMutationAllowed()) {
      setModelNotice("Private-space protection is being updated · the game was not changed");
      return;
    }
    const prompt = currentGamePrompt(session);
    if (!prompt) return;
    const announcement = `${introduction} ${gamePromptText(prompt)}`;
    const createdAt = new Date().toISOString();
    setGameSession(session);
    updateProfile((current) => ({
      ...current,
      turns: [...current.turns, { id: id(), role: "companion", text: announcement, createdAt, safetyLevel: "steady", safetyContext: "general" }],
    }));
    setActions(gamePromptActions(prompt));
    setLastLearned([]);
    setShowUrgent(false);
    setExpression("happy");
    setGameOpen(false);
    setModelNotice("Offline game · no network used");
    queueSpokenReply(announcement);
  }

  function startGame(kind: GameKind) {
    const summary = listGames().find((game) => game.kind === kind);
    const session = createGameSession(kind, { seed: `${profile.preferredName || "companion"}:${localDateKey(new Date())}` });
    announceGame(session, `Let's play ${summary?.title ?? "together"}. You can stop or skip at any time.`);
  }

  function resumeActiveGame() {
    if (!gameSession) return;
    if (profile.turns.at(-1)?.safetyLevel === "urgent") {
      setVoiceNotice("The game is still paused. Keep talking about what is happening first; it can be resumed later.");
      setGameOpen(false);
      return;
    }
    announceGame(resumeGame(gameSession), "We can resume gently. If you would rather stop, just say so.");
  }

  function replayActiveGame() {
    if (!gameSession) return;
    const replayed = replayGame(gameSession, `${profile.preferredName || "companion"}:${localDateKey(new Date())}:${gameSession.seed + 1}`);
    announceGame(replayed, "Let's play another round.");
  }

  function stopActiveGame() {
    setGameSession(null);
    setGameOpen(false);
    setActions(["Play together", "Keep talking"]);
    setModelNotice("Deterministic offline core ready");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  async function startRecognition() {
    if (!profileMutationAllowed() || !handsFreeRef.current || recognitionRef.current || voiceProcessingRef.current || speakingRef.current) return;
    const requestedPrivacyEpoch = privacySessionGuardRef.current.capture();
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      handsFreeRef.current = false;
      setHandsFree(false);
      setListening(false);
      window.wellbeingDesktop?.disarmMicrophone();
      setVoiceNotice("Voice input is not available on this device. Text conversation still works.");
      return;
    }
    const microphoneArmed = window.wellbeingDesktop
      ? await window.wellbeingDesktop.armMicrophone().catch(() => false)
      : true;
    if (
      !profileMutationAllowed()
      || privacySessionGuardRef.current.capture() !== requestedPrivacyEpoch
      || !handsFreeRef.current
    ) {
      window.wellbeingDesktop?.disarmMicrophone();
      return;
    }
    if (!microphoneArmed) {
      handsFreeRef.current = false;
      setHandsFree(false);
      setListening(false);
      window.wellbeingDesktop?.disarmMicrophone();
      setVoiceNotice("The microphone was not enabled. Text conversation remains available.");
      return;
    }
    const recognition = new Constructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    const recognitionPrivacyEpoch = privacySessionGuardRef.current.capture();
    const callbackIsCurrent = () => recognitionCallbackIsCurrent({
      recognition,
      currentRecognition: recognitionRef.current,
      capturedPrivacyEpoch: recognitionPrivacyEpoch,
      currentPrivacyEpoch: privacySessionGuardRef.current.capture(),
      handsFree: handsFreeRef.current,
      locked: lockedRef.current,
    });
    recognition.onresult = (event) => {
      if (!callbackIsCurrent()) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ");
      setInput(transcript);
      const finalTranscript = finalRecognitionTranscript(event.results);
      if (finalTranscript) {
        voiceProcessingRef.current = true;
        detachRecognitionInstance(recognition);
        setListening(false);
        void send(finalTranscript, "hands-free");
      }
    };
    recognition.onend = () => {
      if (!callbackIsCurrent()) return;
      detachRecognitionInstance(recognition, false);
      setListening(false);
      if (!voiceProcessingRef.current) scheduleHandsFreeListening();
    };
    recognition.onerror = (event) => {
      if (!callbackIsCurrent()) return;
      detachRecognitionInstance(recognition, false);
      setListening(false);
      if (recognitionErrorIsRecoverable(event.error)) {
        setVoiceNotice(event.error === "no-speech" ? "Still here. Listening again…" : "Listening is resuming…");
        scheduleHandsFreeListening(500);
        return;
      }
      handsFreeRef.current = false;
      setHandsFree(false);
      window.wellbeingDesktop?.disarmMicrophone();
      setVoiceNotice("The microphone is unavailable or permission was declined. Text conversation remains available.");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setVoiceNotice("");
    } catch {
      detachRecognitionInstance(recognition, false);
      setListening(false);
      scheduleHandsFreeListening(500);
    }
  }
  startRecognitionRef.current = () => void startRecognition();

  async function toggleListening() {
    if (!profileMutationAllowed()) {
      setVoiceNotice("Private-space protection is being updated. Hands-free talk will be available when it finishes.");
      return;
    }
    if (handsFreeRef.current) {
      handsFreeRef.current = false;
      setHandsFree(false);
      voiceProcessingRef.current = false;
      if (restartListeningTimerRef.current !== null) window.clearTimeout(restartListeningTimerRef.current);
      restartListeningTimerRef.current = null;
      detachRecognitionInstance();
      window.wellbeingDesktop?.disarmMicrophone();
      setListening(false);
      setVoiceNotice("Hands-free talk stopped. You can keep typing.");
      return;
    }
    const capturedPrivacySessionGeneration = privacySessionGuardRef.current.capture();
    const permissionGranted = window.wellbeingDesktop
      ? await window.wellbeingDesktop.requestHandsFreePermission().catch(() => false)
      : true;
    if (
      !profileMutationAllowed()
      || privacySessionGuardRef.current.capture() !== capturedPrivacySessionGeneration
    ) {
      window.wellbeingDesktop?.disarmMicrophone();
      return;
    }
    if (!permissionGranted) {
      handsFreeRef.current = false;
      setHandsFree(false);
      window.wellbeingDesktop?.disarmMicrophone();
      setVoiceNotice("Microphone permission was not granted. Text conversation remains available.");
      return;
    }
    handsFreeRef.current = true;
    setHandsFree(true);
    setVoiceNotice("Hands-free talk is on. Speak naturally; tap the mic again to stop.");
    await startRecognition();
  }

  function deleteMemory(memoryId: string) {
    if (!profileMutationAllowed()) {
      setAccessProblem("Private-space protection is being updated. Nothing was forgotten; try again when it finishes.");
      return;
    }
    const current = profileRef.current;
    if (!current.memories.some((entry) => entry.id === memoryId)) return;
    const forgotten = forgetMemory(current, memoryId);
    memoryGenerationRef.current = nextMemoryGeneration(memoryGenerationRef.current);
    commitProfile(forgotten);
    setLastLearned([]);
    if (modelBusyRef.current) {
      setModelNotice("Memory forgotten · the pending reply will be refreshed before it is shown");
    }
  }

  function deleteAffectCueEvidence(evidenceId: string) {
    if (!profileMutationAllowed()) {
      setAccessProblem("Private-space protection is being updated. Nothing was forgotten; try again when it finishes.");
      return;
    }
    updateProfile((current) => ({
      ...current,
      affectCueEvidence: current.affectCueEvidence.filter((entry) => entry.id !== evidenceId),
    }));
  }

  function changeVoice(voice: CompanionProfile["voice"]) {
    if (!profileMutationAllowed()) {
      setVoiceNotice("Private-space protection is being updated. Voice settings will be available when it finishes.");
      return;
    }
    stopVoicePreview(true);
    updateProfile((current) => ({ ...current, voice }));
  }

  function setLearningEnabled(enabled: boolean) {
    if (!profileMutationAllowed()) return;
    updateProfile((current) => ({ ...current, learningEnabled: enabled }));
  }

  function setInterestPacksEnabled(enabled: boolean) {
    if (!profileMutationAllowed()) return;
    updateProfile((current) => ({ ...current, interestPacksEnabled: enabled }));
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setMemoryOpen(false);
      setSettingsOpen(false);
      setGameOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])",
    )).filter((element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function enablePrivacyLock() {
    setAccessProblem("");
    if (newPassword !== confirmPassword) {
      setAccessProblem("The two personal passwords do not match.");
      return;
    }
    const transitionToken = beginAsyncPrivacyTransition("Private-space protection is being enabled. Hands-free talk is paused until it finishes.");
    if (transitionToken === null) return;
    const profileSnapshot = profileRef.current;
    const passwordSnapshot = newPassword;
    let completed = false;
    try {
      const created = await createVault(profileSnapshot, passwordSnapshot, "primary");
      if (privacySessionGuardRef.current.capture() !== transitionToken || !privacySessionGuardRef.current.isTransitioning()) {
        throw new Error("The private-space transition changed before encryption finished.");
      }
      saveVaultEnvelope(created.envelope);
      clearProfile();
      vaultSessionRef.current = created.session;
      commitProfile(profileSnapshot);
      setPrivacyConfigured(true);
      setNewPassword("");
      setConfirmPassword("");
      completed = true;
    } catch (error) {
      setAccessProblem(error instanceof Error ? error.message : "The privacy lock could not be enabled.");
    } finally {
      endAsyncPrivacyTransition(transitionToken, completed);
    }
  }

  async function enableGuardianSpace() {
    setAccessProblem("");
    if (accessRoleRef.current !== "primary" || !privacyConfigured) {
      setAccessProblem("Unlock the primary space before configuring guardian access.");
      return;
    }
    if (guardianPassword !== guardianConfirmPassword) {
      setAccessProblem("The two guardian passwords do not match.");
      return;
    }
    const transitionToken = beginAsyncPrivacyTransition("Guardian-space protection is being created. Conversation is paused until it finishes.");
    if (transitionToken === null) return;
    const currentProfileSnapshot = profileRef.current;
    const passwordSnapshot = guardianPassword;
    let completed = false;
    try {
      const guardianProfile = ensureOpening(defaultProfile(), "guardian");
      const created = await createVault(guardianProfile, passwordSnapshot, "guardian");
      if (privacySessionGuardRef.current.capture() !== transitionToken || !privacySessionGuardRef.current.isTransitioning()) {
        throw new Error("The guardian-space transition changed before encryption finished.");
      }
      saveVaultEnvelope(created.envelope);
      commitProfile(currentProfileSnapshot);
      setGuardianConfigured(true);
      setGuardianPassword("");
      setGuardianConfirmPassword("");
      completed = true;
    } catch (error) {
      setAccessProblem(error instanceof Error ? error.message : "Guardian space could not be enabled.");
    } finally {
      endAsyncPrivacyTransition(transitionToken, completed);
    }
  }

  function lockNow() {
    if (accessBusyRef.current) return;
    lockedRef.current = true;
    privacySessionGuardRef.current.replaceSession();
    clearTransientConversationState();
    vaultSessionRef.current = null;
    vaultWriteVersionRef.current += 1;
    setAccessProblem("");
    commitProfile(ensureOpening(defaultProfile(), "primary"));
    accessRoleRef.current = "primary";
    setAccessRole("primary");
    setUnlockRole("primary");
    setUnlockPassword("");
    setSettingsOpen(false);
    setMemoryOpen(false);
    setLocked(true);
  }

  async function unlockSelectedSpace() {
    setAccessProblem("");
    if (accessBusyRef.current) return;
    const targetRole = unlockRole;
    const passwordSnapshot = unlockPassword;
    const envelope = loadVaultEnvelope(targetRole);
    if (!envelope) {
      setAccessProblem("That private space is not configured on this device.");
      return;
    }
    const transitionToken = beginAsyncPrivacyTransition("Opening the selected private space. Earlier pending work cannot cross this boundary.");
    if (transitionToken === null) return;
    let completed = false;
    try {
      const opened = await openVault(envelope, passwordSnapshot, targetRole);
      if (privacySessionGuardRef.current.capture() !== transitionToken || !privacySessionGuardRef.current.isTransitioning()) {
        throw new Error("The private-space transition changed before unlocking finished.");
      }
      const openedProfile = ensureOpening(opened.profile, targetRole);
      vaultSessionRef.current = opened.session;
      accessRoleRef.current = targetRole;
      setAccessRole(targetRole);
      commitProfile(openedProfile);
      clearTransientConversationState();
      setUnlockPassword("");
      lockedRef.current = false;
      setLocked(false);
      completed = true;
    } catch (error) {
      setAccessProblem(error instanceof Error ? error.message : "The private space could not be opened.");
    } finally {
      endAsyncPrivacyTransition(transitionToken, completed);
    }
  }

  if (locked) {
    return (
      <div className="lock-screen">
        <main className="lock-card" aria-labelledby="unlock-title">
          <div className="lock-emblem" aria-hidden="true">✦</div>
          <p className="eyebrow">PRIVATE COMPANION · THIS DEVICE</p>
          <h1 id="unlock-title">Welcome back.</h1>
          <p className="lock-intro">Choose your private space and enter its password. The password is never stored, and the guardian space cannot read the primary user’s conversations or memories.</p>
          <fieldset className="role-picker">
            <legend>Private space</legend>
            <label className={unlockRole === "primary" ? "selected" : ""}>
              <input type="radio" name="unlock-role" checked={unlockRole === "primary"} disabled={accessBusy} onChange={() => setUnlockRole("primary")} />
              <span><strong>My companion</strong><small>Primary private memories</small></span>
            </label>
            {guardianConfigured && (
              <label className={unlockRole === "guardian" ? "selected" : ""}>
                <input type="radio" name="unlock-role" checked={unlockRole === "guardian"} disabled={accessBusy} onChange={() => setUnlockRole("guardian")} />
                <span><strong>Parent or guardian</strong><small>Separate guardian conversation</small></span>
              </label>
            )}
          </fieldset>
          <label className="secure-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={unlockPassword}
              disabled={accessBusy}
              onChange={(event) => setUnlockPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void unlockSelectedSpace(); }}
            />
          </label>
          {accessProblem && <p className="access-problem" role="alert">{accessProblem}</p>}
          <button className="primary-action" type="button" disabled={accessBusy || !unlockPassword} onClick={() => void unlockSelectedSpace()}>{accessBusy ? "Opening…" : "Open private space"}</button>
          <p className="lock-footnote">If you live alone, the privacy lock is optional and stays off until you enable it in Settings.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Companion controls">
        <div className="brand-mark" aria-label="Working title">
          <span className="brand-spark">✦</span>
          <span>working<br />title</span>
        </div>
        <nav>
          <button className="rail-button active" aria-current="page"><span>◉</span> Talk</button>
          <button className="rail-button" onClick={() => { setGameOpen(true); setMemoryOpen(false); setSettingsOpen(false); }}><span>✦</span> Play</button>
          <button className="rail-button" onClick={() => { setMemoryOpen(true); setGameOpen(false); setSettingsOpen(false); }}><span>◇</span> Memory</button>
          <button className="rail-button" onClick={() => { setSettingsOpen(true); setGameOpen(false); setMemoryOpen(false); }}><span>⌁</span> Settings</button>
        </nav>
        <div className="local-badge"><span className="status-dot" /> Device-local<br /><small>No cloud account</small></div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">PRIVATE COMPANION · WORKING TITLE</p>
            <h1>{profile.preferredName ? `Good to see you, ${profile.preferredName}.` : "You can begin anywhere."}</h1>
          </div>
          <div className="top-actions">
            {accessRole === "guardian" && <span className="role-chip">Guardian space</span>}
            <button className={`icon-button ${profile.speechEnabled ? "" : "muted"}`} disabled={accessBusy} onClick={() => setSpokenRepliesEnabled(!profile.speechEnabled)} aria-pressed={!profile.speechEnabled} aria-label={profile.speechEnabled ? "Mute spoken replies" : "Turn on spoken replies"}>{profile.speechEnabled ? "◖))" : "◖×"}</button>
            <button className="avatar-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">{profile.preferredName?.[0]?.toUpperCase() ?? "ME"}</button>
          </div>
        </header>

        <section className={`presence-panel safety-${lastSafety}`} aria-label="Companion presence">
          <div className="orb one" /><div className="orb two" />
          <div className="mascot-wrap">
            <div className="mascot-halo" />
            <AnimatedMascot src={mascot} alt="A small glowing lantern companion" waving={waving} listening={listening} speaking={speaking} guiding={guiding} />
            <span className={`mouth-cue${speaking ? " active" : ""}`} aria-hidden="true" />
          </div>
          <div className="presence-copy">
            <div className="presence-label"><span className="status-dot" /> {listening ? "LISTENING" : speaking && handsFree ? "REPLYING" : handsFree ? "HANDS-FREE ON" : lastSafety === "urgent" ? "STAYING WITH YOU" : "HERE WITH YOU"}</div>
            <h2>{lastSafety === "urgent" ? "We only need the next safe minute." : "No judgment. No starting over."}</h2>
            <p>{accessRole === "guardian" ? "This guardian conversation is encrypted separately and cannot reveal the primary user’s private space." : "A synthetic friend who listens and remembers without pretending to be biological. Conversation and memories stay on this device, and you control deletion."}</p>
            <div className="privacy-row"><span>{privacyConfigured ? "▣ Encrypted local vault" : "▣ Local memory"}</span><span>◌ Works offline</span><span>⌫ You control deletion</span></div>
          </div>
        </section>

        <div className="content-grid">
          <section className="conversation-card" aria-label="Conversation">
            <div className="section-heading">
              <div><p className="eyebrow">CONVERSATION</p><h3>Talk it through.</h3></div>
              <button className="text-button" onClick={() => setMemoryOpen(true)}>{profile.memories.length} memories →</button>
            </div>

            <div className="turns" aria-live="polite" ref={turnsRef}>
              {profile.turns.slice(-8).map((turn) => (
                <article key={turn.id} className={`turn ${turn.role} ${turn.safetyLevel}`}>
                  <div className="turn-meta">{turn.role === "companion" ? "Companion" : "You"}<time>{formatTime(turn.createdAt)}</time></div>
                  <p>{turn.text}</p>
                </article>
              ))}
            </div>

            {lastLearned.length > 0 && (
              <div className="learned-strip"><strong>Remembered on this device</strong><span>{lastLearned.map((item) => `${item.label}: ${item.value}`).join(" · ")}</span><button onClick={() => setMemoryOpen(true)}>Review</button></div>
            )}

            {gameSession && (
              <div className={`game-status ${gameSession.status}`}>
                <span>✦ {gameSession.status === "paused" ? "Game paused for conversation" : gameSession.status === "completed" ? "Game complete" : "Playing offline"}</span>
                <strong>{listGames().find((game) => game.kind === gameSession.kind)?.title}</strong>
                <button type="button" onClick={() => setGameOpen(true)}>Game controls</button>
              </div>
            )}

            <div className="quick-actions">{actions.map((action) => <button key={action} disabled={modelBusy || accessBusy} onClick={() => /^(?:play together|play another game)$/i.test(action) ? setGameOpen(true) : void send(action)}>{action}</button>)}</div>

            <form className="composer" onSubmit={submit}>
              <button type="button" className={`mic-button ${handsFree ? "live" : ""}`} disabled={accessBusy} onClick={() => void toggleListening()} aria-pressed={handsFree} aria-label={handsFree ? "Stop hands-free conversation" : "Start hands-free conversation"}>{handsFree ? "■" : "●"}</button>
              <label className="sr-only" htmlFor="message">Message</label>
              <textarea id="message" value={input} disabled={modelBusy || accessBusy} onChange={(event) => setInput(event.target.value)} placeholder={accessBusy ? "Private-space protection is being updated…" : modelBusy ? "Thinking locally…" : "Say what’s on your mind…"} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
              <button className="send-button" type="submit" disabled={modelBusy || accessBusy} aria-label={accessBusy ? "Private-space protection is being updated" : modelBusy ? "Preparing response" : "Send message"}>{modelBusy || accessBusy ? "…" : "↑"}</button>
            </form>
            <p className="voice-status" aria-live="polite">{voiceNotice || handsFreeStatus({ enabled: handsFree, listening, speaking })}</p>
            <p className={`model-receipt${modelBusy ? " active" : ""}`} aria-live="polite"><span className="status-dot" />{modelBusy ? "Checking the local model behind the safety gate…" : modelNotice}</p>
            <p className="composer-note">This companion supports wellbeing and organization; it does not diagnose, prescribe, or change treatment.</p>
          </section>

          <aside className="today-card" aria-label="Today">
            <div className="section-heading"><div><p className="eyebrow">TODAY</p><h3>Gentle, not nagging.</h3></div><span className="date-chip">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span></div>
            {reminders.length ? reminders.map((reminder) => (
              <article className={`reminder ${reminder.tone}`} key={reminder.id}><span className="reminder-dot" /><div><strong>{reminder.title}</strong><p>{reminder.detail}</p></div></article>
            )) : (
              <div className="empty-reminders"><span>✓</span><h4>Nothing pressing.</h4><p>Saved appointments and prescribed-medication schedules can appear here. Reliable routines get quieter reminders.</p></div>
            )}
            <div className="reset-card"><p className="eyebrow">60-SECOND RESET</p><h4>Lower the volume, not your feelings.</h4><p>Breathe in gently for four. Let the exhale take six. Repeat only if it feels comfortable.</p><button disabled={modelBusy || accessBusy} onClick={() => void send("Let's do the 60-second reset")}>Begin together →</button></div>
          </aside>
        </div>
      </main>

      {(memoryOpen || settingsOpen || gameOpen) && <button className="scrim" aria-label="Close panel" onClick={() => { setMemoryOpen(false); setSettingsOpen(false); setGameOpen(false); }} />}
      <aside ref={gameDrawerRef} role="dialog" aria-modal="true" className={`drawer game-drawer ${gameOpen ? "open" : ""}`} aria-hidden={!gameOpen} inert={!gameOpen} aria-label="Play together" onKeyDown={handleDrawerKeyDown}>
        <button className="drawer-close" onClick={() => setGameOpen(false)} aria-label="Close games">×</button>
        <p className="eyebrow">PLAY TOGETHER · OFFLINE</p><h2>A small game, no pressure.</h2>
        <p>These text-first games need no account or internet. Answer by typing or with hands-free talk. Every prompt can be skipped, and game answers are not turned into personal memories.</p>
        {gameSession && (
          <section className="active-game-card" aria-label="Active game">
            <span>{gameSession.status.replaceAll("-", " ")}</span>
            <h3>{listGames().find((game) => game.kind === gameSession.kind)?.title}</h3>
            <p>{gameSession.roundsCompleted} of {gameSession.roundLimit} prompts completed{gameSession.kind === "trivia" ? ` · ${gameSession.score} correct` : ""}.</p>
            <div className="game-control-row">
              {gameSession.status === "paused" && lastSafety !== "urgent" && <button type="button" onClick={resumeActiveGame}>Resume</button>}
              {gameSession.status === "paused" && lastSafety === "urgent" && <button type="button" onClick={() => setGameOpen(false)}>Return to conversation</button>}
              {gameSession.status === "completed" && <button type="button" onClick={replayActiveGame}>Replay</button>}
              <button type="button" onClick={stopActiveGame}>End game</button>
            </div>
          </section>
        )}
        <div className="game-grid">
          {listGames().map((game) => (
            <article className="game-card" key={game.kind}>
              <span aria-hidden="true">{game.kind === "trivia" ? "?" : game.kind === "would-you-rather" ? "↔" : game.kind === "word-association" ? "Aa" : "5"}</span>
              <div><h3>{game.title}</h3><p>{game.description}</p><small>{game.defaultRounds} short prompts · works offline</small></div>
              <button type="button" onClick={() => startGame(game.kind)}>Play</button>
            </article>
          ))}
        </div>
        <p className="game-boundary">If a reply sounds like distress or danger, the game pauses and the regular conversation takes over. You can resume only if and when you want.</p>
      </aside>
      <aside ref={memoryDrawerRef} role="dialog" aria-modal="true" className={`drawer ${memoryOpen ? "open" : ""}`} aria-hidden={!memoryOpen} inert={!memoryOpen} aria-label="Private memory shelf" onKeyDown={handleDrawerKeyDown}>
        <button className="drawer-close" onClick={() => setMemoryOpen(false)} aria-label="Close memory">×</button>
        <p className="eyebrow">PRIVATE MEMORY SHELF</p><h2>What I remember.</h2>
        <p>{privacyConfigured ? "These notes are encrypted in this device’s private vault." : "These notes are stored only in this device profile."} Forgetting one also removes transcript turns that created, quoted, or directly used it; unrelated conversation stays.</p>
        <div className="memory-list">
          {profile.memories.length === 0 ? <div className="empty-memory">Nothing remembered yet. Start naturally; you will not be interrupted by constant permission prompts.</div> : profile.memories.map((entry) => (
            <article key={entry.id} className="memory-item"><div><span>{entry.kind}</span><strong>{entry.label}</strong><p>{entry.value}</p></div><button disabled={accessBusy} onClick={() => deleteMemory(entry.id)} aria-label={`Forget ${entry.label}`}>Forget</button></article>
          ))}
        </div>
        <h3>Why I checked in</h3>
        <p>These bounded receipts explain a tentative pattern check. They store turn references and word counts—not a hidden emotion label, diagnosis, or copy of your message.</p>
        <div className="memory-list" aria-label="Affect check-in evidence">
          {profile.affectCueEvidence.length === 0 ? <div className="empty-memory">No tentative check-in receipts yet.</div> : profile.affectCueEvidence.slice(-6).reverse().map((entry) => (
            <article key={entry.id} className="memory-item"><div><span>{entry.status}</span><strong>{entry.basis.replaceAll("-", " ")}</strong><p>{entry.baselineSampleSize} baseline turns · recent word counts {entry.recentWordCounts.join(", ") || "none"} · no emotion label stored</p></div><button disabled={accessBusy} onClick={() => deleteAffectCueEvidence(entry.id)} aria-label="Forget this check-in receipt">Forget</button></article>
          ))}
        </div>
      </aside>

      <aside ref={settingsDrawerRef} role="dialog" aria-modal="true" className={`drawer ${settingsOpen ? "open" : ""}`} aria-hidden={!settingsOpen} inert={!settingsOpen} aria-label="Settings" onKeyDown={handleDrawerKeyDown}>
        <button className="drawer-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button>
        <p className="eyebrow">SETTINGS</p><h2>Make the companion yours.</h2>
        {accessRole === "guardian" && <div className="guardian-banner"><strong>Guardian space</strong><p>This is a separate conversation. Primary-user memories and transcripts are not available here.</p><button className="secondary-action" type="button" disabled={accessBusy} onClick={lockNow}>Lock guardian space</button></div>}
        <fieldset className="voice-choices"><legend>Local voice preset and appearance</legend>
          <label className={profile.voice === "soft-feminine" ? "selected" : ""}><input type="radio" name="voice" checked={profile.voice === "soft-feminine"} disabled={accessBusy} onChange={() => changeVoice("soft-feminine")} /><img src="/companion-warm-plum-v2-solid.png" alt="Warm plum companion" /><span><strong>Soft feminine</strong>Welcoming default</span></label>
          <label className={profile.voice === "warm-neutral" ? "selected" : ""}><input type="radio" name="voice" checked={profile.voice === "warm-neutral"} disabled={accessBusy} onChange={() => changeVoice("warm-neutral")} /><img src="/companion-warm-plum-v2-solid.png" alt="Warm plum companion" /><span><strong>Warm neutral</strong>Future preset · text only</span></label>
          <label className={profile.voice === "calm-masculine" ? "selected" : ""}><input type="radio" name="voice" checked={profile.voice === "calm-masculine"} disabled={accessBusy} onChange={() => changeVoice("calm-masculine")} /><img src="/companion-light-blue-v2-solid.png" alt="Light blue companion" /><span><strong>Calm masculine</strong>Lower, steady tone</span></label>
        </fieldset>
        <div className="voice-preview-panel">
          <button type="button" onClick={previewSelectedVoice} disabled={accessBusy || !profile.speechEnabled || !selectedVoicePreview}>Preview selected voice</button>
          <small>{selectedVoicePreview ? `${selectedVoicePreview.productLabel} · approved static sample` : "No approved sample for this preset yet"}</small>
          <p>This previews one reviewed recording only. Live generated replies remain text-only until the local voice provider is ready.</p>
        </div>
        <label className="toggle-row"><span><strong>Spoken replies</strong><small>Text always remains visible · no system-voice fallback</small></span><input type="checkbox" checked={profile.speechEnabled} disabled={accessBusy} onChange={(event) => setSpokenRepliesEnabled(event.target.checked)} /></label>
        <label className="toggle-row"><span><strong>Learn from conversation</strong><small>On by default; pause new memories without erasing saved ones</small></span><input type="checkbox" checked={profile.learningEnabled} disabled={accessBusy} onChange={(event) => setLearningEnabled(event.target.checked)} /></label>
        <label className="toggle-row"><span><strong>Interest knowledge packs</strong><small>On by default; remember favorites and use spoiler-aware, sourced facts</small></span><input type="checkbox" checked={profile.interestPacksEnabled} disabled={accessBusy} onChange={(event) => setInterestPacksEnabled(event.target.checked)} /></label>
        {accessRole === "primary" && !privacyConfigured && (
          <section className="privacy-settings" aria-labelledby="privacy-heading">
            <h3 id="privacy-heading">Optional privacy password</h3>
            <p>Useful in a shared home. It is off by default, so people who live alone are not asked for a password.</p>
            <label className="secure-field"><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} disabled={accessBusy} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label className="secure-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} disabled={accessBusy} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            <button className="secondary-action" type="button" disabled={accessBusy || !newPassword || !confirmPassword} onClick={() => void enablePrivacyLock()}>{accessBusy ? "Encrypting…" : "Enable encrypted privacy lock"}</button>
          </section>
        )}
        {accessRole === "primary" && privacyConfigured && (
          <section className="privacy-settings" aria-labelledby="privacy-heading">
            <h3 id="privacy-heading">Encrypted privacy lock is on</h3>
            <p>Conversation and memory are encrypted at rest. Locking clears the open key and decrypted profile from this screen.</p>
            <button className="secondary-action" type="button" disabled={accessBusy} onClick={lockNow}>Lock now</button>
            {!guardianConfigured ? (
              <div className="guardian-setup">
                <h4>Optional parent or legal-guardian space</h4>
                <p>Create a separate login. It does not unlock or reveal the primary user’s private conversation.</p>
                <label className="secure-field"><span>Guardian password</span><input type="password" autoComplete="new-password" value={guardianPassword} disabled={accessBusy} onChange={(event) => setGuardianPassword(event.target.value)} /></label>
                <label className="secure-field"><span>Confirm guardian password</span><input type="password" autoComplete="new-password" value={guardianConfirmPassword} disabled={accessBusy} onChange={(event) => setGuardianConfirmPassword(event.target.value)} /></label>
                <button className="secondary-action" type="button" disabled={accessBusy || !guardianPassword || !guardianConfirmPassword} onClick={() => void enableGuardianSpace()}>{accessBusy ? "Creating…" : "Create separate guardian space"}</button>
              </div>
            ) : <p className="configured-note">✓ Separate guardian access is configured on this device.</p>}
          </section>
        )}
        {accessProblem && <p className="access-problem" role="alert">{accessProblem}</p>}
        <div className="safety-note"><strong>Memory defaults to on—and stays local.</strong><p>Automatic memory prevents repetitive permission prompts. When you forget a memory, the app also removes transcript turns that created, quoted, or directly used that memory; unrelated conversation remains.</p></div>
      </aside>

      <details className={`safety-corner${showUrgent ? " attention" : ""}`}>
        <summary>{showUrgent ? "Urgent options are here while we keep talking" : "Need urgent support?"}</summary>
        <ul>{urgentOptions.map((option) => <li key={option}>{option}</li>)}</ul>
        <p>In the United States, call or text 988 for crisis support, or 911 for immediate danger. Availability and response practices vary by location.</p>
      </details>
    </div>
  );
}
