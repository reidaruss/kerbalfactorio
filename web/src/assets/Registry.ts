// THE id-to-asset lookup (ARCHITECTURE.md section 9.4). Every path in the client
// comes from here, so a moved or renamed .glb is one edit rather than a hunt.
//
// The full registry.json keyed by generated /core ids arrives with the factory at
// W6; what W4 needs is the character, the two tools, and one prop atlas per
// Biome. The Biome table is indexed by the /core Biome enum, so it cannot drift
// from BiomePalette: both are the same ordering, asserted by BIOME_ATLAS.length.

import { BIOME_NAMES } from '../render/materials/BiomePalette.js';

const ROOT = 'assets/';

export const ASSETS = {
  playerBody: `${ROOT}player/player_body.glb`,
  playerFpArms: `${ROOT}player/player_fp_arms.glb`,
  crudePickaxe: `${ROOT}tools/crude_pickaxe.glb`,
  crudeAxe: `${ROOT}tools/crude_axe.glb`,
  armourSet: `${ROOT}player/armour_set.glb`,
  detailCards: `${ROOT}props/detail_cards.glb`,
} as const;

/**
 * One prop atlas per /core Biome, in enum order. Regolith, MoonHighland and
 * CraterFloor share props_moon.glb deliberately: biome.h classifies a moon by
 * elevation band alone, the bands abut with no transition zone, and the surface
 * material is the same dust everywhere (ASSET-SPECS section 3.2).
 */
export const BIOME_ATLAS: readonly string[] = [
  `${ROOT}props/props_ocean.glb`,      // Ocean
  `${ROOT}props/props_beach.glb`,      // Beach
  `${ROOT}props/props_plains.glb`,     // Plains
  `${ROOT}props/props_forest.glb`,     // Forest
  `${ROOT}props/props_hills.glb`,      // Hills
  `${ROOT}props/props_mountains.glb`,  // Mountains
  `${ROOT}props/props_polar.glb`,      // Polar
  `${ROOT}props/props_moon.glb`,       // Regolith
  `${ROOT}props/props_moon.glb`,       // MoonHighland
  `${ROOT}props/props_moon.glb`,       // CraterFloor
];

if (BIOME_ATLAS.length !== BIOME_NAMES.length) {
  throw new Error('Registry: BIOME_ATLAS must have one entry per /core Biome');
}

/**
 * Atlases loaded for EVERY biome rather than selected by one. `detail_cards`
 * is the ground-detail understorey that sits under the biome props; it was
 * declared here and never passed to a loader, so it shipped, validated and had
 * never been drawn (blocker A-2). `?detail=0` drops it again.
 */
export const SHARED_ATLAS: readonly string[] = [ASSETS.detailCards];

/**
 * The props each biome scatters, as node stems, with the atlas subset the moon
 * biomes take. `collides` is the ASSET-SPECS section 3.2 table: eighteen props
 * carry a `col_<Prop>` box and the other twenty-three are walk-through, and the
 * character controller reads THIS, not the presence of a mesh.
 */
export interface PropSpec {
  readonly stem: string;
  readonly collides: boolean;
  /** Instances per square kilometre of chunk surface, before slope rejection. */
  readonly density: number;
  /** Uniform scale jitter, +/- this fraction. */
  readonly jitter: number;
  /**
   * Ground-detail understorey. Drawn only inside `Scatter.DETAIL_RADIUS_M`
   * (40 m) rather than over the whole 170 m ring, because a 0.36 m card past
   * that distance costs an instance and carries no pixels.
   */
  readonly detail?: boolean;
}

/**
 * DENSITY_SCALE turns the per-prop figures below (which are written as "how
 * common is this relative to its neighbours") into instances per square
 * kilometre.
 *
 * The old comment here claimed 6x gives "about one prop per 4 m^2". It does
 * not, and the correction is worth keeping because the number was load-bearing
 * for a judgement about how the ground looks: Plains sums to 19,820 before the
 * scale and 118,920 after, which is **0.119 props per m2, one per 8.4 m2**. The
 * comment was out by 2x. Worse, that figure is a density and the eye reads
 * COVERAGE: at the shipped footprints the biome props cover 13.1% of the
 * ground, so 87% of it is bare however many instances are placed. That is what
 * the `detail: true` understorey below is for, and it is why the tuft sizes
 * matter more than the tuft count.
 */
const DENSITY_SCALE = 6;

const P = (stem: string, collides: boolean, density: number, jitter = 0.25): PropSpec =>
  ({ stem, collides, density: density * DENSITY_SCALE, jitter });

/** A ground-detail card. Same units, but only drawn inside the detail ring. */
const D = (stem: string, density: number, jitter = 0.3): PropSpec =>
  ({ stem, collides: false, density: density * DENSITY_SCALE, jitter, detail: true });

/**
 * The understorey, shared by every vegetated biome. Densities are much higher
 * than a biome prop's because these are the layer that makes ground read as
 * ground rather than as a texture, and the numbers below are 3.6x what they
 * were, which is the single biggest change in the world-art pass.
 *
 * WHAT PAID FOR IT, because a 3.6x density that is not paid for is a frame
 * budget violation and DW-5 is not relaxed. Measured at a fixed Hills camera,
 * one binary, `?detail=0` as the control: the OLD understorey was 9,738
 * instances and cost **1,003,112 triangles and 12.3 ms of an 18.0 ms p50**,
 * which is about 103 triangles for a card whose LOD0 is 18 to 42, because every
 * card was drawn FOUR times, once in the near pass and once in each of three
 * shadow cascades. `PropLibrary.DETAIL_SUFFIX` takes the understorey out of the
 * shadow pass entirely, so a card now costs its own triangle count ONCE. That
 * is a 4x saving spent on a 3.6x density, and it is why this is roughly budget
 * neutral rather than roughly four times the cost.
 *
 * These are FULL-density figures and they apply inside `DETAIL_FULL_M` (30 m).
 * Beyond that `detailWeight` grades them down to 0.18 at 78 m, which is about
 * what the whole ring used to carry, so the old look is now the outer band of
 * the new one and there is no longer a visible line where the cover stops.
 *
 * SEVEN SPECIES, NOT FOUR, AND THE TOTAL IS UNCHANGED (RN-49). The three new
 * ones are paid for out of the existing four rather than added on top: 538,000
 * before and 538,000 after, to the unit. That is deliberate and it is the only
 * honest way to add species while DW-5 is not relaxed, because density is what
 * the triangle budget is spent on and "more variety" must not become "more
 * cost" by default. What changes is WHICH plant stands in a given spot, not how
 * many plants there are.
 *
 * The mix is also CLUSTERED rather than uniform (ScatterLook.CLUSTER_BIAS).
 * Adding species to an unclustered scatter makes the ground MORE uniform, not
 * less: four species salt-and-peppered and seven species salt-and-peppered both
 * average out to one flat texture at any distance, and the second is merely a
 * more expensive way to get there. Species without clustering would have been a
 * cost with no picture.
 */
const GROUND_DETAIL: readonly PropSpec[] = [
  D('Detail_GrassCardA', 180000), D('Detail_GrassCardB', 105000),
  D('Detail_GrassCardC', 70000), D('Detail_PebbleScatter', 24000),
  // The broadleaf forb is the biggest single share of the new budget because it
  // is the shape that most differs from a blade: a field of vertical strokes is
  // what the old four could only ever produce.
  D('Detail_BroadleafForb', 75000), D('Detail_SedgeRosette', 60000),
  // Sparse on purpose. Flowers read as an event, and a flower you see every
  // metre is a texture. Clustering then concentrates these few into occasional
  // stands rather than spreading them evenly, which is the whole point.
  D('Detail_FlowerSprig', 24000),
];
/** Dry and rocky biomes take the litter and the pebbles, not the grass. */
const DRY_DETAIL: readonly PropSpec[] = [
  D('Detail_GrassCardC', 34000), D('Detail_PebbleScatter', 64000),
  // The rosette is the one new species that belongs on dry ground: it hugs the
  // surface, which is what a plant does where water is scarce. 116,000 before
  // and after, so this biome is budget neutral too.
  D('Detail_SedgeRosette', 18000),
];

export const BIOME_PROPS: readonly (readonly PropSpec[])[] = [
  [P('Ocean_Kelp', false, 900), P('Ocean_SeabedRock', true, 400)],
  [P('Beach_Rock', true, 500), P('Beach_Driftwood', true, 260),
    P('Beach_ShellCluster', false, 1400), P('Beach_DuneGrass', false, 5200),
    ...DRY_DETAIL],
  [P('Plains_GrassTuftA', false, 9000), P('Plains_GrassTuftB', false, 7000),
    P('Plains_FlowerCluster', false, 1800), P('Plains_PebbleA', false, 900),
    P('Plains_PebbleB', true, 420), P('Plains_Shrub', false, 700),
    ...GROUND_DETAIL],
  [P('Forest_Fern', false, 4200), P('Forest_DeadTree', true, 420),
    P('Forest_FallenLog', true, 260), P('Forest_MushroomCluster', false, 1500),
    P('Forest_Rock', true, 520), ...GROUND_DETAIL],
  [P('Hills_LargeBoulder', true, 380), P('Hills_ScreePatch', false, 1600),
    P('Hills_Shrub', false, 2200), ...GROUND_DETAIL],
  [P('Mtn_RockSpire', true, 320), P('Mtn_TalusChunk', true, 1500),
    P('Mtn_SnowPatch', false, 900), ...DRY_DETAIL],
  [P('Polar_IceShard', true, 700), P('Polar_SnowDrift', false, 1100),
    P('Polar_IceBoulder', true, 380)],
  [P('Moon_RockSmall', false, 1800), P('Moon_RockLarge', true, 420),
    P('Moon_RegolithRipple', false, 700), D('Detail_PebbleScatter', 20000)],
  [P('Moon_HighlandOutcrop', true, 400), P('Moon_RockLarge', true, 500),
    P('Moon_RockSmall', false, 1600), D('Detail_PebbleScatter', 20000)],
  [P('Moon_CraterRimRock', true, 460), P('Moon_ImpactGlass', false, 700),
    P('Moon_RockSmall', false, 1500), D('Detail_PebbleScatter', 20000)],
];
