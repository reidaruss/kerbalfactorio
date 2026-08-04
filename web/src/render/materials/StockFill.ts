// RN-1251: THE AMBIENT FLOOR THE STOCK MATERIALS NEVER HAD.
//
// `TerrainAmbient.ts` opens with "THE surface lighting constants, in one file
// because two materials now need the same three numbers and a transcribed copy
// is a second authority". There is a third consumer and it has been holding a
// DIFFERENT set of numbers since W4: every stock `MeshStandardMaterial` in the
// near scene (the machines, the structures, the launch pad, the belt cargo, the
// station, the rocks, the props, the player's own body) is floored by ONE
// `THREE.HemisphereLight`, and its two colours are hex literals written before
// any of the terrain's ambient work existed.
//
// WHAT THE TWO SETS OF NUMBERS ACTUALLY ARE, side by side, in linear RGB:
//
//   terrain floor `AMBIENT_DAY`                  0.03000  0.03400  0.04500
//   near hemisphere, SKY half    0x334466 x 0.35  0.01159  0.02023  0.04650
//   near hemisphere, GROUND half 0x101008 x 0.35  0.00181  0.00181  0.00085
//
// (Read off the running client, not converted by hand: `?stockfloor=legacy`
// publishes the two legacy colours through `stockFillState`, and the pre-scale
// triples it prints are 0.03310/0.05781/0.13287 and 0.00518/0.00518/0.00243.)
//
// Three separate things are wrong with the bottom row and only the third is
// obvious.
//
// (1) IT IS ORIENTED WHERE THE TERRAIN'S IS DELIBERATELY NOT. A hemisphere
// light delivers `mix(ground, sky, 0.5 + 0.5*dot(n, up))`, so a face turned
// sideways gets the mean of the two and a face turned down gets the ground
// half alone. `uAmbient` has no weight on it at all: RN-1017 named that as the
// one term in the terrain expression carrying no weight, and its job is
// explicitly "what stops a fully shadowed slope reading as a hole". A floor
// that falls away exactly where the surface is darkest is not a floor.
//
// (2) THE GROUND HALF IS 16.6x, 18.8x AND 52.9x SMALLER, per channel. It is not a
// dim ground bounce, it is zero with a rounding error. The real bounce reaches
// stock materials through RN-64's IBL ground shell and this lane measured it
// doing so (RN-1250), so this literal is not standing in for anything: it is
// the floor UNDER the bounce, and it is absent.
//
// (3) IT DOES NOT MOVE AT NIGHT. `terrainNightAmbient` writes the starlight
// floor into the shared `TERRAIN_AMBIENT` object every frame, which is how the
// terrain and RN-64's ground shell both get a navigable night for free. Nothing
// writes these two literals, so on an airless night the ground beside a machine
// is floored at 0.085/0.099/0.140 and the machine is floored at
// 0.00181/0.00181/0.00085, a factor of 47, 55 and 165. A player's own factory
// is floored darker than the dirt it stands on, by two orders of magnitude.
//
// WHAT THIS FILE DOES, AND WHAT IT DELIBERATELY DOES NOT. It publishes the
// open-sky endpoint of that hemisphere as `TERRAIN_AMBIENT` itself, held BY
// REFERENCE exactly as TerrainAmbient's own header argues for, with the same
// colour top and bottom so the floor is unweighted like the terrain's. It does
// NOT touch the sky ambient, the bounce, the sun or the environment intensity:
// those are separate terms with separate owners, the bounce is measured to be
// working, and a pass that moves four things has measured none of them.
//
// IT IS A FILL AND ITS SIGNATURE IS A SHAPE. On the sky half the change is
// +159% red, +68% green and -3% blue, i.e. near neutral where a surface is
// already turned up into the light. On the ground half it is 16.6x to 52.9x.
// So the prediction, written before measuring per INSTRUMENTS.md: the middle
// of a machine's camera-facing box lifts by more, PROPORTIONALLY, than its
// bright tail does, and it only ever lifts. A term that moved the whole
// distribution by one ratio would be a brightness knob and would have failed
// its own test.
//
// AND THE MEASURED SIZE, RECORDED HERE RATHER THAN ONLY IN THE LEDGER, because
// a constant whose measured effect is not beside it is a constant somebody
// later mistakes for a look knob. Game-lit, sun dot 0.45, close-up machine box
// of 268,550 px: mean 9.033 -> 9.220, p50 6.66 -> 6.83 (+2.6%), p75 13.79 ->
// 14.42 (+4.6%), p99 50.96 -> 51.38 (+0.8%). The shape is right and the size is
// SMALL. At night, headlamp off, the same box moves 25,705 pixels lighter
// against 262 darker. **This is a floor being put where a floor belongs, not a
// fix for how dark the machines look.** RN-1252 is why, and it is not light.

import * as THREE from 'three';
import { TERRAIN_AMBIENT } from './TerrainAmbient.js';

/**
 * The W4 literals, kept here as the thing being replaced rather than deleted.
 * `?stockfloor=0` restores them and `?stockfloor=legacy` computes them through
 * the new writer, which is what makes the two frames comparable.
 */
export const STOCK_FLOOR_LEGACY = { sky: 0x334466, ground: 0x101008, intensity: 0.35 };

/**
 * Three states, and the middle one is the point (RN-1201's shape, copied
 * deliberately).
 *
 *   `?stockfloor=0`       the writer is NOT INSTALLED. Headlamp keeps its own
 *                         two literals and the frame is the pre-change frame
 *                         exactly. This is the negative control.
 *   `?stockfloor=legacy`  the writer IS installed and computes the legacy
 *                         values. Every line of the new path runs, the colours
 *                         are written every frame, `writes` counts up, and the
 *                         frame must come back IDENTICAL to `=0`. That is the
 *                         positive control, and it is an identity by
 *                         construction rather than by tuning.
 *   absent, or a number   the shipped floor, optionally scaled.
 *
 * NUMBERS.md: a control whose arming step silently fails is indistinguishable
 * from a passing control. Here the arming step IS the subject, so a dead writer
 * shows up as `writes: 0` rather than as a null result nobody can read.
 */
export type StockFloorMode = 'off' | 'legacy' | 'on';

const RAW = ((): string | null => new URLSearchParams(self.location.search).get('stockfloor'))();

/** RN-150-safe: a missing parameter is MISSING, never `Number(null) === 0`. */
export const STOCK_FLOOR_MODE: StockFloorMode =
  RAW === '0' ? 'off' : RAW === 'legacy' ? 'legacy' : 'on';

const AMP = ((): number => {
  const f = RAW === null || RAW === 'legacy' ? NaN : Number(RAW);
  return Number.isFinite(f) ? f : 1;
})();

/** Live count of writes, so `legacy` can prove it ran rather than assert it. */
let writes = 0;
/** The linear triple actually written last frame, for the same reason. */
const lastSky = new THREE.Color(0, 0, 0);
const lastGround = new THREE.Color(0, 0, 0);

const LEGACY_SKY = new THREE.Color(STOCK_FLOOR_LEGACY.sky);
const LEGACY_GROUND = new THREE.Color(STOCK_FLOOR_LEGACY.ground);

/**
 * The OPEN-SKY ENDPOINT of the near scene's hemisphere: the pair of colours and
 * the intensity a fully exposed surface sees. Written into `sky` and `ground`,
 * with the intensity returned.
 *
 * IT IS AN ENDPOINT AND NOT THE FINAL VALUE, and that is what makes the
 * positive control exact. Headlamp interpolates from the cave pair toward this
 * one on the measured sky visibility, and that interpolation is untouched here:
 * `?stockfloor=legacy` therefore feeds the caller the same three numbers the
 * two literals gave it, through the same lerp, and the buried endpoint is
 * unchanged in both arms. The only thing that can differ is what an open-sky
 * surface receives, which is the whole claim.
 *
 * Under `on` the intensity is 1 and the whole magnitude lives in the colour,
 * because a hemisphere light's contribution is colour TIMES intensity and two
 * authorities on one product is how a retune of either silently cancels the
 * other. `TERRAIN_AMBIENT` already carries its own amplitude.
 */
export function stockFloor(sky: THREE.Color, ground: THREE.Color): number {
  writes++;
  if (STOCK_FLOOR_MODE === 'legacy') {
    sky.copy(LEGACY_SKY);
    ground.copy(LEGACY_GROUND);
    lastSky.copy(sky);
    lastGround.copy(ground);
    return STOCK_FLOOR_LEGACY.intensity;
  }
  // BY REFERENCE, not by value: `TERRAIN_AMBIENT` is the live object the night
  // writer mutates, so reading it here every frame is what makes the starlight
  // floor reach a machine with no second mechanism and no new uniform.
  sky.copy(TERRAIN_AMBIENT).multiplyScalar(AMP);
  ground.copy(sky);
  lastSky.copy(sky);
  lastGround.copy(ground);
  return 1;
}

/**
 * What the floor ACTUALLY IS this frame, published on TerrainAmbient's own
 * precedent: the previous lane's difficulty was that a constant in the frame
 * could not be attributed to a constant in the code because every quantity
 * between them is nonlinear. Reading the linear triple directly turns that
 * into arithmetic.
 */
export function stockFillState(): {
  mode: StockFloorMode; flagPresent: boolean; amp: number; writes: number;
  sky: [number, number, number]; ground: [number, number, number];
  legacySky: [number, number, number]; legacyGround: [number, number, number];
} {
  return {
    mode: STOCK_FLOOR_MODE, flagPresent: RAW !== null, amp: AMP, writes,
    sky: [lastSky.r, lastSky.g, lastSky.b],
    ground: [lastGround.r, lastGround.g, lastGround.b],
    legacySky: [LEGACY_SKY.r, LEGACY_SKY.g, LEGACY_SKY.b],
    legacyGround: [LEGACY_GROUND.r, LEGACY_GROUND.g, LEGACY_GROUND.b],
  };
}

(window as unknown as { __ofStockFill: unknown }).__ofStockFill = {
  report: stockFillState,
};
