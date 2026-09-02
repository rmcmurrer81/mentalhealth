import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReactiveCompanionOrb } from "./components/ReactiveCompanionOrb";
import { PwaInstallControl } from "./components/PwaInstallControl";
import { classifyExpression, isPartyRoleplayTurn, respond } from "./lib/companion";
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
import { isUrgentOptionsAction, revealUrgentOptions } from "./lib/urgent-options";
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
import type { CompanionExpression, CompanionProfile, ConversationTurn, MemoryRecord, ThemePreference } from "./lib/types";
import { resolveEffectiveTheme, themeConfirmation, themePreferenceFromCommand } from "./lib/theme";
import { createLocalVoiceOutput, type VoiceOutput } from "./lib/voice";
import type { LocalVoicePlaybackEvent } from "./lib/local-voice-client";
import { approvedVoicePreview } from "./lib/voice-preview";
import {
  DEFAULT_COMPANION_NAME,
  cleanCompanionName,
  companionNameFromOptionalInput,
  companionNameFromStoredProfile,
} from "./lib/companion-name";

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
type CompactPanel = "activities" | "memory" | "settings";

type LocalCaptureSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  audioContext: AudioContext | null;
  animationFrame: number | null;
  chunks: Blob[];
  bytes: number;
  discard: boolean;
  heardSpeech: boolean;
  silentSince: number | null;
  startedAt: number;
};

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

function requestedInitialWindowLayout(): "full" | "compact" | "character" {
  const layout = new URLSearchParams(window.location.search).get("layout");
  return layout === "full" || layout === "character" ? layout : "compact";
}

function desktopFirstRunRequested(): boolean {
  return new URLSearchParams(window.location.search).get("desktop") === "1";
}

function cleanPreferredName(value: string): string {
  return value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

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

const personalizedOpeningTurn = (preferredName: string, companionName: string): ConversationTurn => ({
  id: id(),
  role: "companion",
  text: `Hi, ${preferredName}. I’m ${companionName}, your local synthetic companion. I’m ready to listen, remember only what you choose to keep, and stay honest that I’m not a human person. It’s good to meet you.`,
  createdAt: new Date().toISOString(),
  safetyLevel: "steady",
  safetyContext: "general",
});

function ensureOpening(profile: CompanionProfile, role: VaultRole, now = new Date()): CompanionProfile {
  const normalized = {
    ...defaultProfile(),
    ...profile,
    companionName: companionNameFromStoredProfile(profile.companionName),
    speechEnabled: profile.speechPreferenceSet === true ? profile.speechEnabled !== false : true,
    speechPreferenceSet: profile.speechPreferenceSet === true,
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
  const initialWindowLayoutRef = useRef(requestedInitialWindowLayout());
  const desktopFirstRunRef = useRef(desktopFirstRunRequested());
  const [profile, setProfileState] = useState<CompanionProfile>(() => {
    const loaded = startsLockedRef.current ? defaultProfile() : loadProfile();
    return ensureOpening(loaded, "primary");
  });
  const [locked, setLocked] = useState(startsLockedRef.current);
  const [onboardingOpen, setOnboardingOpen] = useState(() => (
    desktopFirstRunRef.current && !startsLockedRef.current && !profile.onboardingCompleted
  ));
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingName, setOnboardingName] = useState(profile.preferredName);
  const [onboardingCompanionName, setOnboardingCompanionName] = useState(
    profile.companionName === DEFAULT_COMPANION_NAME ? "" : profile.companionName,
  );
  const [onboardingVoice, setOnboardingVoice] = useState<"soft-feminine" | "calm-masculine">(
    profile.voice === "calm-masculine" ? "calm-masculine" : "soft-feminine",
  );
  const [onboardingTheme, setOnboardingTheme] = useState<"light" | "medium" | "dark">(
    profile.theme === "light" || profile.theme === "dark" ? profile.theme : "medium",
  );
  const [onboardingAudioEnabled, setOnboardingAudioEnabled] = useState(profile.speechEnabled);
  const [onboardingMicrophoneEnabled, setOnboardingMicrophoneEnabled] = useState(false);
  const [onboardingProblem, setOnboardingProblem] = useState("");
  const [onboardingCompleting, setOnboardingCompleting] = useState(false);
  const [onboardingVoiceFailed, setOnboardingVoiceFailed] = useState(false);
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
  const [speechMotion, setSpeechMotion] = useState<{ event: LocalVoicePlaybackEvent; startedAt: number } | null>(null);
  const [guiding, setGuiding] = useState(false);
  const [expression, setExpression] = useState<CompanionExpression>("neutral");
  const [compactMode, setCompactMode] = useState(initialWindowLayoutRef.current !== "full");
  const [characterOnlyMode, setCharacterOnlyMode] = useState(initialWindowLayoutRef.current === "character");
  const [compactChatVisible, setCompactChatVisible] = useState(initialWindowLayoutRef.current !== "character");
  const [compactPanel, setCompactPanel] = useState<CompactPanel | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(initialWindowLayoutRef.current !== "full");
  const [compactNotice, setCompactNotice] = useState("");
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCompanionName, setSettingsCompanionName] = useState(
    profile.companionName === DEFAULT_COMPANION_NAME ? "" : profile.companionName,
  );
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [lastLearned, setLastLearned] = useState<MemoryRecord[]>([]);
  const [actions, setActions] = useState<string[]>(() => [...defaultConversationActions]);
  const [showUrgent, setShowUrgent] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [localVoiceState, setLocalVoiceState] = useState<"checking" | "ready" | "unavailable">("checking");
  const [modelNotice, setModelNotice] = useState("Deterministic offline core ready");
  const [modelBusy, setModelBusy] = useState(false);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const localCaptureRef = useRef<LocalCaptureSession | null>(null);
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
  const startRecognitionRef = useRef<() => void | Promise<void>>(() => undefined);
  const voiceOutputRef = useRef<VoiceOutput | null>(null);
  const localVoiceStateRef = useRef<"checking" | "ready" | "unavailable">("checking");
  const pendingSpokenReplyRef = useRef<{ text: string; source: "typed" | "hands-free" } | null>(null);
  const openingSpeechAttemptedRef = useRef(false);
  const onboardingIntroPendingRef = useRef(false);
  const onboardingIntroSpokeRef = useRef(false);
  const pendingOnboardingIntroductionRef = useRef<ConversationTurn | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const vaultSessionRef = useRef<VaultSession | null>(null);
  const vaultWriteVersionRef = useRef(0);
  const turnsRef = useRef<HTMLDivElement | null>(null);
  const compactTurnsRef = useRef<HTMLDivElement | null>(null);
  const latestTurnRef = useRef<HTMLElement | null>(null);
  const latestCompactTurnRef = useRef<HTMLElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const memoryDrawerRef = useRef<HTMLElement | null>(null);
  const settingsDrawerRef = useRef<HTMLElement | null>(null);
  const gameDrawerRef = useRef<HTMLElement | null>(null);
  const drawerWasOpenRef = useRef(false);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const unlockPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const talkButtonRef = useRef<HTMLButtonElement | null>(null);
  const urgentOptionsRef = useRef<HTMLDetailsElement | null>(null);
  const lockStateWasLockedRef = useRef(locked);

  profileRef.current = profile;
  accessRoleRef.current = accessRole;

  if (!voiceOutputRef.current) voiceOutputRef.current = createLocalVoiceOutput(window.wellbeingDesktop?.localVoice);

  const effectiveTheme = resolveEffectiveTheme(profile.theme, systemPrefersDark);
  const onboardingCompanionNameValid = companionNameFromOptionalInput(onboardingCompanionName) !== null;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.themePreference = profile.theme;
    document.documentElement.style.colorScheme = effectiveTheme === "medium" ? "dark" : effectiveTheme;
  }, [effectiveTheme, profile.theme]);

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsCompanionName(profile.companionName === DEFAULT_COMPANION_NAME ? "" : profile.companionName);
    }
  }, [profile.companionName, settingsOpen]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const syncSystemTheme = (event: MediaQueryListEvent | MediaQueryList) => setSystemPrefersDark(event.matches);
    syncSystemTheme(query);
    query.addEventListener?.("change", syncSystemTheme);
    return () => query.removeEventListener?.("change", syncSystemTheme);
  }, []);

  useEffect(() => window.wellbeingDesktop?.onWindowModeChanged?.((mode) => {
    setCompactMode(mode !== "full");
    setCharacterOnlyMode(mode === "character");
    setCompactChatVisible(mode !== "character");
    setAlwaysOnTop(mode !== "full");
    setCompactPanel(null);
  }), []);

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

  function commitLocalVoiceState(next: "checking" | "ready" | "unavailable") {
    localVoiceStateRef.current = next;
    setLocalVoiceState(next);
  }

  function releaseVoiceQueueWhenReady() {
    const pending = pendingSpokenReplyRef.current;
    if (pending) {
      pendingSpokenReplyRef.current = null;
      queueSpokenReply(pending.text, pending.source);
      return;
    }

    const current = profileRef.current;
    const opening = current.turns.length === 1 && current.turns[0]?.role === "companion"
      ? current.turns[0]
      : null;
    if (
      !openingSpeechAttemptedRef.current
      && opening
      && !current.preferredName
      && current.speechEnabled
      && (!desktopFirstRunRef.current || current.onboardingCompleted)
    ) {
      openingSpeechAttemptedRef.current = true;
      queueSpokenReply(opening.text);
    }
  }

  function failPendingVoiceQueue() {
    const pending = pendingSpokenReplyRef.current;
    if (!pending) return;
    pendingSpokenReplyRef.current = null;
    if (onboardingIntroPendingRef.current) {
      setOnboardingVoiceFailed(true);
      setVoiceNotice("The local voice did not become ready. Nothing was substituted; choose text only or restart after repairing the local voice cache.");
      return;
    }
    setVoiceNotice(pending.source === "hands-free"
      ? "The optional local voice did not become ready. The complete reply stays visible and listening will resume."
      : "The optional local voice did not become ready. The complete reply stays visible as text.");
    finishSpokenReply(pending.source);
  }

  function detachRecognitionInstance(recognition = recognitionRef.current, stop = true) {
    if (!recognition) return;
    detachRecognitionHandlersBeforeStop(recognition, () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    }, stop);
  }

  function stopLocalCapture(discard = true) {
    const capture = localCaptureRef.current;
    if (!capture) return;
    localCaptureRef.current = null;
    capture.discard = discard;
    if (capture.animationFrame !== null) window.cancelAnimationFrame(capture.animationFrame);
    capture.animationFrame = null;
    for (const track of capture.stream.getTracks()) track.stop();
    void capture.audioContext?.close().catch(() => undefined);
    if (capture.recorder.state !== "inactive") {
      try { capture.recorder.stop(); } catch { /* already stopping */ }
    }
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
    stopLocalCapture(true);
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
    const revealLatestTurnFromItsBeginning = (
      transcript: HTMLDivElement | null,
      latestTurn: HTMLElement | null,
    ) => {
      if (!transcript || !latestTurn) return;
      const top = Math.max(0, latestTurn.offsetTop - transcript.offsetTop);
      transcript.scrollTo({ top, behavior: "smooth" });
    };
    revealLatestTurnFromItsBeginning(turnsRef.current, latestTurnRef.current);
    revealLatestTurnFromItsBeginning(compactTurnsRef.current, latestCompactTurnRef.current);
  }, [profile.turns]);
  useEffect(() => {
    const voice = window.wellbeingDesktop?.localVoice;
    if (!voice) {
      commitLocalVoiceState("unavailable");
      failPendingVoiceQueue();
      return;
    }
    let active = true;
    let timer: number | null = null;
    let attempts = 0;
    const probe = async () => {
      try {
        const status = await voice.status();
        if (!active) return;
        if (status.ready && status.localOnly && status.supportedProfiles.includes(profileRef.current.voice)) {
          commitLocalVoiceState("ready");
          releaseVoiceQueueWhenReady();
          return;
        }
      } catch {
        // Typed conversation remains fully available while the optional host starts or fails.
      }
      attempts += 1;
      // Cold local voice startup is intentionally cache-only and may be slow on
      // a low-memory computer. Keep the complete text visible while allowing a
      // bounded 150-second readiness window before declaring it unavailable.
      if (attempts >= 100) {
        commitLocalVoiceState("unavailable");
        failPendingVoiceQueue();
        return;
      }
      commitLocalVoiceState("checking");
      timer = window.setTimeout(() => void probe(), 1_500);
    };
    void probe();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [profile.voice]);
  useLayoutEffect(() => {
    const drawerIsOpen = memoryOpen || settingsOpen || gameOpen;

    if (drawerIsOpen && !drawerWasOpenRef.current) {
      const activeElement = document.activeElement;
      drawerReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    } else if (!drawerIsOpen && drawerWasOpenRef.current) {
      const returnTarget = drawerReturnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus();
      else talkButtonRef.current?.focus();
      drawerReturnFocusRef.current = null;
    }

    drawerWasOpenRef.current = drawerIsOpen;
  }, [memoryOpen, settingsOpen, gameOpen]);
  useLayoutEffect(() => {
    if (locked) unlockPasswordInputRef.current?.focus();
    else if (lockStateWasLockedRef.current) talkButtonRef.current?.focus();
    lockStateWasLockedRef.current = locked;
  }, [locked]);
  useLayoutEffect(() => {
    const drawer = memoryOpen ? memoryDrawerRef.current : settingsOpen ? settingsDrawerRef.current : gameOpen ? gameDrawerRef.current : null;
    if (!drawer) return;
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])",
    )).filter((element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true");
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !focusable.includes(activeElement)) focusable[0]?.focus();
  });
  useEffect(() => () => {
    handsFreeRef.current = false;
    if (restartListeningTimerRef.current !== null) window.clearTimeout(restartListeningTimerRef.current);
    detachRecognitionInstance();
    stopLocalCapture(true);
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
  const selectedVoicePreview = approvedVoicePreview(profile.voice);
  const compactVoiceStatus = !profile.speechEnabled
    ? "Spoken replies muted"
    : localVoiceState === "ready"
      ? "Local synthetic voice ready"
      : localVoiceState === "checking"
        ? "Local synthetic voice warming up…"
        : "Local synthetic voice unavailable · text stays complete";
  const presenceMode = listening
    ? "Listening closely"
    : speaking
      ? "Replying"
      : guiding
        ? "Breathing with you"
        : handsFree
          ? "Hands-free is on"
          : lastSafety === "urgent"
            ? "Staying with you"
            : expression === "happy"
              ? "Sharing the moment"
              : expression === "concerned"
                ? "Taking this seriously"
                : "Here with you";
  const presenceHeadline = lastSafety === "urgent"
    ? "We only need the next safe minute."
    : guiding
      ? "Let the room get quieter with us."
      : listening
        ? "Take your time. I’m listening."
        : expression === "happy"
          ? "That good moment deserves some room."
          : expression === "concerned"
            ? "You do not have to make this sound okay."
            : "Come as you are. Stay as long as you like.";

  function finishSpokenReply(source: "typed" | "hands-free") {
    speakingRef.current = false;
    setSpeaking(false);
    setSpeechMotion(null);
    if (onboardingIntroPendingRef.current) {
      if (onboardingIntroSpokeRef.current) void enterMainAfterOnboarding("spoken");
      else setOnboardingVoiceFailed(true);
      return;
    }
    if (source === "hands-free" || handsFreeRef.current) {
      voiceProcessingRef.current = false;
      scheduleHandsFreeListening();
    }
  }

  function queueSpokenReply(text: string, source: "typed" | "hands-free" = "typed") {
    if (!profileRef.current.speechEnabled) {
      finishSpokenReply(source);
      return;
    }
    if (localVoiceStateRef.current === "checking") {
      pendingSpokenReplyRef.current = { text, source };
      setVoiceNotice("The local voice is warming up. This complete reply is visible now and will be spoken when the voice is ready.");
      return;
    }
    voiceOutputRef.current?.speak({
      text,
      profile: profileRef.current.voice,
      enabled: profileRef.current.speechEnabled,
      onStart: (playback) => {
        if (!playback) {
          setVoiceNotice("The local voice host did not confirm actual playback timing. The complete reply remains visible and no mouth motion was fabricated.");
          return;
        }
        if (onboardingIntroPendingRef.current) onboardingIntroSpokeRef.current = true;
        speakingRef.current = true;
        setSpeaking(true);
        setSpeechMotion({ event: playback, startedAt: performance.now() });
        commitLocalVoiceState("ready");
        setVoiceNotice("Speaking with the local synthetic Chatterbox voice.");
      },
      onPlayback: (playback) => setSpeechMotion({ event: playback, startedAt: performance.now() }),
      onUnavailable: () => {
        commitLocalVoiceState("unavailable");
        if (onboardingIntroPendingRef.current) setOnboardingVoiceFailed(true);
        setVoiceNotice(source === "hands-free"
          ? "The optional local Chatterbox voice is unavailable. Text remains visible and listening will resume."
          : "The optional local Chatterbox voice is unavailable. This complete reply remains visible as text.");
      },
      onEnd: () => finishSpokenReply(source),
    });
  }

  function cancelSpokenReply(resumeHandsFree: boolean) {
    voiceOutputRef.current?.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    setSpeechMotion(null);
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
      pendingSpokenReplyRef.current = null;
      stopVoicePreview(true);
      cancelSpokenReply(true);
      setVoiceNotice(handsFreeRef.current
        ? "Spoken replies are muted. Hands-free listening stays on."
        : "Spoken replies are muted. Text remains visible.");
    } else {
      setVoiceNotice(localVoiceState === "ready"
        ? "Spoken replies are on. The local synthetic Chatterbox voice is ready."
        : "Spoken replies are on. The optional local Chatterbox voice is still warming up or unavailable; text always remains visible.");
    }
    updateProfile((current) => ({ ...current, speechEnabled: enabled, speechPreferenceSet: true }));
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
      stopLocalCapture(true);
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
    const requestedTheme = themePreferenceFromCommand(text);
    if (requestedTheme) {
      const now = new Date().toISOString();
      const replyText = themeConfirmation(requestedTheme);
      setInput("");
      updateProfile((current) => ({
        ...current,
        theme: requestedTheme,
        turns: [
          ...current.turns,
          { id: id(), role: "user", text, createdAt: now, safetyLevel: "steady", safetyContext: "general" },
          { id: id(), role: "companion", text: replyText, createdAt: now, safetyLevel: "steady", safetyContext: "general" },
        ],
      }));
      setExpression("happy");
      setModelNotice(`${requestedTheme === "system" ? "System appearance" : `${requestedTheme[0].toUpperCase()}${requestedTheme.slice(1)} appearance`} · saved locally`);
      if (source === "hands-free") voiceProcessingRef.current = false;
      queueSpokenReply(replyText, source);
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
    const partyRoleplayActive = isPartyRoleplayTurn(realRiskText(text).text, replyProfileAtStart);

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
        if (partyRoleplayActive) {
          return {
            reply: deterministicReply,
            replyProfile: replyProfileAtStart,
            notice: "Private offline rehearsal · fictional practice is not added to personal memory",
          };
        }
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
    const interestUpdates = replyProfile.interestPacksEnabled && !partyRoleplayActive ? learnInterestSignals(groundedText, replyProfile.interests) : [];
    const carePlans = extractCarePlans(groundedText);
    if (partyRoleplayActive) {
      carePlans.medications.length = 0;
      carePlans.appointments.length = 0;
    }
    setExpression(classifyExpression(text, reply.safetyLevel));
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
        companionName: reply.companionNameChange ?? current.companionName,
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

  function handleQuickAction(action: string) {
    if (isUrgentOptionsAction(action)) {
      setShowUrgent(true);
      revealUrgentOptions(urgentOptionsRef.current);
      return;
    }
    if (/^(?:play together|play another game)$/i.test(action)) {
      setGameOpen(true);
      return;
    }
    void send(action);
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

  async function startLocalRecognition(requestedPrivacyEpoch: number) {
    const localSpeech = window.wellbeingDesktop?.localSpeech;
    if (!localSpeech || localCaptureRef.current) return;
    const status = await localSpeech.status().catch(() => null);
    if (!status?.ready || !status.localOnly || !status.cacheOnly || status.rawAudioPersisted) {
      setListening(false);
      setVoiceNotice("Local speech recognition is warming up. Listening will retry automatically; no audio is being captured yet.");
      scheduleHandsFreeListening(1_000);
      return;
    }
    const microphoneArmed = await window.wellbeingDesktop!.armMicrophone().catch(() => false);
    if (!microphoneArmed
      || !profileMutationAllowed()
      || privacySessionGuardRef.current.capture() !== requestedPrivacyEpoch
      || !handsFreeRef.current) {
      window.wellbeingDesktop?.disarmMicrophone();
      if (!microphoneArmed) {
        handsFreeRef.current = false;
        setHandsFree(false);
        setVoiceNotice("The microphone was not enabled. Nothing was recorded; text conversation remains available.");
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (!profileMutationAllowed()
        || privacySessionGuardRef.current.capture() !== requestedPrivacyEpoch
        || !handsFreeRef.current) {
        for (const track of stream.getTracks()) track.stop();
        window.wellbeingDesktop?.disarmMicrophone();
        return;
      }
      const preferredMime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((candidate) => typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, preferredMime
        ? { mimeType: preferredMime, audioBitsPerSecond: 96_000 }
        : { audioBitsPerSecond: 96_000 });
      const AudioContextConstructor = window.AudioContext;
      const audioContext = AudioContextConstructor ? new AudioContextConstructor() : null;
      const analyser = audioContext?.createAnalyser() ?? null;
      if (analyser && audioContext) {
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.32;
        audioContext.createMediaStreamSource(stream).connect(analyser);
      }
      const capture: LocalCaptureSession = {
        recorder,
        stream,
        audioContext,
        animationFrame: null,
        chunks: [],
        bytes: 0,
        discard: false,
        heardSpeech: false,
        silentSince: null,
        startedAt: performance.now(),
      };
      localCaptureRef.current = capture;
      recorder.ondataavailable = (event) => {
        if (capture.discard || !event.data.size || capture.bytes + event.data.size > 12 * 1024 * 1024) return;
        capture.bytes += event.data.size;
        capture.chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (capture.discard) return;
        void (async () => {
          setListening(false);
          if (!capture.heardSpeech || capture.bytes < 64 || !handsFreeRef.current) {
            setVoiceNotice("Still here. Listening again…");
            scheduleHandsFreeListening(450);
            return;
          }
          voiceProcessingRef.current = true;
          setVoiceNotice("Transcribing this turn locally. Raw microphone audio is not saved.");
          const mimeType = (recorder.mimeType || preferredMime || "audio/webm").split(";", 1)[0].toLowerCase();
          const audio = await new Blob(capture.chunks, { type: mimeType }).arrayBuffer();
          capture.chunks.length = 0;
          const requestId = `speech-${id()}`;
          const result = await localSpeech.transcribe({ requestId, mimeType, audio }).catch(() => null);
          if (!handsFreeRef.current
            || lockedRef.current
            || privacySessionGuardRef.current.capture() !== requestedPrivacyEpoch) {
            voiceProcessingRef.current = false;
            return;
          }
          const transcript = result?.schema === "wellbeing.local-speech.provider-result.v1"
            && result.requestId === requestId
            && result.status === "completed"
            && result.rawAudioPersisted === false
            ? result.text.trim()
            : "";
          if (!transcript) {
            voiceProcessingRef.current = false;
            setVoiceNotice("I did not catch a clear phrase. Listening again…");
            scheduleHandsFreeListening(500);
            return;
          }
          setInput(transcript);
          await send(transcript, "hands-free");
        })();
      };
      recorder.onerror = () => {
        stopLocalCapture(true);
        setListening(false);
        handsFreeRef.current = false;
        setHandsFree(false);
        window.wellbeingDesktop?.disarmMicrophone();
        setVoiceNotice("Local microphone capture stopped unexpectedly. Nothing was saved; text conversation remains available.");
      };
      const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
      const monitor = (now: number) => {
        if (capture.discard || localCaptureRef.current !== capture) return;
        const elapsed = now - capture.startedAt;
        if (analyser && samples) {
          analyser.getByteTimeDomainData(samples);
          let squared = 0;
          for (const value of samples) {
            const normalized = (value - 128) / 128;
            squared += normalized * normalized;
          }
          const rms = Math.sqrt(squared / samples.length);
          if (rms >= 0.022) {
            capture.heardSpeech = true;
            capture.silentSince = null;
          } else if (capture.heardSpeech && rms < 0.016) {
            capture.silentSince ??= now;
          }
        } else if (elapsed >= 500) {
          capture.heardSpeech = true;
        }
        if ((capture.heardSpeech && capture.silentSince !== null && now - capture.silentSince >= 950)
          || elapsed >= 12_000
          || (!capture.heardSpeech && elapsed >= 6_000)) {
          stopLocalCapture(false);
          return;
        }
        capture.animationFrame = window.requestAnimationFrame(monitor);
      };
      recorder.start(250);
      setListening(true);
      setVoiceNotice("Listening locally… pause when you finish. Tap the mic to stop.");
      capture.animationFrame = window.requestAnimationFrame(monitor);
    } catch {
      stopLocalCapture(true);
      setListening(false);
      handsFreeRef.current = false;
      setHandsFree(false);
      window.wellbeingDesktop?.disarmMicrophone();
      setVoiceNotice("Windows or the selected input device did not provide microphone access. Nothing was recorded; text conversation remains available.");
    }
  }

  async function startRecognition() {
    if (!profileMutationAllowed() || !handsFreeRef.current || recognitionRef.current || localCaptureRef.current || voiceProcessingRef.current || speakingRef.current) return;
    const requestedPrivacyEpoch = privacySessionGuardRef.current.capture();
    if (window.wellbeingDesktop?.localSpeech) {
      await startLocalRecognition(requestedPrivacyEpoch);
      return;
    }
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
      stopLocalCapture(true);
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

  function changeTheme(theme: ThemePreference) {
    if (!profileMutationAllowed()) return;
    updateProfile((current) => ({ ...current, theme }));
    setModelNotice(`${theme === "system" ? "System appearance" : `${theme[0].toUpperCase()}${theme.slice(1)} appearance`} · saved locally`);
  }

  function saveCompanionName() {
    if (!profileMutationAllowed()) return;
    const nextName = cleanCompanionName(settingsCompanionName);
    if (!nextName) {
      setAccessProblem("Use 1–40 letters or numbers, with spaces, apostrophes, or hyphens. The companion remains synthetic and cannot use a human-role title.");
      return;
    }
    setAccessProblem("");
    updateProfile((current) => ({ ...current, companionName: nextName }));
    setSettingsCompanionName(nextName);
    setModelNotice(`${nextName} · companion name saved only in this private device profile`);
  }

  function resetCompanionName() {
    if (!profileMutationAllowed()) return;
    setAccessProblem("");
    updateProfile((current) => ({ ...current, companionName: DEFAULT_COMPANION_NAME }));
    setSettingsCompanionName("");
    setModelNotice("Companion · neutral name restored in this private device profile");
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
    setGameOpen(false);
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
      if (desktopFirstRunRef.current && targetRole === "primary" && !openedProfile.onboardingCompleted) {
        setOnboardingName(openedProfile.preferredName);
        setOnboardingCompanionName(openedProfile.companionName === DEFAULT_COMPANION_NAME ? "" : openedProfile.companionName);
        setOnboardingVoice(openedProfile.voice === "calm-masculine" ? "calm-masculine" : "soft-feminine");
        setOnboardingTheme(openedProfile.theme === "light" || openedProfile.theme === "dark" ? openedProfile.theme : "medium");
        setOnboardingAudioEnabled(openedProfile.speechEnabled);
        setOnboardingStep(0);
        setOnboardingOpen(true);
      }
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

  async function changeWindowMode(mode: "full" | "compact" | "character") {
    setCompactPanel(null);
    const bridge = window.wellbeingDesktop?.setWindowMode;
    if (bridge) {
      try {
        const result = await bridge(mode);
        if (result.rejected) throw new Error("The native window rejected that layout change.");
        setCompactMode(result.mode !== "full");
        setCharacterOnlyMode(result.mode === "character");
        setCompactChatVisible(result.mode !== "character");
        setAlwaysOnTop(result.alwaysOnTop);
        setCompactNotice(result.mode === "character" ? "Orb-only corner mode is ready." : result.mode === "compact" ? "Work-beside-me mode is ready." : "Full companion restored.");
        return;
      } catch {
        setCompactNotice("The native window could not change layout. Your conversation is unchanged.");
        return;
      }
    }
    setCompactMode(mode !== "full");
    setCharacterOnlyMode(mode === "character");
    setCompactChatVisible(mode !== "character");
    setCompactNotice(mode === "character" ? "Orb-only preview is active." : mode === "compact" ? "Compact preview is active. Native resizing is available in the installed app." : "Full companion restored.");
  }

  async function toggleAlwaysOnTop() {
    const bridge = window.wellbeingDesktop?.setAlwaysOnTop;
    if (!bridge) {
      setCompactNotice("Always-on-top is available in the installed desktop app.");
      return;
    }
    try {
      const enabled = await bridge(!alwaysOnTop);
      setAlwaysOnTop(enabled);
      setCompactNotice(enabled ? "Pinned above your other work." : "Pin released.");
    } catch {
      setCompactNotice("The desktop could not change the pin setting.");
    }
  }

  async function openFullPanel(panel: "play" | "memory" | "settings") {
    await changeWindowMode("full");
    setGameOpen(panel === "play");
    setMemoryOpen(panel === "memory");
    setSettingsOpen(panel === "settings");
  }

  function toggleCompactPanel(panel: CompactPanel) {
    setCompactPanel((current) => current === panel ? null : panel);
    if (characterOnlyMode) setCompactChatVisible(false);
  }

  async function completeOnboarding() {
    const preferredName = cleanPreferredName(onboardingName);
    const companionName = companionNameFromOptionalInput(onboardingCompanionName);
    if (!preferredName) {
      setOnboardingProblem("Please enter the name you want your companion to use.");
      setOnboardingStep(0);
      return;
    }
    if (!companionName) {
      setOnboardingProblem("Use 1–40 letters or numbers for the companion name, with spaces, apostrophes, or hyphens—or leave it blank to use Companion.");
      setOnboardingStep(0);
      return;
    }
    setOnboardingProblem("");
    const introduction = personalizedOpeningTurn(preferredName, companionName);
    const nextProfile: CompanionProfile = {
      ...profileRef.current,
      onboardingCompleted: false,
      preferredName,
      companionName,
      voice: onboardingVoice,
      theme: onboardingTheme,
      speechEnabled: onboardingAudioEnabled,
      speechPreferenceSet: true,
    };
    pendingOnboardingIntroductionRef.current = introduction;
    commitProfile(nextProfile);
    openingSpeechAttemptedRef.current = true;
    setOnboardingCompleting(true);
    setOnboardingVoiceFailed(false);
    if (onboardingAudioEnabled) {
      onboardingIntroPendingRef.current = true;
      onboardingIntroSpokeRef.current = false;
      queueSpokenReply(introduction.text);
      return;
    }
    await enterMainAfterOnboarding("text-only");
  }

  async function enterMainAfterOnboarding(completion: "spoken" | "text-only") {
    const introduction = pendingOnboardingIntroductionRef.current;
    pendingOnboardingIntroductionRef.current = null;
    updateProfile((current) => ({
      ...current,
      onboardingCompleted: true,
      turns: introduction
        ? (current.turns.length <= 1 ? [introduction] : [...current.turns, introduction])
        : current.turns,
    }));
    onboardingIntroPendingRef.current = false;
    onboardingIntroSpokeRef.current = false;
    pendingSpokenReplyRef.current = null;
    setOnboardingCompleting(false);
    setOnboardingVoiceFailed(false);
    setOnboardingOpen(false);
    if (!onboardingMicrophoneEnabled) {
      setVoiceNotice(completion === "spoken"
        ? "Welcome spoken with the selected local voice. Microphone setup was skipped."
        : "Welcome shown as text. Voice and microphone remain off until you choose to enable them.");
      return;
    }
    const permissionGranted = window.wellbeingDesktop
      ? await window.wellbeingDesktop.requestHandsFreePermission().catch(() => false)
      : true;
    if (!permissionGranted || !profileMutationAllowed()) {
      window.wellbeingDesktop?.disarmMicrophone();
      setVoiceNotice("Microphone permission was not granted. Nothing was recorded; text conversation remains available.");
      return;
    }
    handsFreeRef.current = true;
    setHandsFree(true);
    setVoiceNotice("Welcome complete. Hands-free listening is starting. Windows may still ask for its own microphone permission.");
    scheduleHandsFreeListening(100);
  }

  function continueOnboardingWithTextOnly() {
    onboardingIntroPendingRef.current = false;
    onboardingIntroSpokeRef.current = false;
    pendingSpokenReplyRef.current = null;
    updateProfile((current) => ({ ...current, speechEnabled: false, speechPreferenceSet: true }));
    cancelSpokenReply(false);
    void enterMainAfterOnboarding("text-only");
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
              ref={unlockPasswordInputRef}
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

  if (onboardingOpen && accessRole === "primary") {
    return (
      <main className="onboarding-shell" aria-labelledby="onboarding-title">
        <section className="onboarding-character" aria-label="Your temporary animated companion orb preview">
          <ReactiveCompanionOrb
            listening={false}
            thinking={onboardingCompleting && !speaking}
            speaking={speaking}
            playbackMotion={speechMotion}
            label="Temporary animated companion orb during setup"
          />
          <p><strong>Private by design</strong><span>Conversation, microphone audio, and voice stay on this device.</span></p>
        </section>
        <section className="onboarding-card">
          <header>
            <p className="eyebrow">WELCOME · STEP {onboardingStep + 1} OF 4</p>
            <div className="onboarding-progress" aria-label={`Setup step ${onboardingStep + 1} of 4`}>
              {[0, 1, 2, 3].map((step) => <i key={step} className={step <= onboardingStep ? "complete" : ""} />)}
            </div>
          </header>

          {onboardingStep === 0 && <div className="onboarding-page">
            <h1 id="onboarding-title">What should I call you?</h1>
            <p>This name is saved only in your private local profile. You can change or forget it later.</p>
            <label className="onboarding-name"><span>Preferred name</span><input autoFocus maxLength={40} autoComplete="nickname" value={onboardingName} onChange={(event) => setOnboardingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && cleanPreferredName(onboardingName)) setOnboardingStep(1); }} /></label>
            <label className="onboarding-name"><span>Your companion’s name (optional)</span><input maxLength={40} autoComplete="off" placeholder={DEFAULT_COMPANION_NAME} value={onboardingCompanionName} onChange={(event) => setOnboardingCompanionName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && cleanPreferredName(onboardingName) && onboardingCompanionNameValid) setOnboardingStep(1); }} /></label>
            <p className="onboarding-name-note">Leave this blank to use the neutral name “Companion.” The name stays in this private device profile, and the companion never claims to be human.</p>
          </div>}

          {onboardingStep === 1 && <div className="onboarding-page">
            <h1 id="onboarding-title">Choose a local voice.</h1>
            <p>Both choices are original synthetic voices. The app never substitutes a browser or Windows system voice.</p>
            <fieldset className="onboarding-options voice"><legend>Voice</legend>
              <label className={onboardingVoice === "soft-feminine" ? "selected" : ""}><input type="radio" name="onboarding-voice" checked={onboardingVoice === "soft-feminine"} onChange={() => setOnboardingVoice("soft-feminine")} /><span className="voice-avatar-swatch warm-plum" aria-hidden="true"><i /></span><span><strong>Soft female</strong><small>Gentle and welcoming</small></span></label>
              <label className={onboardingVoice === "calm-masculine" ? "selected" : ""}><input type="radio" name="onboarding-voice" checked={onboardingVoice === "calm-masculine"} onChange={() => setOnboardingVoice("calm-masculine")} /><span className="voice-avatar-swatch light-blue" aria-hidden="true"><i /></span><span><strong>Warm male</strong><small>Lower and steady</small></span></label>
            </fieldset>
            <label className="onboarding-toggle"><span><strong>Speak replies aloud</strong><small>The full reply always remains readable.</small></span><input type="checkbox" checked={onboardingAudioEnabled} onChange={(event) => setOnboardingAudioEnabled(event.target.checked)} /></label>
          </div>}

          {onboardingStep === 2 && <div className="onboarding-page">
            <h1 id="onboarding-title">Choose your appearance.</h1>
            <p>You can switch themes later in Settings.</p>
            <fieldset className="onboarding-options themes"><legend>Theme</legend>
              {(["light", "medium", "dark"] as const).map((theme) => <label key={theme} className={onboardingTheme === theme ? "selected" : ""}><input type="radio" name="onboarding-theme" checked={onboardingTheme === theme} onChange={() => setOnboardingTheme(theme)} /><span className={`theme-swatch ${theme}`} aria-hidden="true"><i /><i /><i /></span><span><strong>{theme === "medium" ? "Default / medium" : theme[0].toUpperCase() + theme.slice(1)}</strong><small>{theme === "medium" ? "Balanced color and contrast" : `${theme} appearance`}</small></span></label>)}
            </fieldset>
          </div>}

          {onboardingStep === 3 && !onboardingCompleting && <div className="onboarding-page">
            <h1 id="onboarding-title">Set up hands-free talk?</h1>
            <div className="microphone-explanation"><span aria-hidden="true">●</span><div><strong>You stay in control of the microphone.</strong><p>If enabled, the app asks once for this app session, then Windows may show its own microphone permission prompt. Setup cannot silently grant or bypass Windows permission. Audio is transcribed locally, kept in memory only, and discarded after each turn.</p></div></div>
            <fieldset className="onboarding-options microphone"><legend>Microphone choice</legend>
              <label className={onboardingMicrophoneEnabled ? "selected" : ""}><input type="radio" name="onboarding-microphone" checked={onboardingMicrophoneEnabled} onChange={() => setOnboardingMicrophoneEnabled(true)} /><span><strong>Enable after setup</strong><small>Ask for permission, then listen locally</small></span></label>
              <label className={!onboardingMicrophoneEnabled ? "selected" : ""}><input type="radio" name="onboarding-microphone" checked={!onboardingMicrophoneEnabled} onChange={() => setOnboardingMicrophoneEnabled(false)} /><span><strong>Not now</strong><small>Typing works without microphone access</small></span></label>
            </fieldset>
          </div>}

          {onboardingStep === 3 && onboardingCompleting && <div className="onboarding-page onboarding-warmup" aria-live="polite">
            <h1 id="onboarding-title">Preparing your welcome.</h1>
            <div className={`warmup-orb${speaking ? " speaking" : ""}`} aria-hidden="true"><i /><i /><i /></div>
            {pendingOnboardingIntroductionRef.current && <p className="onboarding-introduction-text">{pendingOnboardingIntroductionRef.current.text}</p>}
            <p>{speaking
              ? "Your selected local synthetic voice is speaking now. The temporary orb follows the sanitized playback energy."
              : onboardingVoiceFailed
                ? "The local voice could not begin. No browser or Windows substitute was used."
                : localVoiceState === "ready"
                  ? "The selected voice is ready and generating the private local welcome."
                  : "The selected voice is warming locally. No microphone audio is being captured while you wait."}</p>
            <div className="warmup-status"><span className={onboardingVoiceFailed ? "failed" : speaking ? "live" : "warming"} /> <strong>{onboardingVoiceFailed ? "Voice unavailable" : speaking ? "Welcome playing" : "Local voice warm-up in progress"}</strong></div>
            {!speaking && <button type="button" className="secondary-action text-only-choice" onClick={continueOnboardingWithTextOnly}>Continue with text only</button>}
          </div>}

          {onboardingProblem && <p className="onboarding-problem" role="alert">{onboardingProblem}</p>}
          {!onboardingCompleting && <footer>
            <button type="button" className="secondary-action" disabled={onboardingStep === 0} onClick={() => setOnboardingStep((step) => Math.max(0, step - 1))}>Back</button>
            {onboardingStep < 3
              ? <button type="button" className="primary-action" disabled={onboardingStep === 0 && (!cleanPreferredName(onboardingName) || !onboardingCompanionNameValid)} onClick={() => setOnboardingStep((step) => Math.min(3, step + 1))}>Continue</button>
              : <button type="button" className="primary-action" onClick={() => void completeOnboarding()}>{onboardingMicrophoneEnabled ? "Finish and request microphone" : "Finish setup"}</button>}
          </footer>}
        </section>
      </main>
    );
  }

  if (compactMode) {
    return (
      <main className={`compact-companion-shell${characterOnlyMode ? " character-only" : ""} safety-${lastSafety} expression-${expression}`} data-window-mode={characterOnlyMode ? "character" : "compact"} aria-label={characterOnlyMode ? "Orb-only corner companion" : "Compact work beside me companion"}>
        <header className="compact-titlebar">
          <div><span className="status-dot" /><strong>{profile.companionName}</strong><small>{presenceMode} · private local companion</small></div>
          <div>
            <button type="button" className={alwaysOnTop ? "is-active" : ""} onClick={() => void toggleAlwaysOnTop()} aria-pressed={alwaysOnTop} aria-label={alwaysOnTop ? "Stop keeping companion above other windows" : "Keep companion above other windows"} title={alwaysOnTop ? "Unpin window" : "Always on top"}>⌖</button>
            <button type="button" onClick={() => void changeWindowMode("full")} aria-label="Restore full companion" title="Restore full companion">↗</button>
            <button type="button" onClick={() => window.wellbeingDesktop?.hideWindow?.()} aria-label="Hide companion to notification area" title="Hide companion">—</button>
          </div>
        </header>

        <section className="compact-character-stage" aria-label="Live temporary companion orb" onClick={() => { if (characterOnlyMode) setCompactChatVisible(true); }}>
          <div className="compact-aurora" aria-hidden="true" />
          <ReactiveCompanionOrb listening={listening} thinking={modelBusy || guiding} speaking={speaking} playbackMotion={speechMotion} label="Temporary companion orb reacting beside your work" />
        </section>

        {compactPanel && <section className={`compact-panel compact-panel-${compactPanel}`} aria-label={`Compact ${compactPanel}`}>
          <header><div><span>{compactPanel === "activities" ? "✦" : compactPanel === "memory" ? "◇" : "⚙"}</span><strong>{compactPanel === "activities" ? "Play together" : compactPanel === "memory" ? "Private memory" : "Quick settings"}</strong></div><button type="button" onClick={() => setCompactPanel(null)} aria-label={`Close compact ${compactPanel}`}>×</button></header>
          {compactPanel === "activities" && <div className="compact-activity-grid">
            {listGames().map((game) => <button type="button" key={game.kind} onClick={() => { startGame(game.kind); setCompactPanel(null); setCompactChatVisible(true); }}><span>{game.kind === "trivia" ? "?" : game.kind === "would-you-rather" ? "↔" : game.kind === "word-association" ? "Aa" : "◎"}</span><strong>{game.title}</strong><small>{game.description}</small></button>)}
          </div>}
          {compactPanel === "memory" && <div className="compact-memory-list">
            {profile.memories.length === 0 ? <p className="compact-panel-empty">Nothing is saved yet. Memory grows naturally from conversation and stays in this device profile.</p> : profile.memories.slice(-4).reverse().map((entry) => <article key={entry.id}><div><span>{entry.kind}</span><strong>{entry.label}</strong><small>{entry.value}</small></div><button type="button" disabled={accessBusy} onClick={() => deleteMemory(entry.id)} aria-label={`Forget ${entry.label}`}>Forget</button></article>)}
          </div>}
          {compactPanel === "settings" && <div className="compact-settings-list">
            <fieldset className="compact-name-settings"><legend>Companion name</legend><input aria-label="Companion name" maxLength={40} value={settingsCompanionName} placeholder={DEFAULT_COMPANION_NAME} onChange={(event) => setSettingsCompanionName(event.target.value)} /><div><button type="button" onClick={saveCompanionName} disabled={accessBusy}>Save name</button><button type="button" onClick={resetCompanionName} disabled={accessBusy}>Reset</button></div><small>Local to this private profile; this synthetic companion never claims human identity.</small></fieldset>
            <fieldset><legend>Appearance</legend><div className="compact-theme-buttons">{(["light", "medium", "dark"] as const).map((theme) => <button type="button" key={theme} className={profile.theme === theme ? "selected" : ""} onClick={() => changeTheme(theme)} aria-pressed={profile.theme === theme}>{theme === "medium" ? "Default" : theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></fieldset>
            <label><span><strong>Spoken replies</strong><small>Text always stays visible</small></span><input type="checkbox" checked={profile.speechEnabled} disabled={accessBusy} onChange={(event) => setSpokenRepliesEnabled(event.target.checked)} /></label>
            <label><span><strong>Learn from conversation</strong><small>Saved locally and reviewable</small></span><input type="checkbox" checked={profile.learningEnabled} disabled={accessBusy} onChange={(event) => setLearningEnabled(event.target.checked)} /></label>
            <label><span><strong>Interest packs</strong><small>Use remembered favorites gently</small></span><input type="checkbox" checked={profile.interestPacksEnabled} disabled={accessBusy} onChange={(event) => setInterestPacksEnabled(event.target.checked)} /></label>
            <button type="button" className="compact-more-settings" onClick={() => void openFullPanel("settings")}>Privacy and access controls →</button>
          </div>}
        </section>}

        {!compactPanel && (!characterOnlyMode || compactChatVisible || listening || speaking || Boolean(input.trim())) && <section className="compact-conversation" aria-label="Compact conversation">
          <div className="compact-transcript-heading"><strong>Conversation</strong><small>Newest below · scroll for full transcript</small></div>
          <div className="compact-turns" aria-live="polite" aria-label="Full conversation transcript" ref={compactTurnsRef} tabIndex={0}>
            {profile.turns.map((turn, index) => <article ref={index === profile.turns.length - 1 ? latestCompactTurnRef : undefined} key={turn.id} className={`compact-turn ${turn.role} ${turn.safetyLevel}`}><span>{turn.role === "companion" ? profile.companionName : "You"}</span><p>{turn.text}</p></article>)}
          </div>
          <form className="compact-composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="compact-message">Message</label>
            <textarea id="compact-message" value={input} disabled={modelBusy || accessBusy} onChange={(event) => setInput(event.target.value)} placeholder={modelBusy ? "Thinking locally…" : "Talk to me…"} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
            <button type="submit" disabled={modelBusy || accessBusy} aria-label="Send message">{modelBusy ? "…" : "↑"}</button>
          </form>
          <p className={`compact-status voice-${localVoiceState}`} aria-live="polite">{compactNotice || voiceNotice || compactVoiceStatus || modelNotice}</p>
        </section>}

        <nav className="compact-toolbar" aria-label="Compact companion controls">
          <button type="button" className={handsFree ? "is-active" : ""} onClick={() => void toggleListening()} aria-pressed={handsFree} aria-label={handsFree ? "Stop hands-free conversation" : "Start hands-free conversation"} title="Hands-free talk">{handsFree ? "■" : "●"}<small>Talk</small></button>
          <button type="button" className={profile.speechEnabled ? "" : "is-active"} onClick={() => setSpokenRepliesEnabled(!profile.speechEnabled)} aria-pressed={!profile.speechEnabled} aria-label={profile.speechEnabled ? "Mute spoken replies" : "Turn on spoken replies"} title="Speaker mute">{profile.speechEnabled ? "◖))" : "◖×"}<small>Sound</small></button>
          <button type="button" className={compactPanel === "activities" ? "is-active" : ""} onClick={() => toggleCompactPanel("activities")} aria-expanded={compactPanel === "activities"} aria-label="Show activities and play" title="Play and activities">✦<small>Play</small></button>
          <button type="button" className={compactPanel === "memory" ? "is-active" : ""} onClick={() => toggleCompactPanel("memory")} aria-expanded={compactPanel === "memory"} aria-label="Show private memory" title="Memory">◇<small>Memory</small></button>
          <button type="button" className={compactPanel === "settings" ? "is-active" : ""} onClick={() => toggleCompactPanel("settings")} aria-expanded={compactPanel === "settings"} aria-label="Show quick settings" title="Settings">⚙<small>Settings</small></button>
          <PwaInstallControl compact />
          <button type="button" className={characterOnlyMode ? "is-active" : ""} onClick={() => void changeWindowMode(characterOnlyMode ? "compact" : "character")} aria-pressed={characterOnlyMode} aria-label={characterOnlyMode ? "Show compact chat" : "Use orb-only corner mode"} title={characterOnlyMode ? "Show compact chat" : "Orb-only mode"}>◉<small>Orb</small></button>
          <button type="button" onClick={() => void changeWindowMode("full")} aria-label="Expand to full companion" title="Expand">↗<small>Expand</small></button>
          <button type="button" onClick={() => window.wellbeingDesktop?.hideWindow?.()} aria-label="Hide companion" title="Hide">×<small>Hide</small></button>
        </nav>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Companion controls">
        <div className="brand-mark" aria-label="Private companion working title">
          <span className="brand-spark">✦</span>
          <span className="brand-name">{profile.companionName}<small>private space</small></span>
        </div>
        <nav>
          <button ref={talkButtonRef} className="rail-button active" aria-current="page" onClick={() => messageInputRef.current?.focus()}><span className="rail-icon">◉</span><span className="rail-copy"><strong>Talk</strong><small>Your shared space</small></span></button>
          <button className="rail-button" onClick={() => { setGameOpen(true); setMemoryOpen(false); setSettingsOpen(false); }}><span className="rail-icon">✦</span><span className="rail-copy"><strong>Play</strong><small>Offline activities</small></span></button>
          <button className="rail-button" onClick={() => { setMemoryOpen(true); setGameOpen(false); setSettingsOpen(false); }}><span className="rail-icon">◇</span><span className="rail-copy"><strong>Memory</strong><small>People and moments</small></span></button>
          <button className="rail-button" onClick={() => { setSettingsOpen(true); setGameOpen(false); setMemoryOpen(false); }}><span className="rail-icon">⌁</span><span className="rail-copy"><strong>Settings</strong><small>Voice and privacy</small></span></button>
        </nav>
        <div className="local-badge"><span className="status-dot" /> Private local core<br /><small>Memories stay in this device profile</small></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">PRIVATE COMPANION · WORKING TITLE</p>
            <h1>{profile.preferredName ? `Good to see you, ${profile.preferredName}.` : "You can begin anywhere."}</h1>
          </div>
          <div className="top-actions">
            {accessRole === "guardian" && <span className="role-chip">Guardian space</span>}
            <PwaInstallControl />
            <button className={`icon-button ${profile.speechEnabled ? "" : "muted"}`} disabled={accessBusy} onClick={() => setSpokenRepliesEnabled(!profile.speechEnabled)} aria-pressed={!profile.speechEnabled} aria-label={profile.speechEnabled ? "Mute spoken replies" : "Turn on spoken replies"}>{profile.speechEnabled ? "◖))" : "◖×"}</button>
            <button className="icon-button" type="button" onClick={() => void changeWindowMode("compact")} aria-label="Open compact work beside me mode" title="Work beside me">◫</button>
            <button className="avatar-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">{profile.preferredName?.[0]?.toUpperCase() ?? "ME"}</button>
          </div>
        </header>

        <section className={`presence-panel safety-${lastSafety} expression-${expression}`} aria-label="Companion presence">
          <div className="presence-atmosphere" aria-hidden="true"><span /><span /><span /></div>
          <div className="orb one" /><div className="orb two" />
          <div className="mascot-theatre">
            <p className="stage-kicker"><span /> TEMPORARY ANIMATED ORB</p>
            <div className="mascot-wrap">
              <div className="mascot-halo" />
              <ReactiveCompanionOrb listening={listening} thinking={modelBusy || guiding} speaking={speaking} playbackMotion={speechMotion} label="Temporary companion orb reacting in real time" />
            </div>
            <div className="stage-caption"><strong>{presenceMode}</strong><span>Honest temporary orb · smooth local state and playback-energy response · not the future 3D character</span></div>
          </div>
          <div className="presence-copy">
            <div className="presence-label"><span className="status-dot" /> {presenceMode.toUpperCase()}</div>
            <h2>{presenceHeadline}</h2>
            <p>{accessRole === "guardian" ? "This guardian conversation is encrypted separately and cannot reveal the primary user’s private space." : "A synthetic friend who listens and remembers without pretending to be biological. Typed conversation and saved memories stay in this device profile. In the installed app, each hands-free turn is transcribed locally from memory and discarded after use; Windows still controls microphone permission."}</p>
            <div className="presence-actions" aria-label="Start together">
              <button type="button" className="presence-action primary" onClick={() => messageInputRef.current?.focus()}><span>◉</span><strong>Talk with me</strong><small>Type anything</small></button>
              <button type="button" className="presence-action" disabled={modelBusy || accessBusy} onClick={() => void send("Let's do the 60-second reset")}><span>≈</span><strong>Breathe together</strong><small>One quiet minute</small></button>
              <button type="button" className="presence-action" onClick={() => { setGameOpen(true); setMemoryOpen(false); setSettingsOpen(false); }}><span>✦</span><strong>Play something</strong><small>No pressure</small></button>
            </div>
            <div className="privacy-row"><span>{privacyConfigured ? "▣ Encrypted local vault" : "▣ Local memory"}</span><span>◌ Core works offline</span><span>⌫ You control deletion</span></div>
          </div>
        </section>

        <section className="moment-deck" aria-label="Companion spaces">
          <button type="button" onClick={() => setMemoryOpen(true)}><span className="moment-icon memory">◇</span><span><small>REMEMBERS GENTLY</small><strong>{profile.memories.length ? `${profile.memories.length} moments and details` : "Your story starts naturally"}</strong><em>Review or forget anything →</em></span></button>
          <button type="button" onClick={() => { setGameOpen(true); setMemoryOpen(false); setSettingsOpen(false); }}><span className="moment-icon play">✦</span><span><small>PLAY TOGETHER</small><strong>Trivia, choices, and small sparks</strong><em>Works offline →</em></span></button>
          <button type="button" onClick={() => void toggleListening()} disabled={accessBusy}><span className={`moment-icon hands-free${handsFree ? " live" : ""}`}>{handsFree ? "■" : "◉"}</span><span><small>HANDS-FREE SPACE</small><strong>{handsFree ? "Listening is ready" : "Relax and talk naturally"}</strong><em>{handsFree ? "Turn listening off →" : "Turn listening on →"}</em></span></button>
        </section>

        <div className="content-grid">
          <section className="conversation-card" aria-label="Conversation">
            <div className="section-heading">
              <div><p className="eyebrow">CONVERSATION</p><h3>Talk it through.</h3></div>
              <button className="text-button" onClick={() => setMemoryOpen(true)}>{profile.memories.length} memories →</button>
            </div>

            <div className="turns" aria-live="polite" aria-label="Recent conversation transcript" ref={turnsRef} tabIndex={0}>
              {profile.turns.map((turn, index, visibleTurns) => (
                <article ref={index === visibleTurns.length - 1 ? latestTurnRef : undefined} key={turn.id} className={`turn ${turn.role} ${turn.safetyLevel}`}>
                  <div className="turn-meta">{turn.role === "companion" ? profile.companionName : "You"}<time>{formatTime(turn.createdAt)}</time></div>
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

            <div className="quick-actions">{actions.map((action) => <button key={action} disabled={modelBusy || accessBusy} onClick={() => handleQuickAction(action)}>{action}</button>)}</div>

            <form className="composer" onSubmit={submit}>
              <button type="button" className={`mic-button ${handsFree ? "live" : ""}`} disabled={accessBusy} onClick={() => void toggleListening()} aria-pressed={handsFree} aria-label={handsFree ? "Stop hands-free conversation" : "Start hands-free conversation"}>{handsFree ? "■" : "●"}</button>
              <label className="sr-only" htmlFor="message">Message</label>
              <textarea ref={messageInputRef} id="message" value={input} disabled={modelBusy || accessBusy} onChange={(event) => setInput(event.target.value)} placeholder={accessBusy ? "Private-space protection is being updated…" : modelBusy ? "Thinking locally…" : "Say what’s on your mind…"} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
              <button className="send-button" type="submit" disabled={modelBusy || accessBusy} aria-label={accessBusy ? "Private-space protection is being updated" : modelBusy ? "Preparing response" : "Send message"}>{modelBusy || accessBusy ? "…" : "↑"}</button>
            </form>
            <p className="voice-status" aria-live="polite">{voiceNotice || compactVoiceStatus || handsFreeStatus({ enabled: handsFree, listening, speaking })}</p>
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
        <section className="companion-name-settings" aria-labelledby="companion-name-heading">
          <h3 id="companion-name-heading">Companion name</h3>
          <p>Choose a Unicode name for this synthetic companion. It stays only in this private device profile and persists across restarts.</p>
          <label><span>Name</span><input maxLength={40} autoComplete="off" value={settingsCompanionName} placeholder={DEFAULT_COMPANION_NAME} disabled={accessBusy} onChange={(event) => setSettingsCompanionName(event.target.value)} /></label>
          <div><button className="secondary-action" type="button" disabled={accessBusy} onClick={saveCompanionName}>Save name</button><button className="text-button" type="button" disabled={accessBusy} onClick={resetCompanionName}>Reset to Companion</button></div>
        </section>
        {accessRole === "guardian" && <div className="guardian-banner"><strong>Guardian space</strong><p>This is a separate conversation. Primary-user memories and transcripts are not available here.</p><button className="secondary-action" type="button" disabled={accessBusy} onClick={lockNow}>Lock guardian space</button></div>}
        <fieldset className="voice-choices"><legend>Local voice preset and appearance</legend>
          <label className={profile.voice === "soft-feminine" ? "selected" : ""}><input type="radio" name="voice" checked={profile.voice === "soft-feminine"} disabled={accessBusy} onChange={() => changeVoice("soft-feminine")} /><span className="voice-avatar-swatch warm-plum" aria-hidden="true"><i /></span><span><strong>Soft female</strong>Gentle and welcoming</span></label>
          <label className={profile.voice === "calm-masculine" ? "selected" : ""}><input type="radio" name="voice" checked={profile.voice === "calm-masculine"} disabled={accessBusy} onChange={() => changeVoice("calm-masculine")} /><span className="voice-avatar-swatch light-blue" aria-hidden="true"><i /></span><span><strong>Warm male</strong>Lower and steady</span></label>
        </fieldset>
        <fieldset className="theme-choices"><legend>Appearance</legend>
          <p>Follow this device by default, or keep a bold light or dark look for this private profile. You can also say “use dark theme,” “use light theme,” or “follow system.”</p>
          <div>
            {(["light", "medium", "dark", "system"] as const).map((theme) => (
              <label key={theme} className={profile.theme === theme ? "selected" : ""}>
                <input type="radio" name="theme" checked={profile.theme === theme} disabled={accessBusy} onChange={() => changeTheme(theme)} />
                <span className={`theme-swatch ${theme}`} aria-hidden="true"><i /><i /><i /></span>
                <strong>{theme === "system" ? "Follow device" : theme === "medium" ? "Default / medium" : `${theme[0].toUpperCase()}${theme.slice(1)}`}</strong>
                <small>{theme === "system" ? `Following this device · ${effectiveTheme} now` : `${theme} on this profile`}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="voice-preview-panel">
          <button type="button" onClick={previewSelectedVoice} disabled={accessBusy || !profile.speechEnabled || !selectedVoicePreview}>Preview selected voice</button>
          <small>{selectedVoicePreview ? `${selectedVoicePreview.productLabel} · approved static sample` : "No approved sample for this preset yet"}</small>
          <p>This previews one reviewed recording. On this device, the optional offline Chatterbox route uses the same original synthetic reference after it finishes warming up; it never downloads a model or imitates a named person.</p>
        </div>
        <label className="toggle-row"><span><strong>Spoken replies</strong><small>{compactVoiceStatus} · no silent substitute voice</small></span><input type="checkbox" checked={profile.speechEnabled} disabled={accessBusy} onChange={(event) => setSpokenRepliesEnabled(event.target.checked)} /></label>
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

      <details ref={urgentOptionsRef} className={`safety-corner${showUrgent ? " attention" : ""}`}>
        <summary>{showUrgent ? "Urgent options are here while we keep talking" : "Need urgent support?"}</summary>
        <ul>{urgentOptions.map((option) => <li key={option}>{option}</li>)}</ul>
        <p>In the United States, call or text 988 for crisis support, or 911 for immediate danger. Availability and response practices vary by location.</p>
      </details>
    </div>
  );
}
