import type { CompanionExpression } from "./types";

export type CompanionIdentity = "warm-plum" | "light-blue";
export type CompanionViseme = "rest" | "jaw-open" | "wide" | "rounded" | "lip-contact";
export type VisemeTimingLanguage = "en" | "es" | "fr";
export type CompanionGeometryKind = "sphere" | "leaf" | "heart";
export type CompanionSurfaceKind = "fabric" | "skin" | "glass" | "glow" | "metal";

export interface CompanionVisemeCue {
  startMs: number;
  endMs: number;
  viseme: CompanionViseme;
  language: VisemeTimingLanguage;
}

const COMPANION_VISEMES: readonly CompanionViseme[] = ["rest", "jaw-open", "wide", "rounded", "lip-contact"];
const VISEME_TIMING_LANGUAGES: readonly VisemeTimingLanguage[] = ["en", "es", "fr"];
const MAX_VISEME_TIMELINE_MS = 15 * 60 * 1000;

/**
 * Validates a reviewed, provider-supplied mouth-cue timeline before it can
 * drive the 3D rig. Cues must be ordered, non-overlapping, bounded, and use one
 * declared language. This is a timing hook, not an audio-alignment claim.
 */
export function validateCompanionVisemeCues(value: unknown): readonly CompanionVisemeCue[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20_000) return null;
  const cues: CompanionVisemeCue[] = [];
  let priorEnd = 0;
  let language: VisemeTimingLanguage | null = null;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const cue = candidate as Partial<CompanionVisemeCue>;
    if (Object.keys(candidate).sort().join(",") !== "endMs,language,startMs,viseme") return null;
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs)) return null;
    if (cue.startMs! < priorEnd || cue.endMs! <= cue.startMs! || cue.endMs! > MAX_VISEME_TIMELINE_MS) return null;
    if (!COMPANION_VISEMES.includes(cue.viseme as CompanionViseme)) return null;
    if (!VISEME_TIMING_LANGUAGES.includes(cue.language as VisemeTimingLanguage)) return null;
    if (language !== null && cue.language !== language) return null;
    language = cue.language as VisemeTimingLanguage;
    const accepted = Object.freeze({
      startMs: cue.startMs!,
      endMs: cue.endMs!,
      viseme: cue.viseme as CompanionViseme,
      language,
    });
    cues.push(accepted);
    priorEnd = cue.endMs!;
  }
  return Object.freeze(cues);
}

/** Resolves one validated cue timeline to the mouth shape at an elapsed time. */
export function companionVisemeAtElapsedMs(
  elapsedMs: number,
  cues: readonly CompanionVisemeCue[],
): CompanionViseme {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "rest";
  const active = cues.find((cue) => elapsedMs >= cue.startMs && elapsedMs < cue.endMs);
  return active?.viseme ?? "rest";
}

export interface Vec3 { x: number; y: number; z: number; }
export interface MeshGeometry { positions: Float32Array; normals: Float32Array; indices: Uint16Array; }

export interface CompanionPoseInput {
  timeSeconds: number;
  identity: CompanionIdentity;
  expression: CompanionExpression;
  waving: boolean;
  listening: boolean;
  speaking: boolean;
  guiding: boolean;
  reducedMotion: boolean;
  viseme?: CompanionViseme;
}

export interface CompanionPartPose {
  id: string;
  /** Local to parentId when present; otherwise world/root space. */
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: readonly [number, number, number, number];
  emissive: number;
  geometry: CompanionGeometryKind;
  surface: CompanionSurfaceKind;
  parentId?: string;
  visible: boolean;
}

export const COMPANION_3D_RENDERER = Object.freeze({
  renderer: "procedural-webgl-3d",
  fieldOfViewRadians: Math.PI / 4.1,
  nearPlane: 0.1,
  farPlane: 100,
  cameraDistance: 4.98,
  depthTest: true,
  lighting: "three-point-rim-emissive",
  textureSource: null,
});

/** Stable presentation contract used by visual-regression tests and the desktop layout. */
export const COMPANION_VISUAL_PROFILE = Object.freeze({
  silhouette: "tall-slim-lantern-friend",
  minimumDesktopStageWidthPx: 448,
  minimumDesktopStageHeightPx: 490,
  bodyHeightToWidth: 1.82,
  cameraDistance: 4.98,
  palette: "electric-blue-violet-coral-gold",
});

const COLORS = {
  plum: [0.43, 0.045, 0.48, 1] as const,
  plumLight: [0.84, 0.17, 0.70, 1] as const,
  blue: [0.035, 0.35, 0.79, 1] as const,
  blueLight: [0.10, 0.78, 1.0, 1] as const,
  face: [1.0, 0.86, 0.72, 1] as const,
  hand: [1.0, 0.81, 0.66, 1] as const,
  wingPlum: [0.70, 0.12, 0.62, 1] as const,
  wingBlue: [0.055, 0.59, 0.89, 1] as const,
  eye: [0.065, 0.025, 0.065, 1] as const,
  iris: [0.90, 0.37, 0.04, 1] as const,
  highlight: [1, 0.96, 0.88, 1] as const,
  mouth: [0.62, 0.055, 0.18, 1] as const,
  scarf: [1.0, 0.23, 0.31, 1] as const,
  leaf: [0.03, 0.77, 0.69, 1] as const,
  lanternFrame: [1.0, 0.29, 0.10, 1] as const,
  lanternGlow: [1, 0.76, 0.12, 1] as const,
  gold: [1, 0.68, 0.12, 1] as const,
};

function v(x: number, y: number, z: number): Vec3 { return { x, y, z }; }

/** Deterministic indexed UV sphere shared by every independently transformed part. */
export function createCompanionSphere(latitudeSegments = 14, longitudeSegments = 20): MeshGeometry {
  if (latitudeSegments < 3 || longitudeSegments < 3) throw new Error("A 3D sphere needs at least three segments per axis.");
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const theta = latitude * Math.PI / latitudeSegments;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const phi = longitude * Math.PI * 2 / longitudeSegments;
      const x = Math.cos(phi) * sinTheta;
      const y = cosTheta;
      const z = Math.sin(phi) * sinTheta;
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  const row = longitudeSegments + 1;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const first = latitude * row + longitude;
      const second = first + row;
      indices.push(first, first + 1, second, second, first + 1, second + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function createExtrudedOutline(outline: readonly { x: number; y: number }[], halfThickness: number): MeshGeometry {
  if (outline.length < 3 || halfThickness <= 0) throw new Error("An extruded companion shape needs an outline and positive depth.");
  const signedArea = outline.reduce((total, point, index) => {
    const next = outline[(index + 1) % outline.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  const points = signedArea < 0 ? [...outline].reverse() : [...outline];
  const positions: number[] = [0, 0, halfThickness];
  const normals: number[] = [0, 0, 1];
  const indices: number[] = [];
  for (const point of points) {
    positions.push(point.x, point.y, halfThickness);
    normals.push(0, 0, 1);
  }
  const backCenter = positions.length / 3;
  positions.push(0, 0, -halfThickness);
  normals.push(0, 0, -1);
  const backStart = positions.length / 3;
  for (const point of points) {
    positions.push(point.x, point.y, -halfThickness);
    normals.push(0, 0, -1);
  }
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    indices.push(0, 1 + index, 1 + next);
    indices.push(backCenter, backStart + next, backStart + index);
    const point = points[index];
    const following = points[next];
    const edgeX = following.x - point.x;
    const edgeY = following.y - point.y;
    const edgeLength = Math.hypot(edgeX, edgeY) || 1;
    const normalX = edgeY / edgeLength;
    const normalY = -edgeX / edgeLength;
    const sideStart = positions.length / 3;
    positions.push(
      point.x, point.y, halfThickness,
      following.x, following.y, halfThickness,
      following.x, following.y, -halfThickness,
      point.x, point.y, -halfThickness,
    );
    for (let vertex = 0; vertex < 4; vertex += 1) normals.push(normalX, normalY, 0);
    indices.push(sideStart, sideStart + 1, sideStart + 2, sideStart, sideStart + 2, sideStart + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Pointed leaf mesh used for the ear-wings and teal scarf charm. */
export function createCompanionLeaf(segments = 32): MeshGeometry {
  if (segments < 8) throw new Error("A companion leaf needs at least eight outline segments.");
  const outline = Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    const vertical = Math.sin(angle);
    return {
      x: Math.cos(angle),
      y: vertical * (0.38 + Math.abs(vertical) * 0.18),
    };
  });
  return createExtrudedOutline(outline, 0.12);
}

/** Actual heart mesh; the lantern is no longer assembled from overlapping blobs. */
export function createCompanionHeart(segments = 40): MeshGeometry {
  if (segments < 12) throw new Error("A companion heart needs at least twelve outline segments.");
  const outline = Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    return {
      x: Math.pow(Math.sin(angle), 3),
      y: (13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) / 17,
    };
  });
  return createExtrudedOutline(outline, 0.16);
}

function geometryForPart(id: string): CompanionGeometryKind {
  if (id.startsWith("wing-") && !id.includes("vein")) return "leaf";
  if (id === "leaf-charm") return "leaf";
  if (id === "lantern-bezel" || id === "lantern-heart") return "heart";
  return "sphere";
}

function surfaceForPart(id: string): CompanionSurfaceKind {
  if (id.startsWith("eye-") || id.startsWith("iris-") || id.startsWith("eye-highlight")) return "glass";
  if (id.includes("glow") || id.includes("spark") || id === "lantern-heart") return "glow";
  if (id.startsWith("wing-vein") || id === "leaf-charm" || id === "lantern-bezel") return "metal";
  if (id === "head" || id.startsWith("hand-") || id.startsWith("finger-") || id.startsWith("thumb-")) return "skin";
  return "fabric";
}

function part(
  id: string,
  position: Vec3,
  scale: Vec3,
  color: readonly [number, number, number, number],
  rotation = v(0, 0, 0),
  emissive = 0,
  parentId?: string,
  visible = true,
): CompanionPartPose {
  return { id, position, rotation, scale, color, emissive, geometry: geometryForPart(id), surface: surfaceForPart(id), parentId, visible };
}

/** Bounded visual preview only; it is not audio-derived timing. */
export function speakingVisemeAt(timeSeconds: number): CompanionViseme {
  const cycle: readonly CompanionViseme[] = ["jaw-open", "wide", "lip-contact", "rounded", "jaw-open", "rest"];
  return cycle[Math.floor(Math.max(0, timeSeconds) / 0.11) % cycle.length];
}

/** Facial parts are local children of head so nods and leans cannot make them slide. */
export function buildCompanionPose(input: CompanionPoseInput): CompanionPartPose[] {
  const t = input.reducedMotion ? 0 : input.timeSeconds;
  const bodyColor = input.identity === "light-blue" ? COLORS.blue : COLORS.plum;
  const accentColor = input.identity === "light-blue" ? COLORS.blueLight : COLORS.plumLight;
  const wingColor = input.identity === "light-blue" ? COLORS.wingBlue : COLORS.wingPlum;
  const breath = input.guiding
    ? (input.reducedMotion ? 0.025 : Math.sin(t * Math.PI / 3) * 0.055)
    : (input.reducedMotion ? 0 : Math.sin(t * 1.45) * 0.018);
  const hover = input.reducedMotion ? 0 : Math.sin(t * 1.2) * 0.025;
  const listenTilt = input.listening ? (input.reducedMotion ? 0.07 : 0.07 + Math.sin(t * 1.8) * 0.025) : 0;
  const wingFlutter = input.reducedMotion ? 0 : Math.sin(t * (input.listening ? 3.1 : 1.7)) * (input.listening ? 0.075 : 0.028);
  const wave = input.waving ? (input.reducedMotion ? 0.72 : 0.72 + Math.sin(t * 5.8) * 0.23) : 0;
  const happy = input.expression === "happy";
  const concerned = input.expression === "concerned";
  const viseme: CompanionViseme = input.viseme ?? (input.speaking ? (input.reducedMotion ? "jaw-open" : speakingVisemeAt(input.timeSeconds)) : "rest");
  const joyHop = happy ? (input.reducedMotion ? 0.012 : Math.pow(Math.max(0, Math.sin(t * 1.35)), 4) * 0.14) : 0;
  const nod = input.listening ? (input.reducedMotion ? 0.035 : Math.sin(t * 2.35) * 0.075) : 0;
  const headPosition = v(0, 0.92 + hover + (input.speaking && !input.reducedMotion ? Math.sin(t * 9.1) * 0.012 : 0), 0.03);
  const headScale = v(0.72, 0.66, 0.62);
  const bodyY = -0.38 + hover;
  const rightArmRotation = input.waving ? -0.75 - wave * 0.32 : -0.28;
  const rightArmX = input.waving ? 0.84 : 0.69;
  const rightArmY = input.waving ? 0.17 : -0.35;
  const rightHandX = input.waving ? 1.02 : 0.80;
  const rightHandY = input.waving ? 0.78 : -0.72;
  const eyeYScale = concerned ? 0.88 : happy ? 0.94 : 1;
  const mouthShape = viseme === "jaw-open"
    ? { width: 0.14, height: 0.115, upperY: 0.055, lowerY: -0.070, roundness: 0 }
    : viseme === "wide"
      ? { width: 0.235, height: 0.052, upperY: 0.037, lowerY: -0.040, roundness: 0 }
      : viseme === "rounded"
        ? { width: 0.085, height: 0.105, upperY: 0.060, lowerY: -0.060, roundness: Math.PI / 2 }
        : viseme === "lip-contact"
          ? { width: 0.155, height: 0.010, upperY: 0.011, lowerY: -0.011, roundness: 0 }
          : { width: 0.14, height: 0.016, upperY: 0.020, lowerY: -0.020, roundness: 0 };
  const lanternPulse = input.reducedMotion ? 1 : 1 + Math.sin(t * (input.guiding ? Math.PI / 3 : 2.1)) * (input.guiding ? 0.12 : 0.035);
  const leftHandScale = v(0.20, 0.23, 0.14);
  const rightHandScale = v(0.20, 0.23, 0.14);

  const headChild = (
    id: string,
    offsetFromHead: Vec3,
    worldScale: Vec3,
    color: readonly [number, number, number, number],
    rotation = v(0, 0, 0),
    emissive = 0,
    visible = true,
  ) => part(
    id,
    v(offsetFromHead.x / headScale.x, offsetFromHead.y / headScale.y, offsetFromHead.z / headScale.z),
    v(worldScale.x / headScale.x, worldScale.y / headScale.y, worldScale.z / headScale.z),
    color,
    rotation,
    emissive,
    "head",
    visible,
  );

  const handChild = (
    side: "left" | "right",
    id: string,
    offsetFromHand: Vec3,
    worldScale: Vec3,
    rotation = v(0, 0, 0),
    visible = true,
  ) => {
    const handScale = side === "left" ? leftHandScale : rightHandScale;
    return part(
      id,
      v(offsetFromHand.x / handScale.x, offsetFromHand.y / handScale.y, offsetFromHand.z / handScale.z),
      v(worldScale.x / handScale.x, worldScale.y / handScale.y, worldScale.z / handScale.z),
      COLORS.hand,
      rotation,
      0,
      `hand-${side}`,
      visible,
    );
  };

  const showExpressionCurve = viseme === "rest";
  const curveDirection = happy ? 1 : concerned ? -1 : 0.16;
  const mouthCenterY = -0.23 + (concerned ? 0.025 : 0);
  const leftCurveY = mouthCenterY + curveDirection * 0.050;
  const rightCurveY = mouthCenterY + curveDirection * 0.062;
  const centerCurveY = mouthCenterY - curveDirection * 0.022;
  const leftCurveRotation = -curveDirection * 0.42;
  const rightCurveRotation = curveDirection * 0.34;

  const parts: CompanionPartPose[] = [
    part("wing-left", v(-0.98, 0.86 + hover, -0.24), v(0.72, 0.55, 0.14), wingColor, v(0.02, -0.22, 0.13 + wingFlutter)),
    part("wing-right", v(0.98, 0.86 + hover, -0.24), v(0.72, 0.55, 0.14), wingColor, v(-0.02, 0.22, -0.13 - wingFlutter)),
    part("wing-vein-left", v(-1.00, 0.86 + hover, -0.095), v(0.50, 0.025, 0.020), COLORS.gold, v(0, 0, 0.13 + wingFlutter), 0.28),
    part("wing-vein-left-a", v(-1.10, 1.02 + hover, -0.09), v(0.25, 0.018, 0.018), COLORS.gold, v(0, 0, 0.62 + wingFlutter), 0.24),
    part("wing-vein-left-b", v(-1.14, 0.72 + hover, -0.09), v(0.23, 0.018, 0.018), COLORS.gold, v(0, 0, -0.40 + wingFlutter), 0.24),
    part("wing-vein-right", v(1.00, 0.86 + hover, -0.095), v(0.50, 0.025, 0.020), COLORS.gold, v(0, 0, -0.13 - wingFlutter), 0.28),
    part("wing-vein-right-a", v(1.10, 1.02 + hover, -0.09), v(0.25, 0.018, 0.018), COLORS.gold, v(0, 0, -0.62 - wingFlutter), 0.24),
    part("wing-vein-right-b", v(1.14, 0.72 + hover, -0.09), v(0.23, 0.018, 0.018), COLORS.gold, v(0, 0, 0.40 - wingFlutter), 0.24),
    part("body", v(0, bodyY, 0), v(0.67 + breath * 0.20, 1.22 + breath, 0.56 + breath * 0.14), bodyColor),
    part("belly-inlay-left", v(-0.31, -0.38 + hover, 0.54), v(0.085, 0.41, 0.046), COLORS.lanternFrame, v(0, 0, -0.16)),
    part("belly-inlay-right", v(0.31, -0.38 + hover, 0.54), v(0.085, 0.41, 0.046), COLORS.lanternFrame, v(0, 0, 0.16)),
    part("lantern-bezel", v(0, -0.31 + hover, 0.59), v(0.40 * lanternPulse, 0.51 * lanternPulse, 0.095), COLORS.lanternFrame, v(0, 0, 0), 0.30),
    part("lantern-heart", v(0, -0.29 + hover, 0.70), v(0.31 * lanternPulse, 0.40 * lanternPulse, 0.068), COLORS.lanternGlow, v(0, 0, 0), 1.0),
    part("lantern-glow-left", v(-0.12, -0.20 + hover, 0.72), v(0.07 * lanternPulse, 0.11 * lanternPulse, 0.034), COLORS.highlight, v(0, 0, -0.28), 0.9),
    part("lantern-glow-right", v(0.12, -0.20 + hover, 0.72), v(0.07 * lanternPulse, 0.11 * lanternPulse, 0.034), COLORS.highlight, v(0, 0, 0.28), 0.9),
    part("lantern-glow-lower", v(0, -0.48 + hover, 0.72), v(0.08 * lanternPulse, 0.13 * lanternPulse, 0.034), COLORS.highlight, v(0, 0, Math.PI / 4), 0.9),
    part("lantern-spark-left", v(-0.39, 0.08 + hover, 0.57), v(0.032, 0.032, 0.026), COLORS.gold, v(0, 0, 0), 0.8),
    part("lantern-spark-right", v(0.39, -0.76 + hover, 0.57), v(0.026, 0.026, 0.022), COLORS.gold, v(0, 0, 0), 0.8),
    part("scarf", v(0, 0.25 + hover, 0.02), v(0.66, 0.14, 0.58), COLORS.scarf),
    part("head", headPosition, headScale, COLORS.face, v(nod, concerned ? 0.035 : 0, listenTilt)),
    headChild("cap", v(0, 0.57, -0.05), v(0.69, 0.29, 0.58), bodyColor),
    headChild("cap-brim", v(0, 0.42, 0.02), v(0.71, 0.075, 0.60), accentColor),
    headChild("cap-loop-left", v(-0.065, 0.93, -0.04), v(0.055, 0.19, 0.065), bodyColor, v(0, 0, -0.40)),
    headChild("cap-loop-right", v(0.065, 0.93, -0.04), v(0.055, 0.19, 0.065), bodyColor, v(0, 0, 0.40)),
    headChild("cap-loop", v(0, 0.99, -0.04), v(0.105, 0.055, 0.075), accentColor),
    headChild("forehead-glow-left", v(-0.22, 0.37, 0.62), v(0.045, 0.055, 0.024), COLORS.lanternGlow, v(0, 0, 0), 0.95),
    headChild("forehead-glow-mid-left", v(-0.08, 0.43, 0.64), v(0.04, 0.05, 0.024), COLORS.lanternGlow, v(0, 0, 0), 0.95),
    headChild("forehead-glow-mid-right", v(0.08, 0.43, 0.64), v(0.04, 0.05, 0.024), COLORS.lanternGlow, v(0, 0, 0), 0.95),
    headChild("forehead-glow-right", v(0.22, 0.37, 0.62), v(0.045, 0.055, 0.024), COLORS.lanternGlow, v(0, 0, 0), 0.95),
    headChild("freckle-left-a", v(-0.42, -0.11, 0.61), v(0.025, 0.02, 0.018), COLORS.lanternFrame, v(0, 0, 0), 0.15),
    headChild("freckle-left-b", v(-0.35, -0.16, 0.625), v(0.018, 0.018, 0.018), COLORS.lanternFrame, v(0, 0, 0), 0.15),
    headChild("freckle-right-a", v(0.42, -0.11, 0.61), v(0.025, 0.02, 0.018), COLORS.lanternFrame, v(0, 0, 0), 0.15),
    headChild("freckle-right-b", v(0.35, -0.16, 0.625), v(0.018, 0.018, 0.018), COLORS.lanternFrame, v(0, 0, 0), 0.15),
    part("leaf-charm", v(0.22, 0.17 + hover, 0.66), v(0.14, 0.21, 0.055), COLORS.leaf, v(0, 0, -0.54), 0.22),
    part("arm-left", v(-0.69, -0.31 + hover, 0.03), v(0.18, 0.58, 0.20), bodyColor, v(0, 0, 0.25)),
    part("hand-left", v(-0.79, -0.70 + hover, 0.35), leftHandScale, COLORS.hand, v(0, 0, 0.15)),
    handChild("left", "finger-left-index", v(-0.055, 0.15, 0.035), v(0.040, 0.10, 0.038), v(0, 0, -0.12)),
    handChild("left", "finger-left-middle", v(0.0, 0.17, 0.04), v(0.042, 0.115, 0.039)),
    handChild("left", "finger-left-ring", v(0.058, 0.14, 0.035), v(0.038, 0.095, 0.036), v(0, 0, 0.14)),
    part("arm-right", v(rightArmX, rightArmY + hover, 0.03), v(0.18, 0.58, 0.20), bodyColor, v(0, 0, rightArmRotation)),
    part("hand-right", v(rightHandX, rightHandY + hover, 0.35), rightHandScale, COLORS.hand, v(0, 0, input.waving ? wave : -0.18)),
    handChild("right", "finger-right-index", v(-0.105, 0.20, 0.025), v(0.040, 0.14, 0.040), v(0, 0, -0.23), input.waving),
    handChild("right", "finger-right-middle", v(-0.035, 0.225, 0.03), v(0.043, 0.16, 0.042), v(0, 0, -0.08), input.waving),
    handChild("right", "finger-right-ring", v(0.040, 0.215, 0.03), v(0.041, 0.15, 0.040), v(0, 0, 0.09), input.waving),
    handChild("right", "finger-right-little", v(0.105, 0.18, 0.025), v(0.036, 0.12, 0.036), v(0, 0, 0.24), input.waving),
    handChild("right", "thumb-right", v(0.16, 0.02, 0.035), v(0.045, 0.105, 0.042), v(0, 0, -0.78), input.waving),
    part("foot-left", v(-0.28, -1.66 + hover, 0.10), v(0.28, 0.28, 0.38), bodyColor, v(0, 0.06, 0)),
    part("foot-right", v(0.28, -1.66 + hover, 0.10), v(0.28, 0.28, 0.38), bodyColor, v(0, -0.06, 0)),
    headChild("eye-left", v(-0.26, 0.07, 0.635), v(0.15, 0.18 * eyeYScale, 0.070), COLORS.eye),
    headChild("eye-right", v(0.26, 0.07, 0.635), v(0.15, 0.18 * eyeYScale, 0.070), COLORS.eye),
    headChild("iris-left", v(-0.26, 0.055, 0.698), v(0.095, 0.125 * eyeYScale, 0.033), COLORS.iris),
    headChild("iris-right", v(0.26, 0.055, 0.698), v(0.095, 0.125 * eyeYScale, 0.033), COLORS.iris),
    headChild("eye-highlight-left", v(-0.30, 0.135, 0.735), v(0.038, 0.046, 0.016), COLORS.highlight, v(0, 0, 0), 0.36),
    headChild("eye-highlight-right", v(0.22, 0.135, 0.735), v(0.038, 0.046, 0.016), COLORS.highlight, v(0, 0, 0), 0.36),
    headChild("brow-left", v(-0.30, 0.33 + (concerned ? 0.02 : 0), 0.61), v(0.20, 0.032, 0.035), accentColor, v(0, 0, concerned ? -0.24 : happy ? 0.10 : 0.04)),
    headChild("brow-right", v(0.30, 0.33 + (concerned ? 0.02 : 0), 0.61), v(0.20, 0.032, 0.035), accentColor, v(0, 0, concerned ? 0.24 : happy ? -0.10 : -0.04)),
    headChild("mouth", v(0, mouthCenterY, 0.652), v(mouthShape.width, mouthShape.height, 0.032), COLORS.mouth, v(0, 0, mouthShape.roundness), 0, !showExpressionCurve),
    headChild("lip-upper", v(0, mouthCenterY + mouthShape.upperY, 0.678), v(mouthShape.width * 1.02, 0.020, 0.020), COLORS.mouth, v(0, 0, mouthShape.roundness), 0, !showExpressionCurve),
    headChild("lip-lower", v(0, mouthCenterY + mouthShape.lowerY, 0.678), v(mouthShape.width * 1.02, 0.020, 0.020), COLORS.mouth, v(0, 0, mouthShape.roundness), 0, !showExpressionCurve),
    headChild("mouth-corner-left", v(-mouthShape.width, mouthCenterY, 0.674), v(0.025, Math.max(0.022, mouthShape.height * 0.42), 0.020), COLORS.mouth, v(0, 0, 0), 0, !showExpressionCurve),
    headChild("mouth-corner-right", v(mouthShape.width, mouthCenterY, 0.674), v(0.025, Math.max(0.022, mouthShape.height * 0.42), 0.020), COLORS.mouth, v(0, 0, 0), 0, !showExpressionCurve),
    headChild("mouth-curve-left", v(-0.115, leftCurveY, 0.682), v(0.105, 0.018, 0.022), COLORS.mouth, v(0, 0, leftCurveRotation), 0, showExpressionCurve),
    headChild("mouth-curve-center", v(0, centerCurveY, 0.684), v(0.078, 0.019, 0.022), COLORS.mouth, v(0, 0, curveDirection * 0.025), 0, showExpressionCurve),
    headChild("mouth-curve-right", v(0.118, rightCurveY, 0.682), v(0.112, 0.018, 0.022), COLORS.mouth, v(0, 0, rightCurveRotation), 0, showExpressionCurve),
  ];

  return parts.map((companionPart) => companionPart.parentId ? companionPart : {
    ...companionPart,
    position: { ...companionPart.position, y: companionPart.position.y + joyHop },
  });
}

export function mat4Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) value += a[index * 4 + row] * b[column * 4 + index];
      out[column * 4 + row] = value;
    }
  }
  return out;
}

export function mat4Perspective(fieldOfViewRadians: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fieldOfViewRadians / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * 2 * range, 0,
  ]);
}

function translation(x: number, y: number, z: number): Float32Array {
  const matrix = mat4Identity();
  matrix[12] = x; matrix[13] = y; matrix[14] = z;
  return matrix;
}

function scaling(x: number, y: number, z: number): Float32Array {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

function rotationX(angle: number): Float32Array {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotationY(angle: number): Float32Array {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationZ(angle: number): Float32Array {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Local model matrix. Use resolveCompanionWorldMatrices for parented parts. */
export function modelMatrixForPart(pose: CompanionPartPose): Float32Array {
  const rotated = mat4Multiply(rotationZ(pose.rotation.z), mat4Multiply(rotationY(pose.rotation.y), rotationX(pose.rotation.x)));
  return mat4Multiply(translation(pose.position.x, pose.position.y, pose.position.z), mat4Multiply(rotated, scaling(pose.scale.x, pose.scale.y, pose.scale.z)));
}

/** Resolves a strict, cycle-checked transform hierarchy into world matrices. */
export function resolveCompanionWorldMatrices(pose: readonly CompanionPartPose[]): ReadonlyMap<string, Float32Array> {
  const partsById = new Map<string, CompanionPartPose>();
  for (const companionPart of pose) {
    if (partsById.has(companionPart.id)) throw new Error(`Duplicate companion part id: ${companionPart.id}`);
    partsById.set(companionPart.id, companionPart);
  }
  const resolved = new Map<string, Float32Array>();
  const resolving = new Set<string>();
  const resolvePart = (id: string): Float32Array => {
    const existing = resolved.get(id);
    if (existing) return existing;
    const companionPart = partsById.get(id);
    if (!companionPart) throw new Error(`Missing companion part: ${id}`);
    if (resolving.has(id)) throw new Error(`Companion hierarchy cycle at: ${id}`);
    resolving.add(id);
    const local = modelMatrixForPart(companionPart);
    const world = companionPart.parentId ? mat4Multiply(resolvePart(companionPart.parentId), local) : local;
    resolving.delete(id);
    resolved.set(id, world);
    return world;
  };
  for (const companionPart of pose) resolvePart(companionPart.id);
  return resolved;
}

/** Correct inverse-transpose normal matrix for any composed, nonuniform world transform. */
export function normalMatrixForModelMatrix(model: Float32Array): Float32Array {
  const a00 = model[0]; const a01 = model[1]; const a02 = model[2];
  const a10 = model[4]; const a11 = model[5]; const a12 = model[6];
  const a20 = model[8]; const a21 = model[9]; const a22 = model[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let determinant = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(determinant) < 1e-12) throw new Error("Companion model matrix is not invertible.");
  determinant = 1 / determinant;
  return new Float32Array([
    b01 * determinant,
    b11 * determinant,
    b21 * determinant,
    (-a22 * a01 + a02 * a21) * determinant,
    (a22 * a00 - a02 * a20) * determinant,
    (-a21 * a00 + a01 * a20) * determinant,
    (a12 * a01 - a02 * a11) * determinant,
    (-a12 * a00 + a02 * a10) * determinant,
    (a11 * a00 - a01 * a10) * determinant,
  ]);
}

export function normalMatrixForPart(pose: CompanionPartPose, worldModel = modelMatrixForPart(pose)): Float32Array {
  return normalMatrixForModelMatrix(worldModel);
}

export function companionViewProjection(aspect: number): Float32Array {
  const projection = mat4Perspective(
    COMPANION_3D_RENDERER.fieldOfViewRadians,
    aspect,
    COMPANION_3D_RENDERER.nearPlane,
    COMPANION_3D_RENDERER.farPlane,
  );
  return mat4Multiply(projection, translation(0, -0.05, -COMPANION_3D_RENDERER.cameraDistance));
}
