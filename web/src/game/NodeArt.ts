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
  /**
   * Relative draw weight inside its kind's list. Absent means 1, and a list in
   * which every entry is absent picks EXACTLY as the old uniform floor did, bit
   * for bit, which is why the two trees below are untouched by this field.
   */
  weight?: number;
  /**
   * Biome indices (biome.h order, BiomePalette.BIOME_NAMES) this form may stand
   * in. Absent means every biome, so an entry that does not opt in is unchanged.
   */
  biomes?: readonly number[];
}

/** biome.h / BIOME_NAMES index. Only the ones a node art entry gates on. */
const MOUNTAINS = 5;

/**
 * WG-94, THE MOUNTAINS SPIRE, BACK AS SOMETHING YOU CAN HIT. WG-68 retired the
 * 3.40 m decor prop because a rock the crosshair cannot catch is a lie, and
 * named the loss; RN-244 re-authored the form as a Rock harvest node, so it
 * costs no new resource, no recipe and no /core change: it is a second entry in
 * a list that already existed. 2.60 m authored and placed at ROCK_SCALE_MIN to
 * MAX, so these stand 1.95 m to 3.90 m and the tallest is taller than the
 * retired prop ever was.
 *
 * `radiusM` 1.4 against the boulder's 1.0 because reach is measured TO THE NODE
 * and this one is genuinely wider at the base (1.30 x 1.15 m) as well as much
 * taller. `pick` scales it by the placement scale, so a 3.9 m spire is reachable
 * from proportionally further and a 1.95 m one demands proportional aim.
 *
 * `hitUpM` 1.15 IS DERIVED FROM THE PLAYER AND NOT FROM THE ASSET. Every other
 * node sits near 0.55 of its own height, which here is 1.43 m authored and
 * 2.15 m at the largest placement: over the player's head, so the swing would
 * land on nothing. 1.15 m is the arm, and `min(0.55 * h, 1.15)` is the rule.
 * INSTRUMENTS.md's 8 m machine paid in advance: the first asset of a new size
 * class falsifies every constant that was sized against the old set.
 *
 * MOUNTAINS ONLY. The form is frost shattering along joints, a high-altitude
 * process, and a 3.9 m spire on a beach is the same category error the decor
 * spire was. Polar is the obvious second home and is deliberately NOT taken:
 * this pass has no Polar measurement site, and a claim measured nowhere reports
 * its own absence. WEIGHT 0.5, so one Mountains rock in three is a spire: a
 * scree slope is made of scree and the spires are what break its skyline.
 */
const ROCK_SPIRE: NodeArt = {
  file: 'rock_spire.glb', root: 'RockSpire', radiusM: 1.4, hitUpM: 1.15,
  colour: 0x8d887e, weight: 0.5, biomes: [MOUNTAINS],
};

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
  [NODE_KIND.Rock]: [
    { file: 'boulder_stone.glb', root: 'BoulderStone', radiusM: 1.0, hitUpM: 0.6, colour: 0x8d887e },
    ROCK_SPIRE,
  ],
  [NODE_KIND.CoalSeam]: [{ file: 'boulder_coal.glb', root: 'BoulderCoal', radiusM: 1.1, hitUpM: 0.6, colour: 0x35353c }],
  [NODE_KIND.IronOre]: [{ file: 'boulder_iron.glb', root: 'BoulderIron', radiusM: 1.1, hitUpM: 0.6, colour: 0xb4bac0 }],
  [NODE_KIND.CopperOre]: [{ file: 'boulder_copper.glb', root: 'BoulderCopper', radiusM: 1.0, hitUpM: 0.6, colour: 0xc06b3e }],
};

/**
 * `?spires=0`: the one-binary control for WG-94 (standing rule 7). Splices the
 * entry OUT of the list rather than skipping it at pick time, so the control
 * also removes the fetch: `NodeField.load` builds its download set from `ART`,
 * and a control that still paid 167 kB for a file it never draws would not be
 * the pre-change state. `Boot` calls this once, before `NodeField.load`.
 */
export function setSpires(on: boolean): void {
  const list = ART[NODE_KIND.Rock];
  const at = list.indexOf(ROCK_SPIRE);
  if (on && at < 0) list.push(ROCK_SPIRE);
  else if (!on && at >= 0) list.splice(at, 1);
}

/**
 * Which art a node of `kind` wears, given the biome it stands in and its own
 * placement hash. `biome` is a biome.h index, or -1 where the caller genuinely
 * does not know one (an ore-patch outcrop): an entry that gates on biome is
 * then REFUSED rather than assumed, because "unknown" must not read as "yes".
 *
 * A WEIGHTED draw, and the weights are what stop a second entry meaning "half of
 * them". With every weight absent and no biome gate this is bit-for-bit the
 * uniform `list[floor(frac(hash32(h, 3)) * n)]` it replaces, which is why the
 * two trees and every ore boulder pick exactly the file they picked before: at
 * n equal weights of 1 the cumulative walk and the floor agree on every input,
 * including the exact ties.
 */
export function pickArt(kind: number, h: number, biome: number): NodeArt | null {
  const list = ART[kind];
  if (list === undefined || list.length === 0) return null;
  const gated = list.some((a) => a.biomes !== undefined);
  const usable = gated
    ? list.filter((a) => a.biomes === undefined
        || (biome >= 0 && a.biomes.includes(biome)))
    : list;
  if (usable.length === 0) return null;
  let total = 0;
  for (const a of usable) total += a.weight ?? 1;
  let r = frac(hash32(h, 3)) * total;
  for (const a of usable) {
    r -= a.weight ?? 1;
    if (r < 0) return a;
  }
  return usable[usable.length - 1];
}

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
