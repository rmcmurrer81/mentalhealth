export type RecognitionResultLike = {
  0: { transcript: string };
  isFinal: boolean;
};

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function finalRecognitionTranscript(results: ArrayLike<RecognitionResultLike>): string {
  return Array.from(results)
    .filter((result) => result.isFinal)
    .map((result) => String(result[0]?.transcript ?? ""))
    .join(" ")
    .replace(CONTROL_OR_BIDI, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

export function recognitionErrorIsRecoverable(error: string): boolean {
  return error === "no-speech" || error === "aborted";
}

export function handsFreeStatus(input: {
  enabled: boolean;
  listening: boolean;
  speaking: boolean;
}): string {
  if (!input.enabled) return "Hands-free talk is off.";
  if (input.speaking) return "Replying aloud; listening resumes when the reply ends.";
  if (input.listening) return "Listening for your next thought. Tap the mic to stop.";
  return "Hands-free talk is staying on and will resume listening.";
}
