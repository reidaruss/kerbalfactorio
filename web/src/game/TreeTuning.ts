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

/** Most trees one cell may hold. A guard on the fair draw, not a target.
 *
 * WG-310 RAISED THIS FROM 6, measured rather than assumed. A full-weight
 * Forest cell's expectation is `density * areaKm2` at `canopyWeight`'s ceiling
 * of 1 (`buildCell`'s `e`, "before weighting" in the old comment's sense: the
 * biome density alone, not yet thinned by the stand field or the treeline),
 * which at a 28 m cell (`TREE_CELL_M`, ~0.000784 km2) and the pre-lane table's
 * Forest ask (3,840/km2, `HARVEST_BASE_KM2`) is 3.01. The cap does not start
 * biting at some comfortable multiple of that: solving `3.01 * m >= 6` puts
 * the threshold at `m >= 1.993`, JUST UNDER 2x, and this lane's shipped
 * multiplier (3, see `HARVEST_TABLE_MULT`) is past it. So the raise is not
 * headroom for a hypothetical future increase, it is LOAD-BEARING for what
 * ships today: a fresh-context verifier measured 4 cells capped at exactly
 * x2 with the cap still at 6, and at the full canopy table (23,040/km2) the
 * same arithmetic gives 18.06, ABOVE the old cap by a wide margin: probed at
 * `forestaircanopy` with the ask multiplied by six and the cap still at 6,
 * `cellsCapped` read 765 of 3,169 offered (24%) and `deliveredFraction`
 * 0.5115, silently shipping half the ruling's own table while every other
 * number on the row claimed the full one. 20 clears the deterministic
 * ceiling (18.06) with margin and restores `deliveredFraction` to ~1 at
 * every biome and every multiplier 1 through 6 tested (the other three
 * biomes' new-table maxima -- Hills 5.65, Mountains 2.26, Plains 1.98 --
 * were never close to binding even at the full x6; Forest was always the
 * constraint, RN-46's "measure, do not assume" applies to a guard exactly as
 * much as to a picture). Still COUNTED when it bites: `cellsCapped` must
 * read 0 on the shipped table, and a nonzero reading here is now a real
 * defect again rather than the expected state this lane found. */
export const MAX_PER_CELL = 20;

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
 * field and the treeline thin it, AND BEFORE `HARVEST_TABLE_MULT` below.
 *
 * THESE ARE THE RETIRED CANOPY TIER'S OWN PRE-WG-222 ASKS, ROW FOR ROW
 * (Registry's CANOPY_* tables summed per biome, at DENSITY_SCALE 6 -- the
 * OLDER x6, the one that turned a 70-tree Forest ask into 420 and is baked
 * into the numbers below rather than applied here). Corrected by WG-310: the
 * "x6" in each row comment used to mean THIS multiply, and a reader who saw
 * "x6" beside 420 and concluded the table was current drew exactly the wrong
 * conclusion (world-gen.md 6.13.11 item 5) -- WG-222 put a SECOND x6 on top
 * of the canopy table later and this array never received it, which is
 * `HARVEST_TABLE_MULT`'s whole reason to exist.
 */
const HARVEST_BASE_KM2: readonly number[] = [
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
 * WG-310 (NUMBERS.md WG-310 to WG-319, ADMIN RULING). `Registry.ts`'s canopy
 * rows (`CANOPY_FOREST` etc.) are each built through `C()`, which multiplies
 * by the shared `DENSITY_SCALE` (6) the same way `HARVEST_BASE_KM2` above
 * already was, so the CANOPY TABLE'S OWN per-biome total is `Registry`'s raw
 * per-species sum, CURRENT NUMBERS (Forest `1200+360+2280=3840`), times THAT
 * SAME six, giving Plains 2,520, Forest 23,040, Hills 7,200, Mountains 2,880:
 * exactly `HARVEST_BASE_KM2` times a SECOND six. (An earlier draft of this
 * paragraph cited the retired PRE-WG-222 per-species figures, 300+90+250,
 * which sum to 640 and not 3,840; that is the exact citation trap
 * world-gen.md 6.13.11 item 5 warns about, reproduced here once and
 * corrected: `HARVEST_BASE_KM2`'s own per-row comments carry the CURRENT
 * Registry sums, and this paragraph now matches them.) WG-222 put that
 * second six on the canopy table alone and `TREE_DENSITY_KM2` never received
 * it (world-gen.md 6.13.11 item 2, ScatterTuning.ts's "SIX FOLD density step
 * at 550 m"). The ruling: harvest adopts the canopy table TABLE-WIDE, gated
 * on this lane measuring the node cost at the densest pose FIRST (standing
 * rule 7) rather than assuming the full six-fold ask was free.
 *
 * MEASURED (world-gen.md 6.17, `wg310probe.mjs`/`wg310interleave.mjs`,
 * interleaved WG-189 pairs at `forestair`, the pose that bound, order
 * rotated per repeat): full x6 delivers honestly (13,322 to 13,363 nodes
 * against a 2,219 to 2,229 baseline, `cellsCapped` 0 once `MAX_PER_CELL` was
 * raised alongside this, see above) but breaks the frame budget against
 * `StatsProbe.ts`'s ALERT=25/FAIL=40 ms gate on p99: a six-sample run put its
 * p50 median at 14.0 ms and its p99 median at 23.7 ms (three of six samples
 * over ALERT, worst 36.3), and an earlier three-sample run on this lane's own
 * first pass put the same arm considerably worse (p50 median 20.5, p99
 * median 36.8, worst 52.2, over ALERT on every sample). BOTH RUNS AGREE ON
 * THE VERDICT (x6 is not safe to ship) AND DISAGREE SUBSTANTIALLY ON
 * MAGNITUDE, which is reported rather than hidden: this VM's frame timing
 * carries real session-to-session background variance, so treat x6's own
 * numbers as "clearly over, severity uncertain" rather than as a precise
 * reading. x3 held ALL SIX of six interleaved samples under ALERT (p50
 * median 11.6, p99 median 18.6, worst 20.7) against a x1 baseline's own
 * worst of six (19.6) -- real, repeated margin, and the sample this
 * multiplier is shipped on. `forestaircanopy`, this lane's other named
 * pose, never left ALERT even at the full x6 (four-sample p99 median 20.5,
 * worst 22.2), so it was never the binding pose and `forestair`'s number is
 * the one that governs; see world-gen.md 6.17.1 for why (the ring's node
 * count is nearly the same at both poses, but only `forestaircanopy` turns
 * the extra nodes into visible triangles, so `forestair` pays the CPU cost
 * for geometry nobody sees. That is separately routed in 6.17 as owed work
 * this lane's brief does not cover).
 *
 * SHIPPED FRACTION: 3 of the ruling's 6, the largest that held a full,
 * repeated margin under ALERT at the pose that bound, documented as
 * INTENTIONAL per the ruling's own stated fallback rather than silently
 * short of the table. `?harvestx6=0` is the full kill switch back to
 * `HARVEST_BASE_KM2` (mult 1, the exact pre-lane table), not to some third
 * intermediate value, so the before arm is one page param from the shipped
 * build either way (standing rule 7).
 */
export const HARVEST_TABLE_MULT = 3;

export const TREE_DENSITY_KM2: readonly number[] =
  HARVEST_BASE_KM2.map((v) => v * HARVEST_TABLE_MULT);

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
