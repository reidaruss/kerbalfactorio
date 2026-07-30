// Rock placement tuning: where stone harvest nodes go, how many, and the one
// derived threshold that decides which scatter rocks were allowed to survive.
//
// THE DESIGN RULING THIS FILE IMPLEMENTS (Admin, 2026-07-30): there are no
// inert rocks. Anything rock-shaped and big enough to interact with IS a
// harvest node and gives stone; only pebbles below interaction size remain
// decoration. The trees solved the same problem the other way (a scenery tree
// is a visually distinct species, WG-59); for rocks the failure mode is killed
// instead of signalled around, because a rock has no silhouette grammar the way
// a snapped crown gives a dead tree one.
//
// Everything here is a pure function of (seed, lattice cell), never of the
// player, the camera, the chunk LOD or the order cells were visited in. That is
// what makes a rock an attribute of the planet: stream away and back and the
// same rocks stand in the same places, which is also what the persistence key
// is built on (RockField).

/**
 * How far rocks exist around the player, metres. Deliberately equal to the
 * scatter's RADIUS_M: the decor rocks this pass retires only ever existed
 * inside that ring, so matching it means the retirement plus the placement is
 * roughly visually neutral in reach, and no hillside that used to show rocks
 * goes bare at a range the old ones were never drawn at either.
 */
export const ROCK_RADIUS_M = 170;

/**
 * Lattice cell size, metres of ground per side. 24 m puts the one-rock-per-cell
 * ceiling at ~1,736/km2, comfortably above the densest biome ask below, and
 * keeps the full-ring scan at about 160 cells, which is one cheap pass.
 */
export const ROCK_CELL_M = 24;

/** Most rocks one cell may hold. A guard on the fair draw, not a target. */
export const MAX_PER_CELL = 3;

/**
 * Per-instance size range, uniform from the cell hash. The pick sphere and the
 * hit height both scale with this in NodeField, so a big rock is harvestable
 * from proportionally further and a small one demands proportional aim.
 * The MIN is load-bearing beyond looks: DECOR_ROCK_MAX_H below is derived from
 * it, so lowering it without re-deriving that threshold re-opens the gap
 * between the smallest real rock and the biggest fake one.
 */
export const ROCK_SCALE_MIN = 0.75;
export const ROCK_SCALE_MAX = 1.5;

/**
 * Metres a rock is settled INTO the ground along its normal, as a fraction of
 * its own scale. The boulder glb pins its base plane at z = 0 (RN-68), so on
 * any slope one edge would stand proud; a small settle reads as a rock IN the
 * ground rather than a prop ON it, exactly as the ore outcrops do.
 */
export const ROCK_SINK_FRAC = 0.08;

// ---------------------------------------------------------------------------
// THE DECOR THRESHOLD, DERIVED AND NOT CHOSEN.
//
// The rule the player learns after one swing: a rock the size of a harvest
// node's silhouette gives stone. The smallest harvestable silhouette that can
// exist in the world is the LOW (spent) variant of the smallest-scaled placed
// stone node. Any decoration that reaches that size is a lie the crosshair
// cannot catch (the picker is ray-vs-node-sphere; scenery is invisible to it
// by construction), so decoration must stay strictly below it.
//
// The three factors, each named for where it lives, because a constant sized
// against "today's asset set" is the catalogued hidden-assumption failure
// (INSTRUMENTS.md, the 8 m machine that falsified four constants at once):
//   0.90  boulder_common.py KINDS["stone"] dims z, the authored Full height
//   0.40  boulder_common.py VARIANTS "Low" z scale, the spent-stub height
//   ROCK_SCALE_MIN  the smallest scale this file ever places one at
// If any of those three moves, this threshold moves with the two that are
// referenced and must be re-derived against the one that is transcribed
// (the .glb dims; tools/smoke/rockdims.mjs re-measures the transcription off
// the exported bytes so drift fails a check rather than shipping).
// ---------------------------------------------------------------------------
export const NODE_STONE_FULL_H = 0.90;
export const NODE_LOW_Z_SCALE = 0.40;
export const DECOR_ROCK_MAX_H =
  NODE_STONE_FULL_H * NODE_LOW_Z_SCALE * ROCK_SCALE_MIN;  // = 0.27 m

/**
 * Mean rocks per km2 by biome index (biome.h order: Ocean, Beach, Plains,
 * Forest, Hills, Mountains, Polar, then the three moon biomes).
 *
 * The shape follows the brief and the retired decor it replaces: Mountains get
 * scree (the retired Mtn_TalusChunk ran at 1,500/km2 as pure decoration; real
 * nodes are individually simulated so the ask is lower and CLUSTERED so the
 * local read is still "a scree slope"); Hills get scattered singles with mild
 * grouping (replacing Hills_LargeBoulder at 380); Plains sparse singles;
 * Forest sparsest, trees dominate there; Beach moderate clusters (replacing
 * Beach_Rock at 500); Ocean sparse (replacing Ocean_SeabedRock at 400); Polar
 * modest (replacing Polar_IceBoulder at 380 with honest stone).
 *
 * MOON BIOMES ARE 0 AND THAT IS A DEFERRAL, NOT A RULING: Cinder's rock decor
 * still lies and is logged as owed work, but a moon pass needs its own density
 * table and its own measurement sites, and nothing on Cinder is measurable in
 * this pass.
 */
export const ROCK_DENSITY_KM2: readonly number[] = [
  140,   // Ocean
  240,   // Beach
  170,   // Plains
  130,   // Forest
  330,   // Hills
  640,   // Mountains
  180,   // Polar
  0, 0, 0,  // Moon: Regolith, Highland, CraterFloor (deferred, see above)
];

/**
 * Cluster contrast per biome, 0 = flat field, 1 = fully gathered into patches.
 * Mountains near 1 is what makes 640/km2 read as scree slopes with bare rock
 * between them rather than a uniform sprinkle; Plains near 0 is lone erratics.
 */
export const ROCK_CLUSTER_C: readonly number[] = [
  0.35, 0.55, 0.25, 0.35, 0.45, 0.8, 0.4, 0, 0, 0,
];

/** Cluster field feature sizes, body-frame metres (same discipline as the
 *  canopy stand field: world-space and smooth, so it cannot tile per chunk). */
export const ROCK_CLUSTER_M = 90;
export const ROCK_CLUSTER_DETAIL_M = 30;

/**
 * cos of the steepest ground a rock stands on. The same 57 degree constant
 * every prop uses (ScatterTuning.MIN_SLOPE_COS), kept with a counter because
 * WG-63 measured that gate refusing 0 cells at all seven survey sites: the
 * counter is the measurement the next reader inherits, whichever way it reads.
 */
export const ROCK_MIN_SLOPE_COS = 0.55;

/** Finite-difference arm for the slope sample, metres. About the footprint of
 *  the boulder itself, so the slope refused is the slope the rock would span. */
export const SLOPE_ARM_M = 1.5;

/** Standing water above which a cell refuses a rock (ScatterTuning's
 *  WET_REJECT_M, same value for the same shoreline float reason). */
export const ROCK_WET_REJECT_M = 0.02;

/** Smootherstep. */
const sstep = (t: number): number =>
  t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10);

/** Integer lattice hash, seeded. Three axes plus the world seed, one round. */
export function rockHash(seed: number, a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2f) ^ Math.imul(b | 0, 0x9e3779b1)
    ^ Math.imul(c | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x2545f491)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export const frac = (h: number): number => (h >>> 8) / 16777216;

/** One octave of trilinear value noise over body-frame metres, in [0,1]. */
function octave(seed: number, x: number, y: number, z: number, scale: number): number {
  const fx = x / scale, fy = y / scale, fz = z / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = sstep(fx - ix), ty = sstep(fy - iy), tz = sstep(fz - iz);
  const c = (dx: number, dy: number, dz: number): number =>
    rockHash(seed, ix + dx, iy + dy, iz + dz) / 4294967296;
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * tx;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * tx;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * tx;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * Cluster weight at a body-frame point for a biome, mean approximately 1 so
 * the per-biome density stays the MEAN density whatever the contrast. The
 * field is a two-octave value noise n with mean 1/2; the weight is a ramp of n
 * whose expectation is normalised out, blended by the biome's contrast.
 * (The realised mean is measured per site by probes/rocks.js rather than
 * trusted from this comment; deliveredFraction uses the same weight on both
 * sides, so this term cannot fake a delivery.)
 */
export function rockClusterW(seed: number, x: number, y: number, z: number,
                             contrast: number): number {
  if (contrast <= 0) return 1;
  const n = octave(seed, x, y, z, ROCK_CLUSTER_M) * 0.7
    + octave(seed ^ 0x9e37, x, y, z, ROCK_CLUSTER_DETAIL_M) * 0.3;
  // ramp with expectation ~0.5 under the field's bell-shaped distribution,
  // scaled by 2 so the clustered term keeps the mean.
  const g = sstep((n - 0.38) / (0.68 - 0.38)) * 2;
  return (1 - contrast) + contrast * g;
}
