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
    expect(appSource).toContain("The selected local voice is not connected yet.");
    expect(appSource).toContain("no system-voice fallback");
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
