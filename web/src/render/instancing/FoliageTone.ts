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
  canopy: { sat: 0.62, val: 0.86 },
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

export function foliageToneState(): { amp: number; families: Record<string, FoliageTone> } {
  const families: Record<string, FoliageTone> = {};
  for (const [k, v] of Object.entries(FOLIAGE_TONE)) families[k] = { ...v };
  return { amp: state.amp, families };
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
  const t = FOLIAGE_TONE[family];
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

