// What ONE placed prop looks like: its colour, its non-uniform scale, and how
// many cards get tucked in around its base.
//
// Split out of Scatter.ts, which owns WHERE props go and was at the 400-line
// cap. The division is deliberate and not just line count: placement is
// terrain data and has to stay auditable against `deliveredFraction`, while
// everything here is art direction and is judged by looking at it. Keeping the
// two apart means a look change cannot quietly move a density measurement.
//
// Every number below comes from the same per-cell hash stream the placement
// uses, so determinism is untouched: the same seed grows the same forest with
// the same colours, and a chunk that streams out and back in is identical.

import * as THREE from 'three';
import { hash32, frac } from './ScatterTuning.js';

/**
 * A prop's look family, decided ONCE per stem from the materials its parts
 * landed in. This is the same argument RN-9 made for `NodeBatch.familyOf`: the
 * decision belongs to the material, because that is what the colour multiplies,
 * and reading it off the parts means a prop that changes material changes look
 * family with it rather than drifting away from a hand-written list.
 */
export type Look = 'foliage' | 'mineral';

/**
 * Is this material role a PLANT? The one authority for that question.
 *
 * It was one predicate inside `lookOf` and is now exported, because
 * `PropLibrary` asks the same question at load time when it decides which
 * geometries get the baked base-contact gradient (RN-30). Two copies of "which
 * materials are plants" is precisely the drift `lookOf`'s own comment warns
 * about, and a second list would be invisible until a new leaf role failed to
 * darken at its base for no reason anybody could see.
 *
 * Note it matches on the material role and therefore covers `OF_Grass:detail`
 * and every `OF_Leaf*` variant without enumerating them.
 */
export function isFoliageMaterial(name: string): boolean {
  return name.startsWith('OF_Grass') || name.startsWith('OF_Leaf');
}

export function lookOf(materials: readonly string[]): Look {
  for (const m of materials) if (isFoliageMaterial(m)) return 'foliage';
  return 'mineral';
}

/**
 * Chance that a foliage instance is drawn as a flower rather than as grass.
 *
 * The reference image's ground is not one green: it is a spread of greens with
 * scattered warm yellow through it, and that scatter is a large part of why it
 * reads as a meadow instead of as a texture. 5.5% is low enough that flowers
 * read as punctuation. It costs nothing at all, because it is the SAME card
 * geometry with a different per-instance colour: no new asset, no new draw
 * call, no extra triangle.
 */
const FLOWER_P = 0.055;
/**
 * Flower and grass tints MULTIPLY the material's albedo, which for `OF_Grass`
 * is 6F8F42 (0.44, 0.56, 0.26). The flower multiplier is above 1 in red and
 * green and well below 1 in blue, which lands near (0.75, 0.84, 0.10): a warm
 * yellow that is still recognisably the same plant. Above about 2.0 in any
 * channel the card clips through the tone curve and reads as a light source, so
 * these are ceilings and not preferences.
 */
const FLOWER = new THREE.Vector3(1.70, 1.50, 0.38);
/** Dry, sun-bleached end of the grass spread. Warm, and slightly desaturated. */
const DRY = new THREE.Vector3(1.22, 1.06, 0.62);

const scratch = new THREE.Color();

/**
 * The colour ONE instance is tinted with.
 *
 * Two independent draws, on purpose. `v` is a VALUE jitter and is what breaks
 * up a field of identical cards at a glance; `d` is a HUE drift toward dry, and
 * it is what stops the field reading as one paint colour when you look at it
 * properly. Applying only one of them looks like a rendering artefact: value
 * alone reads as noise, hue alone reads as patchy.
 *
 * Mineral props take the value jitter only. A rock whose hue wandered would
 * read as a different rock rather than as the same rock in different light,
 * and the whole point of the mineral family is that it is one substance.
 */
export function tintFor(look: Look, seed: number, k: number, out: THREE.Color): THREE.Color {
  const v = 0.80 + frac(hash32(seed, k * 8 + 6)) * 0.38;
  if (look === 'mineral') return out.setRGB(v, v, v);
  if (frac(hash32(seed, k * 8 + 7)) < FLOWER_P) {
    return out.setRGB(FLOWER.x * v, FLOWER.y * v, FLOWER.z * v);
  }
  const d = frac(hash32(seed, k * 8 + 9));
  // Toward DRY, but never all the way: a field where some blades are fully dry
  // and the rest are fully green reads as two species mixed, which is a
  // different and worse look than one species with variation in it.
  const t = d * d * 0.75;
  return out.setRGB(
    v * (1 + (DRY.x - 1) * t), v * (1 + (DRY.y - 1) * t), v * (1 + (DRY.z - 1) * t),
  );
}

export const tintScratch = scratch;

/**
 * Understorey height band, and the number Reid's reference is about.
 *
 * RN-15 shipped the understorey on the SAME height band as the biome tufts
 * (0.55 to 1.30 of the authored blade height) and the result reads as a crop
 * field rather than as a meadow: at `Detail_GrassCardB`'s authored 0.60 m, the
 * worst instance reached 0.60 x (1.3 width jitter x 1.30 height jitter x 1.32
 * distance upscale) = **1.34 m**, which is chest height on a 1.8 m character,
 * and a field of 1.3 m blades has no middle distance in it at all. The
 * Satisfactory reference is ground cover you LOOK ACROSS.
 *
 * Two changes, and the second one is the structural half. The band itself drops
 * to 0.40 to 0.82, which takes the density-weighted mean understorey height
 * from 0.427 m to 0.281 m. And `DETAIL_FAR_GROW` is demoted to a HORIZONTAL
 * upscale in `ScatterEmit`, so the distance term can no longer compound into
 * height at all: the tallest card in the world goes 1.34 m to **0.64 m**. That
 * second half is the one worth remembering, because RN-15 already retuned the
 * height jitter once for exactly this reason (1.48 down to 1.30) and the
 * compounding survived the retune. Capping a product by shrinking one of its
 * factors is a fix that has to be repeated every time either factor moves;
 * taking height out of the product is a fix that holds.
 *
 * Coverage is what the eye reads rather than height (Registry's DENSITY_SCALE
 * note), so the width band is widened to compensate: a shorter, splayed card
 * covers more GROUND per instance while blocking less middle distance, which is
 * the trade the reference makes.
 */
export const DETAIL_H_LO = 0.40;
export const DETAIL_H_HI = 0.82;
export const DETAIL_W_GAIN = 1.18;
/**
 * The RN-15 band, still used by every foliage prop that is NOT understorey, and
 * restored for the understorey too by `PropEmitter`'s `short = false`.
 *
 * That switch is deliberately NOT reachable from a query flag, and the reason is
 * ownership rather than design: every argument the scatter is constructed with
 * is passed by `Boot.ts`, which another lane owns this round, so the honest
 * isolation for the height change is a BINARY PAIR (`docs/screenshots/
 * RN30_world_{before,after}.png`) rather than standing rule 7's one-binary
 * control. The one-line `?grassshort=` wiring is named in the RN-30 report as a
 * coordination item; the constructor parameter is here so that wiring is one
 * line when Boot is free.
 */
export const TALL_H_LO = 0.55;
export const TALL_H_HI = 1.30;

/**
 * Non-uniform scale for one instance: width and height drawn SEPARATELY.
 *
 * The scatter shipped with one uniform scalar, so every card was a scaled copy
 * of the same card and the field had exactly one silhouette in it. Height is
 * what the eye reads on grass (a meadow is a height distribution), so it gets
 * the wider spread of the two, and width gets a narrow one so that a tall card
 * does not also become a fat one.
 *
 * `jitter` is the per-spec figure from the registry and is respected as the
 * WIDTH spread, so a spec that asked to be uniform still is in plan view.
 */
export function scaleFor(
  jitter: number, seed: number, k: number, tall: boolean, short: boolean,
  out: THREE.Vector3,
): THREE.Vector3 {
  const w = 1 + (frac(hash32(seed, k * 8 + 10)) * 2 - 1) * jitter;
  const lo = short ? DETAIL_H_LO : TALL_H_LO;
  const hi = short ? DETAIL_H_HI : TALL_H_HI;
  const h = tall
    ? w * (lo + frac(hash32(seed, k * 8 + 11)) * (hi - lo))
    : w;
  const g = short ? DETAIL_W_GAIN : 1;
  return out.set(w * g, h, w * g);
}

/**
 * How many understorey cards are tucked around the base of one prop.
 *
 * CONTACT BLENDING, and it is the cheapest item on the whole list. Nothing in
 * the reference image is pasted onto the ground: every rock and every cliff foot
 * has vegetation crowding it, and that crowding is the entire reason the rock
 * reads as sitting IN the world rather than ON a picture of it. Our boulders
 * meet the terrain along a hard silhouette with bare ground on both sides of it,
 * which is exactly the pasted-on read.
 *
 * The scatter is the right place for it and the only cheap one: it already
 * knows where every prop went, it already has the cell's four corners in hand
 * for the bilinear interpolation, and a card placed this way costs one pool
 * slot and no draw call. Doing it in the shader instead would need a second
 * pass over the props to build an occlusion field.
 *
 * Only props that COLLIDE get a skirt. That is the registry's own flag for
 * "this is a solid object you walk around" (ASSET-SPECS 3.2), which is the same
 * set as "this has a silhouette that meets the ground", so the skirt follows
 * the asset table rather than a second list that could drift from it.
 */
export const CONTACT_CARDS = 5;
/** Fraction of a cell the skirt is spread over, in the cell's own uv. */
export const CONTACT_SPREAD = 0.30;
