// RN-2265. THE PER-VERTEX CANOPY AREA INDEX, the CPU half of the far treeline.
//
// WHY THE FIELD IS EVALUATED HERE AND NOT IN THE SHADER, and it is not a
// preference. `ScatterTuning.standAt` / `groveAt` are trilinear value noise over
// an INTEGER LATTICE HASH (`ihash3`: three `Math.imul`s, an xor and two
// unsigned shifts, all modulo 2^32). The terrain material compiles as **GLSL ES
// 1.00** (`TerrainProgram.makeTerrainMaterial` builds a plain `ShaderMaterial`
// with `varying`/`texture2D` source and no `glslVersion`, and TerrainArt.glsl's
// own comment says so), and ESSL 1.00 has no integer type and no bitwise
// operators: a 32-bit wrapping multiply cannot be expressed there, and a highp
// float carries 24 mantissa bits, so it cannot even be emulated. An exact GLSL
// mirror of that hash is not merely awkward, it is not writable.
//
// That matters because the whole point of this term is that the material's
// clearings are the INSTANCE tier's clearings. A statistically-similar
// substitute field would put a green wash across a clearing the player can see
// trees standing around, at exactly the ranges where a 165 m stand is still ten
// pixels wide. So the field is evaluated by calling world-gen's OWN exported
// functions, at the SAME coordinates `ScatterSample.sampleChunk` calls them at
// (`anchor + chunk-local position`, see ScatterSample.ts:199-213), and handed to
// the shader as one float per terrain vertex.
//
// THE SAMPLING RATE IS THE TERRAIN MESH'S OWN, WHICH IS THE POINT. A chunk cell
// is `quadEdge / 32`: 115 m at depth 8 (the band resident across the 3.5 km
// instance handover), 230 m at depth 7, 1.8 km out at the 38 km horizon. So the
// field is sampled finely exactly where the camera is and coarsely where the
// pixels are, which is what any far-field term needs and is free here because
// the quadtree already does it. STATED LIMIT: `standAt`'s second octave is
// `STAND_DETAIL_M` = 52 m (period ~104 m) and is therefore below the mesh's
// Nyquist point at every depth this term is visible at. It contributes as extra
// raggedness on a wood's margin rather than as a resolved feature. It does not
// crawl -- it is a function of world position, so it is static aliasing, which
// reads as landscape -- and it is 0.28 of `standAt` against the 165 m octave's
// 0.72, which IS resolved (a 330 m dominant period against 115 m cells is 2.9
// samples per period).
//
// CHUNK EDGES AGREE BY CONSTRUCTION and no filtering is applied for exactly
// that reason: the value at a vertex is a pure function of its world position,
// so two chunks sharing an edge -- at the same depth or across a 2:1 depth
// boundary -- compute the same number there. Any smoothing pass, or any
// depth-dependent lowpass, would break that and draw a line along every chunk
// seam. The one place the geometry moves after upload is `EdgeStitch`, which
// snaps an edge vertex onto its coarser neighbour; `ChunkBatch.stitched`
// therefore RE-fills this attribute from the snapped positions.

import { BIOME_PROPS } from '../../assets/Registry.js';
import {
  canopyWeight, groveAt, standAt,
  TREELINE_BARE_M, TREELINE_WANDER_M,
} from '../../world/ScatterTuning.js';

/**
 * Crown PLAN AREA per canopy species, m^2, as an ellipse on the two horizontal
 * dimensions `tools/blender/contracts.json` publishes for `props_canopy`
 * (pine 3.85 x 2.55, fir 2.9 x 2.2, broadleaf 8.4 x 10.5). Quoted from the
 * contract rather than measured here, and quoted rather than imported because
 * `contracts.json` is a BUILD-TIME artifact that the client never loads.
 *
 * These are the same three numbers world-gen.md 6.9's own mix argument runs on
 * (7.7 / 5.0 / 69.3 m^2), reproduced to three decimals by pi/4 * d1 * d2.
 */
const CROWN_AREA_M2: Readonly<Record<string, number>> = {
  Canopy_Pine: Math.PI * 0.25 * 3.85 * 2.55,
  Canopy_Fir: Math.PI * 0.25 * 2.9 * 2.2,
  Canopy_Broadleaf: Math.PI * 0.25 * 8.4 * 10.5,
};

/**
 * THE CANOPY AREA INDEX PER BIOME, dimensionless, DERIVED LIVE from
 * `Registry.BIOME_PROPS` rather than copied out of it.
 *
 * `mu = sum(density_per_km2 * crownArea_m2) / 1e6`, i.e. crown plan area per
 * unit ground area inside a CLOSED stand of a closed wood -- which is exactly
 * what WG-220's tables mean (world-gen.md 6.9.1: "the density inside a closed
 * stand of a closed wood, not the average over a biome"), and exactly what
 * `canopyWeight` in [0,1] then scales.
 *
 * It is an AREA INDEX and not a coverage fraction on purpose: Forest sums past
 * 1.0 (crowns overlap), and a coverage fraction cannot represent that. The
 * shader turns it into coverage through Beer-Lambert, which is where the
 * viewing angle enters. See TerrainTreeline.ts.
 *
 * Derived rather than tabulated so that a world-gen density change moves this
 * term with it. The failure mode a copied table has here is the specific one
 * NUMBERS.md calls "a constant copied from the thing it watches".
 */
export const BIOME_CANOPY_MU: readonly number[] = BIOME_PROPS.map((specs) => {
  let sum = 0;
  for (const s of specs) {
    if (s.canopy !== true) continue;
    const a = CROWN_AREA_M2[s.stem];
    if (a === undefined) continue;
    sum += s.density * a;
  }
  return sum / 1e6;
});

/** True for any biome that places canopy trees at all. */
export const ANY_CANOPY_MU = BIOME_CANOPY_MU.some((m) => m > 0);

/**
 * RN-2511. THE MEAN PLAN AREA OF ONE PLACED BIOME PROP, m^2, and it is the one
 * FITTED number in the mid-field cover term. The whole argument for why it is
 * fitted rather than quoted -- `props_canopy` publishes a `dims_xyz_m` per
 * species and `props_plains` publishes exactly one, for its `lod0_node` -- is
 * in `render/materials/TerrainCoverFarStand.ts`, which is the consumer. It
 * lives HERE beside `CROWN_AREA_M2` because this file is where the per-biome
 * area indices are derived and a second derivation site is a second answer.
 */
export const COVER_PLAN_AREA_M2 = 0.10;

/**
 * RN-2511. THE GROUND-COVER AREA INDEX PER BIOME, dimensionless, derived LIVE
 * from `Registry.BIOME_PROPS` on `BIOME_CANOPY_MU`'s own pattern and for its
 * own reason: a copied table is "a constant copied from the thing it watches".
 *
 * Over the specs the 170 m ring actually carries: NOT the canopy (it has its
 * own tier and its own material term one range band out, and counting it here
 * would paint a wood twice) and NOT the `detail` cards (they are gone by
 * `DETAIL_RADIUS_M`, 78 m, which is well inside the ring, so they are not
 * cover the ring's edge stops delivering).
 */
export const BIOME_COVER_MU: readonly number[] = BIOME_PROPS.map((specs) => {
  let sum = 0;
  for (const s of specs) {
    if (s.canopy === true || s.detail === true) continue;
    sum += s.density;
  }
  return sum * COVER_PLAN_AREA_M2 / 1e6;
});

/**
 * The altitude past which `canopyWeight` is identically zero, so the noise is
 * never evaluated on a mountain top or anywhere on an airless body. The wander
 * term is `(stand * 2 - 1) * TREELINE_WANDER_M` with `stand` in [0,1], so the
 * highest the bare line can be pushed is `TREELINE_BARE_M + TREELINE_WANDER_M`.
 */
const CANOPY_MAX_ALT_M = TREELINE_BARE_M + TREELINE_WANDER_M;

/**
 * Fill one chunk's canopy area index, one float per vertex.
 *
 * `position` is chunk-local float32 and `anchor` is the chunk's 64-bit body
 * -frame origin, so `anchor + position` is the body-frame metre coordinate
 * `sampleChunk` samples the same fields at (standing rule 6: the sum is formed
 * in float64 here, never as an absolute planet-scale float32).
 *
 * `height` is /core's own datum height (the `aHeight` attribute, which the
 * fragment shader reads as `vRelief` and the snowline divides by `uMaxRelief`),
 * standing in for `sampleChunk`'s `hypot(w) - bodyRadiusM`. The two are the same
 * quantity and using this one costs no hypot and needs no body radius plumbed
 * through the chunk path. THE NEGATIVE CONTROL FOR THAT SUBSTITUTION IS THE
 * `vista` POSE: it stands on a 4.7 km ridge, well past `CANOPY_MAX_ALT_M`, so if
 * these were not the same quantity the ridge would go green.
 */
export function fillCanopyIndex(
  out: Float32Array, cover: Float32Array | null,
  position: Float32Array, height: Float32Array,
  biome: Uint8Array, verts: number, ax: number, ay: number, az: number,
): void {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < verts; ++i) {
    const b = biome[i * 4];
    const mu = BIOME_CANOPY_MU[b] ?? 0;
    const cmu = BIOME_COVER_MU[b] ?? 0;
    const altM = height[i];
    // RN-2511. The two consumers gate differently and the OR is deliberate:
    // the canopy index is only meaningful where a biome plants trees and below
    // the treeline, but the GROUND-COVER field is meaningful anywhere the
    // 170 m prop ring places anything at all -- a beach carries driftwood and
    // dune grass and no canopy, and its mid field is as bald as the plains'.
    // Evaluating the two noise fields once and spending them twice is what
    // makes the second consumer free wherever the first one already ran.
    if ((mu <= 0 || altM >= CANOPY_MAX_ALT_M) && cmu <= 0) {
      out[i] = 0;
      if (cover !== null) cover[i] = 0;
      continue;
    }
    const wx = ax + position[i * 3];
    const wy = ay + position[i * 3 + 1];
    const wz = az + position[i * 3 + 2];
    const sa = standAt(wx, wy, wz);
    const ga = groveAt(wx, wy, wz);
    if (cover !== null) cover[i] = coverField(sa, ga);
    if (mu <= 0 || altM >= CANOPY_MAX_ALT_M) { out[i] = 0; continue; }
    const w = canopyWeight(altM, sa, ga);
    const v = w > 0 ? w * mu : 0;
    out[i] = v;
    s1 += v;
    s2 += v * v;
  }
  if (s1 > 0) accumulateCanopyMu(s1, s2);
}

/**
 * RN-2511. THE GROUND-COVER FIELD in [0,1], and it is world-gen's two stand
 * octaves BEFORE `canopyWeight`'s thresholds rather than after them.
 *
 * THE MEASUREMENT THAT FORCED THIS, and it is the finding this function exists
 * to record. The first version of RN-2512's mid-field term drove itself off
 * `canopyWeight` -- the same [0,1] the trees are placed by -- on the argument
 * that the ground's mosaic should be the instance tier's mosaic. It is not
 * usable for that: `canopyWeight` is `ramp(stand, STAND_LO, STAND_HI)` times
 * `ramp(grove, GROVE_LO, GROVE_HI)`, i.e. two hard thresholds, and the
 * realised field is BIMODAL -- planetary mean 0.308 with sd 0.345, min 0.012,
 * max 1.000. It is a wood/no-wood decision and it is right to be. Painted as a
 * three-threshold ladder at the plains art pose, EVERY terrain row from the
 * 170 m ring to the horizon came back at the top step, saturated to the digit
 * across thirteen rows (r 142.0 / g 156.0 with an off level of 7.0): the
 * observer stands inside one closed stand and the whole mid field is inside
 * it. A term referenced to a saturated field has nothing to say.
 *
 * The two octaves UNDER the thresholds are smooth trilinear value noise on
 * [0,1], and they are what a plain's ground cover actually looks like: a
 * continuous rise and fall at the stand's 165 m and the grove's 760 m, denser
 * where the copses are because it is the same field the copses are cut from.
 *
 * 0.65 / 0.35 rather than an even split because the 165 m octave is the one
 * that resolves as FIELD-SCALE structure at the ranges this term is visible at
 * (a 165 m feature at 250 m is a third of the frame's width; a 760 m one is
 * the whole of it, i.e. a level and not a mosaic), and the grove octave's job
 * here is to keep two neighbouring fields from reading as the same field.
 */
export function coverField(stand: number, grove: number): number {
  return 0.65 * stand + 0.35 * grove;
}

/**
 * RN-2275. THE CANOPY-AREA-WEIGHTED MEAN OF THIS FIELD, and it exists because
 * the near canopy CARDS need a `mu` and cannot sample the attribute above.
 *
 * THE DEFECT IT FIXES WAS MEASURED, NOT ANTICIPATED. The card half of the
 * inter-crown self-shadow first used the biome's CLOSED-STAND index on the
 * argument that a card is by definition inside a stand. It is, but the PAINT
 * behind it at the same pixel uses `mu_biome * canopyWeight` at that point, and
 * across a Forest frame `canopyWeight` averages well under 1. So the cards came
 * out about 40 per cent darker than the ground they hand over to, and
 * `forestair`'s boundary pair caught it: the `treeIn` / `treeOut` step went from
 * 0.42 BELOW the no-vegetation gradient to 3.67 ABOVE it, i.e. the handover
 * 2.18.6 proved invisible had been re-opened by the fix for a different defect.
 *
 * `sum(mu^2) / sum(mu)` IS THE RIGHT ESTIMATOR AND NOT A FUDGE. A plain mean
 * over vertices answers "how much canopy is there per unit GROUND", which is
 * the wrong question, because a card is never in a clearing -- it is placed
 * with probability proportional to the density. Weighting each sample by its
 * own canopy area answers "what is the density AT a place that has crowns in
 * it", which is exactly the neighbourhood a card stands in. It is read off the
 * very field the paint uses, at the very vertices the paint is evaluated at, so
 * the two halves cannot be reading different worlds.
 *
 * THE DECAY IS WHAT MAKES IT LOCAL. Chunks are re-uploaded as the quadtree
 * streams, near chunks carry far more vertices than horizon ones, and a plain
 * running total over a session would slowly become a planetary average. 0.98
 * per fill keeps the estimator inside the neighbourhood the player is actually
 * in; it converges well inside a settle, which is why the probe's numbers
 * reproduce to two decimals across fresh processes.
 *
 * STATED LIMITS, both real: it is ONE number for the whole frame, so a card
 * standing in an unusually dense pocket is still lit by the neighbourhood's
 * average rather than its own; and it lags by a few fills when the camera
 * crosses a biome edge at speed. The exact fix for both is a per-instance
 * channel, and the only one a `BatchedMesh` card has is its tint, which
 * `tintFor` already owns -- see rendering.md 2.19.6.
 */
let muS1 = 0;
let muS2 = 0;
const MU_DECAY = 0.98;

function accumulateCanopyMu(s1: number, s2: number): void {
  muS1 = muS1 * MU_DECAY + s1;
  muS2 = muS2 * MU_DECAY + s2;
}

/**
 * The canopy-area-weighted mean index over the resident field, or 0 before any
 * chunk with canopy in it has been filled. Read once per frame by
 * `CanopySelfShadow.updateCanopyCardShade`.
 */
export function residentCanopyMu(): number {
  return muS1 > 0 ? muS2 / muS1 : 0;
}
