// THE COVER COLOUR RULE, and it is the whole reason the carpet cannot make the
// world look bald. RN-2145.
//
// THE PROBLEM, STATED BEFORE THE RULE. A grass carpet that fades out at 90 m
// has to hand the ground back to the terrain material, and the terrain material
// paints the biome's SUBSTRATE colour: Plains is 0x6d6a47, "dry turf over pale
// soil", RN-347's deliberate move away from painting the ground the colour of
// the plants standing on it. So if the carpet is an authored green, the fade is
// a colour step: green at your feet, khaki past it, and the world reads as
// going bald at the exact range the charter warns about.
//
// THE RULE THAT REMOVES THE STEP: the cover colour is a CHROMA ROTATION OF THE
// SUBSTRATE AT CONSTANT LUMINANCE. Every blade takes the terrain's own albedo
// at its own position (BiomePalette.terrainAlbedo, the CPU twin of the four
// lines TerrainShader draws the ground with), rotates it toward green by a
// per-biome weight, and is then renormalised so Rec.709 luminance is exactly
// what it was. Two consequences, and both are the point:
//
//   1. THE FADE CANNOT SHOW AS A VALUE STEP, because there is no value step to
//      show. What is lost across the fade is chroma and texture, not light, and
//      chroma at 90 m through this project's own aerial perspective is already
//      most of the way to the haze colour.
//   2. IT FOLLOWS A3 FOR FREE. When the terrain PBR splatting lane lands a real
//      grass albedo layer, `coverAlbedo` is handed the new colour and the
//      carpet moves with it. There is no second palette to keep in step, which
//      is the failure mode MASTER_PLAN keeps naming.
//
// THE SEAM THIS FILE PUBLISHES TO A3: `coverAlbedo` and `COVER` are the carpet
// side of the fade-target contract. A3's far-field grass layer should target
// `coverAlbedo(substrate, biome)` at the fade end so far ground and near carpet
// agree by construction rather than by tuning. Nothing in this file reaches
// into TerrainArt; the contract is a function A3 can call.

import * as THREE from 'three';
import { BIOME_COUNT } from '../materials/BiomePalette.js';

/** ?grasstint= scales the chroma rotation. 0 makes every blade exactly the
 *  ground colour, which is the isolator for "is the greening doing this". */
const TINT_AMP = ((): number => {
  const v = new URLSearchParams(self.location.search).get('grasstint');
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : 1;
})();

export interface CoverBiome {
  /** Density multiplier on the carpet, 0 switches the biome off entirely. */
  readonly k: number;
  /** How far the blade colour rotates toward green, 0 to 1. */
  readonly green: number;
  /** Height multiplier on the card, so scree stubble is not meadow grass. */
  readonly h: number;
}

/**
 * Index == the /core Biome enum (BiomePalette.BIOME_NAMES).
 *
 * The airless and frozen rows are ZERO and that is the negative control this
 * table gives for free: Polar, Regolith, MoonHighland and CraterFloor must be
 * bit-identical with the carpet on or off, so any measured difference at a moon
 * site is a bug in this layer and not a look decision. Ocean is zero because
 * the Ocean biome renders as flat blue terrain (world audit gap 11) and putting
 * grass on it would be a second wrong thing.
 */
export const COVER: readonly CoverBiome[] = [
  { k: 0.00, green: 0.00, h: 1.00 },   // 0 Ocean
  { k: 0.12, green: 0.35, h: 0.80 },   // 1 Beach: marram, sparse, sun-bleached
  { k: 1.00, green: 1.00, h: 1.00 },   // 2 Plains: the meadow pose's own biome
  { k: 0.85, green: 0.85, h: 0.90 },   // 3 Forest: floor cover under a canopy
  { k: 0.72, green: 0.72, h: 0.92 },   // 4 Hills: thin turf over stony ground
  { k: 0.20, green: 0.40, h: 0.70 },   // 5 Mountains: scree stubble
  { k: 0.00, green: 0.00, h: 1.00 },   // 6 Polar
  { k: 0.00, green: 0.00, h: 1.00 },   // 7 Regolith
  { k: 0.00, green: 0.00, h: 1.00 },   // 8 MoonHighland
  { k: 0.00, green: 0.00, h: 1.00 },   // 9 CraterFloor
];

if (COVER.length !== BIOME_COUNT) {
  throw new Error(`[of] grass: COVER has ${COVER.length} rows for `
    + `${BIOME_COUNT} biomes. A missing row is a biome with no stated cover, `
    + 'which is a decision nobody made.');
}

export function coverOf(biome: number): CoverBiome {
  return COVER[biome] ?? COVER[0];
}

/** Rec.709 relative luminance, linear space. The quantity held fixed. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * THE ROTATION. Red down, green up, blue down a little: the direction a dead
 * substrate moves when living cover grows on it. Then renormalised to the
 * substrate's own luminance, which is the half that makes the fade invisible.
 *
 * Worked example, so the numbers in this file can be argued with. Plains
 * substrate 0x6d6a47 is linear (0.153, 0.144, 0.063), luma 0.140. At green = 1
 * the rotation gives (0.084, 0.187, 0.054), luma 0.156, renormalised by 0.897
 * to (0.075, 0.168, 0.048) = #4E723E in sRGB, luma 0.140 exactly. A muted
 * meadow green at the same value as the soil it stands in, which is what SE's
 * grassland actually is and what RN-347 says a saturated primary is not.
 *
 * `out` is written and returned; nothing is allocated, because this runs once
 * per carpet cell and there are thousands of them per chunk.
 */
export function coverAlbedo(
  substrate: THREE.Color, biome: number, out: THREE.Color,
): THREE.Color {
  const k = coverOf(biome).green * TINT_AMP;
  if (!(k > 0)) return out.copy(substrate);
  const r0 = substrate.r, g0 = substrate.g, b0 = substrate.b;
  const l0 = luma(r0, g0, b0);
  const r = r0 * (1 - 0.45 * k);
  const g = g0 * (1 + 0.30 * k);
  const b = b0 * (1 - 0.15 * k);
  const l = luma(r, g, b);
  const s = l > 1e-6 ? l0 / l : 1;
  return out.setRGB(r * s, g * s, b * s);
}

/** What the carpet is doing, for a probe and for the A3 handover. */
export function coverPaletteState(): {
  tintAmp: number; rows: { biome: number; k: number; green: number; h: number }[];
} {
  return {
    tintAmp: TINT_AMP,
    rows: COVER.map((c, i) => ({ biome: i, k: c.k, green: c.green, h: c.h })),
  };
}
