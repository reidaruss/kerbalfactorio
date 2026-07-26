// Which mesh a harvest node wears, and what colour the resource reads as.
//
// Split out of NodeField when the ore patches landed: two files now need the
// per-kind art and the per-kind palette (the nodes themselves and the ground
// skin of the patch they stand on), and NodeField was at the 400-line cap.
//
// THE PALETTE IS THE READABILITY REQUIREMENT. The complaint that started this
// work was that a player could not tell what they were looking at, so the four
// mined resources are pinned to four colours that survive being seen from
// thirty metres away against green terrain: copper is orange, iron is grey
// blue, coal is near black, stone is pale. `chip` is the debris colour (an
// object in the air, lit) and `ground` is the ore-bearing earth (a surface,
// shadowed), so the ground tone is the deeper of the two on purpose.

import { NODE_KIND } from './GameCore.js';

/** One .glb per node kind, plus the root node name the meshes are prefixed with. */
export interface NodeArt {
  file: string; root: string; radiusM: number; hitUpM: number; colour: number;
}

/**
 * Kind -> art. Trees alternate between two files so a stand is not a clone army.
 * `colour` is what the debris burst is made of, taken from the role palette the
 * asset itself is authored against (of_lib.py). A player should be able to name
 * the resource from the chips alone.
 */
export const ART: Record<number, NodeArt[]> = {
  [NODE_KIND.Tree]: [
    { file: 'tree_conifer.glb', root: 'TreeConifer', radiusM: 1.6, hitUpM: 1.15, colour: 0x6d5238 },
    { file: 'tree_broadleaf.glb', root: 'TreeBroadleaf', radiusM: 2.2, hitUpM: 1.25, colour: 0x6d5238 },
  ],
  [NODE_KIND.Rock]: [{ file: 'boulder_stone.glb', root: 'BoulderStone', radiusM: 1.0, hitUpM: 0.6, colour: 0x8d887e }],
  [NODE_KIND.CoalSeam]: [{ file: 'boulder_coal.glb', root: 'BoulderCoal', radiusM: 1.1, hitUpM: 0.6, colour: 0x35353c }],
  [NODE_KIND.IronOre]: [{ file: 'boulder_iron.glb', root: 'BoulderIron', radiusM: 1.1, hitUpM: 0.6, colour: 0xb4bac0 }],
  [NODE_KIND.CopperOre]: [{ file: 'boulder_copper.glb', root: 'BoulderCopper', radiusM: 1.0, hitUpM: 0.6, colour: 0xc06b3e }],
};

/**
 * The ore-bearing GROUND colour per kind. Deeper and more saturated than the
 * chip colour because it is a shadowed surface rather than a lit fragment, and
 * because a patch has to be identifiable before the player is close enough to
 * see an outcrop's shape.
 */
export const GROUND_COLOUR: Record<number, number> = {
  [NODE_KIND.Rock]: 0x8a8477,       // pale
  [NODE_KIND.CoalSeam]: 0x17171d,   // black
  [NODE_KIND.IronOre]: 0x53687d,    // grey blue
  [NODE_KIND.CopperOre]: 0xa04c19,  // orange
};

/**
 * Ore-bearing ground is MOTTLED, not a smooth gradient. /core's coverage is a
 * clean 1 - u^2 because it is a rule the drill rate reads; a smooth ramp painted
 * on the terrain reads as a projected decal, which is precisely the thing this
 * patch is not. So the skin's own vertices are jittered a few per cent about
 * that number, deterministically from the vertex direction, purely for the eye.
 */
export function mottle(x: number, y: number, z: number): number {
  const h = hash32(Math.round(x * 8191) ^ Math.round(y * 4093),
    Math.round(z * 6151));
  return 0.82 + 0.36 * frac(h);
}

/** The kinds that are ore bodies rather than scenery. Trees are not a deposit. */
export const PATCH_KINDS: number[] = [
  NODE_KIND.IronOre, NODE_KIND.CoalSeam, NODE_KIND.CopperOre, NODE_KIND.Rock,
];

/**
 * Depletion thresholds, from ASSET-SPECS 3.1: remaining/initial at 0.66 and
 * 0.33. `Stump` exists only for the conifer, so `Low` is the floor everywhere
 * and an emptied node keeps its `Low` silhouette rather than vanishing, which
 * is what tells a player "this one is done" instead of "this one moved".
 */
export function variantFor(fraction: number): number {
  if (fraction > 0.66) return 0;
  if (fraction > 0.33) return 1;
  return 2;
}

export function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export const frac = (h: number): number => (h >>> 8) / 16777216;
