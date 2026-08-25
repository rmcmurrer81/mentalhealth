import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_VOICE_RESULT_SCHEMA,
  LOCAL_VOICE_STATUS_SCHEMA,
  approvedVoiceSelector,
  type LocalVoiceClient,
  type LocalVoiceProviderStatus,
  type LocalVoiceSpeakRequest,
  type LocalVoiceSpeakResult,
} from "../src/lib/local-voice-client";
import { defaultProfile, loadProfile, saveProfile } from "../src/lib/memory";
import { chunkSpokenText, createLocalVoiceOutput, spokenReplyText } from "../src/lib/voice";

const root = fileURLToPath(new URL("../", import.meta.url));

function readyStatus(overrides: Partial<LocalVoiceProviderStatus> = {}): LocalVoiceProviderStatus {
  return {
    schema: LOCAL_VOICE_STATUS_SCHEMA,
    providerId: "test.local-voice",
    ready: true,
    localOnly: true,
    supportedProfiles: ["soft-feminine", "warm-neutral", "calm-masculine"],
    ...overrides,
  };
}

function completed(requestId: string): LocalVoiceSpeakResult {
  return { schema: LOCAL_VOICE_RESULT_SCHEMA, requestId, status: "completed" };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("voice presentation helpers", () => {
  it("maps only the two owner-approved product selectors", () => {
    expect(approvedVoiceSelector("soft-feminine")).toBe("calm-female.owner-approved.v1");
    expect(approvedVoiceSelector("calm-masculine")).toBe("warm-male.owner-approved.v1");
    expect(approvedVoiceSelector("warm-neutral")).toBeNull();
  });
  it("keeps conversation but omits emergency-number footers, URLs, and phone digits from audio", () => {
    const displayed = [
      "I'm right here. Call 911 now and keep this open.",
      "Poison Help (U.S.): 1-800-222-1222",
      "More support: https://example.test/help",
    ].join("\n\n");

    const spoken = spokenReplyText(displayed);
    expect(spoken).toContain("I'm right here. Call emergency services now and keep this open.");
    expect(spoken).toContain("the link shown on screen");
    expect(spoken).not.toMatch(/911|1-800|222-1222|https?:|example\.test/);
    expect(displayed).toContain("1-800-222-1222");
  });

  it("turns crisis-service numerals into natural nonnumeric guidance", () => {
    expect(spokenReplyText("You can call or text 988, or dial 112 in immediate danger."))
      .toBe("You can call or use local crisis support, or call emergency services in immediate danger.");
  });

  it("creates bounded sentence-led chunks and drops footer-only audio", () => {
    const text = "First sentence stays calm. Second sentence has enough words to need its own chunk. Third sentence finishes gently.";
    const chunks = chunkSpokenText(text, 52);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 52)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
    expect(chunkSpokenText("Poison Help: 1-800-222-1222")).toEqual([]);
  });
});

describe("provider-neutral local voice output", () => {
  it("is explicitly text-only when no reviewed local provider is connected", async () => {
    const events: string[] = [];
    createLocalVoiceOutput().speak({
      text: "This reply remains visible.",
      profile: "soft-feminine",
      enabled: true,
      onStart: () => events.push("start"),
      onUnavailable: (code) => events.push(`unavailable:${code}`),
      onEnd: () => events.push("end"),
    });
    await vi.waitFor(() => expect(events).toEqual(["unavailable:not-configured", "end"]));
  });

  it("sends bounded chunks through a validated local-only provider with a canonical locale", async () => {
    const requests: LocalVoiceSpeakRequest[] = [];
    const client: LocalVoiceClient = {
      status: async () => readyStatus(),
      speak: async (request) => {
        requests.push(request);
        return completed(request.requestId);
      },
      cancel: () => undefined,
    };
    const events: string[] = [];
    createLocalVoiceOutput(client).speak({
      text: `${"A calm sentence with enough detail to become a useful bounded request. ".repeat(8)}A gentle ending.`,
      profile: "soft-feminine",
      locale: "en_US",
      enabled: true,
      onStart: () => events.push("start"),
      onEnd: () => events.push("end"),
    });

    await vi.waitFor(() => expect(events).toEqual(["start", "end"]));
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((request) => request.text.length <= 220)).toBe(true);
    expect(requests.every((request) => request.locale === "en-US")).toBe(true);
    expect(requests.every((request) => request.profile === "soft-feminine")).toBe(true);
    expect(new Set(requests.map((request) => request.requestId)).size).toBe(requests.length);
  });

  it.each([
    [readyStatus({ localOnly: false }), "not-local-only"],
    [readyStatus({ supportedProfiles: ["warm-neutral"] }), "unsupported-profile"],
    [{ ...readyStatus(), unexpected: true }, "invalid-provider-response"],
    [readyStatus({ unavailableCode: "not-ready" }), "invalid-provider-response"],
  ] as const)("rejects an unavailable or malformed status without sending text", async (status, expectedCode) => {
    let speakCount = 0;
    const client: LocalVoiceClient = {
      status: async () => status as LocalVoiceProviderStatus,
      speak: async (request) => {
        speakCount += 1;
        return completed(request.requestId);
      },
      cancel: () => undefined,
    };
    const events: string[] = [];
    createLocalVoiceOutput(client).speak({
      text: "Keep this visible as text.",
      profile: "soft-feminine",
      enabled: true,
      onUnavailable: (code) => events.push(code),
      onEnd: () => events.push("end"),
    });

    await vi.waitFor(() => expect(events).toEqual([expectedCode, "end"]));
    expect(speakCount).toBe(0);
  });

  it("rejects a mismatched provider result and never routes to another speech engine", async () => {
    const events: string[] = [];
    const client: LocalVoiceClient = {
      status: async () => readyStatus(),
      speak: async (request) => completed(`${request.requestId}-wrong`),
      cancel: () => undefined,
    };
    createLocalVoiceOutput(client).speak({
      text: "Text survives a bad provider response.",
      profile: "calm-masculine",
      enabled: true,
      onStart: () => events.push("start"),
      onUnavailable: (code) => events.push(code),
      onEnd: () => events.push("end"),
    });

    await vi.waitFor(() => expect(events).toEqual(["start", "invalid-provider-response", "end"]));
  });

  it("mute cancels the active local request once, ends immediately, and ignores stale completion", async () => {
    let resolveRequest!: (result: LocalVoiceSpeakResult) => void;
    const requestPromise = new Promise<LocalVoiceSpeakResult>((resolve) => { resolveRequest = resolve; });
    const requests: LocalVoiceSpeakRequest[] = [];
    const cancelled: string[] = [];
    const client: LocalVoiceClient = {
      status: async () => readyStatus(),
      speak: (request) => {
        requests.push(request);
        return requestPromise;
      },
      cancel: (requestId) => { cancelled.push(requestId); },
    };
    const events: string[] = [];
    const output = createLocalVoiceOutput(client);
    output.speak({
      text: "This local reply is currently speaking.",
      profile: "calm-masculine",
      enabled: true,
      onStart: () => events.push("start"),
      onEnd: () => events.push("end"),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    output.cancel();
    expect(cancelled).toEqual([requests[0].requestId]);
    expect(events).toEqual(["start", "end"]);
    resolveRequest(completed(requests[0].requestId));
    await settle();
    expect(events).toEqual(["start", "end"]);
  });

  it("does not contact any provider when replies are muted or only contain a resource footer", async () => {
    let statusCount = 0;
    const client: LocalVoiceClient = {
      status: async () => {
        statusCount += 1;
        return readyStatus();
      },
      speak: async (request) => completed(request.requestId),
      cancel: () => undefined,
    };
    const events: string[] = [];
    const output = createLocalVoiceOutput(client);
    output.speak({ text: "Caption only.", profile: "soft-feminine", enabled: false, onEnd: () => events.push("muted") });
    output.speak({ text: "Poison Help: 1-800-222-1222", profile: "soft-feminine", enabled: true, onEnd: () => events.push("footer") });
    await settle();
    expect(statusCount).toBe(0);
    expect(events).toEqual(["muted", "footer"]);
  });

  it("keeps an unapproved future preset text-only without even querying provider status", async () => {
    let statusCount = 0;
    const client: LocalVoiceClient = {
      status: async () => {
        statusCount += 1;
        return readyStatus();
      },
      speak: async (request) => completed(request.requestId),
      cancel: () => undefined,
    };
    const events: string[] = [];
    createLocalVoiceOutput(client).speak({
      text: "This stays visible.",
      profile: "warm-neutral",
      enabled: true,
      onUnavailable: (code) => events.push(code),
      onEnd: () => events.push("end"),
    });
    await vi.waitFor(() => expect(events).toEqual(["unsupported-profile", "end"]));
    expect(statusCount).toBe(0);
  });

  it("persists the selected preset as profile data without treating it as provider readiness", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    try {
      const profile = { ...defaultProfile(), voice: "calm-masculine" as const };
      saveProfile(profile);
      expect(loadProfile().voice).toBe("calm-masculine");
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("contains no browser, operating-system, fetch, or claimed neural-service fallback", () => {
    const source = [
      readFileSync(`${root}src/lib/voice.ts`, "utf8"),
      readFileSync(`${root}src/lib/local-voice-client.ts`, "utf8"),
    ].join("\n");
    expect(source).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|createBrowserVoiceOutput/);
    expect(source).not.toMatch(/\bfetch\s*\(|https?:\/\//);
    expect(source).not.toMatch(/neural|premium|natural voice|system default/i);
  });
});
