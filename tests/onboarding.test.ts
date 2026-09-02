import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = readFileSync(`${root}src/App.tsx`, "utf8");
const styles = readFileSync(`${root}src/styles.css`, "utf8");
const main = readFileSync(`${root}desktop-shell/desktop/main.cjs`, "utf8");

describe("installed first-run onboarding", () => {
  it("keeps the four meaningful choices inside the app before the main conversation", () => {
    expect(main).toContain("initialRendererTarget.searchParams.set('desktop', '1')");
    expect(app).toContain('WELCOME · STEP {onboardingStep + 1} OF 4');
    expect(app).toContain("What should I call you?");
    expect(app).toContain("Choose a local voice.");
    expect(app).toContain("Soft female");
    expect(app).toContain("Warm male");
    expect(app).toContain("Default / medium");
    expect(app).toContain("Set up hands-free talk?");
    expect(app).toContain("Setup cannot silently grant or bypass Windows permission.");
    expect(styles).toContain(".onboarding-shell");
    expect(styles).toContain(".onboarding-progress");
  });

  it("does not mark onboarding complete until spoken playback or explicit text-only entry", () => {
    const completion = app.slice(app.indexOf("async function completeOnboarding"), app.indexOf("function continueOnboardingWithTextOnly"));
    expect(completion).toContain("onboardingCompleted: false");
    expect(completion).toContain("pendingOnboardingIntroductionRef.current = introduction");
    expect(completion).toContain("queueSpokenReply(introduction.text)");
    expect(app).toContain('if (onboardingIntroSpokeRef.current) void enterMainAfterOnboarding("spoken")');
    expect(completion).toContain("onboardingCompleted: true");
    expect(app).toContain("Continue with text only");
    expect(app).toContain('enterMainAfterOnboarding("text-only")');
    expect(app).toContain("No browser or Windows substitute was used.");
  });

  it("warms voice without microphone capture, then requests hands-free permission truthfully", () => {
    expect(app).toContain("Local voice warm-up in progress");
    expect(app).toContain("No microphone audio is being captured while you wait.");
    expect(app).toContain("requestHandsFreePermission().catch(() => false)");
    expect(app).toContain("Windows may still ask for its own microphone permission.");
    expect(main).toContain("Start hands-free talk?");
    expect(main).toContain("Allow microphone audio for this app session?");
    expect(main).toContain("defaultId: 1");
  });

  it("uses installed memory-only MediaRecorder speech input rather than browser recognition fallback", () => {
    const localCapture = app.slice(app.indexOf("async function startLocalRecognition"), app.indexOf("async function startRecognition"));
    expect(localCapture).toContain("localSpeech.status()");
    expect(localCapture).toContain("navigator.mediaDevices.getUserMedia");
    expect(localCapture).toContain("new MediaRecorder(stream");
    expect(localCapture).toContain("localSpeech.transcribe({ requestId, mimeType, audio })");
    expect(localCapture).toContain("capture.chunks.length = 0");
    expect(localCapture).toContain("stream.getTracks()) track.stop()");
    expect(localCapture).not.toContain("SpeechRecognition");
  });
});
