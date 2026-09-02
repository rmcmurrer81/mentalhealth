import { useEffect, useMemo, useRef } from "react";
import type { LocalVoicePlaybackEvent } from "../lib/local-voice-client";

export type CompanionOrbState = "idle" | "listening" | "thinking" | "speaking";

interface ReactiveCompanionOrbProps {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
  playbackMotion?: { event: LocalVoicePlaybackEvent; startedAt: number } | null;
  label?: string;
}

export function companionOrbState(input: Pick<ReactiveCompanionOrbProps, "listening" | "thinking" | "speaking">): CompanionOrbState {
  if (input.speaking) return "speaking";
  if (input.listening) return "listening";
  if (input.thinking) return "thinking";
  return "idle";
}

export function companionOrbStatus(state: CompanionOrbState): string {
  if (state === "speaking") return "Speaking a private local reply";
  if (state === "listening") return "Listening on this device";
  if (state === "thinking") return "Thinking locally";
  return "Here with you";
}

/** Reads only the sanitized output-playback envelope supplied by the local voice bridge. */
export function playbackEnergyAt(event: LocalVoicePlaybackEvent, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= event.durationMs) return 0;
  let level = 0;
  for (const frame of event.amplitudeFrames) {
    if (frame.startMs > elapsedMs) break;
    level = frame.level;
  }
  return Math.max(0, Math.min(1, level));
}

export function ReactiveCompanionOrb({
  listening,
  thinking,
  speaking,
  playbackMotion,
  label = "Temporary animated companion orb",
}: ReactiveCompanionOrbProps) {
  const orbRef = useRef<HTMLDivElement | null>(null);
  const state = companionOrbState({ listening, thinking, speaking });
  const status = useMemo(() => companionOrbStatus(state), [state]);

  useEffect(() => {
    const orb = orbRef.current;
    if (!orb) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    let disposed = false;
    let smoothedEnergy = 0;
    let renderedTicks = 0;
    orb.dataset.renderer = "reactive-css-orb-2d";
    orb.dataset.presentation = "temporary-orb-not-3d-character";
    orb.dataset.visualKind = "temporary-orb-2d";
    orb.dataset.imageSwapPath = "none";
    orb.dataset.spriteFrameSwap = "false";
    orb.dataset.true3dAcceptance = "fail-temporary-orb-no-live-mesh";
    orb.dataset.webglScene = "false";
    orb.dataset.liveMeshCount = "0";
    orb.dataset.meshRenderCalls = "0";
    orb.dataset.rawAudioAccess = "none";
    orb.dataset.speechTiming = "sanitized-playback-amplitude-envelope";
    orb.dataset.motionMode = "smooth-state-transitions-plus-voice-reactive-core";
    orb.dataset.voiceReactiveCore = "sanitized-playback-energy-only";
    orb.dataset.stableCenter = "true";
    orb.dataset.reducedMotion = String(reducedMotion);
    orb.dataset.motionTick = "0";

    const render = (now: number) => {
      if (disposed) return;
      const targetEnergy = speaking && playbackMotion
        ? playbackEnergyAt(playbackMotion.event, now - playbackMotion.startedAt)
        : 0;
      smoothedEnergy = reducedMotion ? 0 : smoothedEnergy + (targetEnergy - smoothedEnergy) * 0.16;
      orb.style.setProperty("--orb-audio-energy", smoothedEnergy.toFixed(4));
      orb.style.setProperty("--orb-audio-scale", (1 + smoothedEnergy * 0.08).toFixed(4));
      orb.style.setProperty("--orb-voice-aperture-scale", (0.92 + smoothedEnergy * 0.36).toFixed(4));
      orb.style.setProperty("--orb-voice-ring-scale-one", (0.84 + smoothedEnergy * 0.24).toFixed(4));
      orb.style.setProperty("--orb-voice-ring-scale-two", (0.72 + smoothedEnergy * 0.42).toFixed(4));
      orb.style.setProperty("--orb-voice-scan-offset", `${(7 - smoothedEnergy * 18).toFixed(2)}px`);
      orb.dataset.audioEnergy = smoothedEnergy.toFixed(4);
      orb.dataset.playbackTimed = String(Boolean(speaking && playbackMotion));
      renderedTicks += 1;
      if (renderedTicks % 15 === 0) orb.dataset.motionTick = String(renderedTicks);
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
    };
  }, [playbackMotion, speaking]);

  return (
    <div
      className={`companion-orb-stage state-${state}`}
      role="img"
      aria-label={`${label}. ${status}.`}
      data-presence-state={state}
    >
      <span className="companion-orb-orbit orbit-one" aria-hidden="true" />
      <span className="companion-orb-orbit orbit-two" aria-hidden="true" />
      <div ref={orbRef} className="reactive-companion-orb" aria-hidden="true">
        <i className="orb-core" />
        <i className="orb-halo" />
        <i className="orb-voice-ring voice-ring-one" />
        <i className="orb-voice-ring voice-ring-two" />
        <i className="orb-voice-aperture" />
        <i className="orb-voice-scan" />
        <i className="orb-ripple ripple-one" />
        <i className="orb-ripple ripple-two" />
        <i className="orb-spark spark-one" />
        <i className="orb-spark spark-two" />
        <i className="orb-spark spark-three" />
      </div>
      <span className="companion-orb-status" role="status" aria-live="polite">{status}</span>
    </div>
  );
}
