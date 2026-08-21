// The TERRAIN ART AMPLITUDES, read off the query string: how strong each art
// term is, and the wet band. Split out of TerrainMaterial.ts at RN-2050.
//
// One rule governs every parser here and it is RN-150's, paid for twice in
// this material: `Number(null)` is 0 and 0 is finite, so a MISSING parameter
// must read as missing and take the boot default, never as an amplitude of
// zero. `ampParam` is the one place that rule is implemented.
//
// The relief slope's GEOMETRY controls (support, wavelengths, direction field,
// horizon occlusion) are a different question and live in TerrainReliefQuery.ts.

import * as THREE from 'three';
import { FINE_ALB, FINE_BUMP, MID_ALB } from './TerrainArt.glsl.js';
import type { TerrainWaterBand } from './TerrainMaterialTypes.js';
import { SPLAT_A_VALUE, SPLAT_A_CHROMA, SPLAT_A_NORMAL }
  from './TerrainSplat.js';
import { SPLAT_A_FAR } from './TerrainCoverFar.js';
import { HORIZON_A_ANALYTIC, HORIZON_A_AO, HORIZON_A_CHROMA, HORIZON_A_NORMAL,
  HORIZON_A_VALUE,
  MASSIF_A_BUMP, MASSIF_A_M, MASSIF_A_VALUE, MASSIF_B_M, MASSIF_FADE_M }
  from './TerrainHorizon.js';

/**
 * SURFACE ART amplitudes (RN-45): macro colour variation, detail bump, rock
 * strata. See TerrainArt.glsl.ts for what each one is and why.
 *
 * Isolation is BOTH a query flag and a runtime handle, deliberately, because
 * the two answer different questions and RN-30 showed the second is the
 * stronger instrument. `?terrainart=0` and the three per-term flags give
 * standing rule 7's one-binary control over a whole session. `__ofTerrainArt`
 * lets a probe toggle a term between two SETTLED FRAMES, which holds the
 * camera, the sun, the streamed chunk set and the scatter equal by
 * construction rather than by care, and that is what makes a before/after
 * attributable to the term instead of to the run.
 *
 * Defaults are not tuned to taste. Macro 1.0 is the field's authored
 * amplitude; strata 1.0 is full bedding. Each is a multiplier ON those, so 0
 * is off and 1 is as designed.
 *
 * THE DETAIL BUMP IS BACK ON AT RN-50, on a different coordinate. Everything
 * below is the RN-45 measurement that took it OUT, kept because it is the
 * reason the term is keyed on the chunk UV rather than on planet-centred
 * metres, and because it generalises to any future screen-derivative effect on
 * a 600 km body. The artefact and the arithmetic are unchanged; what changed is
 * that the height field no longer reads a coordinate carrying a planet-scale
 * quantum. See TerrainShader's note at the ofArtBump call.
 *
 * WHAT RN-45 MEASURED AND WHY THE TERM WAS DISABLED: It is left in the build, reachable with
 * `?bumpamp=1`, because the measurement is the deliverable and the next person
 * to reach for a screen-derivative effect on this planet needs to be able to
 * reproduce it in one flag.
 *
 * WHAT HAPPENS: a field of concentric moire arcs across the ground within
 * about fifteen metres of the eye (`docs/screenshots/RN45_iso_bump.png`). No
 * number in the probe saw it. It moved 35% of the near band with a healthy
 * peak, which is exactly what a working bump would do.
 *
 * WHY, and it is arithmetic rather than tuning. A screen-derivative bump needs
 * the height field's ARGUMENT to change between adjacent pixels. The argument
 * is planet-centred metres, which is float32 and about 6e5 at Forge's surface,
 * so one ULP is 2^(19-23) = 0.0625 m. The ground under the player is seen at a
 * shallow depression angle, and at the pinned camera one pixel covers 4.3 mm of
 * ground at 2 m and 21.5 mm at 5 m. The quantum is 3 to 15 times the pixel
 * footprint, so whole runs of adjacent pixels sample the SAME quantised
 * position, `dFdx` of the field is exactly zero across them, and it steps at
 * the quantisation boundaries. Those boundaries are surfaces of constant range
 * from the eye, which is why the artefact is a set of arcs centred on the
 * player rather than noise.
 *
 * WHY IT IS NOT FIXABLE BY FADING: the term only becomes well conditioned once
 * the footprint clears the quantum, which is about 20 m (footprint 5 ULP), and
 * it starts aliasing its own 4.2 m octave once the footprint passes a third of
 * that wavelength, which is about 45 m. A twenty-five metre annulus is a band
 * of ground, not a surface treatment, and a bump that exists only in a ring
 * around the player is worse than no bump.
 *
 * WHAT WOULD FIX IT, stated so it is a dependency and not a shrug: the height
 * field needs a high-precision position, which means a per-chunk phase reduced
 * modulo the octave period on the CPU in float64 (where it is exact) and
 * carried alongside the integer cell index, so the shader adds a small local
 * offset to a small local coordinate and never forms a 6e5 intermediate. That
 * is a terrain-chunk format change and therefore world-gen's, not this lane's.
 * Note the macro colour term is UNAFFECTED and ships on: it reads the field's
 * VALUE, where 0.0625 m against an 11.9 m finest octave is 0.5% of a
 * wavelength, and only the DERIVATIVE is destroyed by the quantisation.
 */
export const ART_DEFAULT = { macro: 1.0, bump: 1.0, strata: 1.0 };

export function artAmpFromQuery(): THREE.Vector3 {
  const p = new URLSearchParams(self.location.search);
  const num = (k: string, d: number): number => {
    const v = p.get(k);
    const f = v === null ? NaN : Number(v);
    return Number.isFinite(f) ? f : d;
  };
  const all = p.get('terrainart') === '0' ? 0 : 1;
  return new THREE.Vector3(
    all * (p.get('macrovar') === '0' ? 0 : num('macroamp', ART_DEFAULT.macro)),
    all * (p.get('terrainbump') === '0' ? 0 : num('bumpamp', ART_DEFAULT.bump)),
    all * (p.get('strata') === '0' ? 0 : num('strataamp', ART_DEFAULT.strata)),
  );
}

/**
 * THE GROUND TEXTURE (RN-77/RN-78): amplitude from the query, and the texture
 * itself behind a 1x1 mid-grey placeholder so the first frame is exactly the
 * untextured frame until the PNG lands. 128 is the modulation identity by the
 * texture's own contract (every channel centred on 0.5), so "not loaded yet"
 * and "amplitude 0" are the same picture and there is no pop-to-textured race
 * a probe could catch mid-boot: a settled frame after load is the only frame
 * anyone measures.
 *
 * A failed load is a console.error, which FAILS a smoke run. That is the
 * Surfaces.ts precedent: a missing map must be loud, because an untextured
 * ground is exactly the picture this pass exists to remove.
 */
/**
 * RN-150. `Number(null)` is 0 and 0 is finite, so the original
 * `Number.isFinite(raw) ? raw : 1` made the DEFAULT branch unreachable: with
 * no query param at all the amp booted at 0, and the RN-78 ground texture
 * never drew a pixel in ordinary play. Nothing caught it because every
 * instrument SET the amp explicitly (groundshot's `art.setTex(amp)`), which
 * measured the term perfectly while the shipped default stayed dark, and the
 * invariant counts do not depend on the amp. The wet-sand band had the same
 * dead default. A missing param must read as MISSING, never as 0.
 */
function ampParam(p: URLSearchParams, key: string, fallback: number): number {
  const v = p.get(key);
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : fallback;
}

/**
 * RN-2160. The SPLAT's three amplitudes, on `fineAmpFromQuery`'s pattern
 * exactly, including RN-150's dead-default guard (`ampParam`, not
 * `Number(p.get(...))`, because `Number(null)` is 0 and 0 is finite, which is
 * how the RN-78 ground texture once shipped switched off).
 *
 * THREE knobs and not one, because they fail differently and a single switch
 * could not tell the failures apart: too much VALUE is noise, too much CHROMA
 * is a restyle of a twice-corrected palette, and too much NORMAL is a surface
 * lit like something it is not. `?splat=0` kills all three, which is the one
 * flag every before/after in this lane is taken one apart on.
 */
export function splatAmpFromQuery(): THREE.Vector3 {
  const p = new URLSearchParams(self.location.search);
  const all = p.get('splat') === '0' ? 0 : 1;
  return new THREE.Vector3(
    all * ampParam(p, 'splatval', SPLAT_A_VALUE),
    all * ampParam(p, 'splatchroma', SPLAT_A_CHROMA),
    all * ampParam(p, 'splatnrm', SPLAT_A_NORMAL),
  );
}

/**
 * RN-2195. The far-field cover convergence's OWN amplitude, separate from the
 * splat's three (`uSplatAmp`) rather than folded into the chroma one, for
 * `SPLAT_A_VALUE`/`_CHROMA`/`_NORMAL`'s own reason: this term can be wrong in
 * a way none of the near-field three are (it can green ground that should
 * stay khaki, or fail to meet the carpet at all), so it has to be isolable on
 * its own flag. `?splatfar=0` is the whole-term isolator and is what the
 * before half of every RN-2195 pair is taken with; `?splatfaramp=` sweeps it.
 * RN-150's dead-default guard applies here too (`ampParam`, not
 * `Number(p.get(...))`).
 */
export function splatFarAmpFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('splatfar') === '0') return 0;
  return ampParam(p, 'splatfaramp', SPLAT_A_FAR);
}

/**
 * RN-2340. THE FAR GROUND's four amplitudes, on `splatAmpFromQuery`'s pattern
 * exactly, including RN-150's dead-default guard (`ampParam`, not
 * `Number(p.get(...))`, because `Number(null)` is 0 and 0 is finite, which is
 * how the RN-78 ground texture once shipped switched off and how the wet-sand
 * band did the same).
 *
 * `?horizon=0` is the WHOLE-TERM isolator and is the before half of every pair
 * this lane is judged by -- and unlike `?splat=0` at range, it is a control that
 * actually moves something, which is the entire finding the lane was opened on
 * (the audit measured `?splat=0` at `flyovernoon` moving the ground below the
 * camera by 0.06 counts).
 */
export function horizonAmpFromQuery(): THREE.Vector4 {
  const p = new URLSearchParams(self.location.search);
  const all = p.get('horizon') === '0' ? 0 : 1;
  return new THREE.Vector4(
    all * ampParam(p, 'horizonval', HORIZON_A_VALUE),
    all * ampParam(p, 'horizonchroma', HORIZON_A_CHROMA),
    all * ampParam(p, 'horizonnrm', HORIZON_A_NORMAL),
    all * ampParam(p, 'horizonao', HORIZON_A_AO),
  );
}

/**
 * RN-2340. The range-aware biome-boundary break's own amplitude, separate from
 * the four above for `splatFarAmpFromQuery`'s reason: it fails in a way none of
 * them can, so it needs its own isolator. `?horizoneco=0` is the whole-term
 * control and `?horizonecoamp=` sweeps it; both are also killed by `?horizon=0`,
 * because the field the break rides is fetched by the rung itself.
 */
/**
 * RN-2340. THE MASSIF TERM's two amplitudes, on `fineAmpFromQuery`'s pattern
 * and with RN-150's dead-default guard. `?horizonmassif=0` is the whole-term
 * isolator; `?horizonmassifval=` and `?horizonmassifbump=` isolate the halves,
 * because a blotchy mountain and a corrugated one are different failures.
 *
 * IT IS NESTED UNDER `?horizon=0`, which is therefore the ONE flag that
 * restores the exact pre-RN-2340 ground. It shipped un-nested for one arm on
 * the argument that the two are different mechanisms on different coordinates
 * (`vPhase` texture rungs against `pM` octaves) answering different range
 * bands, which is true and is not a reason: what a lane's before/after pair
 * needs is a SINGLE negative control, and an un-nested second term made every
 * "before" arm in this lane silently a half-before. It was caught by a
 * committed rectangle that moved in the control arm (`vista.box` iqr read 18.71
 * against the audit's 16.35 with `?horizon=0` alone). `?horizonmassif=0` is
 * still the sub-isolator for this half on its own.
 */
export function massifAmpFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  const all = (p.get('horizon') === '0' || p.get('horizonmassif') === '0')
    ? 0 : 1;
  return new THREE.Vector2(
    all * ampParam(p, 'horizonmassifval', MASSIF_A_VALUE),
    all * ampParam(p, 'horizonmassifbump', MASSIF_A_BUMP),
  );
}

/**
 * RN-2340. The massif's two octave wavelengths in METRES. A malformed or
 * non-positive pair takes the boot default rather than being clamped into a
 * state nothing documents, which is `midM`'s own rule.
 */
export function massifMFromQuery(): THREE.Vector2 {
  const v = new URLSearchParams(self.location.search).get('horizonmassifm');
  const n = (v ?? '').split(',').map(Number);
  return (n.length === 2 && n.every((x) => Number.isFinite(x) && x > 0))
    ? new THREE.Vector2(n[0], n[1]) : new THREE.Vector2(MASSIF_A_M, MASSIF_B_M);
}

/**
 * RN-2340. The massif's distance fade-out, (start, end) in metres. A malformed
 * or non-positive pair takes the boot default rather than being clamped into a
 * state nothing documents, which is `midM`'s own rule.
 */
export function massifFadeFromQuery(): THREE.Vector2 {
  const v = new URLSearchParams(self.location.search).get('horizonmassiffade');
  const n = (v ?? '').split(',').map(Number);
  return (n.length === 2 && n.every((x) => Number.isFinite(x) && x > 0)
    && n[1] > n[0])
    ? new THREE.Vector2(n[0], n[1])
    : new THREE.Vector2(MASSIF_FADE_M[0], MASSIF_FADE_M[1]);
}

/**
 * RN-2421. THE CELL GUARD and its analytic stand-in: (armed, stand-in amplitude).
 *
 * `?horizoncell=0` is the EXACT pre-RN-2421 rung -- guard off AND stand-in off
 * in one flag -- because the two are one change: the guard retires the carrier's
 * value half where its cell grids and the stand-in is what replaces it, so an
 * arm with one and not the other is a state this material has never been in and
 * is not a before. `?horizoncellan=` sweeps the stand-in alone for the case that
 * IS a separate question ("is the replacement too strong"), and it is a
 * multiplier on HORIZON_A_ANALYTIC rather than a replacement for it, so 1 is the
 * fitted amplitude and 0 is the guard with nothing behind it.
 *
 * NESTED UNDER `?horizon=0` for massifAmpFromQuery's own recorded scar: an
 * un-nested second term makes every "before" arm a half-before, and that was
 * caught in this same file by a committed rectangle that moved in the control.
 */
export function horizonCellFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  if (p.get('horizon') === '0' || p.get('horizoncell') === '0') {
    return new THREE.Vector2(0, 0);
  }
  return new THREE.Vector2(
    1, ampParam(p, 'horizoncellan', 1) * HORIZON_A_ANALYTIC,
  );
}

/**
 * RN-2422. THE GROUND'S half of the emissive irradiance, as its own isolator.
 *
 * `?firelight=0` already multiplies the whole model by zero, and it is the
 * right control for "is the fire's light worth anything". It cannot answer the
 * question this seam adds, which is a different one: the machine half and the
 * ground half fail differently -- a shell that is too bright is a material
 * error and a ground that is too bright is a footprint of light on a surface
 * with no shadowing in it -- and one switch cannot separate them. So
 * `?firelightground=0` keeps every program and every machine surface exactly
 * as M3 shipped them and zeroes the TERRAIN's take alone, which makes the
 * night-ground pair one FLAG apart on one build instead of one build apart.
 *
 * A hard 0 or 1 rather than an amplitude, on `reliefGrad`'s precedent: what it
 * restores is a previous STATE (the ground that took no emissive light at all)
 * and an intermediate value would be neither state.
 */
export function emitGroundFromQuery(): number {
  return new URLSearchParams(self.location.search)
    .get('firelightground') === '0' ? 0 : 1;
}

export function horizonEcoFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('horizon') === '0' || p.get('horizoneco') === '0') return 0;
  return ampParam(p, 'horizonecoamp', 1);
}

export function groundTexAmpFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('groundtex') === '0') return 0;
  return ampParam(p, 'groundtexamp', 1);
}

/**
 * RN-148: the relief bump's amplitude. The same flag pattern as groundtex, and
 * the same identity argument: the placeholder is 0.5-centred, whose derivative
 * is zero, so "not loaded yet", "amplitude 0" and "flat ground" are one
 * picture. The default is deliberately far below the vnoise bump's 1.6: the
 * bump amplifies a field by its own frequency, and these fields are an order
 * finer than the vnoise octaves.
 */
// 0.08, calibrated DOWN from a first guess of 0.30 exactly as RN-78's weight
// table was measured down from 0.6: at 0.30 a grazing sun crushed every ripple
// trough to black (92% of the beach frame moved, 71% of it darker), at 0.12
// the troughs still sat near black, and 0.06 to 0.08 photographs as luminous
// rippled sand with the crests carrying the read. Grazing light is the
// calibration frame BY DESIGN; noon flattens the term (asymmetry is invisible
// at noon, reliefshot.js measures both).
const RELIEF_DEFAULT = 0.08;

export function groundReliefAmpFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('groundrelief') === '0') return 0;
  return ampParam(p, 'groundreliefamp', RELIEF_DEFAULT);
}

/**
 * RN-1733. The near-field detail layer's two amplitudes, on `specAmpFromQuery`'s
 * pattern exactly, including RN-150's dead-default guard: `Number(null)` is 0
 * and 0 is finite, so a missing parameter must read as MISSING and never as an
 * amplitude of zero. This file has shipped that bug twice already
 * (`groundtexamp` and the wet-sand band) and the failure is silent in the worst
 * direction: the feature is simply absent while every filename claims it is on.
 *
 * `?groundfine=0` is the WHOLE-TERM control and is what the before half of
 * every RN-1733 pair is taken with; `?groundfinebump=0` and `?groundfinealb=0`
 * isolate the two halves, because a bump that is too strong and an albedo that
 * is too strong are different failures and a single switch could not tell them
 * apart.
 */
export function fineAmpFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  const all = p.get('groundfine') === '0' ? 0 : 1;
  return new THREE.Vector2(
    all * (p.get('groundfinebump') === '0' ? 0 : ampParam(p, 'groundfinebumpamp', FINE_BUMP)),
    all * (p.get('groundfinealb') === '0' ? 0 : ampParam(p, 'groundfinealbamp', FINE_ALB)),
  );
}

/**
 * RN-1900. The mid-field layer's amplitude and its luminance-rule weight, on
 * `fineAmpFromQuery`'s pattern exactly, including RN-150's dead-default guard
 * (`Number(null)` is 0 and 0 is finite, so a missing parameter must read as
 * MISSING and never as an amplitude of zero; this file has shipped that bug
 * twice and the failure is silent in the worst direction).
 *
 * `?groundmid=0` is the WHOLE-TERM control and is what the before half of every
 * RN-1900 pair is taken with. `?groundmidlum=0` restores the flat amplitude
 * across every biome, a hard 0 or 1 on `reliefGrad`'s precedent, because what 0
 * restores is a KNOWN state and an intermediate value would be a blend of two
 * derivations rather than either of them.
 */
export function midAmpFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  const all = p.get('groundmid') === '0' ? 0 : 1;
  return new THREE.Vector2(
    all * ampParam(p, 'groundmidamp', MID_ALB),
    p.get('groundmidlum') === '0' ? 0 : 1,
  );
}

/**
 * RN-731: the SPECULAR LOBE's amplitude, on the groundtex/relief flag pattern
 * exactly, including RN-150's dead-default guard (`Number(null)` is 0, so a
 * missing parameter must read as MISSING and never as an amplitude of zero;
 * this file has already shipped that bug twice, in `groundtexamp` and in the
 * wet-sand band).
 *
 * The default is 1.0 rather than a fraction because the term's own strength is
 * authored inside `ofArtRough` and `ofArtSpec`, where it is a physical
 * quantity, not here. This multiplier exists to be an ISOLATOR: `?terrainspec=0`
 * restores the pure-Lambert terrain exactly, which is the before half of every
 * pair this term is judged by, one flag apart on one build under one light.
 */
export function specAmpFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  const all = p.get('terrainspec') === '0' ? 0 : 1;
  return new THREE.Vector2(
    all * (p.get('terrainspecsun') === '0' ? 0 : ampParam(p, 'terrainspecamp', 1)),
    all * (p.get('terrainspecsky') === '0' ? 0 : ampParam(p, 'terrainspecskyamp', 1)),
  );
}

/**
 * The height in metres over which ground above the waterline dries out. 0.55 m
 * is capillary rise plus the ripple's own reach, and it is generous rather than
 * physical: the terrain LOD under the player was 1.8 m when this was chosen, so
 * a band much tighter than half a metre would be thinner than the triangles
 * carrying it and would read as a jagged outline of the mesh rather than as a
 * wet margin.
 *
 * WG-186: that LOD is now 0.899 m, which only makes this constant SAFER (the
 * argument is a floor, and the floor moved down). Left at 0.55 m deliberately:
 * re-tuning it would be a look change riding on an LOD change, and the two
 * would then be inseparable.
 */
const WET_HEIGHT_M = 0.55;

export function wetBandFromQuery(w: TerrainWaterBand | null): THREE.Vector4 {
  if (w === null) return new THREE.Vector4(0, 1, WET_HEIGHT_M, 0);
  const p = new URLSearchParams(self.location.search);
  // RN-150: same Number(null)-is-0 dead default as groundtexamp; see ampParam.
  const amp = p.get('wetsand') === '0' ? 0 : ampParam(p, 'wetsandamp', 1);
  return new THREE.Vector4(w.levelM, w.shorelineM, WET_HEIGHT_M, amp);
}
