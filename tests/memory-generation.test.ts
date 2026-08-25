import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { respond } from "../src/lib/companion";
import { minimizedRecentContext } from "../src/lib/local-model";
import { nextMemoryGeneration, resolveWithMemoryGeneration, resolveWithProfileGenerations } from "../src/lib/memory-generation";
import { defaultProfile, extractMemories, forgetMemory } from "../src/lib/memory";
import { PrivacySessionEpochGuard } from "../src/lib/privacy-session";
import type { CompanionReply, ConversationTurn } from "../src/lib/types";

const root = fileURLToPath(new URL("../", import.meta.url));
const appSource = readFileSync(`${root}src/App.tsx`, "utf8");

describe("memory-generation reply guard", () => {
  it("does not start a pending enhancement when deletion already changed the generation", async () => {
    let generation = 1;
    const pending = vi.fn().mockResolvedValue("stale");
    const refresh = vi.fn(() => "fresh");

    const result = await resolveWithMemoryGeneration(0, () => generation, pending, refresh);

    expect(result).toEqual({ value: "fresh", refreshed: true });
    expect(pending).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns the completed enhancement while memory generation stays current", async () => {
    const pending = vi.fn().mockResolvedValue("current");
    const refresh = vi.fn(() => "fresh");

    const result = await resolveWithMemoryGeneration(4, () => 4, pending, refresh);

    expect(result).toEqual({ value: "current", refreshed: false });
    expect(pending).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("discards a delayed astronomy reply after Forget and keeps later model context clean", async () => {
    const astronomy = extractMemories("I like astronomy.").find((entry) => entry.kind === "preference");
    expect(astronomy).toBeDefined();
    const initialProfile = { ...defaultProfile(), memories: [astronomy!] };
    const forgottenProfile = forgetMemory(initialProfile, astronomy!.id);
    const staleReply = respond("I'm bored.", initialProfile);
    const refreshedReply = respond("I'm bored.", forgottenProfile);
    expect(staleReply.text).toContain("astronomy");
    expect(refreshedReply.text).not.toContain("astronomy");

    let generation = 0;
    let completePending!: (reply: CompanionReply) => void;
    const delayed = new Promise<CompanionReply>((resolve) => { completePending = resolve; });
    const privacyGuard = new PrivacySessionEpochGuard();
    const resolutionPromise = resolveWithProfileGenerations(
      privacyGuard.capture(),
      () => privacyGuard.capture(),
      generation,
      () => generation,
      () => delayed,
      () => refreshedReply,
    );

    generation = nextMemoryGeneration(generation);
    completePending(staleReply);
    const resolution = await resolutionPromise;
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") throw new Error("Forget should refresh, not discard, a reply in the same private session.");
    expect(resolution.refreshed).toBe(true);
    expect(resolution.value.text).not.toContain("astronomy");

    const appendedTurns: ConversationTurn[] = [
      { id: "user", role: "user", text: "I'm bored.", createdAt: "2026-08-25T12:00:00Z", safetyLevel: "steady" },
      { id: "reply", role: "companion", text: resolution.value.text, createdAt: "2026-08-25T12:00:01Z", safetyLevel: "steady", groundedMemoryIds: resolution.value.usedMemoryIds },
    ];
    expect(JSON.stringify(appendedTurns)).not.toContain("astronomy");
    expect(JSON.stringify(minimizedRecentContext(appendedTurns))).not.toContain("astronomy");
  });

  it("blocks profile mutation throughout an asynchronous vault transition and advances the privacy epoch", () => {
    const guard = new PrivacySessionEpochGuard();
    const initialEpoch = guard.capture();

    const transitionToken = guard.beginTransition();
    expect(transitionToken).not.toBe(initialEpoch);
    expect(guard.canMutateProfile()).toBe(false);
    expect(guard.isTransitioning()).toBe(true);

    expect(guard.completeTransition(transitionToken)).toBe(true);
    expect(guard.capture()).not.toBe(transitionToken);
    expect(guard.canMutateProfile()).toBe(true);
    expect(guard.isTransitioning()).toBe(false);
  });

  it("discards a primary reply that finishes after lock and guardian-session replacement", async () => {
    const guard = new PrivacySessionEpochGuard();
    let completePending!: (value: { text: string; sourceRole: string }) => void;
    const delayed = new Promise<{ text: string; sourceRole: string }>((resolve) => { completePending = resolve; });
    const pending = resolveWithProfileGenerations(
      guard.capture(),
      () => guard.capture(),
      0,
      () => 0,
      () => delayed,
      () => ({ text: "refreshed primary reply", sourceRole: "primary" }),
    );

    guard.replaceSession(); // Lock clears the decrypted primary session.
    const guardianUnlockToken = guard.beginTransition();
    expect(guard.completeTransition(guardianUnlockToken)).toBe(true); // Guardian profile replacement completes.
    completePending({ text: "primary transcript and private memory", sourceRole: "primary" });

    await expect(pending).resolves.toEqual({ status: "discarded", reason: "privacy-session-changed" });
  });

  it("discards a pending reply after locking and reopening the same profile", async () => {
    const guard = new PrivacySessionEpochGuard();
    let completePending!: (value: string) => void;
    const delayed = new Promise<string>((resolve) => { completePending = resolve; });
    const pending = resolveWithProfileGenerations(
      guard.capture(),
      () => guard.capture(),
      0,
      () => 0,
      () => delayed,
      () => "refreshed",
    );

    guard.replaceSession();
    const sameProfileUnlockToken = guard.beginTransition();
    expect(guard.completeTransition(sameProfileUnlockToken)).toBe(true);
    completePending("stale reply from the pre-lock session");

    await expect(pending).resolves.toEqual({ status: "discarded", reason: "privacy-session-changed" });
  });

  it("blocks Forget while a vault snapshot is being sealed and permits it after completion", () => {
    const astronomy = extractMemories("I like astronomy.").find((entry) => entry.kind === "preference");
    expect(astronomy).toBeDefined();
    let currentProfile = { ...defaultProfile(), memories: [astronomy!] };
    const guard = new PrivacySessionEpochGuard();

    const transitionToken = guard.beginTransition();
    if (guard.canMutateProfile()) currentProfile = forgetMemory(currentProfile, astronomy!.id);
    expect(currentProfile.memories).toContainEqual(astronomy);

    expect(guard.completeTransition(transitionToken)).toBe(true);
    if (guard.canMutateProfile()) currentProfile = forgetMemory(currentProfile, astronomy!.id);
    expect(currentProfile.memories).toEqual([]);
  });

  it("drops a pending completion during vault creation without leaking transcript, memory, or care-plan data", async () => {
    const guard = new PrivacySessionEpochGuard();
    const guardianProfile = {
      ...defaultProfile(),
      turns: [{ id: "guardian", role: "companion" as const, text: "Guardian space", createdAt: "2026-08-25T12:00:00Z", safetyLevel: "steady" as const }],
    };
    let visibleProfile = guardianProfile;
    let visibleCarePlan = { medications: [] as string[], appointments: [] as string[] };
    let completePending!: (value: {
      turns: ConversationTurn[];
      memoryValues: string[];
      carePlan: { medications: string[]; appointments: string[] };
    }) => void;
    const delayed = new Promise<{
      turns: ConversationTurn[];
      memoryValues: string[];
      carePlan: { medications: string[]; appointments: string[] };
    }>((resolve) => { completePending = resolve; });
    const pending = resolveWithProfileGenerations(
      guard.capture(),
      () => guard.capture(),
      0,
      () => 0,
      () => delayed,
      () => ({ turns: [], memoryValues: [], carePlan: { medications: [], appointments: [] } }),
    );

    const transitionToken = guard.beginTransition();
    completePending({
      turns: [
        { id: "primary-user", role: "user", text: "I like astronomy and take StaleMed.", createdAt: "2026-08-25T12:00:01Z", safetyLevel: "steady" },
        { id: "primary-reply", role: "companion", text: "Let's talk astronomy.", createdAt: "2026-08-25T12:00:02Z", safetyLevel: "steady" },
      ],
      memoryValues: ["astronomy"],
      carePlan: { medications: ["StaleMed"], appointments: ["primary appointment"] },
    });
    const resolution = await pending;
    if (resolution.status === "resolved") {
      visibleProfile = { ...visibleProfile, turns: [...visibleProfile.turns, ...resolution.value.turns] };
      visibleCarePlan = resolution.value.carePlan;
    }
    expect(guard.completeTransition(transitionToken)).toBe(true);

    expect(resolution).toEqual({ status: "discarded", reason: "privacy-session-changed" });
    const visibleState = JSON.stringify({ visibleProfile, visibleCarePlan });
    expect(visibleState).not.toMatch(/astronomy|StaleMed|primary appointment|primary-user|primary-reply/i);
    expect(minimizedRecentContext(visibleProfile.turns)).toEqual([{ role: "companion", text: "Guardian space" }]);
  });

  it("does not call a pending provider or refresh callback after the private session already changed", async () => {
    const guard = new PrivacySessionEpochGuard();
    const captured = guard.capture();
    guard.replaceSession();
    const pending = vi.fn().mockResolvedValue("stale");
    const refresh = vi.fn(() => "fresh");

    const result = await resolveWithProfileGenerations(captured, () => guard.capture(), 0, () => 1, pending, refresh);

    expect(result).toEqual({ status: "discarded", reason: "privacy-session-changed" });
    expect(pending).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("wires privacy transitions to clear pending-send, model, hands-free, microphone, preview, and speech state", () => {
    const quiesce = appSource.slice(
      appSource.indexOf("function quiesceConversationForPrivacyTransition"),
      appSource.indexOf("function profileMutationAllowed"),
    );
    expect(quiesce).toContain("activeSendRef.current = null");
    expect(quiesce).toContain("modelBusyRef.current = false");
    expect(quiesce).toContain("setModelBusy(false)");
    expect(quiesce).toContain("handsFreeRef.current = false");
    expect(quiesce).toContain("setHandsFree(false)");
    expect(quiesce).toContain("voiceProcessingRef.current = false");
    expect(quiesce).toContain("window.clearTimeout(restartListeningTimerRef.current)");
    expect(quiesce).toContain("detachRecognitionInstance()");
    expect(quiesce).toContain("window.wellbeingDesktop?.disarmMicrophone()");
    expect(quiesce).toContain("stopVoicePreview(false)");
    expect(quiesce).toContain("cancelSpokenReply(false)");
  });

  it("wires atomic vault capture, whole-send invalidation, and transient-session clearing into the app", () => {
    const enablePrivacy = appSource.slice(
      appSource.indexOf("async function enablePrivacyLock"),
      appSource.indexOf("async function enableGuardianSpace"),
    );
    expect(enablePrivacy.indexOf("beginAsyncPrivacyTransition")).toBeLessThan(enablePrivacy.indexOf("const profileSnapshot = profileRef.current"));
    expect(enablePrivacy).toContain('createVault(profileSnapshot, passwordSnapshot, "primary")');
    expect(enablePrivacy).toContain("commitProfile(profileSnapshot)");

    const enableGuardian = appSource.slice(
      appSource.indexOf("async function enableGuardianSpace"),
      appSource.indexOf("function lockNow"),
    );
    expect(enableGuardian.indexOf("beginAsyncPrivacyTransition")).toBeLessThan(enableGuardian.indexOf("const currentProfileSnapshot = profileRef.current"));
    expect(enableGuardian).toContain("commitProfile(currentProfileSnapshot)");

    const forget = appSource.slice(appSource.indexOf("function deleteMemory"), appSource.indexOf("function deleteAffectCueEvidence"));
    expect(forget).toContain("if (!profileMutationAllowed())");
    expect(forget).toContain("memoryGenerationRef.current = nextMemoryGeneration");
    expect(forget).toContain("commitProfile(forgotten)");

    const send = appSource.slice(appSource.indexOf("async function send"), appSource.indexOf("function announceGame"));
    expect(send).toContain("const capturedPrivacySessionGeneration = privacySessionGuardRef.current.capture()");
    expect(send).toContain("resolveWithProfileGenerations(");
    const guardedCompletion = send.slice(send.indexOf("const resolvedReply = await resolveWithProfileGenerations"));
    expect(guardedCompletion.indexOf('resolvedReply.status === "discarded"')).toBeLessThan(guardedCompletion.indexOf("const carePlans = extractCarePlans"));
    expect(guardedCompletion.indexOf('resolvedReply.status === "discarded"')).toBeLessThan(guardedCompletion.indexOf("updateProfile((current) =>"));

    const lock = appSource.slice(appSource.indexOf("function lockNow"), appSource.indexOf("async function unlockSelectedSpace"));
    const unlockStart = appSource.indexOf("async function unlockSelectedSpace");
    const unlock = appSource.slice(unlockStart, appSource.indexOf("  if (locked) {", unlockStart));
    const transientReset = appSource.slice(appSource.indexOf("function clearTransientConversationState"), appSource.indexOf("function profileMutationAllowed"));
    const mutationGate = appSource.slice(appSource.indexOf("function profileMutationAllowed"), appSource.indexOf("function beginAsyncPrivacyTransition"));
    expect(lock).toContain("privacySessionGuardRef.current.replaceSession()");
    expect(lock).toContain("lockedRef.current = true");
    expect(lock).toContain("clearTransientConversationState()");
    expect(lock).toContain("commitProfile(ensureOpening(defaultProfile(), \"primary\"))");
    expect(unlock).toContain("clearTransientConversationState()");
    expect(unlock).toContain("lockedRef.current = false");
    expect(transientReset).toContain('setInput("")');
    expect(transientReset).toContain("setLastLearned([])");
    expect(transientReset).toContain("setActions([...defaultConversationActions])");
    expect(transientReset).toContain("setShowUrgent(false)");
    expect(transientReset).toContain('setExpression("neutral")');
    expect(transientReset).toContain('setVoiceNotice("")');
    expect(transientReset).toContain("setGameSession(null)");
    expect(mutationGate).toContain("!lockedRef.current");
  });
});
