// Bloom as a progressive downsample / upsample pyramid (the COD:AW filter), not
// as a bright-pass plus five separable gaussians.
//
// The reason is stability rather than speed, and it is the difference between
// bloom that reads as light and bloom that reads as amateur. A gaussian chain
// over a thresholded buffer FLICKERS: one sub-pixel highlight crossing a texel
// boundary flips in and out of the threshold and the whole halo pulses. The
// 13-tap downsample with a Karis average on the first level weights each tap by
// 1/(1+luma), so a single blown-out texel contributes a bounded amount and the
// pyramid is temporally stable with no temporal filtering at all. This project
// asserts that a settled frame equals the previous one, so that is not a
// nicety.
//
// The threshold is a SOFT KNEE and it is low (1.0 with a 0.55 knee against an
// ACES curve that maps 1.0 to about 0.8 display). Restraint is the entire
// difference between "the sun and the plume glow" and "everything is hazy".

export const BLOOM_DOWN_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 tap(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  #ifdef OF_BLOOM_FIRST
    // Soft-knee threshold, then the Karis weight. Both on the first level only:
    // after that the pyramid is already band-limited and re-weighting would
    // just darken it.
    float l = luma(c);
    float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-5);
    float w = max(soft, l - uThreshold) / max(l, 1e-5);
    c *= clamp(w, 0.0, 1.0);
    c /= (1.0 + luma(c));
  #endif
  return c;
}

void main() {
  vec2 t = uTexel;
  vec3 a = tap(vUv + vec2(-2.0, 2.0) * t);
  vec3 b = tap(vUv + vec2( 0.0, 2.0) * t);
  vec3 c = tap(vUv + vec2( 2.0, 2.0) * t);
  vec3 d = tap(vUv + vec2(-2.0, 0.0) * t);
  vec3 e = tap(vUv);
  vec3 f = tap(vUv + vec2( 2.0, 0.0) * t);
  vec3 g = tap(vUv + vec2(-2.0,-2.0) * t);
  vec3 h = tap(vUv + vec2( 0.0,-2.0) * t);
  vec3 i = tap(vUv + vec2( 2.0,-2.0) * t);
  vec3 j = tap(vUv + vec2(-1.0, 1.0) * t);
  vec3 k = tap(vUv + vec2( 1.0, 1.0) * t);
  vec3 l = tap(vUv + vec2(-1.0,-1.0) * t);
  vec3 m = tap(vUv + vec2( 1.0,-1.0) * t);
  vec3 o = e * 0.125;
  o += (a + c + g + i) * 0.03125;
  o += (b + d + f + h) * 0.0625;
  o += (j + k + l + m) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;

/** 3x3 tent, ADDED into the next-larger level. */
export const BLOOM_UP_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uScatter;

void main() {
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * t).rgb * 1.0;
  s += texture2D(tSrc, vUv + vec2( 0.0, 1.0) * t).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( 1.0, 1.0) * t).rgb * 1.0;
  s += texture2D(tSrc, vUv + vec2(-1.0, 0.0) * t).rgb * 2.0;
  s += texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2( 1.0, 0.0) * t).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-1.0,-1.0) * t).rgb * 1.0;
  s += texture2D(tSrc, vUv + vec2( 0.0,-1.0) * t).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( 1.0,-1.0) * t).rgb * 1.0;
  gl_FragColor = vec4(s * (uScatter / 16.0), 1.0);
}
`;
