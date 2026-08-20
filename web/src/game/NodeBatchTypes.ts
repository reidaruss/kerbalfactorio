// The shapes and the tuned numbers every other node-batch module agrees about.
// Split out of NodeBatch.ts (GP-1086) so the pipeline, the material and the
// ladder can each name what they take without importing each other.
//
// NOTHING HERE HAS BEHAVIOUR, which is the point: a type or a `const` number
// cannot go out of step with the code that reads it the way a helper can.

import * as THREE from 'three';

/** The depletion variants, in the order their geometry ids are stored. */
export const VARIANTS = ['Full', 'Half', 'Low'] as const;
/** LOD tiers per variant. The assets author 0, 1, 2 and, since RN-2202, 3;
 *  anything past this is ignored rather than silently folded into the far slot,
 *  which is the defect `PropLibrary`'s else-branch carried until RN-2200 gave
 *  the props a real ladder too (`render/instancing/PropLods.ts`). */
export const LODS = 4;

/** How far a node draws its LOD0 / LOD1 geometry, in metres OF ITS OWN SIZE.
 *
 * The comparison is `distance / scale`, not distance, and that is the whole
 * point: since WG-116 a tree's scale carries its yield and the world holds
 * trees from 0.82 to 2.39 of the authored height, so one absolute distance
 * would either pop the big ones or pay LOD0 for the small ones. Screen size is
 * what an LOD is actually about and distance over size is its cheap proxy.
 *
 * The two numbers were measured, not chosen: world-gen.md section 6.5.
 */
export const NODE_LOD1_M = 55;
export const NODE_LOD2_M = 165;
/**
 * RN-2202, THE IMPOSTOR RUNG'S THRESHOLD, and it is DERIVED rather than the
 * next term of 55/165.
 *
 * LOD2 is a `seg=4` trunk taper plus two crossed leaf quads, sixteen triangles
 * of which EIGHT are the trunk. LOD3 is the same two quads with the trunk gone,
 * so the only thing the rung can cost the image is a stem. `TreeConifer`'s LOD2
 * stub is 0.20 m in radius, i.e. 0.40 m across. At the shipped 1600x900 frame
 * with a 60 degree vertical field of view the scale is
 *
 *     px per metre at range d  =  (900 / (2 * tan(30deg))) / d  =  779.4 / d
 *
 * so the stub is one pixel wide at d = 0.40 * 779.4 = 312 m. Rounded to 310.
 * Past it the trunk cannot be resolved by the frame this game renders, and the
 * eight triangles drawing it are arithmetic with no image attached, which is
 * `ShadowLod`'s phrase for exactly this shape of waste.
 *
 * IT IS A FRAME-SIZE-DEPENDENT NUMBER AND THAT IS STATED, NOT HIDDEN: at a
 * 4K frame the same stub survives to 665 m. The threshold is not re-derived per
 * resolution because doing so would make a node's geometry id depend on the
 * window size, which is a determinism hazard the probes would find first and
 * a popping hazard the player would find second.
 */
export const NODE_LOD3_M = 310;
/** Fraction of a threshold a node must cross back through before it switches
 *  down again. Without it a node sitting on a boundary rewrites its geometry id
 *  every frame, which is cheap per node and is not cheap at a thousand. */
export const NODE_LOD_HYST = 0.12;

/**
 * The thresholds as a LADDER, in tier order: `NODE_LOD_M[i]` is the range at
 * which a node enters tier `i + 1`.
 *
 * `NodeField.lodFor` used to be three hand-written branches, one per tier, and
 * a fourth tier would have been a fourth branch with its own chance of getting
 * the hysteresis sense backwards on one path. As an array the rule is written
 * once: RISE past a threshold by `1 + HYST`, FALL back through it by
 * `1 - HYST`, and the tier is how many thresholds you are past.
 *
 * ONE BEHAVIOUR CHANGE FALLS OUT AND IT IS DELIBERATE. The old tier-2 branch
 * dropped to tier 1 at bare `NODE_LOD1_M` with no hysteresis at all, while
 * every other path applied it; a node falling two tiers at once therefore
 * crossed one boundary un-damped. The ladder damps every crossing the same way,
 * which is 6.6 m of margin on the 55 m boundary and is the rule the comment
 * above always described.
 */
export const NODE_LOD_M: readonly number[] =
  [NODE_LOD1_M, NODE_LOD2_M, NODE_LOD3_M];

/** One material a piece of node art uses, and its geometry per (variant, LOD),
 *  -1 = absent. THREE LODs, because every node .glb in the project has shipped
 *  `_LOD1` and `_LOD2` meshes since it was authored and `NodeBatch.ts` loaded
 *  neither: a harvest tree drew its 791-triangle LOD0 at 600 m while the 16
 *  triangle impostor the same file contained was dead bytes. */
export interface NodePart {
  readonly material: string;
  readonly geom: number[][];
}

export interface Batch {
  mesh: THREE.BatchedMesh;
  live: number;
  /**
   * Slots handed back by `release`, ready to be handed out again.
   *
   * A BatchedMesh instance cannot be deleted, so a re-populated clearing used to
   * consume a fresh slot for every node it laid and never give the old ones
   * back. That was survivable at 24 nodes and is not now that a patch's outcrops
   * are nodes too: the third regrow would cross the capacity, `acquire` would
   * start returning -1, and the world would come back with pieces of it simply
   * not drawn, silently and only sometimes.
   */
  free: number[];
  /** THIS batch's current instance count. It doubles; see `grow` in
   *  `NodeBatch.ts`. */
  cap: number;
}

/** A candidate primitive found in a template, before any batch exists. */
export interface Found {
  file: string;
  variant: number;
  lod: number;
  material: string;
  source: THREE.Material;
  geometry: THREE.BufferGeometry;
  world: THREE.Matrix4;
}
