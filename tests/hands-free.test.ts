import { describe, expect, it } from "vitest";
import {
  finalRecognitionTranscript,
  handsFreeStatus,
  recognitionErrorIsRecoverable,
} from "../src/lib/hands-free";

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
});
