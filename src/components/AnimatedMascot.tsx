import { useEffect, useRef } from "react";

interface AnimatedMascotProps {
  src: string;
  alt: string;
  waving: boolean;
  listening: boolean;
  speaking: boolean;
  guiding: boolean;
}

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform float u_wave;
  uniform float u_listen;
  uniform float u_speak;
  uniform float u_guide;

  vec2 rotateAround(vec2 point, vec2 pivot, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 p = point - pivot;
    return pivot + vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  float ellipseMask(vec2 uv, vec2 center, vec2 radius) {
    float d = length((uv - center) / radius);
    return 1.0 - smoothstep(0.72, 1.0, d);
  }

  void main() {
    vec2 uv = v_uv;
    float bodyMask = ellipseMask(uv, vec2(0.56, 0.66), vec2(0.28, 0.37));
    float breath = sin(u_time * (u_guide > 0.5 ? 1.05 : 1.55)) * (u_guide > 0.5 ? 0.010 : 0.0035);
    uv.y += breath * bodyMask;
    uv.x += (uv.x - 0.56) * breath * 0.32 * bodyMask;

    float headMask = ellipseMask(uv, vec2(0.57, 0.33), vec2(0.27, 0.24));
    uv.x += sin(u_time * 1.9) * 0.003 * u_listen * headMask;

    float armMask = ellipseMask(uv, vec2(0.28, 0.46), vec2(0.17, 0.22));
    float waveAngle = (sin(u_time * 4.3) * 0.105 + sin(u_time * 8.6) * 0.022) * u_wave;
    vec2 waved = rotateAround(uv, vec2(0.36, 0.54), -waveAngle);
    uv = mix(uv, waved, armMask);

    float handMask = ellipseMask(uv, vec2(0.275, 0.405), vec2(0.09, 0.105));
    vec2 wrist = rotateAround(uv, vec2(0.31, 0.48), sin(u_time * 6.2) * 0.055 * u_wave);
    uv = mix(uv, wrist, handMask);

    float mouthMask = ellipseMask(uv, vec2(0.574, 0.39), vec2(0.065, 0.045));
    float syllable = (sin(u_time * 14.0) * 0.5 + 0.5) * 0.012 * u_speak;
    uv.y += (uv.y - 0.39) * syllable * 8.0 * mouthMask;
    gl_FragColor = texture2D(u_texture, clamp(uv, 0.001, 0.999));
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
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

export function AnimatedMascot({ src, alt, waving, listening, speaking, guiding }: AnimatedMascotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionRef = useRef({ waving, listening, speaking, guiding });

  useEffect(() => {
    motionRef.current = { waving, listening, speaking, guiding };
  }, [waving, listening, speaking, guiding]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.source = src;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true });
    if (!gl) {
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.dataset.renderer = reduceMotion ? "canvas-2d-static" : "canvas-2d-motion";
      const image = new Image();
      image.decoding = "async";
      let frame = 0;
      let renderedFrames = 0;
      let disposed = false;
      const start = performance.now();
      const renderFallback = (now: number) => {
        if (disposed || !image.complete || image.naturalWidth === 0) return;
        const time = (now - start) / 1000;
        const motion = motionRef.current;
        const breathRate = motion.guiding ? 1.05 : 1.55;
        const breath = Math.sin(time * breathRate) * (motion.guiding ? 0.013 : 0.005);
        const listenTilt = motion.listening ? Math.sin(time * 1.9) * 0.009 : 0;
        const waveTilt = motion.waving ? Math.sin(time * 4.3) * 0.018 : 0;
        const speechPulse = motion.speaking ? Math.sin(time * 14) * 0.004 : 0;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(listenTilt + waveTilt);
        context.scale(1 + breath * 0.28, 1 + breath + speechPulse);
        context.drawImage(image, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        context.restore();
        renderedFrames += 1;
        if (renderedFrames % 15 === 0) canvas.dataset.motionTick = String(renderedFrames);
        if (!reduceMotion) frame = requestAnimationFrame(renderFallback);
      };
      image.onload = () => {
        frame = requestAnimationFrame(renderFallback);
      };
      image.onerror = () => {
        canvas.dataset.renderer = "image-load-error";
      };
      image.src = src;
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
      };
    }
    canvas.dataset.renderer = reduceMotion ? "webgl-static" : "webgl-motion";
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertex || !fragment) {
      canvas.dataset.renderer = "shader-error";
      return;
    }
    const program = gl.createProgram();
    if (!program) {
      canvas.dataset.renderer = "program-error";
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.dataset.renderer = "link-error";
      return;
    }

    const positions = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    const uvs = new Float32Array([0,1, 1,1, 0,0, 0,0, 1,1, 1,0]);
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const image = new Image();
    image.decoding = "async";
    let frame = 0;
    let renderedFrames = 0;
    let disposed = false;
    const start = performance.now();
    const render = (now: number) => {
      if (disposed || !image.complete || image.naturalWidth === 0) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform1f(gl.getUniformLocation(program, "u_time"), (now - start) / 1000);
      const motion = motionRef.current;
      gl.uniform1f(gl.getUniformLocation(program, "u_wave"), motion.waving ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "u_listen"), motion.listening ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "u_speak"), motion.speaking ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "u_guide"), motion.guiding ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      renderedFrames += 1;
      if (renderedFrames % 15 === 0) canvas.dataset.motionTick = String(renderedFrames);
      if (!reduceMotion) frame = requestAnimationFrame(render);
    };
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      frame = requestAnimationFrame(render);
    };
    image.onerror = () => {
      canvas.dataset.renderer = "image-load-error";
    };
    image.src = src;

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      gl.deleteTexture(texture);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(uvBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [src]);

  return <canvas ref={canvasRef} width={512} height={512} role="img" aria-label={alt} className="mascot-canvas" />;
}
