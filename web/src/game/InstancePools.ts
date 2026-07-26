// THE INSTANCE-POOL REGISTER, and why an invisible number needed a visible home.
//
// The DW-27 packaging spike found the one defect that reports success: a
// `BatchedMesh` whose instance pool is full does not get slower, it stops
// DRAWING. Machines past the ceiling exist in the plan, exist in /core, tick,
// produce and persist, and are simply never on screen. Measured, from 150
// machines to 900: draw calls frozen at exactly 45, triangles frozen at exactly
// 602,994, p50 barely moving, and every budget indicator reading `ok`.
//
// So the pool count cannot be derived from anything the renderer already
// reports; it has to be published by the pools themselves. This is a register
// rather than a wiring path because the two pools are created deep inside the
// gameplay module, which is loaded dynamically and may not exist at all
// (`?gameplay=0`), while the HUD is composed in `main.ts` before it does.
//
// Pools live as long as the app does, so nothing is ever removed.
//
// WHY THE POOL DOUBLES, AND IS NOT JUST A BIGGER CONSTANT.
// `BatchedMesh.setInstanceCount` reallocates the indirect and matrix textures
// and block-copies the old contents, so every live instance keeps its transform
// and its geometry id and nothing is re-added; the vertex and index pools are
// sized once from the templates and never move, because growth adds instances of
// geometry that is already resident. Doubling makes that O(1) amortised per
// instance and, more importantly, makes capacity follow the PLAN rather than a
// number somebody guessed: the spike could not measure past 150 machines, so any
// fixed larger constant would be the same mistake with a different digit. The
// ceiling below exists only so a runaway cannot allocate unbounded GPU memory,
// and reaching it is counted, published here and printed once.
//
// The per-instance fx texture is square rather than one row for a related
// reason: a 1 x N row runs into MAX_TEXTURE_SIZE, which the WebGL2 spec only
// guarantees at 2048. Indexing is unchanged either way, because the flat array
// index IS the instance id whatever the row width is.

/** Instances a pool STARTS with. It doubles from here on demand. */
export const CAPACITY = 256;
/**
 * The hard ceiling, and it is a memory guard rather than a performance one.
 * 16,384 instances of the machine set is about 38 M triangles, so the triangle
 * budget (2.7 M, ARCHITECTURE 10.3) fails an order of magnitude earlier and
 * says so on the HUD. Nothing should reach this; if something does, the refusal
 * is counted rather than silent.
 */
export const MAX_CAPACITY = 16384;

/** What one pool is doing. `MachineBatch.stats()` returns exactly this. */
export interface PoolReport {
  name: string;
  batches: number;
  instances: number;
  capacity: number;
  ceiling: number;
  /** How many times the pool doubled. */
  grows: number;
  /**
   * Instances REFUSED because the hard ceiling was reached: the count of
   * buildings that exist, tick and produce and are not on screen. It is the
   * number the HUD line and `probes/scale.js` assert on, and it must stay 0.
   */
  refused: number;
}

export interface PoolSource { stats(): PoolReport }

const POOLS = new Set<PoolSource>();

export function registerPool(p: PoolSource): void { POOLS.add(p); }

export function instancePools(): PoolReport[] {
  return [...POOLS].map((p) => p.stats());
}
