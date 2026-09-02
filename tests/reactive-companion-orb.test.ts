import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LocalVoicePlaybackEvent } from "../src/lib/local-voice-client";
import {
  companionOrbState,
  companionOrbStatus,
  playbackEnergyAt,
} from "../src/components/ReactiveCompanionOrb";

const root = fileURLToPath(new URL("../", import.meta.url));

const playback: LocalVoicePlaybackEvent = {
  schema: "wellbeing.local-voice.playback-start.v1",
  requestId: "orb-test-1",
  durationMs: 480,
  timingBasis: "generated-waveform-amplitude-plus-text-class-heuristic",
  amplitudeFrames: [
    { startMs: 0, level: 0.12 },
    { startMs: 80, level: 0.74 },
    { startMs: 260, level: 0.36 },
    { startMs: 410, level: 0.02 },
  ],
  visemeCues: [],
};

describe("honest temporary companion orb", () => {
  it("prioritizes speaking, listening, and thinking deterministically", () => {
    expect(companionOrbState({ speaking: false, listening: false, thinking: false })).toBe("idle");
    expect(companionOrbState({ speaking: false, listening: false, thinking: true })).toBe("thinking");
    expect(companionOrbState({ speaking: false, listening: true, thinking: true })).toBe("listening");
    expect(companionOrbState({ speaking: true, listening: true, thinking: true })).toBe("speaking");
    expect(companionOrbStatus("idle")).toBe("Here with you");
    expect(companionOrbStatus("listening")).toContain("device");
    expect(companionOrbStatus("thinking")).toContain("locally");
    expect(companionOrbStatus("speaking")).toContain("private local reply");
  });

  it("uses only bounded sanitized output-playback energy", () => {
    expect(playbackEnergyAt(playback, -1)).toBe(0);
    expect(playbackEnergyAt(playback, 20)).toBe(0.12);
    expect(playbackEnergyAt(playback, 120)).toBe(0.74);
    expect(playbackEnergyAt(playback, 300)).toBe(0.36);
    expect(playbackEnergyAt(playback, 450)).toBe(0.02);
    expect(playbackEnergyAt(playback, 480)).toBe(0);
    expect(playbackEnergyAt({ ...playback, amplitudeFrames: [{ startMs: 0, level: 8 }] }, 10)).toBe(1);
  });

  it("proves stable center, smooth state styling, accessible status, and reduced motion", () => {
    const component = readFileSync(`${root}src/components/ReactiveCompanionOrb.tsx`, "utf8");
    const styles = readFileSync(`${root}src/styles.css`, "utf8");
    expect(component).toContain('role="status" aria-live="polite"');
    expect(component).toContain("smoothedEnergy + (targetEnergy - smoothedEnergy) * 0.16");
    expect(component).toContain('rawAudioAccess = "none"');
    expect(component).toContain('voiceReactiveCore = "sanitized-playback-energy-only"');
    expect(component).toContain('className="orb-voice-aperture"');
    expect(component).toContain('className="orb-voice-scan"');
    expect(component).toContain('"--orb-voice-scan-offset"');
    expect(component).toContain('window.matchMedia?.("(prefers-reduced-motion: reduce)")');
    expect(styles).toMatch(/\.companion-orb-stage\s*\{[^}]*place-items:center/);
    expect(styles).toMatch(/\.reactive-companion-orb\s*\{[^}]*transform:scale\(var\(--orb-audio-scale,1\)\)/);
    expect(styles).toContain(".companion-orb-stage.state-idle");
    expect(styles).toContain(".companion-orb-stage.state-listening");
    expect(styles).toContain(".companion-orb-stage.state-thinking");
    expect(styles).toContain(".companion-orb-stage.state-speaking");
    expect(styles).toMatch(/\.companion-orb-stage\.state-speaking \.orb-voice-aperture[^}]*--orb-audio-energy/);
    expect(styles).toMatch(/\.companion-orb-stage\.state-speaking \.orb-voice-scan[^}]*--orb-audio-energy/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reactive-companion-orb\s*\{\s*transform:scale\(1\) !important/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.orb-voice-ring, \.orb-voice-aperture, \.orb-voice-scan\s*\{\s*transform:none !important/);
    expect(styles).not.toContain("friendly-wave-sway");
  });
});
