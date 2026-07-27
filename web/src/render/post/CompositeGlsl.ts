// The one pass that turns scene-referred radiance into display bytes: bloom
// mix, exposure, ACES, colour grade, vignette, sRGB encode.
//
// THE TONE CURVE IS THREE'S OWN, COPIED EXACTLY. Renderer.ts has set
// ACESFilmicToneMapping since W0, and three applies it per material only when
// the destination is the default framebuffer; rendering the scene into an
// offscreen target silently switches it off. If the composite used a different
// curve, every A/B in this lane would be measuring "a new tonemapper" and
// attributing it to ambient occlusion. So the curve below is the ACES RRT+ODT
// fit out of three's tonemapping_pars_fragment, matrices and all, and with
// bloom, AO and grade all off the composite is intended to be a no-op against
// the pre-existing pipeline. That is an assertion the probe makes, not a hope.
//
// THE GRADE IS A UNIFORM MIX, NOT A #define. `uGradeMix` at 0.0 leaves the
// tonemapped colour bit-for-bit alone, so `?grade=0` is provably neutral and
// can be toggled inside a single settled frame pair. It costs about twenty ALU
// ops that are paid whether or not the grade is on; that is a deliberate trade
// of a cost below the timer floor for an isolation that is exact.

export const COMPOSITE_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uGradeMix;
uniform float uContrast;
uniform float uSaturation;
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uLift;
uniform float uVignette;
uniform float uVignetteSoft;

const mat3 ACESInputMat = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);
const mat3 ACESOutputMat = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602
);

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 acesFilmic(vec3 color) {
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

vec3 srgbEncode(vec3 v) {
  return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92,
             vec3(lessThanEqual(v, vec3(0.0031308))));
}

/**
 * THE GRADE RUNS IN DISPLAY SPACE, AFTER THE sRGB ENCODE, AND THAT IS A BUG FIX
 * RATHER THAN A PREFERENCE.
 *
 * The first version applied a contrast of 1.06 about a pivot of 0.4135 to the
 * ACES output, which is still scene-linear-ish: mid-grey there is about 0.18,
 * not 0.41. So every value below the pivot was pushed DOWN, and the further
 * below, the harder. Measured on the sky at a fixed camera, one settled frame
 * pair, red channel 37.9 -> 7.9 of 255. It did not read as "more contrast", it
 * read as the shadows falling out of the image, and it was invisible in the
 * whole-frame mean because the crush is confined to the dark end.
 *
 * After the encode, mid-grey really is about 0.5, the pivot means what it says,
 * and a contrast of 1.06 moves the darks by a few counts instead of thirty.
 */
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = (c - 0.5) * uContrast + 0.5;
  // Shadow lift with a toe, so blacks open up without turning grey everywhere.
  c += uLift * (1.0 - smoothstep(0.0, 0.55, l));
  // Split tone: the desert biome reads warm in the light and cool in shade, and
  // grading TOWARD that is the point rather than inventing a new palette.
  // Crossover at 0.12 to 0.55, not 0.25 to 0.80. DW-35 says grade TOWARD the
  // desert look Reid already likes, and sunlit ground in that biome sits near
  // luma 0.55: with the wider crossover it landed halfway between the tints and
  // came out cooler than the ungraded frame, which is grading away from the
  // target. "Shadow" here means the dark quartile, not the lower half.
  c *= mix(uShadowTint, uHighlightTint, smoothstep(0.12, 0.55, l));
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l2), c, uSaturation);
  return clamp(c, 0.0, 1.0);
}

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb;
  hdr += texture2D(tBloom, vUv).rgb * uBloomStrength;
  vec3 c = srgbEncode(acesFilmic(hdr));
  c = mix(c, grade(c), uGradeMix);
  // Vignette last, in the same display space as the grade, where a fixed
  // strength means the same thing at every exposure.
  float r = length(vUv - 0.5) * 1.41421356;
  c *= 1.0 - uVignette * smoothstep(uVignetteSoft, 1.0, r);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
