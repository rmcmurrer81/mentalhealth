import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TEMPORARY_ORB_VISUAL_EVIDENCE,
  evaluateTrue3DVisualGate,
  type True3DVisualEvidence,
} from "../src/lib/true-3d-visual-gate";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("owner true-3D visual acceptance gate", () => {
  it("remains explicitly failed for the honest temporary orb", () => {
    const result = evaluateTrue3DVisualGate(TEMPORARY_ORB_VISUAL_EVIDENCE);
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("The mounted visual is not a live WebGL mesh or GLB rig.");
    expect(result.reasons).toContain("An owner-created or licensed final 3D asset is still missing.");
  });

  it.each([
    ["prerecorded image", { prerecordedImage: true }],
    ["sprite frame swapping", { spriteFrameSwap: true }],
    ["expression image toggles", { expressionImageSwap: true }],
    ["CSS faux depth", { cssOnlyFauxDepth: true }],
  ])("rejects %s even when other 3D claims are present", (_label, override) => {
    const otherwisePassing: True3DVisualEvidence = {
      renderer: "webgl-gltf-rig",
      webglContext: true,
      perspectiveCamera: true,
      depthTest: true,
      runtimeLighting: true,
      liveMeshCount: 1,
      meshRenderCalls: 1,
      stableTransforms: true,
      runtimeAnimation: true,
      runtimeVisemes: true,
      ownerCreatedOrLicensedAsset: true,
      prerecordedImage: false,
      spriteFrameSwap: false,
      expressionImageSwap: false,
      cssOnlyFauxDepth: false,
      ...override,
    };
    expect(evaluateTrue3DVisualGate(otherwisePassing).status).toBe("FAIL");
  });

  it("requires runtime mesh evidence rather than labels alone", () => {
    const claimed: True3DVisualEvidence = {
      ...TEMPORARY_ORB_VISUAL_EVIDENCE,
      renderer: "webgl-gltf-rig",
      ownerCreatedOrLicensedAsset: true,
      cssOnlyFauxDepth: false,
    };
    const result = evaluateTrue3DVisualGate(claimed);
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "No live WebGL context was proven.",
      "No live 3D mesh was rendered.",
      "No mesh render call was observed.",
      "Runtime morph-target or viseme state was not proven.",
    ]));
  });

  it("keeps the old sprite renderer out of the active app and production allowlist", () => {
    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    const orb = readFileSync(`${root}src/components/ReactiveCompanionOrb.tsx`, "utf8");
    const assets = readFileSync(`${root}pwa-build.ts`, "utf8");
    expect(app).toContain("ReactiveCompanionOrb");
    expect(app).not.toContain("AnimatedMascot");
    expect(app).not.toContain("companion-warm-plum-speech-sprite");
    expect(orb).not.toContain("new Image");
    expect(orb).not.toContain("drawImage");
    expect(orb).not.toContain("<canvas");
    expect(orb).toContain('presentation = "temporary-orb-not-3d-character"');
    expect(orb).toContain('imageSwapPath = "none"');
    expect(orb).toContain('spriteFrameSwap = "false"');
    expect(assets).not.toContain("companion-warm-plum-speech-sprite");
    expect(existsSync(`${root}src/components/AnimatedMascot.tsx`)).toBe(false);
  });
});
