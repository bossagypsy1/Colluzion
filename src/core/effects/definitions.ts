// Effect definitions: parameter specs and GLSL. Effects know nothing about audio;
// routing (core/routing) decides what drives each parameter.

export interface ParamSpec {
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface EffectDefinition {
  type: string;
  label: string;
  params: Record<string, ParamSpec>;
  /**
   * GLSL ES 3.00 fragment shader. Contract with the renderer:
   *   in vec2 v_uv;            output UV, 0..1, origin bottom-left
   *   uniform sampler2D u_src; source image
   *   uniform vec2 u_uvScale;  cover-fit scale applied around the centre
   *   uniform float u_time;    absolute media time in seconds (never wall-clock)
   *   uniform float p_<name>;  one float uniform per parameter
   *   out vec4 outColor;
   */
  fragment: string;
}

const PULSE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_uvScale;
uniform float u_time;
uniform float p_zoom;
uniform float p_displaceX;
uniform float p_displaceY;
uniform float p_rows;
out vec4 outColor;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  vec2 p = v_uv - 0.5;
  p /= (1.0 + p_zoom);
  // Row/column glitch displacement; the pattern steps 12 times per media second.
  float step = floor(u_time * 12.0);
  float row = floor((p.y + 0.5) * p_rows);
  float col = floor((p.x + 0.5) * p_rows);
  p.x += (hash(row + step * 31.0) - 0.5) * 2.0 * p_displaceX;
  p.y += (hash(col + step * 17.0 + 101.0) - 0.5) * 2.0 * p_displaceY;
  vec2 uv = p * u_uvScale + 0.5;
  outColor = vec4(texture(u_src, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}
`;

export const EFFECT_DEFINITIONS: Record<string, EffectDefinition> = {
  pulse: {
    type: 'pulse',
    label: 'Zoom pulse + displacement',
    params: {
      zoom: { label: 'Zoom', min: 0, max: 1, default: 0 },
      displaceX: { label: 'Horizontal displacement', min: 0, max: 0.5, default: 0 },
      displaceY: { label: 'Vertical displacement', min: 0, max: 0.5, default: 0 },
      rows: { label: 'Displacement bands', min: 2, max: 200, default: 40 },
    },
    fragment: PULSE_FRAGMENT,
  },
};
