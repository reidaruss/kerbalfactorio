// Tree placement tuning: where trees go, how many, and how big each one is.
//
// THE DESIGN RULING THIS FILE IMPLEMENTS (Reid, 2026-07-31, verbatim): "there
// should be no scenery trees. all trees should be minable". It retires WG-13 to
// WG-17, which built the opposite rule: a scenery tree was a visually distinct
// SPECIES, separated from a harvest tree by silhouette and verified on the
// exported bytes. The rocks pass (WG-67) had already killed the same failure the
// other way round for stone, and this extends that answer to trees, so the world
// now has ONE rule everywhere: if it looks harvestable, it IS harvestable.
//
// It is NOT a deletion of the big trees. A forest tree and a clearing tree may
// both exist and both give wood; what disappears is the requirement that the two
// be separable by class. Size is now a PROPERTY of the tree rather than a
// classification of it, and it means something: see TREE_SCALE_* below.
//
// Everything here is a pure function of (seed, lattice cell), never of the
// player, the camera, the chunk LOD or the order cells were visited in, which is
// what makes a tree an attribute of the planet and is also what the persistence
// key is built on (TreeField).
//
// THE FOREST'S SHAPE IS NOT RE-DESIGNED HERE. The stand field, the treeline and
// its wander were measured and defended in WG-61 and WG-62 and they live in
// `world/ScatterTuning.ts`; this file IMPORTS them rather than restating them,
// so there is exactly one treeline in the client and moving it moves the world.
// Duplicating those numbers here is the DW-26 failure (one fact, two authorities)
// and it would show up as trees whose altitude limit disagreed with the
// understorey shading that is supposed to sit under them.

export {
  TREELINE_FULL_M, TREELINE_BARE_M, TREELINE_WANDER_M,
  // RN-2228. THE HARVEST RING'S OWN TWO NUMBERS MOVED TO `ScatterTuning` and
  // are re-exported here, for the reason the header above gives about the
  // treeline: the canopy tier's near cut-off is DERIVED from where the minable
  // ring ends, and a boundary owned by two files is a boundary that drifts.
  // Every import site of `TREE_RADIUS_M` / `TREE_EDGE_WANDER_M` is unchanged.
  TREE_RADIUS_M, TREE_EDGE_WANDER_M,
} from '../world/ScatterTuning.js';

export const TREE_CELL_M = 28;

/** Most trees one cell may hold. A guard on the fair draw, not a target: at the
 *  Forest ask a cell expects 1.88 before weighting, so this is four standard
 *  deviations of headroom and it is COUNTED when it bites. */
export const MAX_PER_CELL = 6;

/**
 * Per-instance art scale, and THE ONE PLACE SIZE MEANS SOMETHING.
 *
 * A tree's scale is a linear function of its /core GRADE, and grade is what
 * `InitialAmount` is multiplied by, so the wood in a tree is proportional to how
 * big it looks. That is not decoration: it is the answer to the obvious question
 * the ruling creates, which is why you would ever chop the big one. The outcrops
 * have had exactly this rule since deposits.h §P (a piece standing in rich ground
 * is bigger) and trees were the ones pinned near 1.0.
 *
 * THE BAND IS DERIVED FROM THE SHIPPED BYTES, and the first one was derived from
 * a docstring and was wrong by a third. `NodeField`'s header calls a harvest tree
 * "a 6.5 m tree"; measured off the glb the conifer is 6.50 m and the broadleaf is
 * **5.00 m**, while the retired canopy species are 12.00, 16.50 and 10.50 m. A
 * band of [0.95, 2.10] therefore put the MEDIAN drawn tree at 9.9 m conifer and
 * 7.6 m broadleaf against the canopy's ~13 m, and that gap is exactly what
 * `WG117_rn15_trees.png` showed and no counter did: the ring delivered 799 trees
 * at 0.9891 of the ask, more than the canopy's 462, and the hillside still read
 * as scrub because the trees were a third too short. This is WG-14's rule
 * arriving from the other side: measure the asset, not the comment about it.
 *
 * Grade is `0.5 + 0.5 * hash(seed, dir)` in of_core_api, so it spans [0.5, 1.0]
 * and the band below spans [1.25, 2.45]. On top of it `NodeField.build` applies
 * its own +/-14% jitter, so the world holds conifers from 7.0 m to 18.2 m
 * (median 12.0) and broadleaves from 5.4 m to 14.0 m (median 9.3), against the
 * canopy's authored 8.8 m to 19.8 m. The pick sphere and the hit height both
 * scale with this in `NodeField`, so a bigger tree stays chop-able from
 * proportionally further and nothing about the swing changes.
 */
export const TREE_SCALE_MIN = 1.25;
export const TREE_SCALE_MAX = 2.45;

/** Art scale for a node of this grade. Linear, so scale and yield move together
 *  and "the big one is worth more" is true rather than merely plausible. */
export function treeScaleFor(grade: number): number {
  const t = Math.max(0, Math.min(1, (grade - 0.5) * 2));
  return TREE_SCALE_MIN + t * (TREE_SCALE_MAX - TREE_SCALE_MIN);
}

/**
 * Mean trees per km2 by biome index (biome.h order: Ocean, Beach, Plains,
 * Forest, Hills, Mountains, Polar, then the three moon biomes), BEFORE the stand
 * field and the treeline thin it.
 *
 * THESE ARE THE RETIRED CANOPY TIER'S OWN ASKS, ROW FOR ROW (Registry's
 * CANOPY_* tables summed per biome, at its DENSITY_SCALE of 6), and that is a
 * correction rather than a convenience. The first version of this table asked
 * 2,400 in Forest, derived so that the RING AVERAGE matched what the canopy
 * realised (1,292/km2 after `canopyDistanceWeight` thinned two thirds of its
 * ring). Measured, that was right and it LOOKED WRONG, and the picture is what
 * caught it: the canopy is at FULL density inside 300 m and only thins beyond,
 * so its ring average is not the number the eye ever read. The eye reads the
 * near field, the near field was 1.6x thinner, and the middle distance of
 * `WG117_forest_trees.png` was visibly emptier than
 * `WG117_forest_head.png` while every counter said the delivery was 0.99.
 * DW-7 again: no number saw this.
 *
 * Copying the asks instead of re-deriving them also makes the change honest in
 * one direction only. The near field is preserved by construction, and the far
 * field is now DENSER than the canopy's, because the distance thinning is gone.
 *
 * BEACH AND OCEAN ARE 0 AND THAT IS THE RULING, NOT AN OMISSION: the survey's
 * beach candidate is "THE DESERT ... bare pale sand and dry scrub, no trees
 * ever" and the retired canopy had no Beach row either, so this pass leaves that
 * site bit-identical. POLAR IS 0 AND IS A DEFERRAL: a taiga wants its own
 * species and its own measurement site, and nothing polar is measurable here.
 */
export const TREE_DENSITY_KM2: readonly number[] = [
  0,      // Ocean
  0,      // Beach     (the desert stays the desert)
  420,    // Plains    (isolated copses in open grass; canopy 18+5+47, x6)
  3840,   // Forest    (the closed canopy;             canopy 300+90+250, x6)
  1200,   // Hills     (woodland below the treeline;   canopy 110+40+50, x6)
  480,    // Mountains (stragglers, the treeline deletes; canopy 55+25, x6)
  0,      // Polar     (deferred, see above)
  0, 0, 0,  // Moon: Regolith, Highland, CraterFloor
];

/**
 * cos of the steepest ground a tree stands on, about 44 degrees, tighter than
 * the 57 degrees every other prop gets, for `CANOPY_MIN_SLOPE_COS`'s reason: a
 * boulder on a 55 degree flank is a boulder that fell there, a 12 m tree on one
 * is a tree growing out of a cliff.
 *
 * **IT REFUSES NOTHING ON THE DESIGNED SURFACE, ANYWHERE ON THIS PLANET, AND
 * THAT IS MEASURED RATHER THAN OBSERVED (WG-121).** WG-63 read 0 refusals from
 * the canopy tier's copy of this constant at all seven survey sites, and this
 * copy reads 0 at all eight; a count of zero at a handful of gentle sites is
 * equally consistent with "the gate works" and "the gate is not wired", so
 * `probes/treeslope.js` went looking instead. Hill-climbed to a sample spacing
 * finer than SLOPE_ARM_M over 26,120 oracle samples: the steepest ground
 * ANYWHERE on Forge is 57.92 degrees (lat 58.0, lon 16.5, at 2,865 m) and the
 * steepest ground BELOW THE TREELINE is 29.15 degrees (lat -77.0, lon 2.6, at
 * 1,676 m). Everything steep is bare because it is high, so on the designed
 * surface this gate cannot fire.
 *
 * IT IS KEPT ANYWAY, and the reason is the one case the census cannot reach:
 * the slope is sampled THROUGH `editsHandle`, so a dug pit or a levelled
 * terrace makes locally steep ground under a live tree ring, and that ground is
 * the only thing between a tree and a cliff the player cut. **That case is
 * UNTESTED and is logged as owed work**; it is not a licence to believe the
 * gate works. Lowering the constant until the counter moved was rejected
 * outright: it would refuse trees on ground that is fine for trees, purely to
 * flatter an instrument.
 */
export const TREE_MIN_SLOPE_COS = 0.72;

/** Finite-difference arm for the slope sample, metres. About the footprint of a
 *  grown tree's root plate, so the slope refused is the slope it would span. */
export const SLOPE_ARM_M = 3.0;

/** Standing water above which a cell refuses a tree (`ScatterTuning`'s
 *  WET_REJECT_M, same value for the same shoreline-float reason). */
export const TREE_WET_REJECT_M = 0.02;

/**
 * Metres of clearance a streamed tree keeps from the spawn clearing's own
 * standalone nodes.
 *
 * The 14 trees `NodeField.populate` lays on a golden-angle spiral are STAYING
 * (they are already harvestable, so the ruling does not touch them) and they are
 * the only wood at a spawn above the treeline, which the current Mountains
 * candidate is. Without this gate a low-altitude spawn would stream trees into
 * the same 56 m of ground and interpenetrate them. Only the clearing's own nodes
 * are tested, never the whole placed array: that is 14 comparisons per candidate
 * instead of a thousand, and the clearing is the one case where two placement
 * systems address the same ground.
 */
export const TREE_CLEARING_KEEPOUT_M = 6.0;

/**
 * cos of the ground's angle to the local up at `d`, finite-differenced from the
 * OFF-MESH oracle over SLOPE_ARM_M.
 *
 * The oracle and not the chunk mesh, deliberately: a streamed tree may be
 * offered ground whose chunk is at any LOD depth or not resident at all, and a
 * gate whose answer depended on that would place different trees on different
 * approaches. It is also the reason this gate can bite where the canopy's copy
 * measured zero refusals at all seven sites (WG-63): that one read a terrain
 * cell's normal, up to 28 m across at depth 11.
 */
export function oracleSlopeCos(
  M: { _of_surface_height(b: number, e: number, x: number, y: number, z: number): number },
  body: number, edits: number, bodyRadiusM: number,
  dx: number, dy: number, dz: number,
): number {
  const arm = SLOPE_ARM_M / bodyRadiusM;
  let tx = 0, ty = 1, tz = 0;
  if (Math.abs(dy) > 0.99) { tx = 1; ty = 0; }
  let ux = ty * dz - tz * dy, uy = tz * dx - tx * dz, uz = tx * dy - ty * dx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const h = (ax: number, ay: number, az: number): number => {
    const l = Math.hypot(ax, ay, az) || 1;
    return M._of_surface_height(body, edits, ax / l, ay / l, az / l);
  };
  const h0 = h(dx, dy, dz);
  const gu = (h(dx + ux * arm, dy + uy * arm, dz + uz * arm) - h0) / SLOPE_ARM_M;
  const gv = (h(dx + vx * arm, dy + vy * arm, dz + vz * arm) - h0) / SLOPE_ARM_M;
  return 1 / Math.sqrt(1 + gu * gu + gv * gv);
}

/** Everything `TreeField.stats()` publishes, and therefore everything a probe
 *  is allowed to assert on. Declared here rather than inline so the shape is
 *  readable next to the constants the counters are about. */
export interface TreeStats {
  enabled: boolean; radiusM: number; live: number; cells: number;
  known: number; pending: number; wanted: number; delivered: number;
  deliveredFraction: number; offeredCells: number; biomeZeroCells: number;
  treelineCells: number; refusedSlope: number; wetCells: number;
  refusedWater: number; refusedClearing: number; cellsCapped: number;
  drainedOnRestore: number; regrowsPrevented: number; forgotten: number;
  scans: number; lastScanMs: number; backlog: number;
}

/** Smootherstep. */
const sstep = (t: number): number =>
  t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10);

/** Integer lattice hash, seeded. Three axes plus the world seed, one round.
 *  Deliberately the same shape as `RockTuning.rockHash` and deliberately NOT a
 *  call into it: the two lattices must not correlate, and sharing a function
 *  would make a tree cell and a rock cell with the same integers draw the same
 *  stream. The salts differ at every call site for the same reason. */
export function treeHash(seed: number, a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x1b873593) ^ Math.imul(b | 0, 0xcc9e2d51)
    ^ Math.imul(c | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x7feb352d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export const frac = (h: number): number => (h >>> 8) / 16777216;

/** One octave of trilinear value noise over body-frame metres, in [0,1]. */
function octave(seed: number, x: number, y: number, z: number, scale: number): number {
  const fx = x / scale, fy = y / scale, fz = z / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = sstep(fx - ix), ty = sstep(fy - iy), tz = sstep(fz - iz);
  const c = (dx: number, dy: number, dz: number): number =>
    treeHash(seed, ix + dx, iy + dy, iz + dz) / 4294967296;
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * tx;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * tx;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * tx;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * The ring edge's displacement at a body-frame point, in [-1, 1]. Smooth and
 * world-anchored for WG-62's reason: the same ground must give the same edge
 * however the player approached it, and a hashed tile would make the boundary
 * reshuffle as cells changed hands.
 */
export function edgeWander(seed: number, x: number, y: number, z: number): number {
  return octave(seed ^ 0x51ed, x, y, z, 260) * 2 - 1;
}
