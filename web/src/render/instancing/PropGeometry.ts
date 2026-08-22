// Turning ONE authored prop primitive into a geometry a BatchedMesh can hold,
// and baking the base-contact gradient into it while we are there.
//
// Split out of PropLibrary.ts at the 400-line cap, and the boundary is a real
// one rather than a line count: everything here is a pure function of one
// BufferGeometry and answers 'what does this primitive look like'; PropLibrary
// owns pools, slots, growth and the batch keys, and answers 'where does an
// instance of it live'. Keeping them apart means a look change cannot move a
// capacity measurement.

import * as THREE from 'three';
import { bendNormals, foliageBend } from './FoliageNormal.js';
import { accumulateCrownBake, crownBend, crownNormals } from './CrownNormal.js';
import { copyUv } from './Surfaces.js';

/** Just enough of `PropLibrary.Batch` for the base-shade toggle below. */
export interface ShadedBatch {
  mesh: THREE.BatchedMesh;
  shaded: boolean;
  savedColour: Uint8Array | null;
  /** Whether this batch took the foliage bake, i.e. carries the tip tint. */
  foliage: boolean;
  /** Lazy copy of the tinted bytes, for `setLeafVar` to restore. */
  savedTint: Uint8Array | null;
}

/**
 * Turn the baked base-contact gradient off and on INSIDE ONE SETTLED FRAME.
 *
 * A runtime toggle rather than a query flag, for the reason `PropLibrary.
 * setVisible` gives: a page reload cannot guarantee the same camera, the same
 * streamed chunk set or the same sun, and this lane's whole output is a matched
 * pair. It is also the ONLY isolation available to it this round, because every
 * construction argument `PropLibrary` takes is passed from `Boot.ts`, which
 * another lane owns.
 *
 * `BatchedMesh` concatenates every added geometry's attributes into ONE buffer,
 * so the whole array is written at once and there is no offset arithmetic to get
 * wrong. The baked bytes are copied out LAZILY on the first call, so a run that
 * never measures this pays nothing for it.
 *
 * Returns how many batches were touched, because a toggle that silently matched
 * nothing is exactly the shape of a measurement over an effect that never ran.
 */
export function setBaseShade(batches: Iterable<ShadedBatch>, on: boolean): number {
  let touched = 0;
  for (const b of batches) {
    if (!b.shaded) continue;
    const attr = b.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Uint8Array;
    if (b.savedColour === null) b.savedColour = arr.slice();
    if (on) arr.set(b.savedColour); else arr.fill(255);
    attr.needsUpdate = true;
    touched++;
  }
  return touched;
}

/**
 * BASE-CONTACT DARKENING, baked into the per-vertex colour of every foliage
 * geometry. The cheapest of the three shadow-contact options RN-30 weighed, and
 * the only one that costs literally nothing to run.
 *
 * WHY IT EXISTS. RN-15 took the understorey out of the shadow pass, which is
 * where 12.3 ms of an 18.0 ms frame was going, and the picture paid for it: in
 * the before, every tuft casts a distinct shadow and the ground reads as having
 * depth; in the after the ground is flatter and more evenly lit. That is the
 * single biggest remaining gap against the reference.
 *
 * WHAT IT IS. A plant is darker where it meets the ground, because the ground
 * and its own neighbours occlude the sky there. That is an ambient-occlusion
 * fact about the ASSET, not about the frame, so it belongs in the asset's
 * vertices rather than in a pass. Cost is exactly zero: no draw call, no
 * triangle, no shader, no uniform, and not one extra byte, because
 * `normalize` was already writing a constant-255 colour attribute on every prop
 * geometry (see below for why that attribute has to exist at all).
 *
 * WHAT IT IS NOT. It darkens the CARD, not the ground under the card, so it
 * grounds a silhouette and it cannot produce a cast shadow. That is the
 * screen-space contact pass's job (`post/ContactGlsl.ts`), and the two are
 * complementary rather than alternatives: this one survives `?contact=0` and
 * costs nothing, that one darkens ground the sun cannot reach.
 *
 * 0.42 over the bottom 38% of the geometry's own height, smoothstepped. Not a
 * hard band, because a hard band on a 3-triangle blade lands on exactly one
 * vertex and reads as a paint stripe. The fraction is of the GEOMETRY's height
 * rather than a fixed metre figure so that one constant is right for a 0.38 m
 * card and a 4 m tree at once.
 */
const BASE_SHADE = 0.42;
const BASE_FRAC = 0.38;

/**
 * Which base-contact profile a geometry gets. RN-62 extended this from a
 * boolean, because the gradient was foliage-only and the reason was never that
 * rocks do not need it.
 *
 * A BOULDER OCCLUDES THE SKY AT ITS OWN BASE EXACTLY AS A PLANT DOES, and
 * `ScatterLook` already names the symptom: "our boulders meet the terrain along
 * a hard silhouette with bare ground on both sides of it, which is exactly the
 * pasted-on read". The 5-card contact skirt mitigates that in vegetated biomes
 * ONLY, so Polar, Ocean, Moon and Mountains, which carry no understorey tier,
 * get nothing at all today. This reaches all of them for the same zero cost.
 *
 * THE ATTRIBUTE WAS ALREADY THERE AND ALREADY UPLOADED. `normalize` has always
 * written a constant-255 colour on every prop geometry, because `setColorAt` on
 * a BatchedMesh is silently discarded without it. So the mineral gradient costs
 * no draw call, no triangle, no shader, no uniform and not one extra byte. That
 * is now the third time this lane has found a live attribute nothing was
 * reading (RN-50's per-quad UV, RN-61's node instance colour, this).
 */
export type BaseBake = 'foliage' | 'mineral';

/**
 * SHALLOWER AND WEAKER THAN THE PLANT PROFILE, and not as a matter of taste.
 *
 * A grass tuft is a translucent thicket: light is occluded by its own
 * neighbours for a long way up, which is why 0.42 over the bottom 38% is right
 * for a card. A boulder is one opaque convex mass, so the only genuinely
 * occluded region is the narrow wedge where it meets the ground, and a band
 * that deep would read as a rock dipped in paint rather than as contact.
 *
 * The fraction is of the GEOMETRY's own height, so one pair of constants is
 * right for a 0.10 m pebble card and a 3.4 m spire at once.
 */
const MINERAL_SHADE = 0.64;
const MINERAL_FRAC = 0.20;

/**
 * LEAF TIP TINT (RN-102). A real plant is not one flat green: tips are
 * sun-bleached toward yellow and the interior sits cooler. The vertex colour
 * attribute is already there and already MULTIPLIES the material colour and
 * the per-instance tint (see bakeColour's header), so a per-channel gradient
 * costs the same zero everything the base shade costs.
 *
 * THE GREEN CHANNEL IS THE INVARIANT, BY DESIGN AND NOT BY TASTE. Only r and
 * b are modulated, g carries exactly the greyscale the bake would have
 * written without the tint. That is what makes `setLeafVar(false)` possible
 * at all on a BatchedMesh, whose concatenated buffer has forgotten which
 * geometry each byte came from: the untinted bake is recovered by copying g
 * into r and b, no geometry needed.
 *
 * THE FIRST VERSION RAISED r AT THE TIPS AND THE PROBE FALSIFIED IT: a
 * normalized Uint8 colour is a MULTIPLIER and cannot exceed 1.0, so "+16% r"
 * clamps to nothing wherever the bake is already bright, which is everywhere
 * above the base band, i.e. exactly the tips. 30 tiles moved, all darker
 * (only the blue cut survived), peak 0.86. **A brighter tip is expressible
 * in this encoding only as a darker interior**, so that is what this is: the
 * interior loses red (cool, self-shadowed) and the tip loses blue (warm,
 * sun-dried), both multipliers <= 1 so nothing clamps, and the tips carry
 * the plant's full brightness while the body sits cooler behind them. The
 * predicted toggle direction is therefore net DARKER with the tint on, and
 * the probe asserts that, from this mechanism and not from a tuning.
 *
 * The named failure mode, checked for in the close-up rather than "general
 * goodness": too strong and the field reads as autumn or as dirt showing
 * through, a dying meadow rather than a lit one.
 */
const INNER_R = 0.10;
const TIP_B = 0.16;
const TIP_FRAC = 0.40;
/** ?leafvar=0 bakes the flat greyscale, the pre-RN-102 bytes exactly. */
const leafVarOn = new URLSearchParams(self.location.search).get('leafvar') !== '0';

/**
 * Toggle the tip tint INSIDE ONE SETTLED FRAME, `setBaseShade`'s shape for
 * its reason (a reload cannot hold the frame equal). Restore is from a lazy
 * saved copy; the off state is DERIVED from the green channel as above.
 * NOTE the two toggles do not compose: `setBaseShade(false)` flattens to 255
 * and its restore brings the tint back with it. Probes use one at a time.
 */
export function setLeafVar(batches: Iterable<ShadedBatch>, on: boolean): number {
  let touched = 0;
  for (const b of batches) {
    if (!b.foliage) continue;
    const attr = b.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Uint8Array;
    if (on) {
      if (b.savedTint === null) continue;   // never switched off: already on
      arr.set(b.savedTint);
    } else {
      if (b.savedTint === null) b.savedTint = arr.slice();
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = arr[i + 1];
        arr[i + 2] = arr[i + 1];
      }
    }
    attr.needsUpdate = true;
    touched++;
  }
  return touched;
}

/**
 * Fill one geometry's vertex-colour attribute: a white constant, or the
 * base-contact gradient above.
 *
 * A WHITE COLOUR ATTRIBUTE ON EVERY PROP GEOMETRY IS MANDATORY EVEN WHEN THE
 * GRADIENT IS NOT WANTED, and it is not decoration: it is what makes
 * `BatchedMesh.setColorAt` reach the pixel. Checked in three's own source rather
 * than assumed, because the obvious reading is wrong. `USE_BATCHING_COLOR`
 * declares `vColor` and writes `vColor *= getBatchingColor(...)` in
 * `color_vertex.glsl.js:24`, but `color_fragment.glsl.js` multiplies
 * `diffuseColor` by it only `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )`.
 * So per-instance colour on a BatchedMesh is silently DISCARDED unless the
 * material also sets `vertexColors`, and setting `vertexColors` without a
 * `color` attribute binds the default (0,0,0,1) and renders every prop BLACK.
 * Both halves are required and neither fails loudly on its own.
 *
 * The ORDER is the load-bearing part for the gradient: three composes
 * `vColor = 1` then `vColor.rgb *= color` (this attribute) then
 * `vColor *= getBatchingColor(...)` (the per-instance tint), so the gradient and
 * the tint MULTIPLY and neither erases the other. A gradient written here
 * therefore survives `PropLibrary.tint`.
 *
 * Uint8 normalised: 3 B a vertex against 12 B for float32. 60,000 verts a batch
 * is 180 kB either way, so the gradient is free in memory as well as in time.
 */
export function bakeColour(g: THREE.BufferGeometry, bake: BaseBake): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Uint8Array(n * 3);
  const shade = bake === 'mineral' ? MINERAL_SHADE : BASE_SHADE;
  const frac = bake === 'mineral' ? MINERAL_FRAC : BASE_FRAC;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; ++i) {
    const y = pos.getY(i);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  // Guard the degenerate case rather than dividing by it: a flat card lying in
  // the ground plane has zero height, and 0/0 would write NaN into every
  // vertex and render the whole batch black.
  const span = Math.max(1e-4, (hi - lo) * frac);
  const span0 = Math.max(1e-4, hi - lo);
  const tint = bake === 'foliage' && leafVarOn;
  for (let i = 0; i < n; ++i) {
    const y = pos.getY(i);
    const t = Math.min(1, Math.max(0, (y - lo) / span));
    const s = shade + (1 - shade) * (t * t * (3 - 2 * t));
    const g = Math.round(s * 255);
    if (tint) {
      // Tip band over the geometry's own height, the same normalisation the
      // base shade uses, so one constant serves a 0.4 m card and a 12 m crown.
      const u = Math.min(1, Math.max(0,
        ((y - lo) / span0 - (1 - TIP_FRAC)) / TIP_FRAC));
      const t2 = u * u * (3 - 2 * u);
      col[i * 3] = Math.round(s * (1 - INNER_R * (1 - t2)) * 255);
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = Math.round(s * (1 - TIP_B * t2) * 255);
    } else {
      col[i * 3] = g; col[i * 3 + 1] = g; col[i * 3 + 2] = g;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
}

/** Strip everything a BatchedMesh cannot bind consistently across geometries. */
export function normalize(
  src: THREE.BufferGeometry, worldMatrix: THREE.Matrix4, bake: BaseBake,
  crown = false,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  copyUv(src, g, pos.count, 'props');   // UNCONDITIONAL. See Surfaces.copyUv.
  const idx = src.getIndex();
  // Every geometry in a batch must agree about having an index (three throws
  // otherwise), and a prop authored as a triangle soup would break the batch.
  if (idx !== null) g.setIndex(idx.clone());
  else {
    const seq = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; ++i) seq[i] = i;
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  // AFTER the matrix, never before. The gradient is a function of the vertex's
  // height in the world the prop is placed in, and a glTF node that carries a
  // rotation or an offset in its local matrix would otherwise have its base
  // darkening painted along the wrong axis, on exactly the props whose authoring
  // happened to need a transform. Silent, and only visible as one shrub in ten
  // being shaded sideways.
  g.applyMatrix4(worldMatrix);
  // AFTER the matrix, for the same reason the gradient is: the bend is a
  // function of the vertex's height and its offset from the part's own base
  // centre in the frame the prop STANDS in, and a glTF node carrying a
  // rotation would otherwise have its outward direction computed in the
  // authoring frame and applied in the placed one.
  // RN-2590. THE CROWN IMPOSTOR TAKES ITS OWN CONSTRUCTION, and the split is
  // here rather than inside `bendNormals` so the understorey's bytes are
  // untouched BY CONSTRUCTION: `bendNormals` is shared by grass, leaf and
  // canopy, and RN-1766 bought +7.4 per cent of `forestfloor`'s whole-frame
  // `iqr` with it, so a crown fix edited into it could only ever be proved
  // harmless by re-measuring the understorey. `?crownnormal=0` routes the crown
  // back through `bendNormals` and is the exact pre-lane control.
  // See CrownNormal.ts for the two degeneracies and the derivation.
  if (bake === 'foliage') {
    const amount = foliageBend().amount;
    const useCrown = crown && crownBend().on;
    if (useCrown) crownNormals(g, amount);
    else bendNormals(g, amount);
    // The label says which construction WROTE these bytes, and `authored` is
    // its own answer rather than being folded into either: at
    // `?foliagenormal=0` both paths return before writing anything, so
    // reporting `crown` there would name a construction that did not run.
    if (crown) {
      accumulateCrownBake(g, amount <= 0 ? 'authored' : (useCrown ? 'crown' : 'bend'));
    }
  }
  bakeColour(g, bake);
  g.computeBoundingSphere();
  return g;
}

