import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const appSource = readFileSync(`${root}src/App.tsx`, "utf8");

describe("production voice lifecycle wiring", () => {
  it("keeps local speech behind the provider-neutral VoiceOutput adapter", () => {
    expect(appSource).toContain("createLocalVoiceOutput(window.wellbeingDesktop?.localVoice)");
    expect(appSource).toContain("voiceOutputRef.current?.speak");
    expect(appSource).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|createBrowserVoiceOutput/);
    expect(appSource).toContain("The optional local Chatterbox voice is unavailable.");
    expect(appSource).toContain("no silent substitute voice");
    expect(appSource).toContain("This complete reply remains visible as text.");
  });

  it("routes both mute controls through immediate cancellation", () => {
    expect(appSource.match(/setSpokenRepliesEnabled\(/g)?.length).toBeGreaterThanOrEqual(3);
    const handler = appSource.slice(
      appSource.indexOf("function setSpokenRepliesEnabled"),
      appSource.indexOf("function scheduleHandsFreeListening"),
    );
    expect(handler).toContain("cancelSpokenReply(true)");
    expect(handler).not.toContain("handsFreeRef.current = false");
    expect(appSource).toContain("Hands-free listening stays on.");
  });

  it("keeps the listen-reply-speak-resume callback on hands-free replies", () => {
    const completion = appSource.slice(
      appSource.indexOf("function finishSpokenReply"),
      appSource.indexOf("function queueSpokenReply"),
    );
    expect(completion).toContain('source === "hands-free"');
    expect(completion).toContain("voiceProcessingRef.current = false");
    expect(completion).toContain("scheduleHandsFreeListening()");
  });

  it("holds a complete reply during local voice warmup and releases it when ready", () => {
    expect(appSource).toContain("pendingSpokenReplyRef");
    expect(appSource).toContain('localVoiceStateRef.current === "checking"');
    expect(appSource).toContain("This complete reply is visible now and will be spoken when the voice is ready.");
    expect(appSource).toContain("releaseVoiceQueueWhenReady()");
    expect(appSource).toContain("failPendingVoiceQueue()");
    expect(appSource).toContain("attempts >= 100");
    expect(appSource).toContain("bounded 150-second readiness window");
  });

  it("gates the personalized desktop welcome on actual selected-voice playback or explicit text-only choice", () => {
    expect(appSource).toContain("openingSpeechAttemptedRef");
    expect(appSource).toContain("current.turns.length === 1");
    expect(appSource).toContain("desktopFirstRunRef.current");
    expect(appSource).toContain("onboardingIntroPendingRef.current = true");
    expect(appSource).toContain('enterMainAfterOnboarding("spoken")');
    expect(appSource).toContain("continueOnboardingWithTextOnly");
    expect(appSource).toContain("queueSpokenReply(opening.text)");
    expect(appSource).toContain('className="onboarding-introduction-text"');
    const onboardingAvatar = appSource.slice(
      appSource.indexOf('<section className="onboarding-character"'),
      appSource.indexOf('<section className="onboarding-card"'),
    );
    expect(onboardingAvatar).toContain("speaking={speaking}");
    expect(onboardingAvatar).toContain("playbackMotion={speechMotion}");
    expect(onboardingAvatar).not.toContain("speaking={false}");
  });

  it("starts a ready welcome immediately without an artificial renderer delay", () => {
    const queue = appSource.slice(
      appSource.indexOf("function queueSpokenReply"),
      appSource.indexOf("function cancelSpokenReply"),
    );
    expect(queue).toContain("voiceOutputRef.current?.speak({");
    expect(queue).not.toContain("setTimeout");
    expect(appSource).not.toContain("speechStartTimerRef");
  });

  it("keeps every complete turn readable in both full and compact transcripts", () => {
    expect(appSource).toContain("{profile.turns.map((turn, index, visibleTurns) => (");
    expect(appSource).toContain("{profile.turns.map((turn, index) => <article");
    expect(appSource).not.toContain("profile.turns.slice(-8)");
    const styles = readFileSync(`${root}src/styles.css`, "utf8");
    for (const selector of [".turn p", ".compact-turn p"]) {
      const rule = styles.slice(styles.indexOf(selector), styles.indexOf("}", styles.indexOf(selector)) + 1);
      expect(rule).toContain("max-height: none");
      expect(rule).toContain("overflow: visible");
      expect(rule).toContain("white-space: pre-wrap");
    }
  });

  it("clears playback-driven mouth motion immediately on completion and mute", () => {
    const finish = appSource.slice(
      appSource.indexOf("function finishSpokenReply"),
      appSource.indexOf("function queueSpokenReply"),
    );
    const cancel = appSource.slice(
      appSource.indexOf("function cancelSpokenReply"),
      appSource.indexOf("function setSpokenRepliesEnabled"),
    );
    expect(finish).toContain("setSpeechMotion(null)");
    expect(cancel).toContain("setSpeechMotion(null)");
    expect(cancel).toContain("scheduleHandsFreeListening()");
    const queue = appSource.slice(
      appSource.indexOf("function queueSpokenReply"),
      appSource.indexOf("function cancelSpokenReply"),
    );
    expect(queue).toContain("if (!playback)");
    expect(queue).toContain("no mouth motion was fabricated");
  });

  it("pauses recognition for an approved static preview and never routes it through dynamic speech", () => {
    const preview = appSource.slice(
      appSource.indexOf("function previewSelectedVoice"),
      appSource.indexOf("function scheduleHandsFreeListening"),
    );
    expect(preview).toContain("cancelSpokenReply(false)");
    expect(preview).toContain("stopVoicePreview(false)");
    expect(preview).toContain("voiceProcessingRef.current = true");
    expect(preview).toContain("detachRecognitionInstance()");
    expect(preview).toContain("new Audio(selectedVoicePreview.file)");
    expect(preview).not.toContain("voiceOutputRef.current?.speak");
  });

  it("cleans up preview playback and resumes hands-free after mute, end, error, or play rejection", () => {
    const lifecycle = appSource.slice(
      appSource.indexOf("function setSpokenRepliesEnabled"),
      appSource.indexOf("function scheduleHandsFreeListening"),
    );
    expect(lifecycle).toContain("stopVoicePreview(true)");
    expect(lifecycle).toContain("preview.onended = null");
    expect(lifecycle).toContain("preview.onerror = null");
    expect(lifecycle).toContain("preview.pause()");
    expect(lifecycle).toContain('preview.removeAttribute("src")');
    expect(lifecycle).toContain("voiceProcessingRef.current = false");
    expect(lifecycle).toContain("if (resumeHandsFree && handsFreeRef.current) scheduleHandsFreeListening()");
    expect(lifecycle).toContain("preview.onended = () => finish");
    expect(lifecycle).toContain("preview.onerror = () => finish");
    expect(lifecycle).toContain("preview.play().catch(() => finish");
  });
});
