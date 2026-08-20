// The shapes and the tuned numbers every other node-batch module agrees about.
// Split out of NodeBatch.ts (GP-1086) so the pipeline, the material and the
// ladder can each name what they take without importing each other.
//
// NOTHING HERE HAS BEHAVIOUR, which is the point: a type or a `const` number
// cannot go out of step with the code that reads it the way a helper can.

import * as THREE from 'three';

/** The depletion variants, in the order their geometry ids are stored. */
export const VARIANTS = ['Full', 'Half', 'Low'] as const;
/** LOD tiers per variant. The assets author 0, 1 and 2; anything past this is
 *  ignored rather than silently folded into the far slot, which is the defect
 *  `PropLibrary`'s else-branch still carries. */
export const LODS = 3;

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
/** Fraction of a threshold a node must cross back through before it switches
 *  down again. Without it a node sitting on a boundary rewrites its geometry id
 *  every frame, which is cheap per node and is not cheap at a thousand. */
export const NODE_LOD_HYST = 0.12;

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
