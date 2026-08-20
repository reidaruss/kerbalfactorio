// THE SKY AMBIENT, DELIVERED TO THE STOCK MATERIALS (RN-2201).
//
// ============================== WHAT WAS WRONG ==============================
//
// Lane A1 raised `TERRAIN_SKY_AMBIENT` from 0.32 to 0.88, a 2.75x, and then
// measured the meadow with `?ambientfill=0` one flag apart on one build: near-
// ground luma 63.69 with the fill and 61.60 without, of a +14-count move. TWO
// COUNTS OF FOURTEEN. Its own conclusion, in rendering.md section 2.11 and in
// the trap catalogue:
//
//   "`StockFill.stockFloor` gives the scatter props a hemisphere fill of
//    `TERRAIN_AMBIENT * AMP`, the FLOOR ONLY -- the sky-ambient WEIGHT that
//    lights the terrain never reaches a single blade of grass."
//
// The near ground of a meadow is not terrain, it is props. So the term that
// makes the terrain's shadow side read as air rather than as a hole stops at
// the terrain's own two materials and the sky's ground shell, and everything
// standing ON the ground is lit by a floor and an environment map that know
// nothing about it. A2 hit the same wall and routed the carpet around it,
// taking the terrain's shared uniform objects instead of `StockFill`; this is
// that same wiring for the props and the harvest nodes, which A2 could not do
// because they are stock `MeshStandardMaterial`s and not a `ShaderMaterial`.
//
// ================================ THE WIRING ================================
//
// The SAME EXPRESSION, from the SAME shared uniform objects, spliced into the
// stock program:
//
//     TerrainFragLight.glsl.ts:32   skyAmb = ofAtmoScatter(pM, up, 1e9, 2, 2, t)
//                                            * uSkyAmbient
//     GrassGlsl.ts:303              (identical, character for character)
//     here                          (identical, at the CAMERA's pM)
//
// `pM` IS THE CAMERA'S AND NOT THE FRAGMENT'S, and that is the one deliberate
// approximation. The terrain and the carpet already have a world position in
// hand; a stock material does not, and adding a varying means splicing the
// VERTEX stage of every prop program, which is where `PropWind` already lives.
// The quantity being sampled is the zenith radiance of a 600 km planet's
// atmosphere: across the whole 620 m scatter ring it is constant to far below
// the eight bits the frame is quantised to. Buying a varying for it would be
// paying a real cost for a difference that cannot be photographed.
//
// UNIFORMS ARE SHARED BY REFERENCE, which is the whole point and is also the
// thing that is silent when you get it wrong (DW-22, WaterMaterial's note, and
// GrassMaterial's header repeat it because `UniformsUtils.merge` deep-clones).
// `publish` assigns the atmosphere bundle's and the terrain's own `IUniform`
// OBJECTS into this module's bundle, so when A4's sky work moves the atmosphere
// or the night writer moves the ambient, the props follow with no second
// mechanism and nothing to keep in step.
//
// ============================ WHY THE PI IS THERE ===========================
//
// The terrain multiplies its albedo by `(uAmbient + skyAmb * skyView + ...)`
// directly. Three's stock path puts every irradiance through
// `BRDF_Lambert = RECIPROCAL_PI * diffuseColor`, so a term added to `irradiance`
// arrives at the pixel divided by PI. Handing the props the terrain's number
// unscaled would therefore deliver 31.8 per cent of it and the two surfaces
// would disagree by a constant nobody could see the source of. The PI is not a
// tuning constant; it is the change of convention between the two paths, and it
// is written here so that it is one line to find rather than a fudge factor
// somebody later reads as taste.
//
// THE CONTROLS ARE TWO, not one, and the reason is below at `RAW`: this change
// adds both a VALUE and a per-fragment COST, and a single flag that removes
// both cannot tell you which of them a delta belongs to.
//
// ===================== AND THE MEASURED SIZE IS SMALL =======================
//
// Written here rather than only in the ledger, because a term whose measured
// effect is not beside it is a term somebody later mistakes for a look knob.
// Three interleaved repeats per arm, one server, one build, arm order rotated
// every repeat; every luma below reproduced to 0.00 across its three runs.
//
//   forestfloor  box   19.79 -> 19.89   +0.10
//   meadow       nearG 68.44 -> 68.69   +0.25
//                shade 77.80 -> 77.99   +0.19
//                skyHi/skyHz IDENTICAL TO THE DIGIT (148.75, 183.90)
//   meadow at ?propsky=20                +1.79 on forestfloor box, i.e. LINEAR
//
// The last two rows are the property assertions and they are the reason to
// believe the first three: the term is exactly linear in the flag, and it moves
// the props while leaving the sky it is derived FROM untouched to the digit, so
// what moved cannot be an exposure or a grade shift wearing this term's name.
//
// SO A1'S INFERENCE NAMED A REAL ABSENCE AND OVERSTATED ITS SIZE, and that is
// worth recording as plainly as the fix. The props were never unlit by the sky:
// RN-64's IBL captures a sky AND a ground shell and every stock material
// samples it. What they were outside of was the sky ambient's AUTHORITY -- the
// weight `TERRAIN_SKY_AMBIENT` that the terrain and the carpet answer to. They
// are inside it now, so A4's sky work reaches them with nothing to keep in
// step, and the honest accounting of today's frame is a tenth of a count.
//
// COST: none that separates. Same three interleaved repeats, `propsky=off`
// (the splice absent, i.e. the pre-change program) against `propsky=0` (the
// splice present, value zero): pixels IDENTICAL to the digit, and p50 medians
// 8.00 against 7.50 with within-arm spreads of 2.20 and 1.80. The spread
// swamps the difference, so the per-fragment raymarch is reported as under the
// noise floor rather than as a number.

import * as THREE from 'three';
import { ATMOSPHERE_PARS } from './Atmosphere.glsl.js';
import { TERRAIN_SKY_AMBIENT } from './TerrainAmbient.js';

/**
 * THREE STATES, on `StockFill`'s and RN-1201's precedent, because the two
 * questions this term raises need two different controls and one flag cannot
 * answer both.
 *
 *   `?propsky=off`   the splice is NOT INSTALLED. The programs are the
 *                    pre-RN-2201 programs exactly, so this arm is what the
 *                    per-fragment COST is measured against.
 *   `?propsky=0`     the splice IS installed and the term is multiplied by
 *                    zero. Same program, same instruction count, only the value
 *                    differs, so this arm is what the term's VALUE is measured
 *                    against and the pair cannot be confounded by a shader
 *                    swap.
 *   absent, a number the shipped term, optionally scaled for a sweep.
 *
 * RN-150-safe: a MISSING parameter is missing, never `Number(null) === 0`.
 */
const RAW = new URLSearchParams(self.location.search).get('propsky');
export const PROP_SKY_INSTALLED = RAW !== 'off';
const SCALE = ((): number => {
  const f = RAW === null || RAW === 'off' ? NaN : Number(RAW);
  return Number.isFinite(f) ? f : 1;
})();

/** The one place the flag's value lives, so the shader and the report agree. */
const uPropSky: THREE.IUniform<number> = { value: SCALE };

/**
 * The bundle spliced into every hooked program.
 *
 * It starts with INERT defaults rather than with nothing, because
 * `onBeforeCompile` fires at the first render and `publish` runs during boot:
 * if the order ever inverted, `uAtmosOn = 0` makes `ofAtmoScatter` return
 * `vec3(0)` on its first line and the term is exactly absent. A program
 * compiled against a half-published bundle would otherwise be wrong forever,
 * silently, and only on whatever machine lost the race.
 */
const BUNDLE: Record<string, THREE.IUniform> = {
  uAtmosOn: { value: 0 },
  uBodyCenter: { value: new THREE.Vector3() },
  uSkyAmbient: { value: TERRAIN_SKY_AMBIENT },
  uPropSky,
};

let published = false;

/**
 * Hand this module the LIVE uniform objects. Called once from the boot scope
 * that already holds both (`BootBodyScope`, where `GrassCover` takes the same
 * two things for the same reason).
 *
 * `terrain` is the near terrain material's uniform record and `atmos` is the
 * atmosphere bundle; every key of both that this module's GLSL names is taken
 * BY REFERENCE. Keys neither of them has keep the inert default.
 */
export function publishPropSkyAmbient(
  atmos: Readonly<Record<string, THREE.IUniform>>,
  terrain: Readonly<Record<string, THREE.IUniform>>,
): void {
  for (const k of Object.keys(atmos)) BUNDLE[k] = atmos[k];
  for (const k of ['uBodyCenter', 'uSkyAmbient']) {
    if (terrain[k] !== undefined) BUNDLE[k] = terrain[k];
  }
  BUNDLE.uPropSky = uPropSky;
  published = true;
}

const F_COMMON = '#include <common>';
const F_LIGHTS = '#include <lights_fragment_begin>';

const DECL = /* glsl */`
  uniform vec3  uBodyCenter;
  uniform float uSkyAmbient;
  uniform float uPropSky;
`;

/**
 * `PI` is three's own `#define PI 3.141592653589793` from the common chunk, so
 * the convention change is written in the units three itself publishes.
 *
 * `skyView` is the same `0.5 + 0.5 * dot(n, up)` the terrain uses, evaluated on
 * the WORLD normal: `normal` is view space at this point in the stock program,
 * and a row-vector multiply by `viewMatrix` is its inverse rotation, because a
 * view matrix's upper 3x3 is orthonormal.
 */
const TERM = /* glsl */`
  {
    vec3 ofSkyPm = cameraPosition - uBodyCenter;
    vec3 ofSkyUp = normalize(ofSkyPm);
    vec3 ofSkyTrans;
    vec3 ofSkyAmb = ofAtmoScatter(ofSkyPm, ofSkyUp, 1.0e9, 2, 2, ofSkyTrans)
      * uSkyAmbient;
    vec3 ofSkyN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    irradiance += ofSkyAmb * (0.5 + 0.5 * dot(ofSkyN, ofSkyUp))
      * uPropSky * PI;
  }
`;

/** Anchors that went missing, so a three upgrade that renames a chunk is a
 *  reported number rather than a term that quietly stopped existing. */
const misses: string[] = [];
let spliced = 0;

interface Splicable {
  uniforms: Record<string, THREE.IUniform>;
  fragmentShader: string;
}

/**
 * Splice the term into one program. EXPORTED as a splicer rather than installed
 * as a hook, on `FurShader`'s precedent and for its reason: a material holds ONE
 * `onBeforeCompile`, so the foliage props (which already have `PropWind`) and
 * the mineral nodes (which already have `RockShader`) can only take this by
 * having their existing hook call it. Both anchors put their include back, so
 * neither splice can eat the other's and the order between them is free.
 */
export function injectPropSkyAmbient(shader: Splicable): void {
  if (!PROP_SKY_INSTALLED) return;
  for (const k of Object.keys(BUNDLE)) shader.uniforms[k] = BUNDLE[k];
  const before = shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader
    .replace(F_COMMON, `${F_COMMON}\n${ATMOSPHERE_PARS}\n${DECL}`)
    .replace(F_LIGHTS, `${F_LIGHTS}\n${TERM}`);
  if (shader.fragmentShader === before) { misses.push('both anchors'); return; }
  if (!shader.fragmentShader.includes('ofSkyAmb')) misses.push(F_LIGHTS);
  if (!shader.fragmentShader.includes('ofAtmoScatter')) misses.push(F_COMMON);
  spliced++;
}

/**
 * THE STANDALONE HOOK, for the materials that have no `onBeforeCompile` of their
 * own: the mineral and bark PROP batches, and the `coarse:`/`ore:` node batches
 * with the rock channel off.
 *
 * ONE module-scope function object, never a closure per material, because
 * three's program cache key stringifies `onBeforeCompile` and a fresh closure
 * per batch is a fresh program per batch (`PropWind` and `RockShader` both
 * carry this note; it is repeated because it is silent and expensive).
 */
function hook(shader: Splicable): void { injectPropSkyAmbient(shader); }

/**
 * Install the standalone hook, and ONLY where the slot is free. Returns false
 * where a hook already exists, which is not a failure: that material's own hook
 * is expected to chain `injectPropSkyAmbient` itself, and the counters below
 * are what say whether it did.
 */
export function applyPropSkyAmbient(m: THREE.Material, tag: string): boolean {
  if (!PROP_SKY_INSTALLED) return false;
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    chained.push(tag);
    return false;
  }
  m.onBeforeCompile = hook as unknown as THREE.Material['onBeforeCompile'];
  m.needsUpdate = true;
  installed.push(tag);
  return true;
}

const installed: string[] = [];
const chained: string[] = [];

/**
 * The probe surface, and it publishes the three things a vacuous green would
 * hide: whether the live uniforms were ever handed over, how many programs the
 * term actually reached, and which materials were left to their own hook.
 */
export function propSkyState(): {
  scale: number; installedFlag: boolean; flagPresent: boolean;
  published: boolean; spliced: number;
  installed: string[]; chained: string[]; misses: string[];
  skyAmbient: number;
} {
  return {
    scale: SCALE, installedFlag: PROP_SKY_INSTALLED, flagPresent: RAW !== null,
    published, spliced,
    installed: [...installed], chained: [...chained], misses: [...misses],
    skyAmbient: BUNDLE.uSkyAmbient.value as number,
  };
}

(window as unknown as { __ofPropSky: unknown }).__ofPropSky = {
  report: propSkyState,
};
