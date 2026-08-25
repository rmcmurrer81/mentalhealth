import type { CompanionVoiceProfile } from "./local-voice-client";

export type ApprovedVoicePreview = Readonly<{
  profile: CompanionVoiceProfile;
  productLabel: string;
  file: string;
  sha256: string;
  selectorId: string;
}>;

const APPROVED_PREVIEWS: Readonly<Partial<Record<CompanionVoiceProfile, ApprovedVoicePreview>>> = Object.freeze({
  "soft-feminine": Object.freeze({
    profile: "soft-feminine",
    productLabel: "Calm female",
    file: "/voice-previews/calm-female-approved.wav",
    sha256: "c3e3682817476212c990969901028758fbbde1eb4eb8c97153ef878b3939b33a",
    selectorId: "calm-female.owner-approved.v1",
  }),
  "calm-masculine": Object.freeze({
    profile: "calm-masculine",
    productLabel: "Warm male",
    file: "/voice-previews/warm-male-approved.wav",
    sha256: "0a8cdb8178bf56a6aa2442cca496dcf87a76b52e8eb0743488dc5f0e8c8a8a8e",
    selectorId: "warm-male.owner-approved.v1",
  }),
});

export function approvedVoicePreview(profile: CompanionVoiceProfile): ApprovedVoicePreview | null {
  return APPROVED_PREVIEWS[profile] ?? null;
}
