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
// every repeat. The MEAN lumas below reproduced to 0.00 across their three
// runs; the SPREAD statistics did not, and `iqr` was observed at both 16.36 and
// 16.43, so the tolerance on those is +-0.07 rather than zero. Stated because a
// tolerance quoted tighter than the instrument delivers is a defect in the same
// class as the numbers it is guarding.
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
import { injectEmissiveLight } from './EmissiveLight.js';
import { aerialDiagAmp, uPropPaint } from './AerialDiag.js';
import { CROWN_FACE_INSTALLED, injectCrownFaceFold, noteCrownFaceMaterial }
  from './CrownFaceFold.js';

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
const Q = new URLSearchParams(self.location.search);
const RAW = Q.get('propsky');
export const PROP_SKY_INSTALLED = RAW !== 'off';
const SCALE = ((): number => {
  const f = RAW === null || RAW === 'off' ? NaN : Number(RAW);
  return Number.isFinite(f) ? f : 1;
})();

/**
 * RN-2205, FOLIAGE TRANSLUCENCY, and the numbers are A2'S rather than new ones.
 *
 * The fidelity charter's difference 5 names it outright: our props are "chunky
 * low-poly with hard facet shading AND NO TRANSLUCENCY APPROXIMATION". A2 built
 * one for the carpet and its GLSL is the model here, term for term:
 *
 *   GrassGlsl.ts:324  wrapN = max((dot(n, sd) + uTrans.x) / (1 + uTrans.x), 0)
 *   GrassGlsl.ts:325  fwd   = pow(max(dot(rd, sd), 0), 3)
 *   GrassGlsl.ts:326  trans = albedo * uTrans.y * (wrapN*0.35 + fwd*0.65)
 *                           * sunT * 1.45 * mix(shadow, 1, 0.35)
 *
 * THE CONSTANTS ARE THE SAME CONSTANTS (0.55 wrap, 0.42 gain), and that is the
 * "coordinated with how the carpet shades" requirement taken literally: a tuft
 * of carpet grass and a scatter fern standing in it are one material to the
 * eye, and if the two glowed into a low sun by different amounts the seam
 * between the layers would show exactly where A2 spent a lane making it
 * invisible. They are TRANSCRIBED rather than imported because `GrassMaterial`
 * builds them inside a `transFromQuery` local and this lane may not edit
 * `render/grass`; the transcription is named here so the next mover sees both
 * copies, which is the least bad of the two second-authority failures.
 *
 * `?foliagetrans=0` zeroes the gain (the program is unchanged, so the pair is a
 * value control), and a number scales it.
 */
const FOL_RAW = Q.get('foliagetrans');
const FOL_WRAP = 0.55;
const FOL_GAIN = ((): number => {
  if (FOL_RAW === '0') return 0;
  const f = FOL_RAW === null ? NaN : Number(FOL_RAW);
  return 0.42 * (Number.isFinite(f) ? f : 1);
})();

/** The one place the flag's value lives, so the shader and the report agree. */
const uPropSky: THREE.IUniform<number> = { value: SCALE };
/** x = wrap width, y = gain. The carpet's `uTrans` packing, deliberately. */
const uFolTrans: THREE.IUniform<THREE.Vector2> =
  { value: new THREE.Vector2(FOL_WRAP, FOL_GAIN) };

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
  uFolTrans,
  // RN-2232's haze scale is NOT listed here: it is declared below the BUNDLE
  // (beside its own GLSL, where every other term's knob lives) and `publish`
  // installs it. The inert default is the same shape as the rest -- an absent
  // key leaves `ofAtmoScatter` returning vec3(0) on `uAtmosOn = 0` -- so the
  // race this block's comment is about is closed for it too.
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
  BUNDLE.uPropHaze = uPropHaze;   // RN-2232, see the BUNDLE note above.
  BUNDLE.uPropPaint = uPropPaint; // RN-2540, the same.
  BUNDLE.uPropSpec = uPropSpec;   // RN-2540, the same.
  published = true;
}

const F_COMMON = '#include <common>';
const F_LIGHTS = '#include <lights_fragment_begin>';

const DECL = /* glsl */`
  uniform vec3  uBodyCenter;
  uniform float uSkyAmbient;
  uniform float uPropSky;
  uniform vec2  uFolTrans;
  uniform float uPropHaze;
  uniform float uPropPaint;
  uniform float uPropSpec;
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


/**
 * RN-2205. Spliced into the FOLIAGE programs only, which is why there are two
 * hooks below rather than one hook and a uniform set to zero: a boulder is not
 * a thin leaf, and a rock batch should not pay `getShadowMask` and a
 * transmittance march for a term that is identically zero on it. Two hooks are
 * two programs and they ARE two different programs, so the cache-key difference
 * is the truth rather than a cost.
 *
 * `1.45` is `TERRAIN_SUN_IRRADIANCE`, the same literal the terrain and the
 * carpet both inline. The trailing `PI` is the convention change the sky term
 * explains above, and it is what makes the carpet's explicit `albedo *`
 * implicit here.
 *
 * ============ THE ONE TERM THAT IS NOT THE CARPET'S, AND WHY ============
 *
 * The carpet closes with `mix(shadow, 1.0, 0.35)`, so a blade under a cascade
 * keeps 35 per cent of its glow. THIS SHADER CANNOT READ THAT SHADOW. The
 * carpet is a `ShaderMaterial` and samples the cascades itself; a stock
 * `MeshStandardMaterial` in three r185 exposes no shadow factor to a splice.
 * `getShadowMask()` is defined only by `shadowmask_pars_fragment`, which
 * `meshphysical` does not include (checked in node_modules, not assumed -- the
 * first attempt used it and the whole build went to `VALIDATE_STATUS false`),
 * and `getShadow()` itself takes a five-argument r166+ signature plus a choice
 * of WHICH of the three cascades to sample, which is a per-version, per-rig
 * hard-coding this file should not own.
 *
 * So the factor is a CONSTANT, and it is the carpet's own shadowed floor rather
 * than 1: a foliage prop glows by the amount a SHADED blade of carpet grass
 * glows, everywhere, instead of by the amount a SUNLIT one does. That is the
 * conservative direction of the two. It costs the sunlit crown 65 per cent of
 * the effect it could have had, and it buys the guarantee that a fern on a
 * shadowed forest floor cannot light itself, which is the artefact that would
 * have been visible in exactly the hero frame this lane is judged on.
 * `?foliagetrans=` sweeps it if a later lane gets the real shadow.
 */
/**
 * RN-2232. AERIAL PERSPECTIVE ON THE PROPS, and it is the term that decides
 * whether a distant forest is a forest or is pepper.
 *
 * THE PICTURE FOUND THIS AND NO COUNTER COULD HAVE (DW-7).
 * `docs/screenshots/RN2225_flyover_nohaze.png` is the far canopy switched on
 * with the terrain's haze under it and none on the trees: 22,945 canopy trees
 * over a 4.2 km disc, and the frame reads as dirt on the lens. The ground
 * behind them is washed to a flat pale green by three kilometres of air, and
 * the trees standing ON that ground are drawn at full contrast, so every one
 * of them is a hard dark speck against a surface that has lost its own
 * contrast entirely. The `under` rectangle moved 108.99 -> 108.63, four tenths
 * of a count, and would have signed the change off.
 *
 * `TerrainFragLight.glsl.ts:198-210` is the model and this is the SAME TWO
 * CALLS in the same order with the same arguments, so a tree and the ground it
 * stands on are hazed by one function rather than by two that can disagree:
 *
 *     apIn = ofAtmoScatter(camM, rd, dist, 4, 2, apTrans)
 *     lit  = lit * apTrans + apIn
 *     lit  = ofAtmoAerial(lit, camM, rd, dist, sunT)
 *
 * `OF_AP_VIEW` / `OF_AP_LIGHT` are `TerrainProgram`'s own defines and a stock
 * program has neither, so the two step counts are written as the literals
 * `TerrainProgram.ts:29-30` sets them to (4 and 2). They are loop bounds and
 * therefore have to be compile-time constants either way; the transcription is
 * named here rather than hidden.
 *
 * ON THE FINAL COLOUR AND NOT ON `irradiance`, which is why this splice takes a
 * THIRD anchor rather than joining the two above. Aerial perspective is a
 * transmittance times the outgoing radiance plus an in-scattered term: it acts
 * on what LEAVES the surface, after albedo and after every light. Folding it
 * into `irradiance` would haze the incoming light instead, which reddens a tree
 * rather than fading it, and the two are not the same picture.
 * `<fog_fragment>` is the anchor because it is the one point three publishes
 * that is already defined as "modify the final colour by distance", it exists
 * in every stock fragment program, and its own body is `#ifdef USE_FOG`
 * guarded so this neither reads nor collides with three's fog (which this
 * project does not use, and must not: a second haze authority is the DW-26
 * failure over the exact term A4 spent a whole lane calibrating).
 *
 * `?prophaze=0` is the value control -- the program is unchanged and the term
 * is multiplied by zero, so the pair is one uniform apart. There is no
 * `=off`, because the whole splice already lives behind `?propsky=off`.
 */
const HAZE_RAW = Q.get('prophaze');
const uPropHaze: THREE.IUniform<number> = {
  value: ((): number => {
    if (HAZE_RAW === '0') return 0;
    const f = HAZE_RAW === null ? NaN : Number(HAZE_RAW);
    return Number.isFinite(f) ? f : 1;
  })(),
};

const F_FOG = '#include <fog_fragment>';

/**
 * RN-2540. THE PROPS' SPECULAR ISOLATOR, and it exists because the crown's own
 * radiance could not otherwise be attributed.
 *
 * `totalSpecular` is the ONE radiance in three's stock physical program that is
 * not multiplied by the albedo: `RE_Direct_Physical` and `RE_IndirectSpecular`
 * both write a sun-coloured and a sky-coloured lobe straight into
 * `reflectedLight`, and the sky-coloured one is BLUE. Every other term on a
 * canopy card rides `irradiance`, i.e. rides `BRDF_Lambert(diffuseColor)`, and
 * the card's diffuse blue is multiplied by `cardShadeRGB.b` = 0.0017 (RN-2526),
 * so a measurable blue in the card's un-hazed pixel can only be specular or
 * post. Before this lane there was no way to say which: `?terrainspec=` is the
 * TERRAIN's own knob and reaches no prop, and there is no page parameter for
 * `envMapIntensity` anywhere. RN-952's lesson is that a term with no switch is
 * the one candidate no experiment can eliminate, so it gets one.
 *
 * A REPLACE OF THREE'S OWN LINE, not a new term: at `onBeforeCompile` the
 * material's `fragmentShader` is `meshphysical.glsl.js` verbatim with only the
 * `#include` lines unresolved, so this line is present and is the single point
 * where both specular lobes join the frame. `uPropSpec` at 1 leaves it
 * algebraically unchanged, so the pair is one uniform apart on one program, and
 * a three upgrade that rewrites the line reports a MISS below rather than
 * silently dropping the control.
 */
const F_OUT = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
const OUT_SPEC =
  'vec3 outgoingLight = totalDiffuse + totalSpecular * uPropSpec + totalEmissiveRadiance;';
const uPropSpec: THREE.IUniform<number> = { value: aerialDiagAmp('propspec', 1) };

const AERIAL = /* glsl */`
  {
    vec3 ofApPm = cameraPosition - uBodyCenter;
    vec3 ofApRd =
      -normalize((vec4(normalize(vViewPosition), 0.0) * viewMatrix).xyz);
    float ofApD = length(vViewPosition);
    vec3 ofApSunT = uAtmosOn > 0.5
      ? ofAtmoSunTransmittance(ofApPm, normalize(uSunDir), 3) : vec3(1.0);
    vec3 ofApTrans;
    vec3 ofApIn = ofAtmoScatter(ofApPm, ofApRd, ofApD, 4, 2, ofApTrans);
    // RN-2540. THE PAINT ARM. 0 is the shipped frame exactly (mix(c, 0, 0) is
    // c); 1 zeroes the surface radiance before the two calls below, so the card
    // renders its own additive floor ALONE. An amplitude cannot do this:
    // ?prophaze= moves col*T and Lin together. See AerialDiag.ts.
    vec3 ofApSrc = mix(gl_FragColor.rgb, vec3(0.0), uPropPaint);
    vec3 ofApLit = ofApSrc * ofApTrans + ofApIn;
    ofApLit = ofAtmoAerial(ofApLit, ofApPm, ofApRd, ofApD, ofApSunT);
    gl_FragColor.rgb = mix(ofApSrc, ofApLit, uPropHaze);
  }
`;

const OF_TRANS_SHADOW = '0.35';
const TRANS = /* glsl */`
  {
    vec3 ofTSd = normalize(uSunDir);
    vec3 ofTPm = cameraPosition - uBodyCenter;
    vec3 ofTSunT = uAtmosOn > 0.5
      ? ofAtmoSunTransmittance(ofTPm, ofTSd, 3) : vec3(1.0);
    vec3 ofTN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec3 ofTRd = -normalize((vec4(normalize(vViewPosition), 0.0) * viewMatrix).xyz);
    float ofTWrap =
      max((dot(ofTN, ofTSd) + uFolTrans.x) / (1.0 + uFolTrans.x), 0.0);
    float ofTFwd = pow(max(dot(ofTRd, ofTSd), 0.0), 3.0);
    irradiance += uFolTrans.y * (ofTWrap * 0.35 + ofTFwd * 0.65)
      * ofTSunT * 1.45 * ${OF_TRANS_SHADOW} * PI;
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
export function injectPropSkyAmbient(shader: Splicable,
                                    foliage = false): void {
  if (!PROP_SKY_INSTALLED) return;
  for (const k of Object.keys(BUNDLE)) shader.uniforms[k] = BUNDLE[k];
  // RN-2232. UNCONDITIONAL, not through `BUNDLE`. This one is declared below
  // the bundle beside its own GLSL, so a program compiled before `publish`
  // would otherwise get no `uPropHaze` at all and three would leave it at 0 --
  // which is a silently absent haze rather than a loud one, exactly the
  // failure the bundle's inert-defaults comment exists to prevent.
  shader.uniforms.uPropHaze = uPropHaze;
  // RN-2540. Unconditional for uPropHaze's own reason, one line above.
  shader.uniforms.uPropPaint = uPropPaint;
  shader.uniforms.uPropSpec = uPropSpec;
  // RN-2385. THE OTHER HALF OF "A HOT SURFACE LIGHTS WHAT IS NEAR IT", and it
  // rides this splice rather than getting a hook of its own for this file's
  // own stated reason: a material holds ONE `onBeforeCompile`, and every prop,
  // fern, boulder and mineral node in the game already spends it on `PropWind`
  // or `RockShader` chaining into here. A furnace that lit its own shell and
  // left the crate and the log pile beside it black would be the same defect
  // one metre to the left. Its own `?firelight=` flags are separate, so the
  // pair remains one variable apart.
  injectEmissiveLight(shader);
  const before = shader.fragmentShader;
  if (foliage) spliceTrans++;
  shader.fragmentShader = shader.fragmentShader
    .replace(F_COMMON, `${F_COMMON}\n${ATMOSPHERE_PARS}\n${DECL}`)
    .replace(F_LIGHTS, `${F_LIGHTS}\n${TERM}${foliage ? TRANS : ''}`)
    .replace(F_FOG, `${AERIAL}\n${F_FOG}`)
    .replace(F_OUT, OUT_SPEC);
  if (shader.fragmentShader === before) { misses.push('both anchors'); return; }
  if (!shader.fragmentShader.includes('ofSkyAmb')) misses.push(F_LIGHTS);
  if (!shader.fragmentShader.includes('ofAtmoScatter')) misses.push(F_COMMON);
  // RN-2232. The third anchor gets its own miss row, so a three upgrade that
  // renames the fog chunk reports a lost haze rather than silently dropping it.
  if (!shader.fragmentShader.includes('ofApLit')) misses.push(F_FOG);
  // RN-2540. The fourth anchor, three's OWN line rather than a chunk name, so a
  // three upgrade that rewrites it reports a lost specular control.
  if (!shader.fragmentShader.includes('uPropSpec')) misses.push('outgoingLight');
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
function hook(shader: Splicable): void { injectPropSkyAmbient(shader, false); }
/** The same, for a batch whose role is a plant. See `TRANS`. */
function hookFoliage(shader: Splicable): void {
  injectPropSkyAmbient(shader, true);
}
/**
 * RN-2605. The same again, for the CROWN CARD, and it exists only so that
 * `?wind=0` does not silently drop the face fold.
 *
 * `PropWind.hookCrown` is the shipped path: the crown card is foliage, so the
 * wind owns its one `onBeforeCompile` and chains into here. With `?wind=0` the
 * wind never installs a hook at all and this standalone one is what the crown
 * gets, so the fold has to be reachable from both. A fourth module-scope
 * function object, never a closure, for this file's own program-cache reason.
 */
function hookCrown(shader: Splicable): void {
  injectPropSkyAmbient(shader, true);
  crownFold(shader);
}
/**
 * RN-2605. AND A FIFTH, for `?wind=0&propsky=off` ALONE.
 *
 * Both of those are negative controls, so a reader will ask why the pair is
 * worth a function. Because with both off there is no hook anywhere and the
 * fold would be SILENTLY dropped: a later lane measuring `?propsky=off` against
 * `?propsky=off&wind=0` would be comparing two arms that also differ in the
 * crown's shading normal, and nothing in either frame would say so. Found by a
 * fresh-context reviewer before it shipped. The fold is a separate term from
 * the sky ambient and its own `?crownface=off` is the way to remove it.
 */
function hookCrownOnly(shader: Splicable): void { crownFold(shader); }
function crownFold(shader: Splicable): void {
  injectCrownFaceFold(shader as unknown as {
    uniforms: Record<string, THREE.IUniform>;
    vertexShader: string; fragmentShader: string;
  });
}

/**
 * Install the standalone hook, and ONLY where the slot is free. Returns false
 * where a hook already exists, which is not a failure: that material's own hook
 * is expected to chain `injectPropSkyAmbient` itself, and the counters below
 * are what say whether it did.
 */
export function applyPropSkyAmbient(m: THREE.Material, tag: string,
                                    foliage = false, crown = false): boolean {
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    chained.push(tag);
    return false;
  }
  // RN-2605. THE CROWN'S FOLD IS NOT PART OF THE SKY AMBIENT AND MUST NOT BE
  // TURNED OFF BY IT. This test is ABOVE the `PROP_SKY_INSTALLED` gate rather
  // than below it: with `?wind=0&propsky=off` there is no other hook anywhere
  // and the fold would vanish with no report. See `hookCrownOnly`.
  if (!PROP_SKY_INSTALLED) {
    if (!(crown && CROWN_FACE_INSTALLED)) return false;
    m.onBeforeCompile =
      hookCrownOnly as unknown as THREE.Material['onBeforeCompile'];
    m.needsUpdate = true;
    noteCrownFaceMaterial(m, tag);
    installed.push(tag);
    return true;
  }
  // RN-2605. `crown` implies `foliage`; the pair is passed rather than derived
  // because the caller already holds both predicates and deriving one from the
  // other here would be a second copy of "which material is the crown card".
  // `?crownface=off` falls back to the ordinary foliage hook, so the arm is the
  // pre-lane program SET and not just the pre-lane program text. `PropWind`'s
  // `applyWind` carries the full note.
  const useCrown = crown && CROWN_FACE_INSTALLED;
  const fn = (useCrown ? hookCrown : foliage ? hookFoliage : hook) as unknown;
  m.onBeforeCompile = fn as THREE.Material['onBeforeCompile'];
  m.needsUpdate = true;
  if (useCrown) noteCrownFaceMaterial(m, tag);
  installed.push(tag);
  return true;
}

const installed: string[] = [];
const chained: string[] = [];
let spliceTrans = 0;

/**
 * The probe surface, and it publishes the three things a vacuous green would
 * hide: whether the live uniforms were ever handed over, how many programs the
 * term actually reached, and which materials were left to their own hook.
 */
export function propSkyState(): {
  scale: number; installedFlag: boolean; flagPresent: boolean;
  published: boolean; spliced: number;
  installed: string[]; chained: string[]; misses: string[];
  skyAmbient: number; folWrap: number; folGain: number;
  folFlagPresent: boolean; folPrograms: number;
} {
  return {
    scale: SCALE, installedFlag: PROP_SKY_INSTALLED, flagPresent: RAW !== null,
    published, spliced,
    installed: [...installed], chained: [...chained], misses: [...misses],
    skyAmbient: BUNDLE.uSkyAmbient.value as number,
    folWrap: FOL_WRAP, folGain: FOL_GAIN, folFlagPresent: FOL_RAW !== null,
    // Programs the translucency actually reached. Zero here with a nonzero
    // gain is the vacuous green: the term is configured and in no shader.
    folPrograms: spliceTrans,
  };
}

(window as unknown as { __ofPropSky: unknown }).__ofPropSky = {
  report: propSkyState,
};
