// The foliage PALETTE correction, split out of Surfaces.ts at RN-345 for the
// 400-line cap (ARCHITECTURE 2.2 rule 1) on the PostDefaults.ts precedent: the
// argument for these four numbers is longer than the numbers, and a constant
// whose reason is not beside it becomes a constant nobody dares move.
//
// Surfaces.ts imports it and remains the one place a foliage material is
// touched. Nothing else may call `applyFoliageTone`.

import type * as THREE from 'three';
import type { Family } from './Surfaces.js';

/**
 * FOLIAGE TONE (RN-345). THE ONE PLACE THE FOLIAGE PALETTE IS CORRECTED, AND IT
 * IS HERE BECAUSE THIS IS THE ONLY FILE EVERY FOLIAGE MATERIAL PASSES THROUGH.
 *
 * THE MEASUREMENT THAT ASKED FOR IT. Reid, on the forest floor: "Still plato-y
 * smooth pastel. Not what im looking for." Measured at the Forest site, standing
 * eye, local noon, the near-ground reference box reads RGB (15.7, 50.3, 14.7).
 * Red is 0.31 of green and blue is 0.29 of green: that is not a plant, it is the
 * green PRIMARY, and the masked-ground saturation over 1.22 M pixels is 0.65.
 * Photographic foliage does not do that. Live broadleaf sits near R/G 0.75 and
 * B/G 0.50, conifer nearer 0.85 and 0.75 (grey-green), and a forest floor is
 * mostly not live leaf at all but litter, stem and dead blade, which is warmer
 * and greyer again. One hue at one saturation across the whole layer is the
 * defect, and it is a PALETTE defect, not a form defect: the flora lanes moved
 * silhouette and IoU and Reid saw no change, because he was never looking at
 * silhouette.
 *
 * WHY NOT IN `of_lib.PALETTE`, WHICH IS WHERE THE COLOUR NOMINALLY LIVES. That
 * table is baked into 51 glb by Blender, four lanes are authoring those files
 * right now, and a palette edit would rebuild every one of them and collide with
 * all four. It is also the wrong grain: PALETTE is one colour per ROLE, and what
 * is wrong here is one correction per FAMILY, applied after the mean-neutral
 * albedo scale, which is a rendering decision and belongs to rendering.
 *
 * THE SPLIT OF LABOUR, and each axis has exactly one owner so a change stays
 * attributable:
 *   - LEVEL and HUE of the family, here.
 *   - WITHIN-CARD detail (the base-to-tip value ramp, per-blade variation, and
 *     the alpha silhouette) in texgen's card authoring.
 *   - PLANT-TO-PLANT variation in `ScatterLook.tintFor`.
 * Applying a saturation cut in two of the three would be untraceable the moment
 * either moved, which is the mistake DW-35 names for the split tone.
 *
 * THE TRANSFORM IS SATURATION-AND-VALUE ABOUT THE COLOUR'S OWN LUMA, NOT THREE
 * MULTIPLIERS. A per-channel multiplier moves value and hue together and cannot
 * be reasoned about; this one names the two things the art direction names.
 * `sat` below 1 pulls toward the material's own luminance, which is grey-green
 * rather than pastel: pastel is low saturation at HIGH value, and the value
 * factor moves the other way, so the pair cannot drift into it. The warm term is
 * deliberately absent here and lives in the instance tint, because "some of this
 * plant is dead" is a per-plant fact and not a family-wide one.
 */
/**
 * RN-2495 MOVES `canopy`'s SATURATION OFF `leaf`'s DIGIT, AND IT ADDS NO AXIS.
 *
 * A CROWN IS NOT A LEAF, and that is the whole argument. `sat = 0.62` was
 * authored against ONE measurement, named in the header above: a near leaf card
 * at a standing eye on a forest floor, where a green primary reads as plastic.
 * RN-2245 then copied it to `canopy` TO THE DIGIT. But the `canopy` family is
 * worn by exactly one object, the `_LOD3` crown impostor, and that object is a
 * WHOLE TREE CROWN drawn only beyond `CANOPY_NEAR_M` -- an assembly of leaves,
 * never a leaf, and never seen closer than 550 m.
 *
 * Canopy radiative transfer says the two are not the same colour. A photon
 * leaving the top of a closed stand has interacted with foliage more than once,
 * and each interaction multiplies the leaf's spectral selectivity, so a canopy
 * is strictly MORE saturated than the leaves it is made of. The standard
 * two-stream result for a dense canopy, with `w` the leaf single-scattering
 * albedo (reflectance plus transmittance),
 *
 *     rInf(w) = (1 - sqrt(1 - w)) / (1 + sqrt(1 - w))
 *
 * on broadleaf optics (`w` about 0.27 green, 0.08 red, 0.06 blue) gives, in
 * LINEAR reflectance:
 *
 *     one leaf     R/G 0.417   B/G 0.333
 *     dense crown  R/G 0.265   B/G 0.197
 *     THIS ROW, at sat 0.62:
 *                  R/G 0.580   B/G 0.467
 *
 * **THE TWO ROWS COME FROM DIFFERENT HALVES OF THE SAME LEAF DATA AND A READER
 * RECOMPUTING ONE FROM THE OTHER'S NUMBERS GETS THE WRONG ANSWER.** The crown
 * row is `rInf` on the `w` triple above. The `one leaf` row is the leaf's own
 * REFLECTANCE triple, `r` about (0.05 red, 0.12 green, 0.04 blue), which is
 * what a camera sees off a single leaf; `w` adds transmittance to it and is
 * the right input for the canopy limit and the wrong one for a leaf's colour
 * (`rInf` on `w` alone would give 0.296 / 0.222 and a bracket that has almost
 * collapsed). Both are ordinary broadleaf values and both are stated so the
 * bracket is reproducible rather than merely cited.
 *
 * **The shipped crown card is less saturated than a single LEAF, let alone a
 * crown -- it sits outside the bracket on the unsaturated side.** `sat = 1.08`
 * is solved to put its linear R/G on the bracket's geometric midpoint, 0.3324.
 * The midpoint and not the crown end, because `rInf` is a semi-infinite limit
 * and our stands are not closed everywhere, and because the card is also seen
 * against sky at the stand edge where the single-leaf end is nearer the truth.
 *
 * THE MOVE IS EXACTLY LUMA-PRESERVING, which is the safety argument. The
 * saturation term is `l + (c - l) * sat` on all three channels with `l` the
 * Rec.709 luma, and the three weights sum to one, so the transformed luma is
 * `l` for every `sat`. Measured on the shipped build across a five-point sweep
 * of this constant: `forestair` `box` luma reads 93.38 / 93.38 / 93.39 / 93.40 /
 * 93.41 -- 0.03 counts of spread over a chroma change of 49 per cent.
 * **RN-2275's pass condition (a wood must read DARKER than its own clearing at
 * all four pose/sun pairs, rendering.md 2.19.4) is a LUMA condition and is
 * therefore protected by algebra, not by a sweep.** It is still measured, since
 * an 8-bit frame through a tonemap is not the linear space the algebra runs in,
 * but the measurement is a confirmation rather than the argument.
 *
 * NO HUE AXIS, AND THE REFUSAL IS THE SAME MODEL SPEAKING. A third term that
 * pulled BLUE down was drafted, measured (it is worth 0.6 counts of whole-frame
 * warm at `forestair`) and REJECTED: the same two-stream numbers put a crown's
 * blue at 0.74 of its red, and this row at `sat = 1.08` is already at 0.46,
 * i.e. the saturation move OVERSHOOTS blue downward rather than leaving a
 * deficit. Shipping a blue cut on top of that would be a constant the model
 * contradicts, which is exactly the "constant nobody dares move" this file's
 * header exists to prevent. **That refusal is also the lane's finding: the
 * frame's blue-grey is not the card's hue.** See the `canopy` row for where it
 * actually is.
 *
 * WHY ONLY `canopy`. `leaf` and `grass` are the near layers and World Audit R4
 * judged both a pass at `forestfloor` and `basedusk`; `leaf`'s 0.62 is the
 * number its own measurement asked for and it stays. `canopy` is the only
 * family that is never seen at a standing eye at all.
 */
interface FoliageTone { sat: number; val: number }
export const FOLIAGE_TONE: Readonly<Partial<Record<Family, FoliageTone>>> = {
  // The canopy and every leaf card. The deepest cut of the two: a leaf mass seen
  // against sky is where a pure green reads most like plastic, and RN-102's
  // leaf-tip variation is a VALUE term that a saturated hue was swamping.
  leaf: { sat: 0.62, val: 0.86 },
  // RN-2245: the far-tier crown card, and it takes `leaf`'s numbers TO THE
  // DIGIT rather than numbers of its own. This is the same argument the palette
  // hex is copied under: `CANOPY_NEAR_M` is 550 m, a harvest tree's own `_LOD3`
  // card sits just inside it wearing `leaf`, and a canopy crown sits just
  // outside it wearing this. Two tone curves across that line would put a
  // visible chroma step at a fixed radius around the player, which is the one
  // artefact a distance fade exists to prevent. Omitting the row entirely would
  // have been worse than a wrong number and silent with it: the card would
  // render at the uncorrected palette saturation while every leaf beside it is
  // pulled to 0.62/0.86.
  //
  // RN-2495. THE RN-2245 ARGUMENT ABOVE IS NOT OVERRULED, IT IS BOUNDED, and
  // the other side of the trade is now measured rather than hypothetical. At
  // `forestair`, box GREEN EXCESS (meanG - (meanR + meanB) / 2, in counts), one
  // page param apart, EVERY ROW FROM THE `?canopysat=0.62` BASELINE IN ONE
  // SESSION, fresh process each (an earlier draft of this table mixed rows
  // taken against mid-search candidate constants; see rendering.md 2.29.8):
  //
  //     baseline, ?canopysat=0.62           3.92
  //     ?propsky=0                          3.91   the sky fill costs 0.01
  //     ?prophaze=0                         4.50   the props' own haze,  0.58
  //     ?crownshadecard=0                   4.80   the CARD shade costs  0.88
  //     ?foliagetone=0  (this row off)      6.27   the desaturation,     2.35
  //     ?crownshadefar=0                    9.31   the FAR PAINT shade,  5.39
  //     ?canopy=0       (the clearing)      4.80
  //
  // The last row is the whole complaint in one number: **with every term in,
  // the wood carries LESS green excess than its own treeless clearing** -- a
  // closed stand of leaves reads less green than the duff under it. This row
  // moves that to 5.85, i.e. +1.05 over the clearing, a sign flip. **THIS ROW
  // IS THE SECOND-LARGEST TERM IN THE FRAME and is 2.7x the card shade**,
  // which is why it is worth moving at all.
  //
  // The step RN-2245 refused is a step BETWEEN TWO DIFFERENT OBJECTS -- a
  // harvest tree's `_LOD3` leaf card and a canopy crown impostor, two textures
  // and two silhouettes -- at a radius no aerial pose can contain: at 1,200 m
  // with a 14 degree pitch the NEAREST ground in frame is 1,243 m, so the ring
  // is off the bottom of every pose this lane is judged on, and every ground
  // pose measured as a control (`forestfloor`, `meadow`, `basedusk`, `vista`,
  // `mtnslope`) reads bit-identical either side of this change.
  //
  // `val` IS UNCHANGED AT 0.86 TO THE DIGIT, deliberately: value is the axis
  // RN-2275's inversion is measured on, so the one axis this lane does not
  // touch is the one that could break it.
  //
  // WHAT THIS ROW CANNOT REACH, stated here because the next mover will
  // otherwise try this constant again. `CanopySelfShadow.updateCanopyCardShade`
  // multiplies the finalised card colour -- THIS row's output -- by a single
  // ACHROMATIC scalar, measured live at `cardShade` 0.1025 at the Forest site.
  // A crown card is therefore painted at a tenth of whatever colour is authored
  // here before the air is added, so doubling its chroma at source moves the
  // committed `crowns` rectangle by 1.19 counts (0.70 -> 1.89 against a
  // clearing at 4.61) and no more. `?crownshadecard=0` is the proof and it is
  // a picture as well as a number.
  canopy: { sat: 1.08, val: 0.86 },
  // Ground cover. Less cut, because a meadow legitimately keeps more chroma than
  // a canopy and because `tintFor`'s dry drift is already acting on this layer.
  grass: { sat: 0.70, val: 0.94 },
};


const state = {
  /**
   * Amplitude of the tone above, 0 = the pre-RN-345 palette exactly.
   *
   * RN-150's rule, and the reason it is spelled out rather than written
   * `Number(p.get('foliagetone')) || 1`: `Number(null)` is 0, so that spelling
   * ships the feature OFF for every player while every probe that passes an
   * explicit `?foliagetone=1` measures it working. A MISSING parameter is
   * MISSING, not zero, and the boot default is asserted as a fixture in its own
   * named check rather than inferred from a run that overrode it.
   */
  amp: ((): number => {
    const v = new URLSearchParams(self.location.search).get('foliagetone');
    const f = v === null ? NaN : Number(v);
    return Number.isFinite(f) ? Math.max(0, Math.min(2, f)) : 1;
  })(),
};

/**
 * RN-2495. THE CANOPY SATURATION GETS ITS OWN OVERRIDE, so the lane's negative
 * control is `?canopysat=0.62` -- the pre-lane build EXACTLY, on the same build
 * and the same program, with one CPU-side constant between the arms. It is a
 * SWEEP and not a switch, because the constant is a solved position on a
 * bracket and the next reader should be able to walk it.
 *
 * A `canopychloro` axis existed in this lane's own history and is not here; see
 * the `canopy` row above for the model that refused it.
 *
 * RN-150-safe in the same spelling `amp` uses: a MISSING parameter is missing,
 * never `Number(null) === 0`.
 */
const CANOPY_SAT = ((): number | null => {
  const v = new URLSearchParams(self.location.search).get('canopysat');
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? Math.max(0, Math.min(2, f)) : null;
})();

/**
 * The row actually applied, after the override. One function so the probe
 * surface and the transform cannot disagree about what shipped, which is the
 * failure `foliageToneState` exists to prevent in the first place.
 */
function rowFor(family: Family): FoliageTone | undefined {
  const t = FOLIAGE_TONE[family];
  if (t === undefined) return undefined;
  if (family !== 'canopy' || CANOPY_SAT === null) return t;
  return { sat: CANOPY_SAT, val: t.val };
}

export function foliageToneState(): {
  amp: number; families: Record<string, FoliageTone>; canopySatFlag: boolean;
} {
  const families: Record<string, FoliageTone> = {};
  for (const k of Object.keys(FOLIAGE_TONE)) {
    families[k] = { ...(rowFor(k as Family) as FoliageTone) };
  }
  return { amp: state.amp, families, canopySatFlag: CANOPY_SAT !== null };
}

/**
 * Set the amplitude and report it. The RUNTIME half of standing rule 7, and it
 * exists for the same reason `setMaps` does: a before/after that differences two
 * page loads cannot hold the camera, the streamed chunk set, the sun angle and
 * the scatter equal, and this term's whole effect is a few counts of chroma.
 * The caller re-applies every registered material, so one call gives a matched
 * pair inside one settled frame.
 */
export function setFoliageTone(amp: number): number {
  state.amp = Math.max(0, Math.min(2, amp));
  return state.amp;
}

/** In place, idempotent because the caller has just rewritten `color` from
 *  `baseColor`. Returns false when the family has no tone, so the report can
 *  state which materials were touched rather than implying all of them. */
export function applyFoliageTone(c: THREE.Color, family: Family): boolean {
  const t = rowFor(family);
  if (t === undefined) return false;
  const a = state.amp;
  const sat = 1 + (t.sat - 1) * a;
  const val = 1 + (t.val - 1) * a;
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  c.setRGB((l + (c.r - l) * sat) * val,
    (l + (c.g - l) * sat) * val,
    (l + (c.b - l) * sat) * val);
  return true;
}

