export type True3DVisualEvidence = {
  renderer: "none" | "css-orb-2d" | "webgl-live-mesh" | "webgl-gltf-rig";
  webglContext: boolean;
  perspectiveCamera: boolean;
  depthTest: boolean;
  runtimeLighting: boolean;
  liveMeshCount: number;
  meshRenderCalls: number;
  stableTransforms: boolean;
  runtimeAnimation: boolean;
  runtimeVisemes: boolean;
  ownerCreatedOrLicensedAsset: boolean;
  prerecordedImage: boolean;
  spriteFrameSwap: boolean;
  expressionImageSwap: boolean;
  cssOnlyFauxDepth: boolean;
};

export type True3DVisualGateResult = {
  status: "PASS" | "FAIL";
  reasons: readonly string[];
};

/**
 * A deliberately strict product gate. A smooth orb can be a valid temporary
 * presence, but it cannot satisfy or be relabeled as the future 3D character.
 */
export function evaluateTrue3DVisualGate(evidence: True3DVisualEvidence): True3DVisualGateResult {
  const reasons: string[] = [];
  if (evidence.renderer !== "webgl-live-mesh" && evidence.renderer !== "webgl-gltf-rig") {
    reasons.push("The mounted visual is not a live WebGL mesh or GLB rig.");
  }
  if (!evidence.webglContext) reasons.push("No live WebGL context was proven.");
  if (!evidence.perspectiveCamera) reasons.push("No perspective camera was proven.");
  if (!evidence.depthTest) reasons.push("Depth testing was not proven.");
  if (!evidence.runtimeLighting) reasons.push("Runtime lighting was not proven.");
  if (!Number.isInteger(evidence.liveMeshCount) || evidence.liveMeshCount < 1) reasons.push("No live 3D mesh was rendered.");
  if (!Number.isInteger(evidence.meshRenderCalls) || evidence.meshRenderCalls < 1) reasons.push("No mesh render call was observed.");
  if (!evidence.stableTransforms) reasons.push("Stable model/camera transforms were not proven.");
  if (!evidence.runtimeAnimation) reasons.push("Runtime animation or blending was not proven.");
  if (!evidence.runtimeVisemes) reasons.push("Runtime morph-target or viseme state was not proven.");
  if (!evidence.ownerCreatedOrLicensedAsset) reasons.push("An owner-created or licensed final 3D asset is still missing.");
  if (evidence.prerecordedImage) reasons.push("Prerecorded/rendered character imagery is forbidden.");
  if (evidence.spriteFrameSwap) reasons.push("Sprite or frame swapping is forbidden.");
  if (evidence.expressionImageSwap) reasons.push("Blink/mouth/expression image toggles are forbidden.");
  if (evidence.cssOnlyFauxDepth) reasons.push("CSS-only faux depth cannot satisfy the 3D gate.");
  return Object.freeze({ status: reasons.length === 0 ? "PASS" : "FAIL", reasons: Object.freeze(reasons) });
}

export const TEMPORARY_ORB_VISUAL_EVIDENCE: Readonly<True3DVisualEvidence> = Object.freeze({
  renderer: "css-orb-2d",
  webglContext: false,
  perspectiveCamera: false,
  depthTest: false,
  runtimeLighting: false,
  liveMeshCount: 0,
  meshRenderCalls: 0,
  stableTransforms: true,
  runtimeAnimation: true,
  runtimeVisemes: false,
  ownerCreatedOrLicensedAsset: false,
  prerecordedImage: false,
  spriteFrameSwap: false,
  expressionImageSwap: false,
  cssOnlyFauxDepth: true,
});
