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
uniform float uCurveMix;
uniform float uSaturation;
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uLift;
uniform float uVignette;
uniform float uVignetteSoft;
// RN-2130 (fidelity lane A1). See ToneDrive.ts for what drives these three and
// for the palette decision they implement.
uniform float uShoulder;
uniform float uShoulderKnee;
uniform float uGreenPull;
uniform vec3  uGreenAxis;

const vec3 OF_LUMA = vec3(0.2126, 0.7152, 0.0722);

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
/**
 * THE CONTRAST TERM HAS TWO SHAPES AND uCurveMix IS THE ONLY THING BETWEEN
 * THEM, DELIBERATELY SLOPE-MATCHED AT THE PIVOT (RN-207).
 *
 * The RN-10 shape is a straight line through 0.5: (c - 0.5) * uContrast + 0.5,
 * followed by the clamp at the end of this function. That clamp is the problem
 * and it is not a rounding detail. At uContrast 1.06 every display value above
 * 0.972 lands on white and everything below 0.028 lands on black, so the top
 * and bottom of the range stop carrying information at all: two sunlit facets a
 * quarter stop apart are the same byte. Raising the contrast to do the work
 * ART-DIRECTION.md asks of value makes that worse in exact proportion, so under
 * the straight line "more contrast" and "less detail at the ends" are the same
 * knob and there is no setting that gets one without the other.
 *
 * The S shape is c + k*(c - 0.5)*(1 - |2c - 1|) with k = uContrast - 1. The
 * bracket is 1 at the pivot and falls linearly to 0 at both ends, so:
 *   - at c = 0.5 the added term is zero and the curve passes through the pivot,
 *   - the DERIVATIVE at the pivot is exactly 1 + k = uContrast, i.e. identical
 *     to the straight line's,
 *   - at c = 0 and c = 1 the added term is zero, so the ends are FIXED POINTS
 *     and nothing is pushed out of range for the clamp to catch.
 *
 * The slope match is what makes uCurveMix an isolation rather than a second
 * contrast knob: at one uContrast the two shapes agree on the mid tones to
 * first order and differ ONLY in what happens at the toe and the shoulder. So a
 * matched pair across uCurveMix answers exactly one question, which is whether
 * rolling the ends is worth having, and the contrast level stays a separate
 * measurement with its own pair.
 *
 * uCurveMix = 0.0 restores the RN-10 expression to the character, which is
 * why the negative control for this whole pass is a uniform write and not a
 * build: setPostTune({ curveMix: 0, contrast: 1.06, ... }) is the shipped
 * image BIT-EXACTLY, assertable with of.framehash().hash.
 */
/**
 * RN-2130. THE HIGHLIGHT SHOULDER, and it is part of the TONE RESPONSE rather
 * than part of the grade, which is why it runs before grade() and outside
 * uGradeMix: a ?grade=0 frame must still get a competent curve.
 *
 * NOTE FOR THE NEXT EDITOR: this comment is INSIDE a template literal, so a
 * backtick anywhere in it terminates the shader source. That is not a style
 * rule, it is a syntax error four functions later, and it cost this lane a
 * typecheck round trip. Quote identifiers plainly here.
 *
 * ACES already has a shoulder in scene-linear, and it is not enough here. The
 * measurement is in ToneDrive.ts: at a 5.85 degree sun EVERY pixel of the far
 * ridge lands above display 200 (hiFrac 1.000) while the ground at the player's
 * feet sits at 33. That is not a curve that is missing a knee, it is a fixed
 * exposure trying to serve two hours of the day; the exposure drive answers the
 * foreground and this answers the distance.
 *
 * THE TERM IS EXACTLY ZERO BELOW THE KNEE AND HAS ZERO DERIVATIVE AT IT.
 * comp is the distance from the knee to white, normalised, and it is SQUARED,
 * so both the value and the slope of the correction vanish at l == knee. No
 * mid tone can move under any uShoulder, which is what separates this from a
 * contrast knob: it can only take from the top.
 */
vec3 shoulder(vec3 c) {
  float l = dot(c, OF_LUMA);
  float comp = clamp((l - uShoulderKnee) / max(1e-4, 1.0 - uShoulderKnee), 0.0, 1.0);
  return c - uShoulder * comp * comp * (c - vec3(uShoulderKnee));
}

vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 straight = (c - 0.5) * uContrast + 0.5;
  vec3 rolled = c + (uContrast - 1.0) * (c - 0.5) * (1.0 - abs(2.0 * c - 1.0));
  c = mix(straight, rolled, uCurveMix);
  // Shadow lift with a toe, so blacks open up without turning grey everywhere.
  // Negative values CRUSH instead, which is the direction ART-DIRECTION.md asks
  // for, and the term keeps its shape either way.
  c += uLift * (1.0 - smoothstep(0.0, 0.55, l));
  // RN-2130. GREEN HARMONISATION, and it is the palette decision's first half.
  //
  // gx SELECTS THE VEGETATION HUE FAMILY, which is the yellow-green through
  // green arc, and NOT just saturated green. The first version of this term
  // used the green channel's lead over the larger of the other two, and the
  // meadow frame says why that was the wrong selector: the substrate reads
  // rgb [63, 67, 36], i.e. red and green within four counts of each other, so
  // its "green lead" is 0.015 and it was left completely untouched while the
  // saturated blades on top of it moved. Harmonising the blades and not the
  // field they stand in is the disagreement, not the fix.
  //
  // Two factors, and each blocks a specific false positive:
  //   BLUE STARVATION (min(r,g) - b) is what every plant in the frame has and
  //     rock, sky, snow and metal do not. It catches khaki as readily as lime.
  //   RED DOMINANCE VETO (g - r) rides a shifted clamp so it is 1 wherever
  //     green is at or above red and falls to 0 by the time red leads by a
  //     quarter. Without it the orange axe handle in the bottom of every
  //     first-person frame is blue-starved too, and it would go sage.
  //
  // The axis is normalised to THIS PIXEL'S OWN LUMINANCE before the mix, so the
  // term moves hue and never value. Without that division a pull toward a fixed
  // colour is a pull toward a fixed brightness, every blade lands on the same
  // number and the meadow flattens into a paint chip, which is the exact
  // failure a harmonisation is supposed to prevent.
  float gx = clamp((min(c.r, c.g) - c.b) * 4.0, 0.0, 1.0)
           * clamp((c.g - c.r) * 4.0 + 1.0, 0.0, 1.0);
  float lg = dot(c, OF_LUMA);
  vec3 axis = uGreenAxis * (lg / max(dot(uGreenAxis, OF_LUMA), 1e-4));
  c = mix(c, axis, uGreenPull * gx);
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
  // The shoulder is OUTSIDE the grade mix on purpose: it is the tone response,
  // not the look, so ?grade=0 isolates the palette and still gets the curve.
  vec3 c = shoulder(srgbEncode(acesFilmic(hdr)));
  c = mix(c, grade(c), uGradeMix);
  // Vignette last, in the same display space as the grade, where a fixed
  // strength means the same thing at every exposure.
  float r = length(vUv - 0.5) * 1.41421356;
  c *= 1.0 - uVignette * smoothstep(uVignetteSoft, 1.0, r);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
