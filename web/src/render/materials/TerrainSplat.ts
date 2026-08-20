// THE TERRAIN SPLAT LAYER TABLE: the six material layers' file names, world
// tiles, hues and roughness bases, and the two fade bands. Constants and one
// assertion; no GLSL (TerrainSplat.glsl.ts) and no uniforms (TerrainUniformState).
//
// RN-2160, fidelity lane A3 phase 1. The gap analysis's section 1 difference 2:
// "their terrain wears materials; ours wears a palette". tools/blender/
// terraintex.py generates the layers; this file is the client half of the same
// contract and the two are checked against each other by of_terrain.json.
//
// ---------------------------------------------------------------------------
// WHY THE HUE IS HERE AND NOT IN THE PIXELS
// ---------------------------------------------------------------------------
// Each layer ships ONE RGBA texture: R albedo value, G/B normal xy, A roughness
// detail, every channel centred on 0.5. There is no albedo COLOUR in the
// asset, and that is the same decision texgen made for its surface families
// ("ALBEDO IS DELIBERATELY ABSENT ... an albedo map multiplies that colour and
// is therefore the one map that can silently move the palette") and for its
// card families ("near-neutral VALUE textures: hue still comes from the
// client's colours"). It buys three things at once:
//
//   1. SIX SAMPLERS INSTEAD OF EIGHTEEN. Six layers times albedo/normal/ORM is
//      eighteen texture units and WebGL2 guarantees sixteen in total.
//   2. THE PALETTE STAYS THE COLOUR AUTHORITY. BiomePalette's ten hexes and
//      BiomeMaterial's tint table still decide what a biome IS; the splat
//      decides what its SURFACE is.
//   3. THE CONVERGENCE RULE BECOMES ARITHMETIC. See below.
//
// ---------------------------------------------------------------------------
// THE CONVERGENCE RULE, in full, because section 3 of the brief asks for it to
// be STATED and because a rule nobody wrote down is a rule nobody kept
// ---------------------------------------------------------------------------
// The palette drives the far colour and the minimap. The near layers must
// arrive at exactly the palette tone at the fade boundary, or the world changes
// colour as the player walks. Four clauses, and each is either arithmetic or
// asserted:
//
//   C1. EVERY CHANNEL OF EVERY LAYER HAS MEASURED MEAN 0.5 (terraintex `check`
//       asserts it on the shipped bytes, all four channels, all six layers,
//       tolerance 0.006). So the mip chain's own limit is the identity: albedo
//       x 1.0, normal (0,0,1), roughness x 1.0.
//   C2. THE VALUE TERM IS MEAN-PRESERVING PER CHANNEL. It is applied as
//       `albedo *= 1 + A * v * vTint.xyz` over a v that is centred on zero, so
//       it moves each channel's SPREAD and leaves its LEVEL alone. This is the
//       macro tint's own scar (TerrainFragSetup: a variation term that moved
//       the level was "a colour grade wearing a variation layer's clothes").
//   C3. THE CHROMA TERM IS LUMINANCE-PRESERVING. Every hue vector below is
//       normalised so its Rec.709 luminance is exactly 1, and the shader's hue
//       is a CONVEX COMBINATION of them (the weights sum to 1 by construction).
//       Luminance is linear, so a convex combination of unit-luminance vectors
//       has unit luminance: the term can rotate hue and cannot move value.
//       `assertHueLuminance()` below is the guard, and it runs at module load.
//   C4. BOTH FADES REACH ZERO INSIDE THE NEAR FIELD, and neither band is a new
//       number. The value and chroma band is `35 to 75 m`, which is texW's own
//       band verbatim, so the splat retires exactly where the existing ground-
//       texture term retires and phase 2 inherits ONE boundary rather than two.
//       The normal and roughness band is `30 to 60 m`, which is the relief
//       bump's band verbatim, for the reason that term states out loud: the
//       chunk UV's world size doubles at every LOD step, and 30-to-60
//       completes inside the max-depth ring where the UV scale is constant.
//
// Past 75 m the ground is bit-for-bit what it is today. That is the whole
// harmony claim and it is checkable with one flag (`?splat=0`).
//
// C4 IS A BACKSTOP AND NOT THE MECHANISM, and that is worth stating plainly
// because the first version of this comment implied otherwise. A one-variable
// control (`?splatfade=300,600,300,600`, one flag apart on one build) moved the
// 35 m strip's contrast by 0.00 and the 27 m strip's by 0.07 counts, i.e. the
// bands were doing nothing at all: C1 gets there first, because a fully
// minified sample IS the identity and the mip chain reaches that around 30 m
// where the pixel footprint passes a metre. The bands still ship, because a
// backstop that is never reached costs one smoothstep and is the thing that
// holds if a future tile scale or a coarser rung changes where minification
// lands. SPLAT_COARSE_RATIO below is the answer to the range that control
// exposed.
//
// ---------------------------------------------------------------------------
// THE UV SCHEME, AND THE SEAM PHASE 2 EXTENDS ALONG
// ---------------------------------------------------------------------------
// The layers ride `vChunkUv` at INTEGER repeats per quad, which is RN-78's
// seam argument unchanged: at a shared edge between same-depth chunks one
// chunk's fract(k * 1.0) meets the other's fract(k * 0.0) and the phase is
// continuous by arithmetic. The repeat counts below are derived from the
// max-depth quad (FINE_CHUNK_M, imported rather than transcribed) and rounded
// to integers, so each layer's WORLD tile is the authored metres to within the
// rounding, published in `SPLAT_LAYERS[i].actualTileM`.
//
// The honest cost is the one the bump chunk already records: the UV normalises
// over the quad, so a coarser LOD ring draws these layers at double the world
// scale. C4's bands are what keep that outside the term. THE REAL FIX IS NOT A
// SHADER CHANGE and it is already named by TerrainArt.glsl's header: a
// per-chunk phase attribute reduced mod the tile period on the CPU in float64.
// That is a terrain-chunk format change and therefore world-gen's to make, and
// it is what would let a splat layer be world-locked at a fixed metre scale all
// the way out. Phase 2's far-field band needs exactly that, so it is flagged as
// a cross-domain contract rather than worked around here.

import * as THREE from 'three';
import { FINE_CHUNK_M } from './TerrainFine.glsl.js';

/** One layer's client-side record. Index order IS of_terrain.json's `order`. */
export interface SplatLayer {
  readonly name: string;
  readonly file: string;
  /** Authored world metres per repeat; of_terrain.json's `tile_m`. */
  readonly tileM: number;
  /** Repeats per max-depth quad. INTEGER, for RN-78's chunk-edge seam. */
  readonly repeats: number;
  /** The COARSE rung's repeats. Also integer, also for the seam. */
  readonly coarseRepeats: number;
  /** What `repeats` actually lands the tile at, after the rounding. */
  readonly actualTileM: number;
  /** What `coarseRepeats` lands the coarse tile at. */
  readonly coarseTileM: number;
  /** Rec.709-unit-luminance hue multiplier. See C3. */
  readonly hue: THREE.Vector3;
  /** Roughness the layer converges to when its detail channel minifies. */
  readonly roughBase: number;
}

/**
 * THE AUTHORED TABLE, before normalisation. `hueRaw` is written the way an
 * artist would say it (grass is greener and less blue than the palette; dirt is
 * warmer; snow is a touch cooler) and `assertHueLuminance` below divides each
 * one by its own luminance, so a row can be edited without anyone having to do
 * the arithmetic by hand and get it wrong. Writing pre-normalised triples here
 * would be three numbers that must agree with a fourth that is not written
 * down, which is how the macro tint shipped a 13 per cent net blue reduction.
 *
 * The SIZES are small on purpose. These are near-field surface layers sitting
 * ON a palette that has already been colour-corrected twice (RN-347 moved four
 * biomes toward the soil they stand on; the fidelity gap asks for LESS
 * saturation, not more). A hue term that reaches +/-20 per cent per channel is
 * a restyle, and a restyle is not this lane's to make.
 */
const AUTHORED: ReadonlyArray<{
  name: string; tileM: number; hueRaw: [number, number, number];
  roughBase: number;
}> = [
  // grass: greener and a little darker-blue than the ground it sits on. This
  // is the layer A2's instanced blades have to meet, so it is deliberately the
  // strongest chroma in the table: the fidelity gap's difference 1 is that our
  // ground reads as a table with objects on it, and half of that fix is the
  // substrate agreeing with the cover about what colour a meadow is.
  { name: 'grass', tileM: 2.0, hueRaw: [0.90, 1.08, 0.84], roughBase: 0.94 },
  // dirt: warm, and the warmest row here. Dry soil is the one natural surface
  // whose hue is unambiguous.
  { name: 'dirt', tileM: 2.0, hueRaw: [1.10, 0.99, 0.82], roughBase: 0.96 },
  // rock: very nearly neutral, a hair warm. Whatever a rock's colour is, it is
  // the palette's job (Mountains is 0x7c7a74 and CraterFloor 0x5c574e, and
  // those are different rocks); this layer's job is the FACETS.
  { name: 'rock', tileM: 2.0, hueRaw: [1.02, 1.00, 0.97], roughBase: 0.76 },
  // cliff: neutral with a faint warm cast for the iron staining the value
  // channel already carries as a wash.
  { name: 'cliff', tileM: 3.0, hueRaw: [1.03, 1.00, 0.96], roughBase: 0.70 },
  // scree: fresh fracture, so very slightly COOL against the rock it broke off
  // (an unweathered face has not stained yet). It is the only pair in the table
  // that differentiates by hue at all, and it is a two per cent difference.
  { name: 'scree', tileM: 2.0, hueRaw: [0.99, 0.99, 1.03], roughBase: 0.84 },
  // snow: cool, and the cool is nearly all of what snow's albedo does. The
  // world audit's gap 10 (snow "reads as paint") is a MATERIAL complaint, and
  // this row is the smallest part of the answer: the normal and the roughness
  // are the rest.
  { name: 'snow', tileM: 4.0, hueRaw: [0.97, 0.99, 1.07], roughBase: 0.54 },
];

/** Rec.709 luminance, the same weights the rest of the renderer uses. */
export function luma709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * C3's guard. It runs at module load, on the NORMALISED table, and it throws
 * rather than warning. A hue vector whose luminance drifts off 1 turns the
 * chroma term into a value term, which is exactly the failure the macro tint
 * shipped and the probe caught as a 5.03 per cent level drop; there is no
 * useful degraded mode where the world is quietly two per cent darker inside
 * 75 m and correct outside it, because that IS the seam this lane exists to
 * not have.
 */
export function assertHueLuminance(layers: ReadonlyArray<SplatLayer>): void {
  for (const l of layers) {
    const y = luma709(l.hue.x, l.hue.y, l.hue.z);
    if (Math.abs(y - 1) > 1e-6) {
      throw new Error(`[of] splat layer ${l.name}: hue luminance ${y}, not 1. `
        + 'The chroma term would move value and the palette would not converge.');
    }
  }
}

function build(): SplatLayer[] {
  return AUTHORED.map((a) => {
    const y = luma709(a.hueRaw[0], a.hueRaw[1], a.hueRaw[2]);
    // INTEGER repeats, from the max-depth quad. Math.max(1) rather than a bare
    // round, because a tile larger than the quad would round to zero repeats
    // and a zero repeat is a constant-colour chunk, which is a silent failure.
    const repeats = Math.max(1, Math.round(FINE_CHUNK_M / a.tileM));
    const coarseRepeats = Math.max(1, Math.round(repeats / SPLAT_COARSE_RATIO));
    return {
      name: a.name,
      file: `of_terrain_${a.name}.png`,
      tileM: a.tileM,
      repeats,
      coarseRepeats,
      actualTileM: FINE_CHUNK_M / repeats,
      coarseTileM: FINE_CHUNK_M / coarseRepeats,
      hue: new THREE.Vector3(a.hueRaw[0] / y, a.hueRaw[1] / y, a.hueRaw[2] / y),
      roughBase: a.roughBase,
    };
  });
}

/**
 * THE COARSE RUNG, and it exists because a one-variable control said the fade
 * bands were not doing the job anyone thought they were doing.
 *
 * WHAT WAS MEASURED (RN-2160, the `midfield` pose at the plains site, three
 * arms one flag apart on one build). With the splat off, the 27 m strip reads
 * iqr 12.34; with it on, 18.06, a +46 per cent recovery of mid-field contrast.
 * At 35 m the same term reads 17.92 off and 17.84 on: NOTHING. Pushing the
 * fade band out to `?splatfade=300,600,300,600` moved that 17.84 to 17.84 and
 * the 27 m figure to 17.99, i.e. inside the noise of the arm it was taken
 * against. So the fade is not what retires this term at range. THE MIP CHAIN
 * IS, and it gets there first: at 35 m the pixel footprint is 0.957 m against
 * a 2 mm texel, which is mip 8, and clause C1 guarantees that a fully minified
 * sample IS the identity. The convergence rule was doing its job about forty
 * metres earlier than the fade band was written for.
 *
 * That is the right behaviour and the wrong range. The fix is the standard one
 * and it is also exactly what phase 2 extends: a SECOND, COARSER TAP of the
 * same six textures, cross-faded in on the pixel footprint as the fine tap
 * minifies. A ratio of 4 puts the coarse rung's tile at 7.2 to 14.5 m, whose
 * content survives to the far end of the near field, and it costs six more
 * fetches inside the same draw call rather than any new state.
 *
 * WHY A SECOND TAP AND NOT A BIGGER TILE. A single 8 m tile would read at
 * range and be visibly soft underfoot: 1024 px over 8 m is 128 texels/m
 * against the 512 texels/m ASSET-SPECS 2.8 asks for at first-person range, and
 * the near field is where a player's face is. Two rungs keep both ends.
 *
 * WHY NOT A THIRD RUNG NOW. That IS phase 2 (the audit's 75 to 600 m hole),
 * and it wants a different coordinate as well as a different scale: past the
 * max-depth ring the chunk UV's world size doubles per LOD step, so the far
 * rung needs world-gen's per-chunk float64 phase attribute. Adding a third
 * rung on the chunk UV would put a scale step in the exact band phase 2 has to
 * make seamless.
 */
export const SPLAT_COARSE_RATIO = 4;

/**
 * The footprint band, in METRES of pixel footprint, over which the coarse rung
 * takes over from the fine one.
 *
 * KEYED ON footM AND NOT ON dist, which is the rule the whole material already
 * follows and for the reason TerrainFragSetup states: at a grazing pose the
 * dFdy arm binds and grows as the SQUARE of the range, so a distance-keyed
 * handover would swap rungs at one range looking down and a completely
 * different one looking along the ground. The measured footprints at the
 * `midfield` pose are 0.257 m at 18 m, 0.572 m at 27 m and 0.957 m at 35 m, so
 * 0.15 to 0.60 puts the crossover through the band where the fine rung's own
 * contrast was measured collapsing.
 */
export const SPLAT_COARSE_FOOT: readonly [number, number] = [0.15, 0.60];

/** The six layers, in of_terrain.json's `order`. */
export const SPLAT_LAYERS: ReadonlyArray<SplatLayer> = build();
assertHueLuminance(SPLAT_LAYERS);

/** The six file names, named once so a typo is a build error. */
export const SPLAT_MAPS: ReadonlyArray<string> = SPLAT_LAYERS.map((l) => l.file);

/**
 * C4's two bands, in metres, as [start, end] of the smoothstep.
 *
 * NEITHER PAIR IS A NEW NUMBER and that is deliberate: both are lifted from a
 * shipped term in this same material together with the argument that chose
 * them, so this lane has no fade constants of its own to defend and no way to
 * put a second boundary where the material already has one.
 */
export const SPLAT_FADE_ALBEDO: readonly [number, number] = [35, 75];
export const SPLAT_FADE_NORMAL: readonly [number, number] = [30, 60];

/**
 * The three amplitudes, and they are three rather than one because they FAIL
 * DIFFERENTLY and therefore have to be isolable separately, which is uFineAmp
 * and uSpecAmp's own argument.
 *
 *   x  VALUE.  Too high and the ground reads as noise again, one octave
 *              coarser than the noise it replaced.
 *   y  CHROMA. Too high and this is a restyle of a twice-corrected palette.
 *   z  NORMAL and ROUGHNESS, together, because they are one claim: a facet
 *              that catches the sun has to be both tilted and smooth, and
 *              splitting them lets a sweep produce a surface that is lit like
 *              rock and shiny like nothing.
 */
export const SPLAT_A_VALUE = 0.85;
export const SPLAT_A_CHROMA = 0.55;
export const SPLAT_A_NORMAL = 1.0;

/**
 * The UV WARP amplitude, in CHUNK UV UNITS, and it is the anti-tiling term.
 *
 * At the shipped repeats a 2 m layer puts about fourteen copies across a
 * max-depth quad, and a walking player crosses six of them in ten seconds, so
 * the tile grid is readable as a marching lattice. Three things break it and
 * this is the cheapest of the three: a low-frequency warp of the sample
 * coordinate, periodic on the chunk (so it adds no seam), which bends the
 * lattice instead of repeating it. The other two are free: the layer WEIGHTS
 * are broken up by a patch field at an incommensurate 9.6 m, and each layer
 * carries its own UV phase offset so the six lattices do not share an origin.
 *
 * 0.006 IS A DERIVATIVE BUDGET, NOT A LOOK. The warp perturbs the UV
 * derivative by roughly amplitude x 2 pi / wavelength = 0.006 x 6.28 x 3 = 11
 * per cent, which moves the hardware mip choice by log2(1.11) = 0.15 of a
 * level, i.e. invisibly. At 0.02 it would be a 38 per cent derivative
 * perturbation and half a mip level, and the term would be paying for its
 * anti-tiling in filtering.
 *
 * IT IS NOT A FULL ANSWER AND IS NOT CLAIMED AS ONE. Stochastic or hex-tile
 * sampling is the real fix and it costs three taps per layer; at six layers
 * that is eighteen fetches and this lane does not have that budget. Recorded
 * as owed, next to phase 2.
 */
export const SPLAT_WARP_UV = 0.006;

/** Repeats per quad of the warp and patch fields. INTEGER, for the seam. */
export const SPLAT_WARP_REPEATS = 3;
export const SPLAT_PATCH_REPEATS = 3;
