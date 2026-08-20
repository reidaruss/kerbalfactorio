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
  out: Float32Array, position: Float32Array, height: Float32Array,
  biome: Uint8Array, verts: number, ax: number, ay: number, az: number,
): void {
  for (let i = 0; i < verts; ++i) {
    const mu = BIOME_CANOPY_MU[biome[i * 4]] ?? 0;
    const altM = height[i];
    if (mu <= 0 || altM >= CANOPY_MAX_ALT_M) { out[i] = 0; continue; }
    const wx = ax + position[i * 3];
    const wy = ay + position[i * 3 + 1];
    const wz = az + position[i * 3 + 2];
    const w = canopyWeight(altM, standAt(wx, wy, wz), groveAt(wx, wy, wz));
    out[i] = w > 0 ? w * mu : 0;
  }
}
