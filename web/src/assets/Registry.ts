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
 * The canopy trees, loaded for every biome like the understorey and for the
 * same reason: which biome a tree stands in is a DENSITY question answered by
 * `BIOME_PROPS` below, not a question about which file it lives in. Three
 * biomes carry trees at three different densities and a fourth is deliberately
 * bare, and one atlas serving all of them is what makes the Forest/Plains edge
 * a gradient instead of a seam.
 *
 * SEPARATE FROM `SHARED_ATLAS`, which is not a style choice. `PropLibrary.load`
 * reads `SHARED_ATLAS` to decide which atlases get the `:detail` batch suffix,
 * and that suffix sets `castShadow = false`. A 12 m tree that casts no shadow
 * is worse than no tree: the whole reason a forest reads as mass is that the
 * ground under it is dark.
 *
 * ZERO NEW DRAW CALLS, and this is why the atlas is worth having at all. A
 * `PropLibrary` batch is keyed by MATERIAL NAME alone, and the three trees use
 * only `OF_Bark`, `OF_LeafDeep`, `OF_Leaf` and `OF_LeafLight`, all four of
 * which `props_forest.glb` already contributes. The trees land in batches that
 * exist. A single new role name would have cost one draw in the near pass and
 * one in each of the three shadow cascades.
 */
export const CANOPY_ATLAS: readonly string[] = [`${ROOT}props/props_canopy.glb`];

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
  /**
   * A CANOPY tree. Drawn out to `ScatterTuning.CANOPY_RADIUS_M` rather than the
   * 170 m biome ring, switched to its far geometry at `CANOPY_LOD2_M` rather
   * than at 45 m, and multiplied by the stand field and the treeline. Mutually
   * exclusive with `detail`, and the three tiers are selected by these two flags
   * alone so a spec cannot land in two pools.
   */
  readonly canopy?: boolean;
  /**
   * Per-instance HEIGHT band, as a fraction of the authored height, overriding
   * the shared foliage band for this spec only. Absent means the shared band,
   * bit-for-bit as before.
   *
   * WHY IT EXISTS AND WHY IT IS HERE. `ScatterLook`'s foliage band is 0.55 to
   * 1.30 and it is correct for what it was written for: a meadow IS a height
   * distribution, and a grass card at 0.55 is still grass. A canopy tree at
   * 0.55 of 12 m is 6.6 m, which is the harvest conifer's height, and the whole
   * design decision this pass rests on is that a scenery tree cannot be
   * mistaken for a harvest node from its silhouette. A band that can produce
   * that collision would falsify the rule on roughly a fifth of the trees in
   * the world.
   *
   * TERRITORY, stated rather than assumed: the shared bands are rendering's
   * (`ScatterLook.ts`), and this field does not touch them. It is an OPT-IN
   * override, so every prop that existed before this line reads exactly the
   * number it read before. It sits in the registry beside the density it
   * qualifies because both are answers to "what does a canopy tree do", but it
   * is a look number in a placement file and it should move with `ScatterLook`
   * when that file moves.
   */
  readonly heightLo?: number;
  readonly heightHi?: number;
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
 * A canopy tree. Same units again, so a tree's density is directly comparable
 * to the fern's underneath it and the two can be read side by side.
 *
 * `collides: true` buys the contact skirt and nothing else: `collides` is
 * consumed in exactly one place in the client (`ScatterEmit`'s skirt test) and
 * no prop in this game has ever stopped a player. A 12 m trunk meeting bare
 * ground is the pasted-on read `ScatterLook.CONTACT_CARDS` exists to remove, so
 * the trees take a skirt where a skirt is visible; `Scatter` withholds it
 * beyond the understorey ring, where five cards at the foot of a tree 300 m
 * away would be five instances nobody can see.
 *
 * The jitter is narrow (0.14, against 0.25 for a boulder) and the height band
 * is narrower still, for the reason `heightLo` gives: variety here comes from
 * having three species of three different heights, not from stretching one.
 */
const C = (stem: string, density: number): PropSpec => ({
  stem, collides: true, density: density * DENSITY_SCALE, jitter: 0.14,
  canopy: true, heightLo: 0.84, heightHi: 1.20,
});

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

/**
 * THE CANOPY, per biome, and the four numbers that decide what this planet's
 * forests look like from a distance.
 *
 * FOREST is the closed forest: 640 before the scale, 3,840 trees per square
 * kilometre after it, which is a mean spacing of about 16 m before the stand
 * field concentrates it. Inside a stand the realised spacing is nearer 12 m and
 * in a clearing it is 50 m, which is the range a real forest actually spans.
 *
 * HILLS gets a third of that and PLAINS a ninth, and those two numbers are
 * doing more work than their size suggests. The biome classifier hands out
 * Forest or Plains on ONE moisture threshold (`biome.h:159`), so the two abut
 * along a line with nothing in between. Giving Plains real, sparse trees and
 * Hills real, thin ones turns that line into a hundred metres of thinning
 * woodland, and it means a player crossing a biome boundary sees a landscape
 * change rather than a switch. The stand field does the rest: at the Plains
 * density the stands read as isolated copses in open grass, which is exactly
 * what a low-density stand field produces and is why this needed no extra rule.
 *
 * MOUNTAINS DOES CARRY A DENSITY, and the first version of this table did not,
 * which was a mistake in two separate ways.
 *
 * It was wrong as ARCHITECTURE, because "Mountains has no trees" was then
 * stated twice: once as an absent row here and once as the treeline in
 * `ScatterTuning`. Two rules with the same content is the DW-26 failure in
 * miniature, and the two would drift the first time either moved.
 *
 * It was wrong as an INSTRUMENT, and that half was measured. With no Mountains
 * row the canopy branch never executed anywhere above the treeline, so the term
 * that deletes trees with altitude had no site in the world at which it could
 * be observed doing so, and `canopyBareCells` read 0 at all seven survey sites
 * while the treeline was in fact working. Giving Mountains a real, small
 * density makes bareness a CONSEQUENCE of the altitude term rather than a
 * second statement of it, and it puts the refusal counter somewhere it can
 * fire. The mountain flanks are also the only steep ground in the survey, which
 * is where the 44 degree slope gate becomes observable for the same reason (R8:
 * a probe that only ever runs on flat ground cannot see a slope rule).
 *
 * What it looks like: nothing, nearly everywhere, because the Mountains biome
 * begins around 2,280 m and the treeline ends at 1,850 m. Where a mountain foot
 * dips below that, it is a few wind-bent stragglers, which is what the bottom
 * of a real mountain looks like and is currently a hard edge.
 *
 * BEACH, POLAR, OCEAN and the three moon biomes get nothing. Beach is the pale
 * dry sand Reid picked out of the WG-53 survey and a treeline behind it would
 * be a different picture; the rest have no soil to argue about.
 */
const CANOPY_FOREST: readonly PropSpec[] = [
  C('Canopy_Pine', 300), C('Canopy_Fir', 90), C('Canopy_Broadleaf', 250),
];
/** Thinner and more coniferous with height, which is what a hillside does. */
const CANOPY_HILLS: readonly PropSpec[] = [
  C('Canopy_Pine', 110), C('Canopy_Fir', 40), C('Canopy_Broadleaf', 50),
];
/** Copses in open grass. Broadleaf-dominant: an oak in a field, not a pine. */
const CANOPY_PLAINS: readonly PropSpec[] = [
  C('Canopy_Pine', 18), C('Canopy_Fir', 5), C('Canopy_Broadleaf', 47),
];
/**
 * Mountain foot only, and conifer only: no broadleaf survives up here, and the
 * treeline deletes almost all of this. It exists so the deletion is something
 * the code DOES rather than something the table omits. See the note above.
 */
const CANOPY_MOUNTAIN: readonly PropSpec[] = [
  C('Canopy_Pine', 55), C('Canopy_Fir', 25),
];

export const BIOME_PROPS: readonly (readonly PropSpec[])[] = [
  [P('Ocean_Kelp', false, 900), P('Ocean_SeabedRock', true, 400)],
  [P('Beach_Rock', true, 500), P('Beach_Driftwood', true, 260),
    P('Beach_ShellCluster', false, 1400), P('Beach_DuneGrass', false, 5200),
    ...DRY_DETAIL],
  [P('Plains_GrassTuftA', false, 9000), P('Plains_GrassTuftB', false, 7000),
    P('Plains_FlowerCluster', false, 1800), P('Plains_PebbleA', false, 900),
    P('Plains_PebbleB', true, 420), P('Plains_Shrub', false, 700),
    ...GROUND_DETAIL, ...CANOPY_PLAINS],
  [P('Forest_Fern', false, 4200), P('Forest_DeadTree', true, 420),
    P('Forest_FallenLog', true, 260), P('Forest_MushroomCluster', false, 1500),
    P('Forest_Rock', true, 520), ...GROUND_DETAIL, ...CANOPY_FOREST],
  [P('Hills_LargeBoulder', true, 380), P('Hills_ScreePatch', false, 1600),
    P('Hills_Shrub', false, 2200), ...GROUND_DETAIL, ...CANOPY_HILLS],
  [P('Mtn_RockSpire', true, 320), P('Mtn_TalusChunk', true, 1500),
    P('Mtn_SnowPatch', false, 900), ...DRY_DETAIL, ...CANOPY_MOUNTAIN],
  [P('Polar_IceShard', true, 700), P('Polar_SnowDrift', false, 1100),
    P('Polar_IceBoulder', true, 380)],
  [P('Moon_RockSmall', false, 1800), P('Moon_RockLarge', true, 420),
    P('Moon_RegolithRipple', false, 700), D('Detail_PebbleScatter', 20000)],
  [P('Moon_HighlandOutcrop', true, 400), P('Moon_RockLarge', true, 500),
    P('Moon_RockSmall', false, 1600), D('Detail_PebbleScatter', 20000)],
  [P('Moon_CraterRimRock', true, 460), P('Moon_ImpactGlass', false, 700),
    P('Moon_RockSmall', false, 1500), D('Detail_PebbleScatter', 20000)],
];
