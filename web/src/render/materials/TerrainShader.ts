// The terrain GLSL. Split out of TerrainMaterial.ts so that file stays a
// material factory and both stay inside the 400-line cap (2.2 rule 1).
//
// Three things happen here that are load-bearing for W3:
//
//  1. AERIAL PERSPECTIVE is computed IN THIS MATERIAL from the shared
//     Atmosphere.glsl model, not as a post pass. The scaled far scene runs the
//     SAME code with uMetresPerUnit = 1e5, so the horizon of the near scene and
//     the limb of the far scene are the same integral and cannot seam.
//  2. SHADOWS come from three's own shadow chunks. Cascade selection is by view
//     depth with constant sampler indices, because GLSL ES 3.00 forbids dynamic
//     indexing of a sampler array.
//  3. The STREAM-IN CROSS-FADE is an ordered 4x4 dither driven by a per-chunk
//     start time in an attribute plus one global uTime, so nothing per-chunk has
//     to be pushed per frame.
//
// RN-2051. The fragment source is now assembled from FIVE named chunks in one
// place. The chunks are concatenated with NOTHING between them, because each
// carries its own leading newline and no trailing one, so
//   original = "\n" + lines[45..881].join("\n") + "\n  "
// and the split is that same expression regrouped. This is the mechanism this
// file already used four times (RN-78's CASCADE_GLSL, RN-148's
// TerrainVertex/TerrainDither, and the two imported pars libraries), taken as
// far as it goes: what is left here is the assembly and the two re-exports.
//
// It was NOT decomposed into GLSL helper functions, and that is a measurement
// rather than a preference: 21 locals in main() live across the section
// boundaries, six of them declared inside `#ifndef OF_SCALED` regions and three
// of them mutable, so helper signatures would have had to be preprocessor-
// guarded and passing `n` and `lit` through calls would reorder float ops. A
// text split reorders nothing, and its correctness is a string comparison
// rather than a frame.

import type { DepthPolicy } from '../DepthPolicy.js';
import { terrainFragPars } from './TerrainFragPars.glsl.js';
import { terrainFragSetup } from './TerrainFragSetup.glsl.js';
import { TERRAIN_FRAG_ALBEDO } from './TerrainFragAlbedo.glsl.js';
import { TERRAIN_FRAG_BUMP } from './TerrainFragBump.glsl.js';
import { TERRAIN_FRAG_LIGHT } from './TerrainFragLight.glsl.js';
// RN-2340. A SIXTH chunk, and the first one that is not inside the near
// material's `#ifndef OF_SCALED`: the massif term's normal half reaches the
// SCALED shell, which is where the ridges past the chunk-depth cutoff are
// actually drawn. See TerrainHorizon.glsl.ts.
import { TERRAIN_HORIZON_BUMP } from './TerrainMassif.glsl.js';

// The VERTEX shader and BAYER moved to TerrainVertex.glsl.ts and
// TerrainDither.glsl.ts at RN-148 (line-cap room; GLSL unchanged to the
// character), on RN-78's CASCADE_GLSL precedent. Both re-exported or imported
// here so every published import site holds.
export { terrainVertexShader } from './TerrainVertex.glsl.js';

// Moved to CascadeShadow.glsl.ts at RN-78 (line-cap room; GLSL unchanged to
// the character). Re-exported so RN-52's published import site still holds.
export { CASCADE_GLSL } from './CascadeShadow.glsl.js';

/** `void main() {` and its closing brace, the two lines the chunks sit between. */
const MAIN_OPEN = '\n    void main() {';
const MAIN_CLOSE = '\n    }\n  ';

export function terrainFragmentShader(depth: DepthPolicy): string {
  return terrainFragPars(depth)
    + MAIN_OPEN
    + terrainFragSetup(depth)
    + TERRAIN_FRAG_ALBEDO
    + TERRAIN_FRAG_BUMP
    + TERRAIN_HORIZON_BUMP
    + TERRAIN_FRAG_LIGHT
    + MAIN_CLOSE;
}
