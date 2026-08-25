import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  detachRecognitionHandlersBeforeStop,
  finalRecognitionTranscript,
  handsFreeStatus,
  recognitionCallbackIsCurrent,
  recognitionErrorIsRecoverable,
} from "../src/lib/hands-free";
import { PrivacySessionEpochGuard } from "../src/lib/privacy-session";

const root = fileURLToPath(new URL("../", import.meta.url));
const appSource = readFileSync(`${root}src/App.tsx`, "utf8");

type BufferedRecognition = {
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  stop: () => void;
};

describe("hands-free conversation controls", () => {
  it("submits only final speech and strips control or bidi text", () => {
    const results = [
      { 0: { transcript: "interim words" }, isFinal: false },
      { 0: { transcript: "  I feel\u202e better\u0000 now  " }, isFinal: true },
    ];
    expect(finalRecognitionTranscript(results)).toBe("I feel better now");
  });

  it("retries silence and an intentional recognition stop but not permission failures", () => {
    expect(recognitionErrorIsRecoverable("no-speech")).toBe(true);
    expect(recognitionErrorIsRecoverable("aborted")).toBe(true);
    expect(recognitionErrorIsRecoverable("not-allowed")).toBe(false);
    expect(recognitionErrorIsRecoverable("audio-capture")).toBe(false);
  });

  it("explains the persistent listen-reply-listen lifecycle", () => {
    expect(handsFreeStatus({ enabled: true, listening: true, speaking: false })).toContain("Listening");
    expect(handsFreeStatus({ enabled: true, listening: false, speaking: true })).toContain("resumes");
    expect(handsFreeStatus({ enabled: false, listening: false, speaking: false })).toContain("off");
  });

  it("rejects buffered interim and final recognition callbacks after lock", () => {
    const guard = new PrivacySessionEpochGuard();
    let currentRecognition: object | null = null;
    let handsFree = true;
    let locked = false;
    let input = "";
    const submissions: string[] = [];
    let recognition!: BufferedRecognition;
    const stop = vi.fn(() => {
      expect(recognition.onresult).toBeNull();
      expect(recognition.onend).toBeNull();
      expect(recognition.onerror).toBeNull();
      expect(currentRecognition).toBeNull();
    });
    recognition = { onresult: null, onend: null, onerror: null, stop };
    currentRecognition = recognition;
    const capturedPrivacyEpoch = guard.capture();
    recognition.onresult = (event) => {
      if (!recognitionCallbackIsCurrent({
        recognition,
        currentRecognition,
        capturedPrivacyEpoch,
        currentPrivacyEpoch: guard.capture(),
        handsFree,
        locked,
      })) return;
      input = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      const final = finalRecognitionTranscript(event.results);
      if (final) submissions.push(final);
    };
    const bufferedResult = recognition.onresult;

    locked = true;
    guard.replaceSession();
    handsFree = false;
    detachRecognitionHandlersBeforeStop(recognition, () => { currentRecognition = null; });
    input = ""; // Central lock reset happens after detachment.
    bufferedResult({ results: [
      { 0: { transcript: "private interim" }, isFinal: false },
      { 0: { transcript: "private final" }, isFinal: true },
    ] });

    expect(stop).toHaveBeenCalledOnce();
    expect(input).toBe("");
    expect(submissions).toEqual([]);
  });

  it("rejects an old primary callback after guardian unlock even when hands-free starts again", () => {
    const guard = new PrivacySessionEpochGuard();
    let currentRecognition: object | null = null;
    let handsFree = true;
    let locked = false;
    let guardianInput = "";
    const guardianSubmissions: string[] = [];
    const primaryRecognition: BufferedRecognition = { onresult: null, onend: null, onerror: null, stop: vi.fn() };
    currentRecognition = primaryRecognition;
    const primaryEpoch = guard.capture();
    primaryRecognition.onresult = (event) => {
      if (!recognitionCallbackIsCurrent({
        recognition: primaryRecognition,
        currentRecognition,
        capturedPrivacyEpoch: primaryEpoch,
        currentPrivacyEpoch: guard.capture(),
        handsFree,
        locked,
      })) return;
      guardianInput = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      const final = finalRecognitionTranscript(event.results);
      if (final) guardianSubmissions.push(final);
    };
    const bufferedPrimaryResult = primaryRecognition.onresult;

    locked = true;
    guard.replaceSession();
    handsFree = false;
    detachRecognitionHandlersBeforeStop(primaryRecognition, () => { currentRecognition = null; });
    const guardianUnlock = guard.beginTransition();
    expect(guard.completeTransition(guardianUnlock)).toBe(true);
    const guardianRecognition = {};
    currentRecognition = guardianRecognition;
    locked = false;
    handsFree = true;
    bufferedPrimaryResult({ results: [
      { 0: { transcript: "primary buffered interim" }, isFinal: false },
      { 0: { transcript: "primary buffered final" }, isFinal: true },
    ] });

    expect(guardianInput).toBe("");
    expect(guardianSubmissions).toEqual([]);
    const recognitionSection = appSource.slice(appSource.indexOf("async function startRecognition"), appSource.indexOf("async function toggleListening"));
    expect(recognitionSection.match(/if \(!callbackIsCurrent\(\)\) return;/g)).toHaveLength(3);
    expect(appSource).toContain("locked: lockedRef.current");
    expect(appSource).toContain("detachRecognitionHandlersBeforeStop(recognition");
  });
});
