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
//
// RN-71: THIS FILE LIVES UNDER render/ AND NOT UNDER world/, AND THAT IS THE
// SPLIT ABOVE MADE STRUCTURAL. It sat in `web/src/world/` from the day it was
// split out, for no better reason than that `Scatter.ts` was already there, and
// it was the one rendering-owned file in a world-gen directory for four passes
// while both domains edited around it. Ownership that is stated in a decision
// log and contradicted by the tree is ownership that gets forgotten.
//
// It still imports `hash32`/`frac` from `world/ScatterTuning`, and that
// direction is correct: the hash stream is placement's, and a look must be able
// to read the same stream a placement used or the two would disagree about
// which cell they are describing. What must NOT appear here is a second copy of
// that stream. World-gen owns where things go; this file owns how they look.

import * as THREE from 'three';
import { hash32, frac } from '../world/ScatterTuning.js';

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
 *
 * RN-2245 adds `OF_Canopy`, and it is the one edit in this lane that a reader
 * would not predict from "the far card gets its own texture". The prefix test
 * above is the ONLY authority on plant-ness, and four separate behaviours hang
 * off it: `PropLibrary.register` picks the foliage base-contact bake instead of
 * the mineral one, `PropGeometry` bends the normals outward, `PropLibrary`
 * attaches wind and the foliage sky-ambient term, and `setLeafVar` skips a
 * batch that is not marked foliage. Move the far card onto a role that does not
 * start with `OF_Leaf` and all four silently stop, with no error anywhere and
 * nothing in a counter to show it. That is the shape of defect this lane is
 * fixing, so it is not one to introduce.
 *
 * `lookOf` below is unaffected either way: a canopy STEM's part list still
 * contains its `OF_Leaf*` LOD0/LOD2 crowns, so the instance tint's dry drift
 * (`tintFor`) reaches every canopy tree exactly as it did before.
 */
export function isFoliageMaterial(name: string): boolean {
  return name.startsWith('OF_Grass') || name.startsWith('OF_Leaf')
    || name.startsWith('OF_Canopy');
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
 * RN-346. PLANT-TO-PLANT VARIATION, THE THIRD OF THE THREE FOLIAGE AXES, AND THE
 * ONLY ONE THAT CAN MAKE A FIELD READ AS A POPULATION RATHER THAN AS A PAINT.
 *
 * The other two live elsewhere on purpose (see FoliageTone.ts's header): the
 * family LEVEL and HUE are one correction in `Surfaces.ts`, the WITHIN-CARD
 * detail is in texgen. This file owns the spread ACROSS instances, and the
 * numbers below widen it, because measured at the Forest site the whole
 * understorey layer was arriving inside a band far narrower than a real one.
 *
 * THREE CHANGES AND EACH ANSWERS A DIFFERENT COMPLAINT.
 *
 * 1. VALUE, 0.80..1.18 to 0.66..1.26. A +/-19 per cent band around the mean is
 *    below what the eye reads as different plants; it reads as noise on one
 *    plant. ART-DIRECTION.md asks for value to do the work, and the cheapest
 *    value in the frame is the one already being drawn per instance for free.
 *
 * 2. THE DRY DRIFT STOPS BEING SQUARED. `t = d * d * 0.75` put the MEDIAN
 *    instance at t = 0.19, i.e. 81 per cent of the way back to the one green,
 *    and only about a quarter of the field anywhere near dry. That is a
 *    distribution shaped like "green with a rare exception", and a real
 *    understorey in late season is not: it is a continuum from green through
 *    olive to straw with no mode. Linear at 0.85 puts the median at 0.43 and
 *    spreads the field evenly along it.
 *
 * 3. A SECOND, INDEPENDENT HUE AXIS: CHROMA. Dry is a WARM drift (red up, blue
 *    down), so a field varied only along it is a line through colour space and
 *    everything on that line is still a saturated hue, just a different one.
 *    Real foliage also varies in how GREY it is: waxy, dusty, shaded and
 *    senescing leaves all lose chroma without going yellow. `mute` pulls an
 *    instance toward its own luminance, so the field becomes an AREA rather
 *    than a line, and the two axes are drawn independently so a plant can be
 *    dry and vivid, or green and grey.
 *
 * THE EXTRA DRAW COMES FROM A RE-SEEDED STREAM, NOT A NEW INDEX, AND THAT IS
 * DELIBERATE. The key here is `k * 8 + n`, so a fifth index would be `+12` and
 * would alias exactly onto instance `k + 1`'s `+4`. Re-hashing with a different
 * SEED gives an independent stream inside the same key space and cannot collide
 * with any caller's index, present or future. Determinism is untouched: it is
 * still a pure function of (seed, k).
 */
const DRY_T_GAIN = 0.85;
const MUTE_MAX = 0.45;
const V_LO = 0.66;
const V_SPAN = 0.60;
/** Any odd 32-bit constant would do; this is the golden-ratio one, used here
 *  only to decorrelate the stream from the placement's. */
const CHROMA_SEED_MIX = 0x9e3779b9;
/**
 * Flower and grass tints MULTIPLY the material's albedo, which for `OF_Grass`
 * is 6F8F42 (0.44, 0.56, 0.26). The flower multiplier is above 1 in red and
 * green and well below 1 in blue, which lands near (0.75, 0.84, 0.10): a warm
 * yellow that is still recognisably the same plant. Above about 2.0 in any
 * channel the card clips through the tone curve and reads as a light source, so
 * these are ceilings and not preferences.
 */
const FLOWER = new THREE.Vector3(1.70, 1.50, 0.38);
/**
 * Dry, sun-bleached end of the grass spread. Warm, and slightly desaturated.
 *
 * RN-346 pushed it further from the green: 1.22/1.06/0.62 to 1.34/1.10/0.58.
 * Straw is not a slightly warmer leaf. Against `OF_Grass`'s (0.44, 0.56, 0.26)
 * the old triple lands at (0.54, 0.59, 0.16), which still has GREEN as its
 * largest channel and therefore still reads as a plant that is alive; the new
 * one lands at (0.59, 0.62, 0.15) and, with the linear drift now putting real
 * instances at t near 0.85, that is where the field finally acquires a warm end
 * at all rather than a warmer green.
 */
const DRY = new THREE.Vector3(1.34, 1.10, 0.58);

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
  const v = V_LO + frac(hash32(seed, k * 8 + 6)) * V_SPAN;
  if (look === 'mineral') return out.setRGB(v, v, v);
  // Flowers keep their chroma. A wildflower IS a saturated hue, and muting the
  // 5.5 per cent of instances whose whole job is punctuation would remove the
  // punctuation while leaving the cost.
  if (frac(hash32(seed, k * 8 + 7)) < FLOWER_P) {
    return out.setRGB(FLOWER.x * v, FLOWER.y * v, FLOWER.z * v);
  }
  const d = frac(hash32(seed, k * 8 + 9));
  // Toward DRY, but never all the way: a field where some blades are fully dry
  // and the rest are fully green reads as two species mixed, which is a
  // different and worse look than one species with variation in it.
  const t = d * DRY_T_GAIN;
  const r = v * (1 + (DRY.x - 1) * t);
  const g = v * (1 + (DRY.y - 1) * t);
  const b = v * (1 + (DRY.z - 1) * t);
  // The chroma axis. Squared, so most instances keep most of their chroma and
  // the grey ones are a tail rather than half the field: this term exists to
  // widen the distribution, and a term that moved every instance by the same
  // amount would be a global desaturation wearing a variation's clothes, which
  // is exactly the mistake TerrainShader's macro-tint note records and the
  // probe caught as a level change where a spread change was claimed.
  const mute = 1 - frac(hash32(seed ^ CHROMA_SEED_MIX, k * 8 + 6)) ** 2 * MUTE_MAX;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return out.setRGB(l + (r - l) * mute, l + (g - l) * mute, l + (b - l) * mute);
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
 * WIRED AS `?grassshort=0` at RN-45, which closes the RN-30 coordination item.
 * It was defaulted for one round for an ownership reason rather than a design
 * one: every argument the scatter is constructed with is passed by `Boot.ts`
 * and another lane owned Boot that round, so the honest isolation for the
 * height change was a BINARY PAIR (`docs/screenshots/RN30_world_{before,after}
 * .png`). Boot came free and it cost the one line it was predicted to cost, so
 * the last unisolated claim in the ground-art programme is now a one-binary
 * control like everything else (standing rule 7).
 */
export const TALL_H_LO = 0.55;
export const TALL_H_HI = 1.30;

/**
 * The height band a MINERAL instance is scaled into, independently of its width.
 *
 * RN-63. Mineral props used to collapse to a uniform scale, so every rock in the
 * world was the same shape at a different size, and the survey found why that
 * reads so strongly: there is exactly ONE mesh per rock stem, and the eye is
 * looking at a few hundred copies of the same 102 triangles rotated about Y at
 * 2,000 to 10,000 instances per km2. Rotation does not change a silhouette
 * viewed from a level camera; a height ratio does.
 *
 * NARROWER THAN THE PLANT BAND (0.55 to 1.30) BECAUSE ROCK RESISTS IT. A tuft
 * stretched to 1.3 still reads as a tuft, since a plant's proportions are
 * genuinely variable. A boulder is a piece of a larger mass and its proportions
 * carry information about what it broke off: past about 1.25 an upright lobe
 * stops reading as stone and starts reading as a stretched copy of the rock next
 * to it, which is a worse artefact than the sameness it was meant to fix.
 *
 * Y IS THE PROP'S OWN UP because the instance is already yawed about the surface
 * normal, so this squashes and stands a rock along its own axis rather than
 * shearing it against the ground. Non-uniform instance scale is already proven
 * on this path: the foliage branch above has used it since the understorey
 * shipped, so the normals are known to survive it.
 */
export const MINERAL_H_LO = 0.74;
export const MINERAL_H_HI = 1.24;

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
    : w * (MINERAL_H_LO + frac(hash32(seed, k * 8 + 11))
        * (MINERAL_H_HI - MINERAL_H_LO));
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
/**
 * SPECIES CLUSTERING (RN-49), the fraction of understorey instances in a patch
 * that are forced to the patch's DOMINANT species.
 *
 * Plants do not salt-and-pepper. They grow in stands, because a plant seeds
 * where its parent stood and because soil, drainage and shade vary over metres
 * rather than over centimetres. The reference reads as a place largely for this
 * reason: it has patches of one thing next to patches of another, and our
 * understorey had every species drawn independently per instance, which
 * produces a perfectly uniform mix at every scale. Adding species without
 * clustering would have made that worse, not better, because more species mixed
 * uniformly is more uniform, not less.
 *
 * The dominant is itself drawn from the SAME weighted table, so a common
 * species dominates many patches and a rare one dominates few. That is what
 * keeps the flowering sprig an occasional stand rather than one patch in seven.
 *
 * 0.55 rather than 1.0 deliberately: a patch that is 100% one species reads as
 * a planted crop, which is the exact failure RN-30 spent a pass removing from
 * the grass height. Just over half is enough for the eye to read a stand while
 * every patch keeps a minority of everything else.
 */
export const CLUSTER_BIAS = 0.55;
/**
 * Patch size, in CELLS, as a power-of-two shift. The scale that matters is the
 * one in METRES: about 14 m across, roughly what the eye reads as "a stand of
 * something" at walking distance, and comfortably inside the 30 m full-density
 * band so a patch is never split by the density falloff.
 *
 * WG-186: THIS CONSTANT IS IN CELLS AND THE CELL JUST HALVED, so it moved on its
 * own and had to be moved back. At DW-19's 1.808 m cell, shift 3 (8x8 cells) was
 * 14.46 m. At maxDepth 15's measured 0.899 m cell it would be 7.19 m, i.e. the
 * authored stand scale silently halving as a side effect of a tessellation
 * change. Shift 4 (16x16 cells) is 14.38 m at the new cell, within 0.6% of the
 * scale that was authored. This is the ONE knob a near-LOD change could not
 * leave alone while still honestly claiming to change tessellation density only.
 *
 * The general trap, worth more than the constant: any tuning value expressed in
 * CELLS rather than in metres is silently a function of `maxDepth`. This was the
 * only one found (`MAX_CELL_M`, `LOD2_M`, `RADIUS_M` and the density figures are
 * all in metres or per-m2 and are unaffected; per-cell COUNTS are area-scaled by
 * `Scatter`'s fair quantiser and measured to hold `deliveredFraction` at 1.0002).
 *
 * KNOWN AND ACCEPTED: the patch lattice is CHUNK-LOCAL, so it restarts at every
 * chunk boundary. That is not a seam, because the pattern is random per patch
 * and a restart is simply another patch edge. It is recorded because the honest
 * fix (a patch key derived from planet-centred position) needs the same
 * high-precision phase the terrain detail bump needs and is blocked on the same
 * world-gen chunk-format work.
 */
export const CLUSTER_SHIFT = 4;
export const CONTACT_CARDS = 5;
/** Fraction of a cell the skirt is spread over, in the cell's own uv. */
export const CONTACT_SPREAD = 0.30;
