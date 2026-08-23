// A HOT SURFACE LIGHTS WHAT IS NEAR IT (RN-2385).
//
// ============================== WHAT WAS WRONG ==============================
//
// World audit R3 built one frame that could ask the question two audits had
// only inferred: `smelternight`, `smelterhero`'s pose at a sub-horizon sun.
// With `?lamp=0` it measured a running smelter whose sight strip glows at luma
// 26.54 while the clean shell 0.3 m away reads **2.72**, the brick columns
// 1.61 and 1.94, the door casting above the fire **0.41**, and the WHOLE FRAME
// 1.80 against a bare `meadownight` at the same hour and the same flag at
// 1.95. A running furnace made the world measurably DARKER than an empty
// field, because it occludes the sky and returns nothing.
//
// The cause is in one line of `MachineFx.ts`: every emissive surface in the
// game was a self-illuminated albedo constant of magnitude about 0.2 in linear
// radiance, added to `totalEmissiveRadiance` and read by nothing. It is under
// the bloom threshold (0.86) so it cannot halo, it is two orders under a
// firebox's real radiance so it cannot light, and it clips to white the moment
// the headlamp lands on it because the only range it has is the tone curve's.
//
// =============== THE DESIGN DECISION, AND THE WEBGL2 CEILING ================
//
// `docs/web/CEILING-STUDY-2026-08-19.md` section 3 names ONE hard WebGL2
// limit in the whole table, and this is it: "Many small lights (tunnel lamps,
// furnace glow, factory emissives) -- HARD LIMIT on WebGL2 forward rendering...
// ClusteredLighting / Forward+ is WebGPU-only in r185. Current mitigation is a
// hard budget of 4 to 8 point lights plus emissive and bloom." So a light per
// firebox is not available and never will be on this renderer.
//
// TWO SHAPES WERE AVAILABLE AND THE SECOND IS BUILT. Stated so the next lane
// does not re-derive the reject:
//
//   (1) A SMALL POOL OF REAL `THREE.PointLight`s, allocated at boot and
//       re-aimed per frame. REJECTED on two measured facts, neither of them
//       the budget. First, `TerrainShader` READS NO THREE.JS LIGHT AT ALL --
//       `Headlamp.ts`'s own header says the terrain survives `?lamp=0` "only
//       because TerrainShader reads no three.js light, which is luck rather
//       than method" -- so a real point light cannot light the ground a
//       furnace stands on, which is half the picture the audit asked for.
//       Second, three drops an invisible light before the lights state, so the
//       light COUNT is part of the program cache key: `Headlamp.ts` measured a
//       441 ms stall and 30 new programs the first time one light appeared,
//       and a pool that grows with the factory would pay that repeatedly.
//   (2) AN EMISSIVE-DRIVEN LOCAL IRRADIANCE TERM: one fixed-size uniform array
//       of emitters, spliced into the programs that must receive it, summed
//       with a windowed inverse square. The ceiling study's own second option
//       ("or cheaper approximations"), and it has none of (1)'s two problems:
//       the array bound is a compile-time constant so the program is identical
//       with zero emitters and with six, and any material can take the splice
//       whether or not three's light loop reaches it.
//
// THE BUDGET IS STATED AND IT IS INSIDE THE CEILING STUDY'S OWN 4 TO 8:
// `EMIT_MAX = 6` emitters live at once, chosen per frame by the score below.
// **This adds ZERO three.js lights**, which `emitState().sceneLights` reports
// against `Headlamp`'s own registration so the claim is checked rather than
// asserted (NUMBERS.md: a sentence in a comment is not an invariant).
//
// ============================== THE MODEL ===================================
//
// A firebox is not a point and it is not a Lambertian disc flush with the
// plate beside it, and both of those matter for the picture:
//
//   E = L * A * wrap(cos, w) * window(d) / (d^2 + r^2)
//
//   * `L * A` is radiance times EMITTING AREA, and the area is MEASURED off
//     the shipped .glb by `MachineGeometry.measureEmitter` (the smelter's peep
//     and sight strip come to 0.083 m2 by `build_smelter.py`'s own header).
//     Neither factor is a tuning constant.
//   * `r` is the source's equivalent-disc radius, sqrt(A / PI), and it is what
//     keeps the inverse square finite as a surface approaches the fire instead
//     of sending the door casting to infinity.
//   * `wrap` is `max((cos + w) / (1 + w), 0)`. A pure cosine is the right law
//     for a point source and the WRONG one here: the peep and the strip stand
//     0.037 m and 0.006 m proud of a plate that is 1.1 m wide, so a cosine
//     model says a furnace does not light its own front, which is not what a
//     furnace does. The wrap is the standard area-source approximation (the
//     carpet's `uTrans.x` uses the identical expression for the identical
//     reason) and `OF_EMIT_WRAP` is the ONE fitted number in this file.
//   * `window` is UE4's squared range window, `(1 - d^2/reach^2)^2` clamped,
//     so an emitter's reach is finite and bounded rather than a global lift
//     that would move `hearthL`/`hearthR` and every distant rectangle. That
//     boundedness is what the audit's done-when asks to be shown.
//
// THE PI at the call site is `PropSkyAmbient`'s convention change, not a
// tuning constant, and that file's own header carries the derivation: three's
// stock path puts every irradiance through `BRDF_Lambert = RECIPROCAL_PI *
// diffuseColor`, so a term added to `irradiance` arrives divided by PI.
//
// ============================== WHAT IT REACHES =============================
//
// The machine programs (`MachineBatch`'s hook), the prop / node programs
// (`PropSkyAmbient`'s splice), the TERRAIN (`TerrainFragLight.glsl.ts`'s own
// `ofEmitIrradiance(pM + uBodyCenter, n) * uEmitGround` line, landed RN-2422;
// this header was stale from that commit until RN-2735 corrected it, per
// rendering.md 2.47(e)) and, since RN-2735, the GRASS CARPET
// (`GrassGlsl.ts`'s fragment stage, gated by the SAME `uEmitGround` object the
// terrain reads, shared by reference from `GrassMaterial.ts`). It does NOT
// reach `WaterMaterial.ts`, a bare `ShaderMaterial` with no splice of any
// kind (`pondside` is a committed pose that stands beside water and would be
// the one to exercise this if it were wired); that gap is a named owed item,
// routed rather than fixed here, in rendering.md 2.52.

import * as THREE from 'three';

/**
 * Emitters live at once. Inside the ceiling study's stated 4-to-8 budget, and
 * a COMPILE-TIME array bound: the program is character-identical whether the
 * world holds zero furnaces or a thousand, so nothing here can trigger the
 * recompile `Headlamp.ts` measured at 441 ms.
 */
export const EMIT_MAX = 6;

/** The area-source wrap. The one fitted number here; see the header. */
const EMIT_WRAP = 0.35;

/**
 * THE FIRE COLOURS, AND THIS IS NOW THE ONLY COPY.
 *
 * `game/MachineFx.ts` (the standalone furnace glow, a different path serving
 * the primitive furnace) declared these two hexes as "the fire colour the
 * smelter's VisualState 1 is authored against" and the batch path had no
 * opinion at all. They are exported from here and imported there, so the
 * furnace in the mouth of a stone hut and the smelter's firebox are one
 * colour by construction rather than by two literals that agree today.
 */
export const FIRE_HEX = 0xff7a1e;
export const EMBER_HEX = 0xd63c10;

/**
 * Linear radiance of the fire surface itself, BURNING and EMBERS. This is the
 * whole of "the emissive has no radiometric range at all", answered.
 *
 * THE NUMBER IS A BLACKBODY RATIO AND NOT A LOOK KNOB, and it is written out
 * because 40 looks outrageous beside an old constant of 0.2:
 *
 *   A smelter reducing ore runs its firebox at roughly 1500 to 1800 K. A
 *   blackbody cavity at 1500 K has a luminance near 1.6e5 cd/m2 and at 1800 K
 *   near 1e6; a sunlit 0.5-albedo surface is about 1.6e4. So a firebox is
 *   between **10 and 60 times a sunlit ground**, and in this project's units a
 *   sunlit ground leaves about 1.3 of radiance (`TERRAIN_SUN_IRRADIANCE` 1.45
 *   times albedo, the terrain's own convention). That puts the honest range at
 *   13 to 78 and **40 is the middle of it**, i.e. a firebox at about 1650 K.
 *
 * IT IS ALSO WHY THE OLD VALUE COULD NEVER HAVE WORKED. The status chip's
 * expression peaked near 0.2, which is a hundredth of this: two orders of
 * magnitude is exactly the gap between "the strip glows at 26.54 and the plate
 * beside it reads 2.72" and a firebox. No amount of falloff tuning closes a
 * hundredfold shortfall in the SOURCE, and that is the finding this constant
 * is the fix for.
 *
 * DRAWN AT THE SAME NUMBER IT RADIATES, deliberately. 40 clips to white on the
 * strip's own pixels, which is what a firebox does to an eye and to a camera,
 * and the bloom pyramid is built to take it: `BloomGlsl.ts`'s first level
 * divides each tap by `1 + luma`, so a blown texel's contribution to the halo
 * is BOUNDED rather than proportional. Clamping the drawn value instead would
 * have thrown away the only HDR input the bloom stage has ever been offered.
 *
 * EMBERS ARE `game/MachineFx.ts`'S OWN AUTHORED RATIO, 0.26, which that file
 * picked for "fuel in the pool but nothing to smelt: dim, no smoke". Taking
 * its ratio rather than inventing a second one is what keeps the furnace in a
 * stone hut and a smelter's firebox one material.
 */
export const FIRE_L_HOT = 40;
export const EMBER_RATIO = 0.26;
export const FIRE_L_EMBER = FIRE_L_HOT * EMBER_RATIO;

const Q = new URLSearchParams(self.location.search);

/**
 * THREE STATES, on `PropSkyAmbient`'s and `StockFill`'s precedent, because
 * this change adds both a VALUE and a per-fragment COST and one flag cannot
 * separate them.
 *
 *   `?firelight=off`  the splice is NOT INSTALLED. The programs are the
 *                     pre-RN-2385 programs exactly, so this arm is what the
 *                     per-fragment cost is measured against.
 *   `?firelight=0`    the splice IS installed and the irradiance is multiplied
 *                     by zero. Same program, same instruction count, so this
 *                     arm is what the term's VALUE is measured against and the
 *                     pair cannot be confounded by a shader swap.
 *   absent / a number the shipped term, optionally scaled for a sweep.
 *
 * RN-150-safe: a MISSING parameter is missing, never `Number(null) === 0`.
 */
const RAW = Q.get('firelight');
export const EMIT_INSTALLED = RAW !== 'off';
const AMP = ((): number => {
  if (RAW === '0') return 0;
  const f = RAW === null || RAW === 'off' ? NaN : Number(RAW);
  return Number.isFinite(f) ? f : 1;
})();

/**
 * `?fireglow=` scales the ember role's own RADIANCE, i.e. how bright the fire
 * looks, separately from `?firelight=`, i.e. what that fire lights. They are
 * two flags because they are two claims: an audit that finds the shell too
 * bright and the fire correct has to be able to say so.
 */
const GLOW_RAW = Q.get('fireglow');
const GLOW = ((): number => {
  if (GLOW_RAW === '0') return 0;
  const f = GLOW_RAW === null ? NaN : Number(GLOW_RAW);
  return Number.isFinite(f) ? f : 1;
})();

/** xyz = engine-space position, w = equivalent-disc radius in metres. */
const posData = new Float32Array(EMIT_MAX * 4);
/** rgb = radiance * area (so the shader divides by d^2 + r^2), a = reach m. */
const colData = new Float32Array(EMIT_MAX * 4);

const uEmitN: THREE.IUniform<number> = { value: 0 };
const uEmitAmp: THREE.IUniform<number> = { value: AMP };
const uFireGlow: THREE.IUniform<number> = { value: GLOW };
const uEmitPos: THREE.IUniform<Float32Array> = { value: posData };
const uEmitCol: THREE.IUniform<Float32Array> = { value: colData };

/** The bundle every spliced program takes BY REFERENCE. */
const BUNDLE: Record<string, THREE.IUniform> = {
  uEmitN, uEmitAmp, uEmitPos, uEmitCol,
};

/**
 * RN-2422. THE SAME BUNDLE, PUBLISHED, for the one consumer that cannot take
 * `injectEmissiveLight`: the TERRAIN. That splicer anchors on
 * `#include <lights_fragment_begin>`, and `TerrainShader` has no such include
 * because it is not a stock program -- it lights itself from `uSunDir` and
 * reads no three.js light at all (`Headlamp.ts`'s own header says so, and
 * 2.25.2 records it as the FIRST reason a pool of real point lights was
 * rejected: "a real point light cannot light the ground a furnace stands on,
 * which is half the picture the audit asked for").
 *
 * So the terrain takes the DECLARATION and the UNIFORMS directly and writes its
 * own one-line use, and what makes that safe is that both are exported from
 * HERE: there is one copy of `ofEmitIrradiance`, one copy of the four uniform
 * holders, and a change to the model reaches the ground and the machine in the
 * same commit by construction.
 */
export const EMIT_UNIFORMS: Record<string, THREE.IUniform> = BUNDLE;

/**
 * `uFireGlow` is NOT in the bundle, on `PropSkyAmbient`'s `uPropHaze`
 * precedent and for the same reason: it belongs to the emissive SURFACE
 * (`MachineFx`) rather than to the irradiance splice, and it has to be bound
 * even under `?firelight=off`, where `injectEmissiveLight` returns without
 * touching anything. Binding it through the bundle would make the fire go
 * dark whenever the LIGHT was switched off, which is two claims in one flag.
 */
export const FIRE_GLOW_UNIFORM = uFireGlow;

/**
 * Metres at which an emitter's irradiance is written off. 0.002 is about one
 * 8-bit count on a mid-albedo surface at this project's exposure, so the reach
 * is derived from the emitter's own peak power rather than chosen: a smelter's
 * 0.109 m2 at radiance 3.4 comes out at 13.6 m and a status LED at under 2.
 */
const EMIT_CUT_IRRADIANCE = 0.002;

/** The reach one emitter earns, from its PEAK power so the window does not
 *  breathe with the flicker. Clamped so nothing lights a whole valley. */
export function emitterReach(area: number): number {
  const r = Math.sqrt(FIRE_L_HOT * Math.max(area, 0) / EMIT_CUT_IRRADIANCE);
  return Math.min(40, Math.max(2, r));
}

/** One live emitter, in engine space. Owned by whoever registered it. */
export interface Emitter {
  x: number; y: number; z: number;
  /** Equivalent-disc radius, metres. Keeps the inverse square finite. */
  radius: number;
  /** Radiance * area, per channel, linear. Zero means "not emitting". */
  r: number; g: number; b: number;
  /** Metres past which this emitter contributes exactly nothing. */
  reach: number;
}

const live: (Emitter | null)[] = [];
const freeSlots: number[] = [];
let selected = 0;
let dropped = 0;
let sceneLights = -1;

/** Claim a persistent handle. Handles are stable until `dropEmitter`. */
export function newEmitter(): number {
  const reuse = freeSlots.pop();
  if (reuse !== undefined) { live[reuse] = null; return reuse; }
  live.push(null);
  return live.length - 1;
}

/** Write (or clear, with `null`) one handle's state for this frame. */
export function setEmitter(h: number, e: Emitter | null): void {
  if (h < 0 || h >= live.length) return;
  live[h] = e;
}

/** Give a handle back. Idempotent. */
export function dropEmitter(h: number): void {
  if (h < 0 || h >= live.length || freeSlots.includes(h)) return;
  live[h] = null;
  freeSlots.push(h);
}

/**
 * Choose which `EMIT_MAX` emitters this frame's programs see, and upload them.
 *
 * The score is the emitter's own contribution AT THE EYE, `power / (1 + d^2)`,
 * which is the only ordering that does not have to choose between "the
 * brightest" and "the nearest": a bank of furnaces across a base and a single
 * hot one at the player's feet are the same question and this answers it once.
 * `dropped` counts the emitters that lost, which is the number that says
 * whether the budget is real in play rather than only in a hero frame.
 */
export function selectEmitters(camX: number, camY: number, camZ: number): number {
  const cand: { i: number; s: number }[] = [];
  for (let i = 0; i < live.length; ++i) {
    const e = live[i];
    if (e === null) continue;
    const p = e.r + e.g + e.b;
    if (p <= 0) continue;
    const dx = e.x - camX, dy = e.y - camY, dz = e.z - camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > e.reach * e.reach) continue;
    cand.push({ i, s: p / (1 + d2) });
  }
  cand.sort((a, b) => b.s - a.s);
  dropped = Math.max(0, cand.length - EMIT_MAX);
  const n = Math.min(EMIT_MAX, cand.length);
  for (let k = 0; k < n; ++k) {
    const e = live[cand[k].i] as Emitter;
    posData[k * 4] = e.x; posData[k * 4 + 1] = e.y;
    posData[k * 4 + 2] = e.z; posData[k * 4 + 3] = e.radius;
    colData[k * 4] = e.r; colData[k * 4 + 1] = e.g;
    colData[k * 4 + 2] = e.b; colData[k * 4 + 3] = e.reach;
  }
  uEmitN.value = n;
  selected = n;
  return n;
}

/**
 * Count the three.js lights in the near scene, ONCE, so the "this adds no
 * lights" claim in the header is a reading rather than a sentence. Called from
 * the same boot scope that builds `Headlamp`, which is the file that owns the
 * registration rule this is checking against.
 */
export function auditSceneLights(near: THREE.Object3D): number {
  let n = 0;
  near.traverse((o) => { if ((o as THREE.Light).isLight === true) n++; });
  sceneLights = n;
  return n;
}

/** GLSL literal for a hex authored in sRGB, in the LINEAR working space the
 *  shader adds into. One conversion, three's own, never a hand-typed triple. */
function lin(hex: number): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

export const FIRE_LIN_GLSL = lin(FIRE_HEX);
export const EMBER_LIN_GLSL = lin(EMBER_HEX);

/** The linear fire colours, for the CPU side of the emitter. Same source. */
export const FIRE_LIN = new THREE.Color(FIRE_HEX);
export const EMBER_LIN = new THREE.Color(EMBER_HEX);

/**
 * THE RADIANCE OF ONE MACHINE'S FIRE, and this function is the SINGLE
 * AUTHORITY for it: `MachineFx.ts`'s GLSL is generated from the same four
 * constants below, so the light a furnace casts and the brightness it is drawn
 * at cannot drift apart. `state` and `level` are the fx texel's own z and w
 * channels, unchanged (`FactoryView.fxFor`).
 *
 * State 1 is /core's VisualState "working"; everything else is embers or cold.
 * `level` is already the breathing sine for a working machine and 0.18 for one
 * that is not, so the flicker rides through with nothing added here.
 */
export function fireRadiance(state: number, level: number,
                             out: THREE.Color): THREE.Color {
  const hot = state > 0.5 && state < 1.5;
  out.copy(hot ? FIRE_LIN : EMBER_LIN);
  return out.multiplyScalar((hot ? FIRE_L_HOT : FIRE_L_EMBER)
    * Math.max(0, level) * GLOW);
}

const DECL = /* glsl */`
  uniform float uEmitN;
  uniform float uEmitAmp;
  uniform vec4  uEmitPos[${EMIT_MAX}];
  uniform vec4  uEmitCol[${EMIT_MAX}];

  vec3 ofEmitIrradiance(vec3 ofEpW, vec3 ofEnW) {
    vec3 ofEsum = vec3(0.0);
    for (int ofEi = 0; ofEi < ${EMIT_MAX}; ++ofEi) {
      if (float(ofEi) >= uEmitN) break;
      vec3 ofEd = uEmitPos[ofEi].xyz - ofEpW;
      float ofEd2 = dot(ofEd, ofEd);
      float ofEreach = uEmitCol[ofEi].w;
      float ofEwin = clamp(1.0 - ofEd2 / (ofEreach * ofEreach), 0.0, 1.0);
      float ofEcos = dot(ofEnW, ofEd * inversesqrt(max(ofEd2, 1.0e-8)));
      float ofEwrap = max((ofEcos + ${EMIT_WRAP.toFixed(2)})
        / (1.0 + ${EMIT_WRAP.toFixed(2)}), 0.0);
      float ofEr = uEmitPos[ofEi].w;
      ofEsum += uEmitCol[ofEi].rgb
        * (ofEwrap * ofEwin * ofEwin / (ofEd2 + ofEr * ofEr));
    }
    return ofEsum * uEmitAmp;
  }
`;

/**
 * RN-2422. The declaration, exported for the terrain's own splice. See
 * EMIT_UNIFORMS for why the terrain cannot use `injectEmissiveLight`.
 */
export const EMIT_DECL_GLSL = DECL;

const F_COMMON = '#include <common>';
const F_LIGHTS = '#include <lights_fragment_begin>';

/**
 * The world position of this fragment, reconstructed from what a stock program
 * already carries rather than from a new varying. `vViewPosition` is three's
 * own `-mvPosition.xyz` (fragment TO camera, view space), and a row-vector
 * multiply by `viewMatrix` is the inverse rotation because a view matrix's
 * upper 3x3 is orthonormal -- the same identity `PropSkyAmbient` already uses
 * for its normals, in the same file's own words. So this costs no vertex-stage
 * edit and cannot fall out of step with the matrix the geometry was drawn by.
 */
const TERM = /* glsl */`
  {
    vec3 ofEmW = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
    vec3 ofEmN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    irradiance += ofEmitIrradiance(ofEmW, ofEmN) * PI;
  }
`;

const misses: string[] = [];
let spliced = 0;

interface Splicable {
  uniforms: Record<string, THREE.IUniform>;
  fragmentShader: string;
}

/**
 * Splice the term into one stock program, and take the uniform bundle BY
 * REFERENCE (DW-22: `UniformsUtils.merge` deep-clones, so an assignment here
 * is the whole of the wiring and a copy would be a term that never updates).
 *
 * Exported as a splicer rather than installed as a hook, on `PropSkyAmbient`'s
 * precedent and for its reason: a material holds ONE `onBeforeCompile`, so the
 * machine layers (which already have `MachineFx` and `PartMaterial`) and the
 * props (which already have `PropWind` or `RockShader`) can only take this by
 * having their existing hook call it.
 */
export function injectEmissiveLight(shader: Splicable): void {
  if (!EMIT_INSTALLED) return;
  for (const k of Object.keys(BUNDLE)) shader.uniforms[k] = BUNDLE[k];
  const before = shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader
    .replace(F_COMMON, `${F_COMMON}\n${DECL}`)
    .replace(F_LIGHTS, `${F_LIGHTS}\n${TERM}`);
  if (shader.fragmentShader === before) { misses.push('both anchors'); return; }
  if (!shader.fragmentShader.includes('ofEmitIrradiance(ofEmW')) {
    misses.push(F_LIGHTS);
  }
  if (!shader.fragmentShader.includes('vec3 ofEmitIrradiance')) {
    misses.push(F_COMMON);
  }
  spliced++;
}

/**
 * The probe surface, and it publishes the four things a vacuous green would
 * hide: whether any program took the splice, how many emitters were actually
 * chosen this frame, how many lost the budget, and how many three.js lights
 * exist in the near scene (which is the claim that this is not a light farm).
 */
export function emitState(): {
  installed: boolean; flagPresent: boolean; amp: number; glow: number;
  glowFlagPresent: boolean; spliced: number; misses: string[];
  max: number; registered: number; selected: number; dropped: number;
  sceneLights: number; fireHot: number; fireEmber: number; wrap: number;
  emitters: { x: number; y: number; z: number; radius: number;
              r: number; g: number; b: number; reach: number }[];
} {
  const out: Emitter[] = [];
  for (let k = 0; k < selected; ++k) {
    out.push({
      x: posData[k * 4], y: posData[k * 4 + 1], z: posData[k * 4 + 2],
      radius: posData[k * 4 + 3], r: colData[k * 4], g: colData[k * 4 + 1],
      b: colData[k * 4 + 2], reach: colData[k * 4 + 3],
    });
  }
  let reg = 0;
  for (const e of live) if (e !== null) reg++;
  return {
    installed: EMIT_INSTALLED, flagPresent: RAW !== null, amp: AMP, glow: GLOW,
    glowFlagPresent: GLOW_RAW !== null, spliced, misses: [...misses],
    max: EMIT_MAX, registered: reg, selected, dropped, sceneLights,
    fireHot: FIRE_L_HOT, fireEmber: FIRE_L_EMBER, wrap: EMIT_WRAP,
    emitters: out,
  };
}

(window as unknown as { __ofEmit: unknown }).__ofEmit = { report: emitState };
