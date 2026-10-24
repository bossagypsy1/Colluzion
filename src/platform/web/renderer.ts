// WebGL2 renderer. Draws a source image through the active effect's shader.
// Phase 1 runs one effect pass straight to the canvas; Phase 3 adds a
// ping-pong framebuffer chain for multiple effects in order.

import { EFFECT_DEFINITIONS } from '../../core/effects/definitions.ts';
import type { FrameState } from '../../core/render/frameState.ts';

const VERTEX = `#version 300 es
out vec2 v_uv;
void main() {
  // Full-screen triangle from gl_VertexID; no vertex buffers needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PASSTHROUGH = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_uvScale;
out vec4 outColor;
void main() { outColor = vec4(texture(u_src, (v_uv - 0.5) * u_uvScale + 0.5).rgb, 1.0); }
`;

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

export interface SourceImage {
  image: TexImageSource;
  width: number;
  height: number;
}

export class GlRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private texture: WebGLTexture;
  private programs = new Map<string, Program>();
  private hasSource = false;
  private srcW = 1;
  private srcH = 1;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Could not create a WebGL texture.');
    this.texture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.programs.set('__passthrough', this.compile(PASSTHROUGH));
    for (const def of Object.values(EFFECT_DEFINITIONS)) this.programs.set(def.type, this.compile(def.fragment));
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** Uploads a new source frame. Video elements, canvases and VideoFrames upload GPU-side in Chrome. */
  setSource(src: SourceImage): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.image);
    this.srcW = src.width;
    this.srcH = src.height;
    this.hasSource = true;
  }

  render(frame: FrameState): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.hasSource) return;

    // Cover-fit: scale UVs so the source fills the output without distortion.
    const srcAspect = this.srcW / this.srcH;
    const dstAspect = w / h;
    const uvScale: [number, number] = srcAspect > dstAspect ? [dstAspect / srcAspect, 1] : [1, srcAspect / dstAspect];

    const fx = frame.effects[0];
    const prog = (fx && this.programs.get(fx.type)) || this.programs.get('__passthrough')!;
    gl.useProgram(prog.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this.uniform1i(prog, 'u_src', 0);
    const loc = prog.uniforms.get('u_uvScale');
    if (loc) gl.uniform2f(loc, uvScale[0], uvScale[1]);
    this.uniform1f(prog, 'u_time', frame.musicTime);
    if (fx) for (const [name, value] of Object.entries(fx.params)) this.uniform1f(prog, `p_${name}`, value);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
    gl.deleteTexture(this.texture);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private uniform1f(p: Program, name: string, v: number): void {
    const loc = p.uniforms.get(name);
    if (loc) this.gl.uniform1f(loc, v);
  }

  private uniform1i(p: Program, name: string, v: number): void {
    const loc = p.uniforms.get(name);
    if (loc) this.gl.uniform1i(loc, v);
  }

  private compile(fragment: string): Program {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s) ?? 'unknown error'}`);
      }
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program) ?? 'unknown error'}`);
    }
    const uniforms = new Map<string, WebGLUniformLocation>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      const loc = info && gl.getUniformLocation(program, info.name);
      if (info && loc) uniforms.set(info.name, loc);
    }
    return { program, uniforms };
  }
}
