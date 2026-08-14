// ONE shared ShaderMaterial for every chunk in both scenes. Same program, same
// uniforms, so chunks batch trivially and the shader cache never thrashes; the
// far-scene variant is the same source with #define OF_SCALED, not a second
// material (ARCHITECTURE.md section 4.4).
//
// Per-chunk state is ZERO. Everything that varies per chunk arrives in the
// aBiome / aHeight / aFadeT0 attributes, which is what lets one material serve
// 250 meshes without a clone or a per-draw uniform push.
//
// The GLSL lives in TerrainShader.ts.

import * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';
import { biomeGrain, biomeMatWeights, biomeReliefWeights, biomeTint }
  from './BiomeMaterial.js';
import { biomeColorArray } from './BiomePalette.js';
import { GROUND_RELIEF_MAP, GROUND_VALUE_MAP, groundTexture } from './GroundTextures.js';
import { TERRAIN_AMBIENT, TERRAIN_SKY_AMBIENT } from './TerrainAmbient.js';
import { terrainFragmentShader, terrainVertexShader } from './TerrainShader.js';
// RN-843. The shipped support for the relief slope, now a uniform's DEFAULT
// rather than a `#define`. Imported from where it is derived and documented,
// so there is still one authority for the number and the sweep cannot drift
// from the value the sweep is measured against.
import { RELIEF_GRAD_UV, REL_SWING_DEFAULT, REL_CELL, REL_CELL_NOISE } from './TerrainArt.glsl.js';
import { FAR_SCALE } from '../Scenes.js';

// ?side= overrides this for a one-off diagnosis; the committed default is what
// the winding actually needs (see SharedIndex).
const TERRAIN_SIDE = ((): THREE.Side => {
  const s = new URLSearchParams(self.location.search).get('side');
  if (s === 'double') return THREE.DoubleSide;
  if (s === 'back') return THREE.BackSide;
  return THREE.FrontSide;
})();

/**
 * Aerial-perspective sample counts. Far cheaper than the sky quad: the segment
 * is short and nearly iso-altitude, so 4 x 2 is already smooth.
 */
const AP_VIEW_STEPS = 4;
const AP_LIGHT_STEPS = 2;

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
const ART_DEFAULT = { macro: 1.0, bump: 1.0, strata: 1.0 };

function artAmpFromQuery(): THREE.Vector3 {
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

function groundTexAmpFromQuery(): number {
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

function groundReliefAmpFromQuery(): number {
  const p = new URLSearchParams(self.location.search);
  if (p.get('groundrelief') === '0') return 0;
  return ampParam(p, 'groundreliefamp', RELIEF_DEFAULT);
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
/**
 * RN-741. Whether the relief bump takes its slope over a fixed tile-space
 * support (1, shipped) or as a screen derivative of the sampled height (0, the
 * exact pre-RN-741 path).
 *
 * This is a NEGATIVE CONTROL rather than a taste knob, so it is a hard 0 or 1
 * and not an amplitude: the thing it restores is a defect, and an intermediate
 * value would be a blend of two derivations rather than either of them.
 */
function reliefGradFromQuery(): number {
  return new URLSearchParams(self.location.search).get('reliefgrad') === '0' ? 0 : 1;
}

/**
 * RN-843. `?reliefgraduv=` overrides the support the relief slope is
 * differenced over, in TILE UNITS (one unit is one repeat of
 * `of_ground_relief`). A missing parameter is MISSING and takes the boot
 * default, never `Number(null) === 0`, which would ship the term with a zero
 * support and difference a texel against itself (NUMBERS.md, boot defaults).
 */
function reliefGradUvFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefgraduv');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : RELIEF_GRAD_UV;
}

/**
 * RN-961. `?reliefswing=` is the ripple direction's peak-to-peak swing across
 * cells, in radians. `?reliefswing=0` collapses every cell's rotation to the
 * identity and restores the pre-RN-961 sample coordinate exactly, so it is the
 * negative control for the whole term on one build rather than two commits
 * apart. A missing parameter is MISSING and takes the boot default (NUMBERS.md,
 * boot defaults), never `Number(null) === 0`, which would ship the term off
 * while every filename claimed it was on.
 */
function reliefSwingFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefswing');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : REL_SWING_DEFAULT;
}

/**
 * RN-1005. The direction field's two SCALES, on reliefSwingFromQuery's pattern.
 * `?reliefcell=` is the cell edge in tile units and `?reliefcellnoise=` is the
 * angle noise's frequency on the cell lattice. Both are strictly positive: zero
 * would divide by zero and a negative cell mirrors the lattice, so a bad value
 * takes the boot default rather than being clamped into a state nothing
 * documents.
 *
 * There is NO "off" value for either, and that is correct rather than an
 * oversight: the negative control for the whole mechanism is `?reliefswing=0`,
 * which collapses every rotation to the identity and makes both scales
 * unobservable. A second control over the same term would be two ways to
 * express one state, and the pair could disagree.
 */
function reliefCellFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefcell');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : REL_CELL;
}
function reliefCellNoiseFromQuery(): number {
  const v = new URLSearchParams(self.location.search).get('reliefcellnoise');
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : REL_CELL_NOISE;
}

/**
 * RN-842. `?horizonocc=` overrides the measured occlusion, and `?horizonocc=0`
 * is the EXACT negative control: at zero the shader's two ambient weights are
 * algebraically the pre-RN-842 expressions, so the control restores the old
 * behaviour rather than approximating it.
 *
 * Returns null when the parameter is ABSENT, which is what lets Boot tell "the
 * caller asked for zero" apart from "nobody asked". Parsing a missing flag as
 * `Number(null) === 0` is how a feature ships off with its own control
 * permanently engaged (NUMBERS.md, boot defaults).
 */
function horizonOccFromQuery(): number | null {
  const v = new URLSearchParams(self.location.search).get('horizonocc');
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(0.45, Math.max(0, n)) : null;
}

function specAmpFromQuery(): THREE.Vector2 {
  const p = new URLSearchParams(self.location.search);
  const all = p.get('terrainspec') === '0' ? 0 : 1;
  return new THREE.Vector2(
    all * (p.get('terrainspecsun') === '0' ? 0 : ampParam(p, 'terrainspecamp', 1)),
    all * (p.get('terrainspecsky') === '0' ? 0 : ampParam(p, 'terrainspecskyamp', 1)),
  );
}

/**
 * WHAT THE GROUND NEEDS TO KNOW ABOUT WATER, and it is deliberately the least
 * that will do (RN-57): a direction, two radii and a height. It is NOT a
 * WaterOracle and it is NOT `depthAt`. The ground does not ask where the water
 * is per fragment, because that would be a second consumer of the water
 * authority inside a shader, which is the DW-26 trap by another route. It is
 * handed the pond's published disc once at boot, and it darkens a band.
 */
export interface TerrainWaterBand {
  /** Unit direction of the pond centre, body frame. */
  readonly dirX: number; readonly dirY: number; readonly dirZ: number;
  /** The water surface, METRES ABOVE THE DATUM, i.e. the same frame as aHeight. */
  readonly levelM: number;
  readonly shorelineM: number;
}

/**
 * The height in metres over which ground above the waterline dries out. 0.55 m
 * is capillary rise plus the ripple's own reach, and it is generous rather than
 * physical: the shipped terrain LOD is 1.8 m under the player, so a band much
 * tighter than half a metre would be thinner than the triangles carrying it and
 * would read as a jagged outline of the mesh rather than as a wet margin.
 */
const WET_HEIGHT_M = 0.55;

function wetBandFromQuery(w: TerrainWaterBand | null): THREE.Vector4 {
  if (w === null) return new THREE.Vector4(0, 1, WET_HEIGHT_M, 0);
  const p = new URLSearchParams(self.location.search);
  // RN-150: same Number(null)-is-0 dead default as groundtexamp; see ampParam.
  const amp = p.get('wetsand') === '0' ? 0 : ampParam(p, 'wetsandamp', 1);
  return new THREE.Vector4(w.levelM, w.shorelineM, WET_HEIGHT_M, amp);
}

export interface TerrainMaterialOptions {
  readonly depth: DepthPolicy;
  readonly maxReliefM: number;
  /** The pond, or null on a dry body. See TerrainWaterBand. */
  readonly water: TerrainWaterBand | null;
  readonly atmosphere: AtmosphereUniforms;
  /** Cascade far planes in metres; the length is the cascade count. */
  readonly cascadeSplits: number[];
  readonly fadeSecs: number;
}

export interface TerrainMaterials {
  readonly near: THREE.ShaderMaterial;
  readonly far: THREE.ShaderMaterial;
  /** Push the per-frame globals. Per-chunk uniform state stays at zero. */
  update(bodyCenterEngine: THREE.Vector3, simTimeSecs: number): void;
  dispose(): void;
}

export function createTerrainMaterials(o: TerrainMaterialOptions): TerrainMaterials {
  const palette = biomeColorArray();
  // ONE Vector3 shared by both materials by reference, on the atmosphere's own
  // precedent (see the merge note below): a runtime toggle that reached the
  // near material and not the far one would be a second authority on how the
  // ground looks, which is the exact bug class this file already guards.
  const artAmp = artAmpFromQuery();
  // The ground texture (RN-78): one shared IUniform for the map, one shared
  // holder for the amplitude, the biome weight table built once. All shared
  // by reference between the two materials for the reason artAmp is.
  const groundTex = groundTexture(GROUND_VALUE_MAP);
  const groundAmp: THREE.IUniform<number> = { value: groundTexAmpFromQuery() };
  const biomeMat = biomeMatWeights();
  // RN-148: the asymmetric relief pair, shared by reference exactly as the
  // value texture is and for the same one-authority reason.
  const reliefTex = groundTexture(GROUND_RELIEF_MAP);
  const reliefAmp: THREE.IUniform<number> = { value: groundReliefAmpFromQuery() };
  const biomeRelief = biomeReliefWeights();
  // RN-1257. The per-biome material record and its two EXACT controls.
  // `?biomescale=0` writes the pre-RN-1257 frequency partition into every
  // biome, so the three-tap blend reproduces the old two-tap one to the bit;
  // `?biometint=0` writes (1,1,1) into every tint, so the modulation goes back
  // to being pure value. Both are hard 0-or-1 on reliefGrad's precedent rather
  // than amplitudes, because what they restore is a PREVIOUS STATE and an
  // intermediate value would be neither state (RN-741's argument).
  //
  // There is deliberately no third flag for the roughness table: roughness has
  // exactly one consumer, so `?terrainspec=0` already removes every effect it
  // can have, and a second control over one term is two ways to express one
  // state that can disagree (RN-1005's argument).
  const qp = new URLSearchParams(self.location.search);
  const biomeGrainW = biomeGrain(qp.get('biomescale') === '0');
  const biomeTintW = biomeTint(qp.get('biometint') === '0');
  // The wet band, likewise ONE object shared by both materials by reference so
  // a runtime tweak cannot reach one and not the other. The amplitude is zero on
  // a dry body, which is what makes `ofArtWet` return on its first line and cost
  // the fragment a compare rather than two lengths.
  // RN-731. One shared holder for the specular amplitude, by reference into
  // both materials for the same one-authority reason artAmp is: a runtime
  // toggle that reached the near material and not the far one would be a
  // second opinion about how the ground responds to light.
  const specAmp = specAmpFromQuery();
  // RN-741, shared by reference into both materials for the one-authority
  // reason artAmp is: a control that reached the near material and not the far
  // one would make the negative control a statement about one scene only.
  const reliefGrad: THREE.IUniform<number> = { value: reliefGradFromQuery() };
  // RN-843. The relief slope's SUPPORT, promoted from a `#define` to a shared
  // uniform. It was a compile-time constant because it was believed to be
  // derived and settled; it is neither (see RELIEF_GRAD_UV's note), and the
  // measurement that showed so needed to sweep it inside ONE page, one camera
  // and one streamed chunk set, which a define cannot do.
  const reliefGradUv: THREE.IUniform<number> = { value: reliefGradUvFromQuery() };
  // RN-961. Shared by reference into both materials for the one-authority
  // reason artAmp is: a control that reached the near material and not the far
  // one would make the negative control a statement about one scene only.
  const reliefSwing: THREE.IUniform<number> = { value: reliefSwingFromQuery() };
  // RN-1005. Shared by reference into both materials for the one-authority
  // reason artAmp is: a scale that reached the near material and not the far
  // one would make the sweep a statement about one scene only.
  const reliefCell: THREE.IUniform<number> = { value: reliefCellFromQuery() };
  const reliefCellNoise: THREE.IUniform<number> = { value: reliefCellNoiseFromQuery() };
  // RN-842. The body's own horizon occlusion. Written by Boot from
  // `measureHorizonOcclusion`; the boot value here is the flat-plane model, so
  // a material built before the measurement lands behaves exactly as it did
  // before RN-842 rather than guessing.
  const horizonOcc: THREE.IUniform<number> = { value: horizonOccFromQuery() ?? 0 };
  // RN-841. Shared by reference into both materials for the one-authority
  // reason artAmp is. A hard 0 or 1 and not an amplitude, on reliefGrad's
  // precedent: what 0 restores is a defect, and an intermediate value would be
  // a blend of two derivations rather than either of them.
  const bounceLit: THREE.IUniform<number> = {
    value: new URLSearchParams(self.location.search).get('bouncelit') === '0' ? 0 : 1,
  };
  const wetBand = wetBandFromQuery(o.water);
  const wetDir = new THREE.Vector3(
    o.water?.dirX ?? 0, o.water?.dirY ?? 1, o.water?.dirZ ?? 0);
  const cascades = o.cascadeSplits.length;
  const splits = new THREE.Vector3(
    o.cascadeSplits[0] ?? 1, o.cascadeSplits[1] ?? 1, o.cascadeSplits[2] ?? 1,
  );

  const make = (scaled: boolean): THREE.ShaderMaterial => {
    // UniformsLib.lights is MANDATORY for a lights:true ShaderMaterial: three
    // writes ambientLightColor / directionalLights / directionalShadowMap
    // straight into material.uniforms and throws if the slots are missing.
    const uniforms: Record<string, THREE.IUniform> =
      THREE.UniformsUtils.merge([THREE.UniformsLib.lights]);
    // Assigned AFTER the merge on purpose: merge deep-clones, and the atmosphere
    // uniforms must stay the SAME OBJECTS the sky material holds. Sharing by
    // reference is what makes "the sky and the horizon agree" structural rather
    // than something someone has to remember to synchronise.
    Object.assign(uniforms, o.atmosphere, {
      uBodyCenter: { value: new THREE.Vector3(0, 0, 0) },
      uMaxRelief: { value: o.maxReliefM },
      uBiomeColor: { value: palette },
      // THE SHARED OBJECTS, not copies of the numbers. SkyAtmosphere's ground
      // shell holds these same two so the environment's lower hemisphere is
      // computed from the terrain's own ambient model (RN-64, TerrainAmbient.ts).
      uAmbient: { value: TERRAIN_AMBIENT },
      uTime: { value: 0 },
      uFadeDur: { value: o.fadeSecs },
      uMetresPerUnit: { value: scaled ? 1 / FAR_SCALE : 1 },
      uCascadeFar: { value: splits },
      uSkyAmbient: { value: TERRAIN_SKY_AMBIENT },
      uArtAmp: { value: artAmp },
      uGroundTex: groundTex,
      uGroundTexAmp: groundAmp,
      uGroundRelief: reliefTex,
      uGroundReliefAmp: reliefAmp,
      uBiomeMat: { value: biomeMat },
      uBiomeRelief: { value: biomeRelief },
      uBiomeGrain: { value: biomeGrainW },
      uBiomeTint: { value: biomeTintW },
      uWetBand: { value: wetBand },
      uWetDir: { value: wetDir },
      uSpecAmp: { value: specAmp },
      uReliefGrad: reliefGrad,
      uReliefGradUv: reliefGradUv,
      uReliefSwing: reliefSwing,
      uReliefCell: reliefCell,
      uReliefCellNoise: reliefCellNoise,
      uHorizonOcc: horizonOcc,
      uBounceLit: bounceLit,
    });
    const m = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: terrainVertexShader(o.depth),
      fragmentShader: terrainFragmentShader(o.depth),
      // HAS_NORMAL is NOT set here: WebGLProgram already emits it for any
      // material whose geometry has a normal attribute, and defining it twice is
      // a hard compile failure. shadowmap_vertex reads it to decide whether to
      // apply the normal bias, so it must come from three, not from us.
      defines: {
        OF_CASCADES: scaled ? 0 : cascades,
        OF_AP_VIEW: AP_VIEW_STEPS,
        OF_AP_LIGHT: AP_LIGHT_STEPS,
        ...(scaled ? { OF_SCALED: 1 } : {}),
      },
      lights: true,
      side: TERRAIN_SIDE,
    });
    m.name = scaled ? 'TerrainMaterial(scaled)' : 'TerrainMaterial';
    return m;
  };

  const near = make(false);
  const far = make(true);
  // The runtime handle, on the `window.__ofSurfaces` / `window.__ofAtmos`
  // precedent. It writes the SHARED vector, so there is no path by which the
  // two materials can disagree, and it needs no uniform push because three
  // uploads a ShaderMaterial's uniforms every frame.
  (self as unknown as Record<string, unknown>).__ofTerrainArt = {
    set(macro: number, bump: number, strata: number): void {
      artAmp.set(macro, bump, strata);
    },
    get(): [number, number, number] { return [artAmp.x, artAmp.y, artAmp.z]; },
    reset(): void {
      artAmp.set(ART_DEFAULT.macro, ART_DEFAULT.bump, ART_DEFAULT.strata);
    },
    // RN-57. Same handle rather than a second one, because the wet band is a
    // terrain art term and a probe toggling it wants the SAME settled-frame
    // instrument RN-45 built for the other three.
    setWet(amp: number): number { wetBand.w = amp; return amp; },
    getWet(): [number, number, number, number] { return wetBand.toArray(); },
    // RN-78, same handle for the same reason as setWet: the ground texture is
    // a terrain art term and a probe toggling it wants the settled-frame
    // instrument, not a page reload.
    setTex(amp: number): number { groundAmp.value = amp; return amp; },
    getTex(): number { return groundAmp.value; },
    // RN-148, same handle for the same reason as setTex: the relief is a
    // terrain art term and a probe toggling it wants the settled-frame
    // instrument, not a page reload.
    setRelief(amp: number): number { reliefAmp.value = amp; return amp; },
    getRelief(): number { return reliefAmp.value; },
    /** RN-741. 1 is the band-limited tile-space slope, 0 the pre-RN-741 screen
     *  derivative. Runtime, so a probe gets RN-30's settled-frame pair rather
     *  than two page loads, which is what the shadow-LOD `k` comparison could
     *  NOT have and had to state as a bound instead. */
    setReliefGrad(v: number): number { reliefGrad.value = v > 0.5 ? 1 : 0; return reliefGrad.value; },
    getReliefGrad(): number { return reliefGrad.value; },
    reliefGradDefault(): { present: boolean; value: number } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('reliefgrad') !== null, value: reliefGradFromQuery() };
    },
    /** RN-843. The relief slope's SUPPORT in tile units, at runtime, because
     *  the shipped value is the defect and finding the right one needs a sweep
     *  inside one page rather than one build per rung. */
    setReliefGradUv(v: number): number {
      if (Number.isFinite(v) && v > 0) reliefGradUv.value = v;
      return reliefGradUv.value;
    },
    getReliefGradUv(): number { return reliefGradUv.value; },
    /** RN-843. The shipped default and whether the URL moved it, so a sweep can
     *  assert its own fixture before reading any rung (GP-142). */
    reliefGradUvDefault(): { present: boolean; value: number; shipped: number } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('reliefgraduv') !== null,
        value: reliefGradUvFromQuery(),
        shipped: RELIEF_GRAD_UV,
      };
    },
    /** RN-1000. The ripple direction's peak-to-peak swing in radians, at
     *  runtime, on setReliefGradUv's precedent exactly and for the sharper
     *  version of its reason. RN-961 shipped `?reliefswing=` and no handle, so
     *  the only available before/after pair was TWO PAGE LOADS: two streamed
     *  chunk sets, two scatter draws, two sun solves and two convergence
     *  histories, with the term's effect somewhere inside all of that. The
     *  artefact this term exists to remove is judged BY LOOKING at a pair, and
     *  a pair whose two halves differ in more than the term is not a pair. With
     *  this handle the camera, the sun, the chunks and the props are equal by
     *  construction and every moved pixel is the term's.
     *
     *  Negative values are refused rather than clamped: a negative swing is a
     *  caller error (the term is peak-to-peak) and silently reading it as its
     *  own magnitude would make a mistyped sweep look like a working one. */
    setReliefSwing(v: number): number {
      if (Number.isFinite(v) && v >= 0) reliefSwing.value = v;
      return reliefSwing.value;
    },
    getReliefSwing(): number { return reliefSwing.value; },
    /** RN-1000. The shipped default and whether the URL moved it, so a pair can
     *  assert its own fixture before reading either half (GP-142), and so the
     *  BOOT DEFAULT is assertable in its own right rather than only reachable
     *  by passing an explicit flag (RN-150: two features have already shipped
     *  dark because every probe passed one). */
    reliefSwingDefault(): { present: boolean; value: number; shipped: number } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('reliefswing') !== null,
        value: reliefSwingFromQuery(),
        shipped: REL_SWING_DEFAULT,
      };
    },
    /** RN-1005. The direction field's two scales at runtime. Strictly positive
     *  in the setter as well as in the parser, because a sweep that silently
     *  ignored a bad rung would report the PREVIOUS rung's frame under the new
     *  rung's label, which is worse than failing. */
    setReliefCell(v: number): number {
      if (Number.isFinite(v) && v > 0) reliefCell.value = v;
      return reliefCell.value;
    },
    getReliefCell(): number { return reliefCell.value; },
    setReliefCellNoise(v: number): number {
      if (Number.isFinite(v) && v > 0) reliefCellNoise.value = v;
      return reliefCellNoise.value;
    },
    getReliefCellNoise(): number { return reliefCellNoise.value; },
    reliefCellDefault(): {
      present: boolean; value: number; shipped: number;
      noisePresent: boolean; noiseValue: number; noiseShipped: number;
    } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('reliefcell') !== null,
        value: reliefCellFromQuery(),
        shipped: REL_CELL,
        noisePresent: p.get('reliefcellnoise') !== null,
        noiseValue: reliefCellNoiseFromQuery(),
        noiseShipped: REL_CELL_NOISE,
      };
    },
    /** RN-841. 1 is the unshadowed bounce source, 0 the pre-RN-841 expression. */
    setBounceLit(v: number): number { bounceLit.value = v > 0.5 ? 1 : 0; return bounceLit.value; },
    getBounceLit(): number { return bounceLit.value; },
    bounceLitDefault(): { present: boolean; value: number } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('bouncelit') !== null, value: p.get('bouncelit') === '0' ? 0 : 1 };
    },
    /** RN-842. The body's horizon occlusion. 0 is the exact flat-plane model. */
    setHorizonOcc(v: number): number {
      horizonOcc.value = Math.min(0.45, Math.max(0, v));
      return horizonOcc.value;
    },
    getHorizonOcc(): number { return horizonOcc.value; },
    horizonOccDefault(): { present: boolean; value: number | null } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('horizonocc') !== null, value: horizonOccFromQuery() };
    },
    // RN-731, same handle for the same reason as setRelief: the specular is a
    // terrain art term, and a probe toggling it wants RN-30's settled-frame
    // instrument (two frames with the camera, sun, streamed chunk set and
    // scatter equal BY CONSTRUCTION) rather than a page reload, which holds
    // none of those equal.
    /** `sun` is the GGX highlight, `sky` is the grazing sky reflection. Both
     *  are written into the SHARED vector, so the near and far materials cannot
     *  disagree, and neither needs a uniform push (three uploads a
     *  ShaderMaterial's uniforms every frame). */
    setSpec(sun: number, sky?: number): [number, number] {
      specAmp.set(sun, sky ?? sun);
      return [specAmp.x, specAmp.y];
    },
    getSpec(): [number, number] { return [specAmp.x, specAmp.y]; },
    /** The boot DEFAULT as its own fixture, separate from the live value, so a
     *  probe that always passes an explicit flag still exercises what ships
     *  (RN-150: `Number(null)` is 0 and 0 is finite). */
    specDefault(): { present: boolean; sun: number; sky: number } {
      const p = new URLSearchParams(self.location.search);
      const boot = specAmpFromQuery();
      const keys = ['terrainspec', 'terrainspecamp', 'terrainspecsun',
        'terrainspecsky', 'terrainspecskyamp'];
      return {
        present: keys.some((k) => p.get(k) !== null),
        sun: boot.x, sky: boot.y,
      };
    },
    reliefState(): { w: number; h: number } {
      const img = reliefTex.value.image as { width?: number; height?: number } | null;
      return { w: img?.width ?? 0, h: img?.height ?? 0 };
    },
    // The FIXTURE assertion for probes (INSTRUMENTS.md, GP-142): a pair taken
    // against the 1x1 placeholder is bit-identical by construction and reads
    // as a dead term when it is a dead fetch. width 1024 is "the real map is
    // bound"; width 1 is "still the placeholder".
    texState(): { w: number; h: number } {
      const img = groundTex.value.image as { width?: number; height?: number } | null;
      return { w: img?.width ?? 0, h: img?.height ?? 0 };
    },
  };
  return {
    near,
    far,
    update(bodyCenterEngine, simTimeSecs) {
      (near.uniforms.uBodyCenter.value as THREE.Vector3).copy(bodyCenterEngine);
      // The far scene puts the body centre at the scaled origin, always.
      (far.uniforms.uBodyCenter.value as THREE.Vector3).set(0, 0, 0);
      near.uniforms.uTime.value = simTimeSecs;
      far.uniforms.uTime.value = simTimeSecs;
    },
    dispose() { near.dispose(); far.dispose(); groundTex.value.dispose(); },
  };
}
