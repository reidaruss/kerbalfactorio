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

export function lookOf(materials: readonly string[]): Look {
  for (const m of materials) {
    if (m.startsWith('OF_Grass') || m.startsWith('OF_Leaf')) return 'foliage';
  }
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
  jitter: number, seed: number, k: number, tall: boolean, out: THREE.Vector3,
): THREE.Vector3 {
  const w = 1 + (frac(hash32(seed, k * 8 + 10)) * 2 - 1) * jitter;
  // 0.55 to 1.30, and the TOP of that range is the number that was retuned.
  // It started at 1.48 and it COMPOUNDS with the distance upscale, so a card
  // authored at 0.58 m could reach 1.48 x 1.45 = 2.1x, i.e. 1.2 m, which put
  // the understorey at the same height as the biome tufts it is supposed to sit
  // under and made a meadow read as a cornfield. The two multipliers were fine
  // apart and wrong together, which is the sort of thing only a picture shows.
  const h = tall
    ? w * (0.55 + frac(hash32(seed, k * 8 + 11)) * 0.75)
    : w;
  return out.set(w, h, w);
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
