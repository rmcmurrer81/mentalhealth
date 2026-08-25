import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { approvedVoicePreview } from "../src/lib/voice-preview";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("owner-approved static voice previews", () => {
  it("maps only the two explicitly approved starter profiles", () => {
    expect(approvedVoicePreview("soft-feminine")?.productLabel).toBe("Calm female");
    expect(approvedVoicePreview("calm-masculine")?.productLabel).toBe("Warm male");
    expect(approvedVoicePreview("warm-neutral")).toBeNull();
    expect(approvedVoicePreview("soft-feminine")?.selectorId).toBe("calm-female.owner-approved.v1");
    expect(approvedVoicePreview("calm-masculine")?.selectorId).toBe("warm-male.owner-approved.v1");
  });

  it.each(["soft-feminine", "calm-masculine"] as const)("binds %s to its exact reviewed WAV", (profile) => {
    const preview = approvedVoicePreview(profile);
    expect(preview).not.toBeNull();
    const bytes = readFileSync(`${root}public${preview!.file}`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(preview!.sha256);
  });

  it("keeps preview evidence distinct from dynamic synthesis", () => {
    const source = readFileSync(`${root}src/lib/voice-preview.ts`, "utf8");
    expect(source).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|providerId|modelId|voiceId/);
  });
});
