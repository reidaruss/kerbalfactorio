// RN-2130 to RN-2144, FIDELITY LANE A1. THE IMAGE'S ART DIRECTION, in one file,
// driven by ONE input: where the sun is.
//
// WHY THIS EXISTS AT ALL. Until this lane the composite ran ACES at a FIXED
// exposure of 1.2 with a split tone graded "toward the desert biome", and the
// numbers say what that costs at the two ends of the day arc. One pose, one
// camera, `vista` against `vistadawn` on the build this file was written
// against:
//
//     rectangle          noon-ish (44.3 deg)     dawn (5.85 deg)
//     far ridge hzBand   198.86, hiFrac 0.001    231.51, hiFrac 1.000
//     near ground nearG  134.14                   33.01
//     far / near ratio   1.48                     7.01
//
// At dawn EVERY PIXEL of the far ridge is above luma 200 and the ground at the
// player's feet is at 33. A fixed exposure cannot express both halves of a day,
// so it expresses neither: the frame inverts, the distance becomes a milk wall
// and the foreground falls out of the image. That is difference 4 of
// `docs/web/FIDELITY-GAP-2026-08-19.md` section 1, and it is what this file is
// for.
//
// ==========================================================================
// THE PALETTE DECISION, stated as an art director would state it
// ==========================================================================
//
//   "ONE MEADOW, LIT AT TWO TEMPERATURES."
//
//   Warm dry-straw light on everything the sun touches. Cool blue-green in
//   everything it does not, because the only other lamp in the scene is the
//   sky and the sky is blue. Nothing in a daylight frame is allowed to be
//   NEUTRAL dark: an unlit surface is sky-lit, not unlit.
//
//   Greens are pulled onto a single sage-olive axis. Foliage in this world
//   arrives from three unrelated authorities (the biome palette, the scatter
//   albedos and the understorey cards) and they do not agree on a hue, which
//   is why the meadow reads as lime blades scattered over forest-green clumps
//   over an olive substrate: three materials, not one field. Harmonising the
//   hue while PRESERVING each pixel's luminance is what turns them back into
//   one material lit many ways.
//
//   The sky keeps its blue and gives up its top two stops. A landscape whose
//   sky is three and a half times the luminance of its ground is a photograph
//   of a sky with some ground under it; the shoulder below is how the ground
//   gets the frame back.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. There is no depth-aware distance
// grading here, and "gentle blue distance" is therefore NOT closed by this
// lane. The reason is structural rather than a preference: `PostStack` runs the
// composite AFTER the view-model pass, so the depth attachment at that moment
// holds the player's forearms and not the world (PostStack's own header says
// so). A distance grade needs the world's depth and would have to be a fifth
// pass or move the composite, both of which are out of A1's scope. Distance
// colour belongs to the haze lane (L1) and the sky lane (A4), which own the
// term that actually produces it.
//
// EVERY CONSTANT BELOW IS AN AUTHORED ENDPOINT, and every one of them has a
// control (standing rule 7): `?tone=0` restores the pre-A1 image (fixed
// exposure 1.2, no shoulder, no warmth, no green pull) without a rebuild, and
// `?shoulder=`, `?greenpull=`, `?occtint=0` sweep or remove the three new
// terms one at a time.

import type { PostTuning } from './PostConfig.js';

function num(p: URLSearchParams, key: string, fallback: number): number {
  const v = p.get(key);
  if (v === null) return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

const Q = new URLSearchParams(self.location.search);

/** `?tone=0`: the whole of this file becomes a no-op and the image is pre-A1. */
const TONE_ON = Q.get('tone') !== '0';
/** `?occtint=0`: occlusion goes back to a neutral grey multiply. */
const OCC_TINT_ON = Q.get('occtint') !== '0';

// --------------------------------------------------------------------------
// EXPOSURE, keyed to sun elevation.
//
// NOON IS 1.20 EXACTLY, which is RN-208's calibrated value and is not a
// coincidence: that number was chosen as the largest exposure at which the
// shadow occupancy does not move, measured at three sites, and throwing it away
// would be throwing away the one exposure in this project that was measured
// rather than picked. So the high-sun end of the arc is UNCHANGED by this lane
// and only the half that was never calibrated moves.
//
// DAWN IS 1.70 AND IT IS A PARTIAL ADAPTATION, not a full one. At 5.85 degrees
// the ground's direct term has lost most of its irradiance to `ndl` and to the
// sun's own transmittance while the haze in front of the far ridge has GAINED,
// so an eye standing in that meadow would stop down for the sky and open up for
// the ground and can do neither. 1.70 is about half a stop: enough to pull
// `nearG` off the floor, not enough to pretend the hour is noon. The other half
// of the correction is the shoulder, which takes the distance DOWN rather than
// taking the foreground further up, and the two together are what un-invert the
// frame without flattening it.
//
// NIGHT COMES BACK DOWN to 1.15. Without this the dawn lift keeps running past
// the terminator and a moonless night, whose whole ambient is the RN-152
// starlight floor, gets brightened into a dim grey day.
const EXPOSURE_NIGHT = 1.15;
const EXPOSURE_LOWSUN = 1.70;
const EXPOSURE_NOON = 1.20;

// --------------------------------------------------------------------------
// THE HIGHLIGHT SHOULDER, in display space, above a knee.
//
// It is a fraction of the distance from the knee to white, applied with a
// squared weight so it is EXACTLY zero at the knee and has zero derivative
// there: nothing in the mid tones can move, by construction, which is what
// makes this a shoulder and not a contrast knob wearing one.
//
// 0.20 at noon and 0.46 at a low sun. The noon value is small on purpose: at
// 44 degrees the far ridge is at 198.86 with hiFrac 0.001, i.e. bright but not
// clipped, and it wants restraint rather than rescue. At 5.85 degrees the same
// ridge is at 231.51 with hiFrac 1.000 -- every pixel of it above 200 -- and
// that is the milk wall the audit named.
// RETUNED ONCE, BY EYE, AFTER THE FIRST AFTER-FRAME. 0.22 / 0.46 at a knee of
// 0.58 moved the meadow's far ridge from 217.86 to 214.59 and left hiFrac at
// 0.993: every pixel of the band still above 200, i.e. the milk wall survived
// intact and the term was decorative. These values (and a knee at 0.52, which
// is just above display mid-grey rather than well above it) are what actually
// buy the distance back. The knee is still comfortably above every lit-grass
// value in the frame, so the meadow itself is untouched by the shoulder.
const SHOULDER_NOON = 0.50;
const SHOULDER_LOWSUN = 0.72;
/** Display value at which the shoulder starts. Above mid-grey by design. */
const SHOULDER_KNEE = 0.52;

// --------------------------------------------------------------------------
// DAWN WARMTH. A per-channel tint blended in by the low-sun weight.
//
// The audit measured the sky's own `warm` moving 14.83 counts over 61 degrees
// of sun elevation and staying at -86, i.e. deeply blue at every hour: the
// scattering integral resolves the sun's DIRECTION (1.84x sun-side brightening)
// and never its COLOUR. Fixing that inside the integral is the sky lane's job
// (audit gap 8, class (a)); this is the grade doing what a grade is for while
// the model catches up, and it is labelled as a grade rather than smuggled in
// as physics.
const WARM_LOWSUN: readonly [number, number, number] = [1.090, 0.998, 0.888];

// --------------------------------------------------------------------------
// GREEN HARMONISATION. The sage-olive axis every green in the frame is pulled
// toward, at its own luminance.
//
// Chosen against the meadow frame rather than derived: the substrate reads
// rgb [51.5, 53.1, 27.8] (yellow-olive, blue starved to 28) while the lit
// blades read lime and the tufts read a much bluer forest green. This axis sits
// between them with the blue channel lifted off the floor, which is what stops
// the harmonised field reading as a colour-key rather than as grass.
// THE BLUE COMPONENT IS THE POINT OF THIS AXIS. A sage that is blue-starved is
// just a different khaki and pulling one khaki toward another buys nothing: the
// first version of this constant read [0.360, 0.470, 0.245], whose blue-to-
// green ratio (0.52) is almost exactly the substrate's own (0.53), so the pull
// moved the field's hue by nothing at all. 0.300 against 0.455 is 0.66, which
// is the ratio a sky-lit grassland actually has, and it is what puts air into
// the ground colour.
const GREEN_AXIS: readonly [number, number, number] = [0.335, 0.455, 0.300];
const GREEN_PULL = 0.50;

// --------------------------------------------------------------------------
// COLOURED OCCLUSION. Per-channel WEIGHTS on the AO multiply, not a colour.
//
// `AO_APPLY_FS` is a multiply blend, so the only way occlusion can carry colour
// is for the three channels to be occluded by different amounts. Occluded light
// is sky light, the sky is blue, so red is removed hardest and blue is barely
// removed at all: an occluded pixel loses its warmth before it loses its
// brightness and the blob under a tuft goes blue-green instead of going black.
//
// At a low sun the sky is a smaller share of what is being occluded and the
// ground bounce is a larger one, so the weights flatten toward neutral and warm
// slightly. This is the same reasoning as the ambient fill in TerrainAmbient.ts
// and the two are driven from the same elevation on purpose.
const OCC_TINT_DAY: readonly [number, number, number] = [1.00, 0.86, 0.62];
const OCC_TINT_LOWSUN: readonly [number, number, number] = [1.00, 0.94, 0.86];

/**
 * The elevation weights every term above is keyed on, and the ONE place they
 * are computed, so the composite, the AO tint and the terrain ambient fill
 * cannot disagree about what hour it is.
 *
 * `dayK` is 0 at and below a 3.4 degree sun and 1 above 24.8 degrees.
 * `nightK` is 0 below -5.7 degrees and 1 above 1.1 degrees.
 */
function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface ToneState {
  /** `dot(sunDir, localUp)`, the same number the sky and the ambient read. */
  elevationDot: number;
  /** Scene-linear gain handed to the ACES fit. */
  exposure: number;
  /** Highlight compression above the knee, 0 to 1. */
  shoulder: number;
  /** How much of `WARM_LOWSUN` is mixed in, 0 at a high sun. */
  warm: number;
  /** Per-channel AO strength weights. Grey when `?occtint=0`. */
  occTint: [number, number, number];
}

export const TONE: ToneState = {
  elevationDot: 0.5, exposure: EXPOSURE_NOON, shoulder: SHOULDER_NOON,
  warm: 0, occTint: [1, 1, 1],
};

/**
 * Drive the whole image from the sun's elevation. Called once per frame by
 * `Systems`, beside `terrainNightAmbient`, which reads the same number for the
 * same reason. Idempotent by construction: every field is assigned, never
 * accumulated.
 */
export function updateToneDrive(elevationDot: number): ToneState {
  TONE.elevationDot = elevationDot;
  if (!TONE_ON) {
    TONE.exposure = EXPOSURE_NOON;
    TONE.shoulder = 0;
    TONE.warm = 0;
    TONE.occTint = [1, 1, 1];
    return TONE;
  }
  const dayK = smooth(elevationDot, 0.06, 0.42);
  const nightK = smooth(elevationDot, -0.10, 0.02);
  const low = nightK * (1 - dayK);
  TONE.exposure = EXPOSURE_NIGHT
    + (EXPOSURE_LOWSUN - EXPOSURE_NIGHT) * nightK
    + (EXPOSURE_NOON - EXPOSURE_LOWSUN) * dayK * nightK;
  TONE.shoulder = SHOULDER_NOON + (SHOULDER_LOWSUN - SHOULDER_NOON) * low;
  TONE.warm = low;
  const t: [number, number, number] = [1, 1, 1];
  for (let i = 0; i < 3; ++i) {
    t[i] = OCC_TINT_ON
      ? OCC_TINT_DAY[i] + (OCC_TINT_LOWSUN[i] - OCC_TINT_DAY[i]) * low
      : 1;
  }
  TONE.occTint = t;
  return TONE;
}

/** `?shoulder=` and `?greenpull=`, read once. Sweeps without a rebuild. */
const SHOULDER_AMP = num(Q, 'shoulderamp', 1);
const GREEN_PULL_Q = TONE_ON ? num(Q, 'greenpull', GREEN_PULL) : 0;

/**
 * Write every tone and grade uniform the composite owns. Lives here rather than
 * in `PostStack.finish()` so the art direction is in the file that states it,
 * and because `PostStack.ts` is four lines under the 400-line cap.
 */
export function writeToneUniforms(
  u: Record<string, { value: unknown }>, tune: PostTuning, grade: boolean,
): void {
  u.uExposure.value = TONE_ON ? TONE.exposure : tune.exposure;
  u.uShoulder.value = TONE.shoulder * SHOULDER_AMP;
  u.uShoulderKnee.value = SHOULDER_KNEE;
  u.uGradeMix.value = grade ? 1 : 0;
  u.uContrast.value = tune.contrast;
  u.uCurveMix.value = tune.curveMix;
  u.uSaturation.value = tune.saturation;
  u.uLift.value = tune.lift;
  u.uVignette.value = grade ? tune.vignette : 0;
  u.uVignetteSoft.value = tune.vignetteSoft;
  u.uGreenPull.value = GREEN_PULL_Q;
  const st = u.uShadowTint.value as { set(x: number, y: number, z: number): void };
  const hl = u.uHighlightTint.value as { set(x: number, y: number, z: number): void };
  const gx = u.uGreenAxis.value as { set(x: number, y: number, z: number): void };
  st.set(...tune.shadowTint);
  // The warm tint rides the HIGHLIGHT side only. Warming the shade as well
  // would cancel the split tone the palette is built on, which is the whole
  // "two temperatures" half of the decision above.
  hl.set(
    tune.highlightTint[0] * (1 + (WARM_LOWSUN[0] - 1) * TONE.warm),
    tune.highlightTint[1] * (1 + (WARM_LOWSUN[1] - 1) * TONE.warm),
    tune.highlightTint[2] * (1 + (WARM_LOWSUN[2] - 1) * TONE.warm),
  );
  gx.set(...GREEN_AXIS);
}

(window as unknown as { __ofTone: unknown }).__ofTone = {
  report: (): ToneState & { toneOn: boolean; greenPull: number } => ({
    ...TONE, toneOn: TONE_ON, greenPull: GREEN_PULL_Q,
  }),
};
