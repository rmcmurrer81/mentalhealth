import {
  LOCAL_VOICE_REQUEST_SCHEMA,
  approvedVoiceSelector,
  createUnavailableLocalVoiceClient,
  localVoiceAvailability,
  validLocalVoicePlaybackEvent,
  validLocalVoiceResult,
  type CompanionVoiceProfile,
  type LocalVoiceClient,
  type LocalVoicePlaybackEvent,
  type LocalVoiceUnavailableCode,
} from "./local-voice-client";

export type { CompanionVoiceProfile } from "./local-voice-client";

export type VoiceOutputRequest = {
  text: string;
  profile: CompanionVoiceProfile;
  enabled: boolean;
  locale?: string;
  onStart?: (event?: LocalVoicePlaybackEvent) => void;
  onPlayback?: (event: LocalVoicePlaybackEvent) => void;
  onEnd?: () => void;
  onUnavailable?: (code: LocalVoiceUnavailableCode) => void;
};

export type VoiceOutput = {
  speak: (request: VoiceOutputRequest) => void;
  /** Cancels immediately and completes the active request exactly once. */
  cancel: () => void;
  /** Cancels without callbacks; intended only for component teardown. */
  dispose: () => void;
};

const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const MARKDOWN_LINK = /\[([^\]]+)]\((?:https?:\/\/|www\.)[^)]+\)/gi;
const PHONE_LIKE = /(?:\+?\d[\d\s().-]{5,}\d|\b(?:911|988|112|999)\b)/i;
const RESOURCE_LABEL = /\b(?:poison help|poison control|crisis|lifeline|hotline|emergency|urgent help|support line)\b/i;

function normalizedLocale(locale: string | undefined): string {
  try {
    return Intl.getCanonicalLocales((locale || "en-US").trim().replaceAll("_", "-"))[0] || "en-US";
  } catch {
    return "en-US";
  }
}

function isShortResourceFooter(line: string): boolean {
  if (line.length > 180 || !PHONE_LIKE.test(line)) return false;
  return RESOURCE_LABEL.test(line) || /^\s*(?:call|text|dial)\b/i.test(line) || /^[^.!?]{1,48}:\s*/.test(line);
}

function withInitialCase(source: string, replacement: string): string {
  return /^[A-Z]/.test(source) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

/**
 * Produces the conversational portion of a displayed reply for text-to-speech.
 * The displayed text is never mutated. Resource footers remain visible, while
 * phone numbers and URLs are omitted from audio so a screen reader or caller can
 * read the exact local resource deliberately.
 */
export function spokenReplyText(text: string): string {
  const withoutControl = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  const conversationalLines = withoutControl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isShortResourceFooter(line));

  return conversationalLines
    .join(" ")
    .replace(MARKDOWN_LINK, "$1")
    .replace(URL, "the link shown on screen")
    .replace(/\b(?:call|dial)\s+(?:911|112|999)\b/gi, (match) => withInitialCase(match, "call emergency services"))
    .replace(/\b(?:call|text)\s+988\b/gi, (match) => withInitialCase(match, "use local crisis support"))
    .replace(/\b(?:911|112|999)\b/g, "emergency services")
    .replace(/\b988\b/g, "local crisis support")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+?/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitLongSegment(segment: string, maximum: number): string[] {
  const pieces: string[] = [];
  let remaining = segment.trim();
  while (remaining.length > maximum) {
    const window = remaining.slice(0, maximum + 1);
    const preferred = Math.max(window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(": "));
    const whitespace = window.lastIndexOf(" ");
    const boundary = preferred >= Math.floor(maximum * 0.55) ? preferred + 1 : whitespace > 0 ? whitespace : maximum;
    pieces.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

/** Splits speech into bounded sentence-led chunks to avoid long-utterance stalls. */
export function chunkSpokenText(text: string, maxLength = 220): string[] {
  const safeText = spokenReplyText(text);
  if (!safeText) return [];
  const maximum = Math.max(40, Math.floor(maxLength));
  const sentences = safeText.split(/(?<=[.!?])\s+/u).flatMap((sentence) => splitLongSegment(sentence, maximum));
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (!sentence) continue;
    const combined = current ? `${current} ${sentence}` : sentence;
    if (combined.length <= maximum) {
      current = combined;
      continue;
    }
    if (current) chunks.push(current);
    current = sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

type ActiveSpeech = {
  token: number;
  chunks: string[];
  currentRequestId: string | null;
  started: boolean;
  finished: boolean;
  request: VoiceOutputRequest;
  locale: string;
  expectsPlaybackEvent: boolean;
};

/**
 * Creates the sole voice-output path. A provider must explicitly attest that it
 * is ready, local-only, and supports the selected preset. There is deliberately
 * no browser or operating-system speech fallback.
 */
export function createLocalVoiceOutput(client: LocalVoiceClient = createUnavailableLocalVoiceClient()): VoiceOutput {
  let nextToken = 0;
  let active: ActiveSpeech | null = null;
  const unsubscribePlayback = client.onPlaybackStart?.((value) => {
    if (!validLocalVoicePlaybackEvent(value)) return;
    const session = active;
    if (!session || session.finished || session.currentRequestId !== value.requestId) return;
    session.request.onPlayback?.(value);
    if (!session.started) {
      session.started = true;
      session.request.onStart?.(value);
    }
  });

  function complete(session: ActiveSpeech, unavailable?: LocalVoiceUnavailableCode) {
    if (session.finished) return;
    session.finished = true;
    if (active?.token === session.token) active = null;
    if (unavailable) session.request.onUnavailable?.(unavailable);
    session.request.onEnd?.();
  }

  function invalidate(notify: boolean) {
    const session = active;
    active = null;
    nextToken += 1;
    if (session) {
      if (session.currentRequestId) {
        try {
          void Promise.resolve(client.cancel(session.currentRequestId)).catch(() => undefined);
        } catch {
          // Cancellation is best effort; stale provider results remain ignored.
        }
      }
      if (notify) complete(session);
    }
  }

  async function run(session: ActiveSpeech) {
    try {
      if (!approvedVoiceSelector(session.request.profile)) {
        complete(session, "unsupported-profile");
        return;
      }
      const availability = localVoiceAvailability(await client.status(), session.request.profile);
      if (active?.token !== session.token || session.finished) return;
      if (!availability.available) {
        complete(session, availability.code);
        return;
      }

      for (let index = 0; index < session.chunks.length; index += 1) {
        if (active?.token !== session.token || session.finished) return;
        const requestId = `voice-${session.token}-${index + 1}`;
        session.currentRequestId = requestId;
        if (!session.started && !session.expectsPlaybackEvent) {
          session.started = true;
          session.request.onStart?.();
        }
        const result = await client.speak({
          schema: LOCAL_VOICE_REQUEST_SCHEMA,
          requestId,
          text: session.chunks[index],
          profile: session.request.profile,
          locale: session.locale,
        });
        if (active?.token !== session.token || session.finished) return;
        if (!validLocalVoiceResult(result, requestId)) {
          complete(session, "invalid-provider-response");
          return;
        }
        if (result.status !== "completed") {
          complete(session, result.status === "unavailable" ? "not-ready" : "provider-error");
          return;
        }
      }
      complete(session);
    } catch {
      if (active?.token === session.token && !session.finished) complete(session, "provider-error");
    }
  }

  return {
    speak(request) {
      invalidate(true);
      const chunks = request.enabled ? chunkSpokenText(request.text) : [];
      if (!chunks.length) {
        request.onEnd?.();
        return;
      }

      const session: ActiveSpeech = {
        token: ++nextToken,
        chunks,
        currentRequestId: null,
        started: false,
        finished: false,
        request,
        locale: normalizedLocale(request.locale),
        expectsPlaybackEvent: typeof client.onPlaybackStart === "function",
      };
      active = session;
      void run(session);
    },
    cancel() {
      invalidate(true);
    },
    dispose() {
      invalidate(false);
      unsubscribePlayback?.();
    },
  };
}
