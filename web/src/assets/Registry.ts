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
}

/**
 * DENSITY_SCALE turns the per-prop figures below (which are written as "how
 * common is this relative to its neighbours") into instances per square
 * kilometre. It is 6 because 1x was measured and looked like scrub: three props
 * per 784 m^2 cell, which is one every 16 m and reads as an empty field with
 * litter on it. 6x is about one prop per 4 m^2 inside the scatter radius, which
 * is what makes a biome read as a place rather than as a texture.
 */
const DENSITY_SCALE = 6;

const P = (stem: string, collides: boolean, density: number, jitter = 0.25): PropSpec =>
  ({ stem, collides, density: density * DENSITY_SCALE, jitter });

export const BIOME_PROPS: readonly (readonly PropSpec[])[] = [
  [P('Ocean_Kelp', false, 900), P('Ocean_SeabedRock', true, 400)],
  [P('Beach_Rock', true, 500), P('Beach_Driftwood', true, 260),
    P('Beach_ShellCluster', false, 1400), P('Beach_DuneGrass', false, 5200)],
  [P('Plains_GrassTuftA', false, 9000), P('Plains_GrassTuftB', false, 7000),
    P('Plains_FlowerCluster', false, 1800), P('Plains_PebbleA', false, 900),
    P('Plains_PebbleB', true, 420), P('Plains_Shrub', false, 700)],
  [P('Forest_Fern', false, 4200), P('Forest_DeadTree', true, 420),
    P('Forest_FallenLog', true, 260), P('Forest_MushroomCluster', false, 1500),
    P('Forest_Rock', true, 520)],
  [P('Hills_LargeBoulder', true, 380), P('Hills_ScreePatch', false, 1600),
    P('Hills_Shrub', false, 2200)],
  [P('Mtn_RockSpire', true, 320), P('Mtn_TalusChunk', true, 1500),
    P('Mtn_SnowPatch', false, 900)],
  [P('Polar_IceShard', true, 700), P('Polar_SnowDrift', false, 1100),
    P('Polar_IceBoulder', true, 380)],
  [P('Moon_RockSmall', false, 1800), P('Moon_RockLarge', true, 420),
    P('Moon_RegolithRipple', false, 700)],
  [P('Moon_HighlandOutcrop', true, 400), P('Moon_RockLarge', true, 500),
    P('Moon_RockSmall', false, 1600)],
  [P('Moon_CraterRimRock', true, 460), P('Moon_ImpactGlass', false, 700),
    P('Moon_RockSmall', false, 1500)],
];
