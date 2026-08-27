import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPANION_3D_RENDERER,
  COMPANION_VISUAL_PROFILE,
  buildCompanionPose,
  companionVisemeAtElapsedMs,
  companionViewProjection,
  createCompanionHeart,
  createCompanionLeaf,
  createCompanionSphere,
  mat4Multiply,
  modelMatrixForPart,
  normalMatrixForModelMatrix,
  normalMatrixForPart,
  resolveCompanionWorldMatrices,
  speakingVisemeAt,
  validateCompanionVisemeCues,
  type CompanionPoseInput,
  type CompanionPartPose,
} from "../src/lib/companion-3d";

const root = fileURLToPath(new URL("../", import.meta.url));

function input(overrides: Partial<CompanionPoseInput> = {}): CompanionPoseInput {
  return {
    timeSeconds: 0,
    identity: "warm-plum",
    expression: "neutral",
    waving: false,
    listening: false,
    speaking: false,
    guiding: false,
    reducedMotion: false,
    ...overrides,
  };
}

function byId(pose: CompanionPartPose[], id: string): CompanionPartPose {
  const found = pose.find((part) => part.id === id);
  if (!found) throw new Error(`Missing 3D part: ${id}`);
  return found;
}

describe("procedural companion geometry", () => {
  it("builds indexed triangles with real positive and negative z depth and unit normals", () => {
    const geometry = createCompanionSphere(12, 18);
    expect(geometry.positions.length).toBe((12 + 1) * (18 + 1) * 3);
    expect(geometry.normals.length).toBe(geometry.positions.length);
    expect(geometry.indices.length).toBe(12 * 18 * 6);
    expect(geometry.indices.length % 3).toBe(0);
    const zValues = Array.from(geometry.positions).filter((_, index) => index % 3 === 2);
    expect(Math.min(...zValues)).toBeLessThan(-0.9);
    expect(Math.max(...zValues)).toBeGreaterThan(0.9);
    for (let index = 0; index < geometry.normals.length; index += 3) {
      const length = Math.hypot(geometry.normals[index], geometry.normals[index + 1], geometry.normals[index + 2]);
      expect(length).toBeCloseTo(1, 5);
    }
    expect(Math.max(...geometry.indices)).toBeLessThan(geometry.positions.length / 3);
    let outwardTriangleFound = false;
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const ia = geometry.indices[index] * 3;
      const ib = geometry.indices[index + 1] * 3;
      const ic = geometry.indices[index + 2] * 3;
      const ab = [geometry.positions[ib] - geometry.positions[ia], geometry.positions[ib + 1] - geometry.positions[ia + 1], geometry.positions[ib + 2] - geometry.positions[ia + 2]];
      const ac = [geometry.positions[ic] - geometry.positions[ia], geometry.positions[ic + 1] - geometry.positions[ia + 1], geometry.positions[ic + 2] - geometry.positions[ia + 2]];
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const area = Math.hypot(...cross);
      if (area > 1e-5) {
        const dot = cross[0] * geometry.normals[ia] + cross[1] * geometry.normals[ia + 1] + cross[2] * geometry.normals[ia + 2];
        expect(dot).toBeGreaterThan(0);
        outwardTriangleFound = true;
        break;
      }
    }
    expect(outwardTriangleFound).toBe(true);
  });

  it("rejects flat or degenerate segment counts", () => {
    expect(() => createCompanionSphere(2, 20)).toThrow(/three segments/i);
    expect(() => createCompanionSphere(12, 2)).toThrow(/three segments/i);
  });

  it("builds distinct pointed leaf and real heart meshes with front, back, and side depth", () => {
    const leaf = createCompanionLeaf(32);
    const heart = createCompanionHeart(40);
    for (const geometry of [leaf, heart]) {
      expect(geometry.positions.length).toBe(geometry.normals.length);
      expect(geometry.indices.length % 3).toBe(0);
      const zValues = Array.from(geometry.positions).filter((_, index) => index % 3 === 2);
      expect(Math.min(...zValues)).toBeLessThan(0);
      expect(Math.max(...zValues)).toBeGreaterThan(0);
      expect(Math.max(...geometry.indices)).toBeLessThan(geometry.positions.length / 3);
    }
    const leafX = Array.from(leaf.positions).filter((_, index) => index % 3 === 0);
    const leafY = Array.from(leaf.positions).filter((_, index) => index % 3 === 1);
    expect(Math.max(...leafX) - Math.min(...leafX)).toBeGreaterThan((Math.max(...leafY) - Math.min(...leafY)) * 1.5);
    const heartY = Array.from(heart.positions).filter((_, index) => index % 3 === 1);
    expect(Math.min(...heartY)).toBeLessThan(-0.9);
  });

  it("uses a perspective camera, a bounded clip range, lighting, and depth testing", () => {
    expect(COMPANION_3D_RENDERER.renderer).toBe("procedural-webgl-3d");
    expect(COMPANION_3D_RENDERER.depthTest).toBe(true);
    expect(COMPANION_3D_RENDERER.textureSource).toBeNull();
    expect(COMPANION_3D_RENDERER.nearPlane).toBeGreaterThan(0);
    expect(COMPANION_3D_RENDERER.farPlane).toBeGreaterThan(COMPANION_3D_RENDERER.nearPlane);
    expect(COMPANION_3D_RENDERER.fieldOfViewRadians).toBeGreaterThan(0);
    expect(COMPANION_3D_RENDERER.fieldOfViewRadians).toBeLessThan(Math.PI);
    const projection = companionViewProjection(1);
    expect(projection).toHaveLength(16);
    expect(projection[11]).toBe(-1);
    expect(projection[15]).toBeGreaterThan(0);
  });
});

describe("articulated companion pose", () => {
  it("contains separate depth-bearing character, face, wing, and lantern parts", () => {
    const pose = buildCompanionPose(input());
    const ids = new Set(pose.map((part) => part.id));
    for (const id of [
      "body", "head", "arm-left", "arm-right", "hand-left", "hand-right", "foot-left", "foot-right",
      "wing-left", "wing-right", "eye-left", "eye-right", "mouth", "lantern-bezel",
      "lantern-glow-left", "lantern-glow-right", "lantern-glow-lower",
      "lantern-heart", "finger-right-index", "finger-right-middle", "finger-right-ring", "finger-right-little", "thumb-right",
      "wing-vein-left", "wing-vein-right", "forehead-glow-left", "forehead-glow-right",
    ]) expect(ids.has(id), id).toBe(true);
    expect(pose.every((part) => part.scale.z > 0)).toBe(true);
    expect(new Set(pose.map((part) => part.position.z)).size).toBeGreaterThan(6);
    expect(byId(pose, "wing-left").geometry).toBe("leaf");
    expect(byId(pose, "lantern-heart").geometry).toBe("heart");
    expect(byId(pose, "body").surface).toBe("fabric");
    expect(byId(pose, "eye-left").surface).toBe("glass");
    expect(byId(pose, "lantern-heart").surface).toBe("glow");
  });

  it("locks the accepted tall, slim, close-camera visual direction", () => {
    const pose = buildCompanionPose(input({ identity: "light-blue" }));
    const body = byId(pose, "body");
    expect(COMPANION_VISUAL_PROFILE.silhouette).toBe("tall-slim-lantern-friend");
    expect(COMPANION_VISUAL_PROFILE.minimumDesktopStageWidthPx).toBeGreaterThanOrEqual(448);
    expect(COMPANION_VISUAL_PROFILE.minimumDesktopStageHeightPx).toBeGreaterThanOrEqual(490);
    expect(body.scale.y / body.scale.x).toBeGreaterThanOrEqual(COMPANION_VISUAL_PROFILE.bodyHeightToWidth - 0.01);
    expect(COMPANION_3D_RENDERER.cameraDistance).toBeLessThan(5);
    expect(COMPANION_3D_RENDERER.cameraDistance).toBe(COMPANION_VISUAL_PROFILE.cameraDistance);
    expect(byId(pose, "foot-left").position.y).toBeLessThan(-1.5);
    expect(byId(pose, "head").position.y).toBeGreaterThan(0.85);
  });

  it("waves hello through actual arm, hand, wing, and model-matrix changes", () => {
    const idle = buildCompanionPose(input({ timeSeconds: 0.37 }));
    const waving = buildCompanionPose(input({ timeSeconds: 0.37, waving: true }));
    expect(byId(waving, "arm-right").rotation.z).not.toBe(byId(idle, "arm-right").rotation.z);
    expect(byId(waving, "hand-right").position.y).toBeGreaterThan(byId(idle, "hand-right").position.y + 1);
    expect(byId(waving, "finger-right-index").visible).toBe(true);
    expect(byId(idle, "finger-right-index").visible).toBe(false);
    expect(byId(waving, "finger-right-index").parentId).toBe("hand-right");
    expect(Array.from(modelMatrixForPart(byId(waving, "hand-right")))).not.toEqual(Array.from(modelMatrixForPart(byId(idle, "hand-right"))));
    const laterWave = buildCompanionPose(input({ timeSeconds: 0.72, waving: true }));
    expect(byId(laterWave, "hand-right").rotation.z).not.toBeCloseTo(byId(waving, "hand-right").rotation.z, 4);
  });

  it("performs a bounded joyful hop, moves the whole root, and returns deterministically to idle height", () => {
    const peakTime = Math.PI / (2 * 1.35);
    const returnTime = Math.PI / 1.35;
    const neutralPeak = buildCompanionPose(input({ timeSeconds: peakTime }));
    const happyPeak = buildCompanionPose(input({ timeSeconds: peakTime, expression: "happy" }));
    for (const id of ["body", "head", "arm-left", "arm-right", "wing-left", "wing-right", "foot-left", "foot-right"]) {
      expect(byId(happyPeak, id).position.y - byId(neutralPeak, id).position.y, id).toBeCloseTo(0.14, 5);
    }
    const neutralReturn = buildCompanionPose(input({ timeSeconds: returnTime }));
    const happyReturn = buildCompanionPose(input({ timeSeconds: returnTime, expression: "happy" }));
    expect(byId(happyReturn, "body").position.y).toBeCloseTo(byId(neutralReturn, "body").position.y, 8);
    expect(byId(happyPeak, "body").position.y - byId(neutralPeak, "body").position.y).toBeLessThanOrEqual(0.14);
  });

  it("leans and nods while listening and changes brows and mouth for concern", () => {
    const neutral = buildCompanionPose(input({ timeSeconds: 0.61 }));
    const concerned = buildCompanionPose(input({ timeSeconds: 0.61, listening: true, expression: "concerned" }));
    expect(byId(concerned, "head").rotation.z).not.toBe(byId(neutral, "head").rotation.z);
    expect(byId(concerned, "head").rotation.x).not.toBe(byId(neutral, "head").rotation.x);
    expect(byId(concerned, "brow-left").rotation.z).toBeLessThan(0);
    expect(byId(concerned, "brow-right").rotation.z).toBeGreaterThan(0);
    expect(byId(concerned, "mouth").visible).toBe(false);
    expect(byId(concerned, "mouth-curve-left").position.y).toBeLessThan(byId(concerned, "mouth-curve-center").position.y);
    expect(byId(concerned, "mouth-curve-right").position.y).toBeLessThan(byId(concerned, "mouth-curve-center").position.y);
  });

  it("parents the complete face and cap to the head and resolves composed world and normal matrices", () => {
    const pose = buildCompanionPose(input({ timeSeconds: 0.61, listening: true }));
    const world = resolveCompanionWorldMatrices(pose);
    const head = byId(pose, "head");
    const headWorld = world.get("head");
    expect(headWorld).toBeDefined();
    for (const id of [
      "cap", "cap-loop", "eye-left", "eye-right", "iris-left", "iris-right",
      "eye-highlight-left", "eye-highlight-right", "brow-left", "brow-right",
      "mouth", "lip-upper", "lip-lower", "mouth-corner-left", "mouth-corner-right",
      "mouth-curve-left", "mouth-curve-center", "mouth-curve-right",
    ]) {
      const child = byId(pose, id);
      expect(child.parentId, id).toBe("head");
      const expected = Array.from(mat4Multiply(headWorld!, modelMatrixForPart(child)));
      expect(Array.from(world.get(id)!)).toEqual(expected);
    }
    const eyeWorld = world.get("eye-left")!;
    const eyeNormal = normalMatrixForModelMatrix(eyeWorld);
    expect(eyeNormal).toHaveLength(9);
    expect(Array.from(eyeNormal).every(Number.isFinite)).toBe(true);
    const transformedTangentX = [eyeWorld[0], eyeWorld[1], eyeWorld[2]];
    const transformedTangentZ = [eyeWorld[8], eyeWorld[9], eyeWorld[10]];
    const transformedNormalY = [eyeNormal[3], eyeNormal[4], eyeNormal[5]];
    const dot = (left: number[], right: number[]) => left.reduce((total, value, index) => total + value * right[index], 0);
    expect(dot(transformedNormalY, transformedTangentX)).toBeCloseTo(0, 6);
    expect(dot(transformedNormalY, transformedTangentZ)).toBeCloseTo(0, 6);
    expect(Array.from(eyeWorld)).not.toEqual(Array.from(modelMatrixForPart(byId(pose, "eye-left"))));
    expect(head.parentId).toBeUndefined();
  });

  it("constructs visibly upturned and downturned mouths from unequal curved segments", () => {
    const happyPose = buildCompanionPose(input({ expression: "happy", viseme: "rest" }));
    const concernedPose = buildCompanionPose(input({ expression: "concerned", viseme: "rest" }));
    const happyLeft = byId(happyPose, "mouth-curve-left");
    const happyCenter = byId(happyPose, "mouth-curve-center");
    const happyRight = byId(happyPose, "mouth-curve-right");
    expect(happyLeft.visible && happyCenter.visible && happyRight.visible).toBe(true);
    expect(happyLeft.position.y).toBeGreaterThan(happyCenter.position.y);
    expect(happyRight.position.y).toBeGreaterThan(happyCenter.position.y);
    expect(happyLeft.rotation.z).toBeLessThan(0);
    expect(happyRight.rotation.z).toBeGreaterThan(0);
    expect(Math.abs(happyLeft.rotation.z)).not.toBeCloseTo(Math.abs(happyRight.rotation.z), 6);
    expect(Math.abs(happyLeft.position.x)).not.toBeCloseTo(Math.abs(happyRight.position.x), 6);
    const concernedLeft = byId(concernedPose, "mouth-curve-left");
    const concernedCenter = byId(concernedPose, "mouth-curve-center");
    const concernedRight = byId(concernedPose, "mouth-curve-right");
    expect(concernedLeft.position.y).toBeLessThan(concernedCenter.position.y);
    expect(concernedRight.position.y).toBeLessThan(concernedCenter.position.y);
    expect(concernedLeft.rotation.z).toBeGreaterThan(0);
    expect(concernedRight.rotation.z).toBeLessThan(0);
    expect(byId(happyPose, "mouth").visible).toBe(false);
    expect(byId(concernedPose, "mouth").visible).toBe(false);
  });

  it("animates guided breathing, lantern glow, speaking mouth, and speaking head motion", () => {
    const guideStart = buildCompanionPose(input({ guiding: true, timeSeconds: 0 }));
    const guideInhale = buildCompanionPose(input({ guiding: true, timeSeconds: 1.5 }));
    expect(byId(guideInhale, "body").scale.y).toBeGreaterThan(byId(guideStart, "body").scale.y + 0.05);
    expect(byId(guideInhale, "lantern-glow-left").scale.x).toBeGreaterThan(byId(guideStart, "lantern-glow-left").scale.x);
    const speechA = buildCompanionPose(input({ speaking: true, timeSeconds: 0.12 }));
    const speechB = buildCompanionPose(input({ speaking: true, timeSeconds: 0.31 }));
    expect(byId(speechA, "mouth").scale.y).not.toBeCloseTo(byId(speechB, "mouth").scale.y, 4);
    expect(byId(speechA, "head").position.y).not.toBeCloseTo(byId(speechB, "head").position.y, 4);
  });

  it("preserves identity palettes and uses correct inverse-scale normal transforms", () => {
    const plum = buildCompanionPose(input({ identity: "warm-plum" }));
    const blue = buildCompanionPose(input({ identity: "light-blue" }));
    expect(byId(plum, "body").color).not.toEqual(byId(blue, "body").color);
    const normal = normalMatrixForPart(byId(plum, "body"));
    expect(normal).toHaveLength(9);
    expect(normal[0]).toBeCloseTo(1 / byId(plum, "body").scale.x, 5);
    expect(normal[4]).toBeCloseTo(1 / byId(plum, "body").scale.y, 5);
    expect(normal[8]).toBeCloseTo(1 / byId(plum, "body").scale.z, 5);
  });

  it("exposes distinct closed, jaw, wide, rounded, and lip-contact 3D viseme transforms", () => {
    const visemes = ["rest", "jaw-open", "wide", "rounded", "lip-contact"] as const;
    const shapes = visemes.map((viseme) => {
      const pose = buildCompanionPose(input({ speaking: true, viseme }));
      return {
        viseme,
        mouth: Array.from(modelMatrixForPart(byId(pose, "mouth"))),
        upper: Array.from(modelMatrixForPart(byId(pose, "lip-upper"))),
        lower: Array.from(modelMatrixForPart(byId(pose, "lip-lower"))),
      };
    });
    expect(new Set(shapes.map((shape) => JSON.stringify(shape.mouth))).size).toBe(visemes.length);
    expect(new Set(shapes.map((shape) => JSON.stringify([shape.upper, shape.lower]))).size).toBe(visemes.length);
    const contact = buildCompanionPose(input({ speaking: true, viseme: "lip-contact" }));
    const jaw = buildCompanionPose(input({ speaking: true, viseme: "jaw-open" }));
    expect(Math.abs(byId(contact, "lip-upper").position.y - byId(contact, "lip-lower").position.y)).toBeLessThan(0.04);
    expect(Math.abs(byId(jaw, "lip-upper").position.y - byId(jaw, "lip-lower").position.y)).toBeGreaterThan(0.15);
  });

  it("uses a bounded deterministic preview viseme sequence until timed voice cues arrive", () => {
    expect(["rest", "jaw-open", "wide", "rounded", "lip-contact"]).toContain(speakingVisemeAt(0));
    expect(speakingVisemeAt(0.12)).not.toBe(speakingVisemeAt(0));
    expect(speakingVisemeAt(0.66)).toBe(speakingVisemeAt(0));
    expect(speakingVisemeAt(-1)).toBe(speakingVisemeAt(0));
  });

  it("accepts a bounded reviewed timing cue sequence and drives exact 3D mouth poses", () => {
    const cues = validateCompanionVisemeCues([
      { startMs: 0, endMs: 90, viseme: "lip-contact", language: "en" },
      { startMs: 90, endMs: 210, viseme: "jaw-open", language: "en" },
      { startMs: 210, endMs: 320, viseme: "wide", language: "en" },
      { startMs: 360, endMs: 470, viseme: "rounded", language: "en" },
    ]);
    expect(cues).not.toBeNull();
    expect(companionVisemeAtElapsedMs(20, cues!)).toBe("lip-contact");
    expect(companionVisemeAtElapsedMs(150, cues!)).toBe("jaw-open");
    expect(companionVisemeAtElapsedMs(250, cues!)).toBe("wide");
    expect(companionVisemeAtElapsedMs(340, cues!)).toBe("rest");
    expect(companionVisemeAtElapsedMs(400, cues!)).toBe("rounded");
    expect(companionVisemeAtElapsedMs(500, cues!)).toBe("rest");

    const contact = buildCompanionPose(input({ speaking: true, viseme: companionVisemeAtElapsedMs(20, cues!) }));
    const jaw = buildCompanionPose(input({ speaking: true, viseme: companionVisemeAtElapsedMs(150, cues!) }));
    expect(Array.from(modelMatrixForPart(byId(contact, "mouth"))))
      .not.toEqual(Array.from(modelMatrixForPart(byId(jaw, "mouth"))));
  });

  it("fails closed for malformed, overlapping, mixed-language, or unbounded timing cues", () => {
    expect(validateCompanionVisemeCues([])).toBeNull();
    expect(validateCompanionVisemeCues([
      { startMs: 0, endMs: 100, viseme: "jaw-open", language: "en" },
      { startMs: 90, endMs: 180, viseme: "wide", language: "en" },
    ])).toBeNull();
    expect(validateCompanionVisemeCues([
      { startMs: 0, endMs: 100, viseme: "jaw-open", language: "en" },
      { startMs: 100, endMs: 180, viseme: "wide", language: "es" },
    ])).toBeNull();
    expect(validateCompanionVisemeCues([
      { startMs: 0, endMs: 901_000, viseme: "rounded", language: "fr" },
    ])).toBeNull();
    expect(validateCompanionVisemeCues([
      { startMs: 0, endMs: 100, viseme: "unknown", language: "en" },
    ])).toBeNull();
    expect(companionVisemeAtElapsedMs(Number.NaN, [])).toBe("rest");
  });

  it("keeps reduced-motion states static, readable, and minimally displaced", () => {
    const first = buildCompanionPose(input({ reducedMotion: true, expression: "happy", waving: true, listening: true, speaking: true, guiding: true, timeSeconds: 1 }));
    const later = buildCompanionPose(input({ reducedMotion: true, expression: "happy", waving: true, listening: true, speaking: true, guiding: true, timeSeconds: 99 }));
    expect(later).toEqual(first);
    const reducedNeutral = buildCompanionPose(input({ reducedMotion: true, timeSeconds: 1 }));
    expect(byId(first, "body").position.y - byId(reducedNeutral, "body").position.y).toBeLessThanOrEqual(0.0121);
    expect(byId(first, "hand-right").position.y).toBeGreaterThan(byId(reducedNeutral, "hand-right").position.y);
    expect(byId(first, "mouth").scale.y).toBeGreaterThan(byId(reducedNeutral, "mouth").scale.y);
  });
});

describe("runtime model source", () => {
  it("enables WebGL depth rendering, triangle meshes, normals, lighting, and requestAnimationFrame", () => {
    const component = readFileSync(`${root}src/components/AnimatedMascot.tsx`, "utf8");
    expect(component).toMatch(/attribute vec3 a_position/);
    expect(component).toMatch(/attribute vec3 a_normal/);
    expect(component).toMatch(/u_viewProjection/);
    expect(component).toMatch(/u_normalMatrix/);
    expect(component).toMatch(/gl\.enable\(gl\.DEPTH_TEST\)/);
    expect(component).toMatch(/gl\.clear\(gl\.COLOR_BUFFER_BIT \| gl\.DEPTH_BUFFER_BIT\)/);
    expect(component).toMatch(/gl\.drawElements\(gl\.TRIANGLES/);
    expect(component).toMatch(/requestAnimationFrame/);
    expect(component).toContain("resolveCompanionWorldMatrices(pose)");
    expect(component).toContain("normalMatrixForModelMatrix(worldModel)");
  });

  it("presents the live mesh inside a state-responsive spatial theatre", () => {
    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    const component = readFileSync(`${root}src/components/AnimatedMascot.tsx`, "utf8");
    const styles = readFileSync(`${root}src/styles.css`, "utf8");
    expect(app).toContain("REAL-TIME 3D PRESENCE");
    expect(app).toContain("Articulated WebGL character · local visual state");
    expect(component).toContain("data-presence-state");
    expect(component).toContain("stage-depth-ring");
    expect(component).toContain("mascot-ground-shadow");
    expect(component).toContain("mascot-plinth");
    expect(component).toMatch(/fillLight[\s\S]*bounceLight[\s\S]*specular/);
    expect(styles).toContain("perspective: 980px");
    expect(styles).toContain("transform-style: preserve-3d");
    expect(styles).toMatch(/\.mascot-3d-stage[^}]*width:\s*480px[^}]*height:\s*500px/);
    expect(styles).toMatch(/\.presence-panel[^}]*min-height:\s*590px/);
    expect(component).toContain("COMPANION_VISUAL_PROFILE.silhouette");
  });

  it("keeps one renderer lifecycle while prop transitions flow through motionRef without resetting motionTick", () => {
    const component = readFileSync(`${root}src/components/AnimatedMascot.tsx`, "utf8");
    const lifecycle = component.slice(component.indexOf("RENDERER_LIFECYCLE_INVARIANT"));
    expect(lifecycle).toMatch(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/);
    expect(component).toContain("motionRef.current = { identity, expression, waving, listening, speaking, guiding, viseme }");
    expect(component).toContain("}, [identity, expression, waving, listening, speaking, guiding, viseme]);");
    expect(component).toContain("buildCompanionPose({ ...motionRef.current");
    expect(component).toContain('rendererLifecycle = "mount-only-live-motion-ref"');
    expect(component.match(/dataset\.motionTick = "0"/g)).toHaveLength(1);
    expect(component).toContain("dataset.motionTick = String(renderedFrames)");
    expect(component).toContain("dataset.motionRevision = String(motionRevisionRef.current)");
  });

  it("has no PNG, image element, texture, or image-swap dependency in the application runtime", () => {
    const app = readFileSync(`${root}src/App.tsx`, "utf8");
    const component = readFileSync(`${root}src/components/AnimatedMascot.tsx`, "utf8");
    for (const source of [app, component]) {
      expect(source).not.toMatch(/companion-[^"']+\.png/i);
      expect(source).not.toMatch(/new Image\s*\(/);
      expect(source).not.toMatch(/drawImage\s*\(/);
      expect(source).not.toMatch(/sampler2D|TEXTURE_2D|texImage2D/);
    }
    expect(app).not.toMatch(/<img\b/);
  });

  it("labels the deterministic procedural non-picture compatibility path as not 3D", () => {
    const component = readFileSync(`${root}src/components/AnimatedMascot.tsx`, "utf8");
    expect(component).toContain("compatibility-canvas-2d");
    expect(component).toContain("Compatibility fallback · not 3D");
    expect(component).toContain("drawProceduralFallback");
    expect(component).not.toContain("image.src");
  });
});
