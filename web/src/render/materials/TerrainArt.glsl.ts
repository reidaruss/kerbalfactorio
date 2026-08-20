// The terrain's SURFACE ART: a macro variation field, a derivative bump, and
// rock strata. GLSL text only, no uniforms declared here; TerrainShader.ts
// declares them and calls these three functions.
//
// The EIGHTH term, the near-field detail layer (RN-1730 to RN-1735), lives in
// TerrainFine.glsl.ts and is imported and re-exported here, so this file stays
// the one place to look for "what surface-art terms exist" while none of them
// has to live in a file that is already 2.3x over the line cap.
//
// Split out of TerrainShader.ts at the 400-line cap (2.2 rule 1), and worth
// reading on its own because all three answer the same complaint: the ground is
// FLAT COLOUR. Every fragment of one biome on one slope is currently the exact
// same RGB, and a hillside made of one RGB reads as a painted backdrop at every
// distance, which is the largest per-pixel gap between this and the reference.
//
// ---------------------------------------------------------------------------
// WHY THIS IS IN THE TERRAIN AND NOT IN NEW ROCK MESHES
// ---------------------------------------------------------------------------
// The brief ranked "rocks and cliffs, ours are smooth low-poly blobs" above
// this. It was reordered, and this is the reason, stated so it can be argued
// with: IN THIS ENGINE A CLIFF IS TERRAIN, NOT A PROP. The rock props are
// boulders, they are metre-scale, and the scatter ring is 170 m. Every actual
// cliff, cut bank, ravine wall, crater rim and mountain flank in the world is
// drawn by THIS material, through the one `rock` constant on the steep branch,
// which was `vec3(0.30, 0.28, 0.26)` and nothing else. So "layered strata and
// real silhouettes on cliffs" is a shader item that reaches every cliff face on
// the planet, and the mesh item reaches a few hundred boulders. The mesh item
// is still real and is specified as an art request; it is second.
//
// ---------------------------------------------------------------------------
// PRECISION, WHICH IS THE ONE HARD CONSTRAINT HERE
// ---------------------------------------------------------------------------
// The noise phase is PLANET-CENTRED METRES (`pM`), not engine space, and that
// is not a style choice. Engine space rebases under the floating origin, so a
// field keyed on `vWorld` would SWIM across the ground every time the origin
// moved. `pM` is stable by construction because both terms of `vWorld -
// uBodyCenter` move together.
//
// The cost of that choice is precision, and it sets a hard floor on the finest
// octave. `pM` is float32 and is about 600e3 on Forge's surface, i.e. 2^19.2,
// so one ULP is 2^(19-23) = 0.0625 m. A 4.2 m octave therefore quantises to
// about 1.5% of its own wavelength, which is invisible; a 0.5 m octave would
// quantise to 12.5% and would render as visible stair-stepping. SUB-METRE
// DETAIL IS NOT REACHABLE FROM pM AND IS NOT ATTEMPTED HERE. Reaching it needs
// a per-chunk phase attribute reduced mod the octave period on the CPU in
// float64, where it is exact, which is a terrain-chunk format change and
// therefore world-gen's to make. That is flagged up rather than faked.
//
// ---------------------------------------------------------------------------
// TWO INDEPENDENT CONFINEMENTS, ON PURPOSE
// ---------------------------------------------------------------------------
// (1) A COMPILE-TIME gate. The whole block is `#ifndef OF_SCALED`, so the far
//     scaled scene, where one unit is 1e5 m and a 12 m octave is far below one
//     pixel, cannot reach this code at all. A viewer in orbit gets the same
//     planet it got before. This is confinement by the call graph, which RN-30
//     established is the only kind that holds.
// (2) A DISTANCE fade, which is what actually prevents a SEAM. The near scene
//     hands terrain to the far scene at about 15 km (`nearDepthCutoff`), so if
//     the fade did not complete well before that, the same ridge would be
//     modulated on one side of the handover and flat on the other. It completes
//     at 4 km, which is a factor of 3.75 of margin, and by 4 km the aerial
//     perspective term is already at an optical depth of 1.8 and dominates.
//
// Neither is a substitute for the other: the define stops orbital aliasing, the
// fade stops the handover seam.

import { TERRAIN_ART_FINE, FINE_CHUNK_M, FINE_LUM_REF }
  from './TerrainFine.glsl.js';
// RN-1900. The NINTH term, the mid-field layer, on TerrainFine's precedent and
// for the same 2.2 rule 1 reason. Same leaf discipline: TerrainMid imports
// nothing, this file imports and re-exports it.
import { TERRAIN_ART_MID, MID_WA, MID_WB } from './TerrainMid.glsl.js';
// BT-275. The four remaining term groups, split out at the 400-line cap on the
// TerrainFine/TerrainMid precedent above and by the same leaf discipline: each
// is GLSL text plus the tuning constants that term reads, each imports nothing
// but TerrainFine, and this file imports and RE-EXPORTS all of them so every
// existing import site keeps working and this stays the one place to look for
// "what surface-art terms exist". The split is a MOVE: every block below is
// byte-identical to the one that left, and the concatenation order in
// TERRAIN_ART_PARS is unchanged.
import { TERRAIN_ART_NOISE, TERRAIN_ART_MACRO, TERRAIN_ART_STRATA,
  TERRAIN_ART_BUMP, ART_OCT_FINE, ART_OCT_COARSE } from './TerrainBump.glsl.js';
import { TERRAIN_ART_RELIEF, RELIEF_REPEATS, RELIEF_GRAD_UV }
  from './TerrainRelief.glsl.js';
import { TERRAIN_ART_WET } from './TerrainWet.glsl.js';
import { TERRAIN_ART_TEX, TERRAIN_ART_SPEC, TEX_SCALE_GAIN, ROUGH_GRAIN,
  TEX_FINE_REPEATS } from './TerrainTex.glsl.js';
// RN-2160. The TENTH term, the near-field SPLAT, on TerrainFine's precedent and
// by the same leaf discipline. It is the first term here that is a MATERIAL
// rather than a modulation: see TerrainSplat.glsl.ts for the weight rules and
// TerrainSplat.ts for the convergence rule the whole thing rests on.
import { TERRAIN_SPLAT, TERRAIN_SPLAT_PARS } from './TerrainSplat.glsl.js';
// RN-2195. Phase 1.5, the fade-target seam: the far-field green convergence
// that hands off from the near splat's own chroma term at the SAME boundary
// (TerrainCoverFar.ts's header). It reuses `coverSel` and `splatVeg`, both
// already in scope where it is called, so it needs no defines of its own
// beyond the three baked rotation constants.
import { TERRAIN_COVER_FAR, TERRAIN_COVER_FAR_PARS } from './TerrainCoverFar.glsl.js';

/**
 * RN-1855. The two PRE-FIX values, kept as named exports rather than typed into
 * a probe, because the before half of every pair this correction is judged by
 * is exactly these two numbers and a transcribed constant is how a negative
 * control ends up measuring something else (standing rule 11). `?artfinem=` and
 * `?relieffinem=` restore them on one build; nothing in the shipped path reads
 * them.
 */
export const ART_FINE_M_PRE1855 = 4.2;
export const RELIEF_FINE_M_PRE1855 = 0.45;

// RN-1733. The near-field detail layer lives in TerrainFine.glsl.ts (2.2 rule
// 1; this file was already 2.3x over the 400-line cap before it existed).
// Everything it exports is RE-EXPORTED here so every import site that reaches
// for a terrain-art constant keeps working and there is still one place to
// look for "what surface-art terms exist".
export { TERRAIN_ART_FINE, FINE_A, FINE_R, FINE_B, FINE_W, FINE_CHUNK_M,
  FINE_M, FINE_BUMP, FINE_ALB, FINE_LUM_REF } from './TerrainFine.glsl.js';

// RN-1900. The mid-field layer, re-exported for the identical reason.
export { TERRAIN_ART_MID, MID_A_M, MID_B_M, MID_WA, MID_WB, MID_ALB }
  from './TerrainMid.glsl.js';

// BT-275. The four term groups split out of this file, re-exported for the
// identical reason: an import site asks TerrainArt for a surface-art symbol and
// does not need to know which of the leaf files now holds it.
export { TERRAIN_ART_NOISE, TERRAIN_ART_MACRO, TERRAIN_ART_STRATA,
  TERRAIN_ART_BUMP, ART_OCT_FINE, ART_OCT_COARSE, ART_FINE_M, ART_COARSE_M }
  from './TerrainBump.glsl.js';
export { TERRAIN_ART_RELIEF, RELIEF_REPEATS, RELIEF_FINE_TILES, RELIEF_FINE_M,
  RELIEF_GRAD_UV, REL_CELL, REL_CELL_NOISE, REL_SWING_DEFAULT }
  from './TerrainRelief.glsl.js';
export { TERRAIN_ART_WET } from './TerrainWet.glsl.js';
export { TERRAIN_ART_TEX, TERRAIN_ART_SPEC, TEX_SCALE_GAIN, ROUGH_GRAIN,
  TEX_FINE_REPEATS } from './TerrainTex.glsl.js';

// RN-2160. Re-exported for the identical reason: an import site asks TerrainArt
// for a surface-art symbol and does not need to know which leaf file holds it.
export { TERRAIN_SPLAT, TERRAIN_SPLAT_PARS } from './TerrainSplat.glsl.js';
// RN-2195. Re-exported for the identical reason.
export { TERRAIN_COVER_FAR, TERRAIN_COVER_FAR_PARS } from './TerrainCoverFar.glsl.js';

// RN-1855. OF_ART_FINE_M and OF_RELIEF_FINE_M are GONE rather than left behind,
// on RN-1005's rule exactly: they are uniforms now (uArtFineM, uReliefFineM),
// and a dead define that still compiles is how a lane ends up sweeping one
// authority while the shader reads the other. What replaces them is the pair of
// OCTAVE COUNTS the fades are derived from, which the noise call sites now read
// too, so the wavelength and its fade cannot be two numbers again.
export const TERRAIN_ART_PARS = `#define OF_ART_OCT_FINE ${ART_OCT_FINE.toFixed(1)}\n`
  + `#define OF_ART_OCT_COARSE ${ART_OCT_COARSE.toFixed(1)}\n`
  + `#define OF_RELIEF_REPEATS ${RELIEF_REPEATS.toFixed(1)}\n`
  + `#define OF_FINE_CHUNK_M ${FINE_CHUNK_M.toFixed(2)}\n`
  + `#define OF_FINE_LUM_REF ${FINE_LUM_REF.toFixed(5)}\n`
  + `#define OF_RELIEF_GRAD_UV ${RELIEF_GRAD_UV.toFixed(4)}\n`
  + `#define OF_TEX_SCALE_GAIN ${TEX_SCALE_GAIN.toFixed(2)}\n`
  + `#define OF_TEX_FINE ${TEX_FINE_REPEATS.toFixed(1)}\n`
  + `#define OF_ROUGH_GRAIN ${ROUGH_GRAIN.toFixed(1)}\n`
  // RN-1900. The mid-field layer's two octave weights. DEFINES and not
  // uniforms, and TerrainMid's MID_WA docstring says why: the balance between
  // them is not a live question, while the two WAVELENGTHS and the amplitude
  // are, and those are uniforms (uMidM, uMidAmp).
  + `#define OF_MID_WA ${MID_WA.toFixed(2)}\n`
  + `#define OF_MID_WB ${MID_WB.toFixed(2)}\n`
  // RN-1005. OF_REL_CELL and OF_REL_CELL_NOISE are GONE rather than left
  // behind: they are uniforms now (uReliefCell, uReliefCellNoise), and a dead
  // define that still compiles is exactly how a lane ends up sweeping one
  // authority while the shader reads the other. REL_CELL and REL_CELL_NOISE
  // remain the boot defaults, in TypeScript, with one home each.
  + TERRAIN_ART_NOISE + TERRAIN_ART_MACRO + TERRAIN_ART_STRATA + TERRAIN_ART_BUMP
  + TERRAIN_ART_WET + TERRAIN_ART_TEX + TERRAIN_ART_RELIEF + TERRAIN_ART_FINE
  // RN-1900. AFTER TERRAIN_ART_NOISE, which is not cosmetic: ofArtMid calls
  // ofArtVnoise and GLSL ES 1.0 requires a function to be declared before use.
  + TERRAIN_ART_MID
  + TERRAIN_ART_SPEC
  // RN-2160. LAST, and the order is load-bearing: ofSplatWarp calls
  // ofArtVnoise2P, which TERRAIN_ART_FINE declares, and GLSL ES 1.0 requires a
  // function to be declared before use.
  //
  // Its defines sit HERE, immediately above their only consumer, rather than in
  // the define block at the top of this expression. The preprocessor does not
  // care (a #define is in scope from its own line onward and TERRAIN_SPLAT is
  // the next string concatenated), and the whole set is GENERATED from
  // TerrainSplat.ts's table, so keeping the generator's output beside the code
  // it feeds is what stops someone reading the define block and believing those
  // literals were typed.
  + TERRAIN_SPLAT_PARS
  + TERRAIN_SPLAT
  // RN-2195. LAST, on the same reasoning: `ofFarCoverRotate` has no callee of
  // its own (it is a pure dot-product/multiply, unlike ofSplatWarp), so
  // nothing downstream of it needs it declared earlier, but its defines are
  // GENERATED from TerrainCoverFar.ts exactly as the splat's are, so they sit
  // beside their consumer rather than in the define block above.
  + TERRAIN_COVER_FAR_PARS
  + TERRAIN_COVER_FAR;
