import { useEffect, useRef, useState } from "react";
import {
  COMPANION_VISUAL_PROFILE,
  buildCompanionPose,
  companionViewProjection,
  createCompanionHeart,
  createCompanionLeaf,
  createCompanionSphere,
  normalMatrixForModelMatrix,
  resolveCompanionWorldMatrices,
  type CompanionIdentity,
  type CompanionGeometryKind,
  type CompanionSurfaceKind,
  type CompanionViseme,
  speakingVisemeAt,
} from "../lib/companion-3d";
import type { CompanionExpression } from "../lib/types";

interface AnimatedMascotProps {
  identity: CompanionIdentity;
  expression: CompanionExpression;
  alt: string;
  waving: boolean;
  listening: boolean;
  speaking: boolean;
  guiding: boolean;
  viseme?: CompanionViseme;
}

interface MotionState {
  identity: CompanionIdentity;
  expression: CompanionExpression;
  waving: boolean;
  listening: boolean;
  speaking: boolean;
  guiding: boolean;
  viseme?: CompanionViseme;
}

const vertexShaderSource = `
  attribute vec3 a_position;
  attribute vec3 a_normal;
  uniform mat4 u_model;
  uniform mat4 u_viewProjection;
  uniform mat3 u_normalMatrix;
  varying vec3 v_worldPosition;
  varying vec3 v_worldNormal;
  varying vec3 v_objectPosition;

  void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    v_worldPosition = world.xyz;
    v_worldNormal = normalize(u_normalMatrix * a_normal);
    v_objectPosition = a_position;
    gl_Position = u_viewProjection * world;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec3 v_worldPosition;
  varying vec3 v_worldNormal;
  varying vec3 v_objectPosition;
  uniform vec4 u_color;
  uniform float u_emissive;
  uniform float u_surface;

  void main() {
    vec3 normal = normalize(v_worldNormal);
    vec3 keyLight = normalize(vec3(-0.42, 0.76, 0.88));
    vec3 fillLight = normalize(vec3(0.78, 0.20, 0.62));
    vec3 bounceLight = normalize(vec3(0.10, -0.94, 0.38));
    float key = max(dot(normal, keyLight), 0.0);
    float fill = max(dot(normal, fillLight), 0.0);
    float bounce = max(dot(normal, bounceLight), 0.0);
    vec3 viewDirection = normalize(vec3(0.0, 0.2, 6.0) - v_worldPosition);
    vec3 halfVector = normalize(keyLight + viewDirection);
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 1.75);
    float specular = pow(max(dot(normal, halfVector), 0.0), 34.0);
    float light = 0.18 + key * 0.74 + fill * 0.22 + bounce * 0.10 + rim * 0.28;
    float verticalLift = clamp((v_worldPosition.y + 1.8) / 4.0, 0.0, 1.0);
    vec3 warmBounce = vec3(1.0, 0.42, 0.12) * bounce * 0.075;
    vec3 coolRim = vec3(0.08, 0.74, 1.0) * rim * 0.10;
    float weave = sin((v_objectPosition.x + v_objectPosition.y) * 33.0) * sin((v_objectPosition.y - v_objectPosition.x) * 41.0);
    float grain = sin(v_objectPosition.x * 57.0 + sin(v_objectPosition.y * 39.0) * 1.8);
    vec3 surfaceColor = u_color.rgb;
    float surfaceSpecular = specular * 0.26;
    if (u_surface < 0.5) {
      surfaceColor *= 0.94 + weave * 0.055 + grain * 0.018;
      surfaceSpecular *= 0.38;
    } else if (u_surface < 1.5) {
      surfaceColor *= 0.985 + grain * 0.014;
      surfaceSpecular *= 0.64;
    } else if (u_surface < 2.5) {
      surfaceColor = mix(surfaceColor, vec3(0.10, 0.045, 0.025), 0.12);
      surfaceSpecular *= 2.35;
    } else if (u_surface < 3.5) {
      surfaceColor *= 1.06;
      surfaceSpecular *= 1.35;
    } else {
      surfaceColor *= 0.92 + rim * 0.18;
      surfaceSpecular *= 1.8;
    }
    vec3 color = surfaceColor * light + warmBounce + coolRim + vec3(surfaceSpecular) + surfaceColor * u_emissive * 0.88;
    color += u_color.rgb * verticalLift * 0.045;
    gl_FragColor = vec4(color, u_color.a);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function surfaceCode(surface: CompanionSurfaceKind): number {
  return surface === "fabric" ? 0 : surface === "skin" ? 1 : surface === "glass" ? 2 : surface === "glow" ? 3 : 4;
}

function drawProceduralFallback(
  canvas: HTMLCanvasElement,
  state: MotionState,
  reducedMotion: boolean,
  timeSeconds: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const plum = state.identity === "warm-plum";
  const body = plum ? "#7d1590" : "#087acb";
  const accent = plum ? "#ec4cc9" : "#35d7ff";
  const wing = plum ? "#bd32a9" : "#16a7e8";
  const hover = reducedMotion ? 0 : Math.sin(timeSeconds * 1.2) * 4;
  const breath = state.guiding && !reducedMotion ? Math.sin(timeSeconds * Math.PI / 3) * 0.035 : 0;
  const viseme = state.viseme ?? (state.speaking ? (reducedMotion ? "jaw-open" : speakingVisemeAt(timeSeconds)) : "rest");
  const mouthWidth = viseme === "wide" ? 18 : viseme === "rounded" ? 8 : 12;
  const mouthOpen = viseme === "jaw-open" ? 11 : viseme === "rounded" ? 9 : viseme === "wide" ? 5 : viseme === "lip-contact" ? 1.5 : 2;
  const wave = state.waving ? (reducedMotion ? -0.62 : -0.62 + Math.sin(timeSeconds * 5.8) * 0.18) : 0.18;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(256, 262 + hover);
  context.scale(1 + breath * 0.25, 1 + breath);
  context.fillStyle = wing;
  context.save(); context.rotate(-0.4); context.beginPath(); context.ellipse(-126, -76, 70, 29, 0, 0, Math.PI * 2); context.fill(); context.restore();
  context.save(); context.rotate(0.4); context.beginPath(); context.ellipse(126, -76, 70, 29, 0, 0, Math.PI * 2); context.fill(); context.restore();
  context.fillStyle = body;
  context.beginPath(); context.ellipse(0, 52, 72, 133, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#efd0ae";
  context.beginPath(); context.ellipse(0, -78, 78, 67, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = body;
  context.beginPath(); context.ellipse(0, -140, 71, 25, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = accent;
  context.beginPath(); context.ellipse(0, -169, 12, 19, 0, 0, Math.PI * 2); context.fill();
  context.save();
  context.translate(-94, 23); context.rotate(-0.18); context.fillStyle = body; context.beginPath(); context.ellipse(0, 0, 22, 58, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#e8b18d"; context.beginPath(); context.ellipse(-3, 48, 21, 22, 0, 0, Math.PI * 2); context.fill(); context.restore();
  context.save();
  context.translate(94, state.waving ? -20 : 23); context.rotate(wave); context.fillStyle = body; context.beginPath(); context.ellipse(0, 0, 22, 58, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#e8b18d"; context.beginPath(); context.ellipse(0, state.waving ? -49 : 48, 21, 22, 0, 0, Math.PI * 2); context.fill(); context.restore();
  context.fillStyle = body;
  context.beginPath(); context.ellipse(-32, 178, 29, 27, 0, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.ellipse(32, 178, 29, 27, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#24100f";
  context.beginPath(); context.ellipse(-29, -76, 18, 22, 0, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.ellipse(29, -76, 18, 22, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#fff7e8";
  context.beginPath(); context.arc(-35, -84, 4, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(23, -84, 4, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#7b2430"; context.lineWidth = 5; context.lineCap = "round"; context.beginPath();
  if (state.expression === "concerned") context.arc(0, -37, 16, Math.PI * 1.15, Math.PI * 1.85);
  else context.arc(0, -50, 17, 0.15, Math.PI - 0.15);
  context.stroke();
  if (state.speaking || state.viseme) {
    context.fillStyle = "#7b2430"; context.beginPath(); context.ellipse(0, -39, mouthWidth, mouthOpen, 0, 0, Math.PI * 2); context.fill();
  }
  context.fillStyle = "#ec6f2f";
  context.beginPath(); context.ellipse(0, 51, 42, 50, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#ffbf42";
  context.beginPath(); context.arc(-14, 40, 22, 0, Math.PI * 2); context.arc(14, 40, 22, 0, Math.PI * 2); context.fill();
  context.save(); context.translate(0, 62); context.rotate(Math.PI / 4); context.fillRect(-20, -20, 40, 40); context.restore();
  context.restore();
}

export function AnimatedMascot({ identity, expression, alt, waving, listening, speaking, guiding, viseme }: AnimatedMascotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const motionRef = useRef<MotionState>({ identity, expression, waving, listening, speaking, guiding, viseme });
  const motionRevisionRef = useRef(0);

  useEffect(() => {
    motionRef.current = { identity, expression, waving, listening, speaking, guiding, viseme };
    motionRevisionRef.current += 1;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.dataset.motionRevision = String(motionRevisionRef.current);
      canvas.dataset.motionState = [identity, expression, waving, listening, speaking, guiding, viseme ?? "preview"].join(":");
    }
  }, [identity, expression, waving, listening, speaking, guiding, viseme]);

  // RENDERER_LIFECYCLE_INVARIANT: initialize exactly once per component mount.
  // Every live prop transition is read from motionRef by the continuing frame loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true });
    let frame = 0;
    let disposed = false;
    let renderedFrames = 0;
    const start = performance.now();
    canvas.dataset.model = "procedural-articulated-3d";
    canvas.dataset.textureSource = "none";
    canvas.dataset.depthTest = "enabled";
    canvas.dataset.hierarchy = "head-parented-world-matrices";
    canvas.dataset.geometrySet = "sphere-leaf-heart-articulated";
    canvas.dataset.materialSystem = "fabric-skin-glass-glow-metal";
    canvas.dataset.rendererLifecycle = "mount-only-live-motion-ref";
    canvas.dataset.rendererStartedAt = String(start);
    canvas.dataset.motionTick = "0";
    canvas.dataset.motionRevision = String(motionRevisionRef.current);
    canvas.dataset.visualProfile = COMPANION_VISUAL_PROFILE.silhouette;
    canvas.dataset.cameraDistance = String(COMPANION_VISUAL_PROFILE.cameraDistance);

    if (!gl) {
      canvas.dataset.renderer = "compatibility-canvas-2d";
      canvas.dataset.depthTest = "unavailable";
      setFallback("WebGL is unavailable; showing a procedural 2D compatibility fallback.");
      const render2d = (now: number) => {
        if (disposed) return;
        drawProceduralFallback(canvas, motionRef.current, reduceMotion, (now - start) / 1000);
        renderedFrames += 1;
        if (renderedFrames % 15 === 0) canvas.dataset.motionTick = String(renderedFrames);
        if (!reduceMotion) frame = requestAnimationFrame(render2d);
      };
      frame = requestAnimationFrame(render2d);
      return () => { disposed = true; cancelAnimationFrame(frame); };
    }

    setFallback(null);
    canvas.dataset.renderer = reduceMotion ? "webgl-3d-static" : "webgl-3d-motion";
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertex || !fragment) {
      canvas.dataset.renderer = "webgl-shader-unavailable";
      setFallback("3D shaders are unavailable; showing the compatibility marker.");
      return;
    }
    const program = gl.createProgram();
    if (!program) { setFallback("3D initialization is unavailable; showing the compatibility marker."); return; }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
      setFallback("3D linking is unavailable; showing the compatibility marker.");
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    const normalLocation = gl.getAttribLocation(program, "a_normal");
    gl.enableVertexAttribArray(normalLocation);
    const geometrySources = new Map<CompanionGeometryKind, ReturnType<typeof createCompanionSphere>>([
      ["sphere", createCompanionSphere(18, 28)],
      ["leaf", createCompanionLeaf(40)],
      ["heart", createCompanionHeart(48)],
    ]);
    const gpuMeshes = new Map<CompanionGeometryKind, { position: WebGLBuffer; normal: WebGLBuffer; index: WebGLBuffer; count: number }>();
    for (const [kind, geometry] of geometrySources) {
      const position = gl.createBuffer();
      const normal = gl.createBuffer();
      const index = gl.createBuffer();
      if (!position || !normal || !index) {
        setFallback("3D buffers are unavailable; showing the compatibility marker.");
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normal);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
      gpuMeshes.set(kind, { position, normal, index, count: geometry.indices.length });
    }

    const modelLocation = gl.getUniformLocation(program, "u_model");
    const viewProjectionLocation = gl.getUniformLocation(program, "u_viewProjection");
    const normalMatrixLocation = gl.getUniformLocation(program, "u_normalMatrix");
    const colorLocation = gl.getUniformLocation(program, "u_color");
    const emissiveLocation = gl.getUniformLocation(program, "u_emissive");
    const surfaceLocation = gl.getUniformLocation(program, "u_surface");
    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    const render = (now: number) => {
      if (disposed) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(viewProjectionLocation, false, companionViewProjection(canvas.width / canvas.height));
      const pose = buildCompanionPose({ ...motionRef.current, timeSeconds: (now - start) / 1000, reducedMotion: reduceMotion });
      const worldMatrices = resolveCompanionWorldMatrices(pose);
      for (const companionPart of pose) {
        if (!companionPart.visible) continue;
        const worldModel = worldMatrices.get(companionPart.id);
        const gpuMesh = gpuMeshes.get(companionPart.geometry);
        if (!worldModel || !gpuMesh) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, gpuMesh.position);
        gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpuMesh.normal);
        gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpuMesh.index);
        gl.uniformMatrix4fv(modelLocation, false, worldModel);
        gl.uniformMatrix3fv(normalMatrixLocation, false, normalMatrixForModelMatrix(worldModel));
        gl.uniform4fv(colorLocation, companionPart.color);
        gl.uniform1f(emissiveLocation, companionPart.emissive);
        gl.uniform1f(surfaceLocation, surfaceCode(companionPart.surface));
        gl.drawElements(gl.TRIANGLES, gpuMesh.count, gl.UNSIGNED_SHORT, 0);
      }
      renderedFrames += 1;
      if (renderedFrames % 15 === 0) canvas.dataset.motionTick = String(renderedFrames);
      if (!reduceMotion) frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      for (const mesh of gpuMeshes.values()) {
        gl.deleteBuffer(mesh.position); gl.deleteBuffer(mesh.normal); gl.deleteBuffer(mesh.index);
      }
      gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    };
  }, []);

  return (
    <div
      className={`mascot-3d-stage expression-${expression}${listening ? " is-listening" : ""}${speaking ? " is-speaking" : ""}${guiding ? " is-guiding" : ""}`}
      data-presence-state={listening ? "listening" : speaking ? "speaking" : guiding ? "guiding" : expression}
    >
      <span className="stage-depth-ring ring-one" aria-hidden="true" />
      <span className="stage-depth-ring ring-two" aria-hidden="true" />
      <span className="stage-star star-one" aria-hidden="true">✦</span>
      <span className="stage-star star-two" aria-hidden="true">✦</span>
      <span className="stage-star star-three" aria-hidden="true">✦</span>
      <span className="mascot-ground-shadow" aria-hidden="true" />
      <canvas ref={canvasRef} width={512} height={512} role="img" aria-label={alt} className="mascot-canvas" />
      <span className="mascot-plinth" aria-hidden="true"><i /></span>
      {fallback && <span className="mascot-fallback-label" role="status">Compatibility fallback · not 3D<span>{fallback}</span></span>}
    </div>
  );
}
