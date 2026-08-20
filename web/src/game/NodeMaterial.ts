// ONE BATCH: the material, the three optional shader hooks it may carry, and the
// BatchedMesh they drive. Split out of NodeBatch.ts (GP-1086).
//
// Every number in the material is a decision with a measurement behind it and
// they are all in the comments below, unmoved. START_CAPACITY comes with it
// because the last line of `makeBatch` is the only line in the project that
// reads it.

import * as THREE from 'three';
import { applyPropSkyAmbient } from '../render/materials/PropSkyAmbient.js';
import { attachSurface, type Family } from '../render/instancing/Surfaces.js';
import { applyWind } from '../render/instancing/PropWind.js';
import { assertPartMatBase } from '../render/materials/PartMaterial.js';
import { applyRockMat } from '../render/materials/RockShader.js';
import { ROCK_CHANNEL, mineralFamily } from './NodeGeometry.js';
import type { Batch } from './NodeBatchTypes.js';

/**
 * DW-28. Instances per material, as a STARTING size that doubles on demand up
 * to a ceiling, never a fixed wall.
 *
 * This was a hard `128` with no growth path and a silent `-1` on exhaustion,
 * which is the exact failure DW-28 exists to prevent and which this project has
 * paid for twice: a fixed 256 in `MachineBatch` stopped the factory drawing at
 * about 150 machines while every indicator read healthy, and the same shape in
 * `PropLibrary` was measured this week to be costing 25% of the foliage. The
 * comment on `free` in `NodeBatchTypes.ts` even PREDICTED it ("the third regrow
 * would cross the capacity, `acquire` would start returning -1, and the world
 * would come back with pieces of it simply not drawn, silently and only
 * sometimes"), which makes it the most expensive kind of known bug.
 *
 * The start is deliberately still small, because the clearing genuinely holds a
 * couple of dozen nodes: growth is for the case nobody predicted, and paying
 * for 16,384 instances up front to guard against it is the opposite mistake.
 */
const START_CAPACITY = 128;

export function makeBatch(group: THREE.Group, name: string,
                          s: { verts: number; idx: number; src: THREE.Material },
                          cull: boolean): Batch {
  const metal = name.endsWith(':metal');
  const ore = name.startsWith('ore:');
  // Does this batch carry the per-mineral channel? ONE predicate, shared with
  // the bake gate in `build`, because a hook with no attribute and an
  // attribute with no hook are both silent.
  const rock = ROCK_CHANNEL && mineralFamily(name);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true,
    // RN-158: the ore SEAM bucket. The old world had iron and copper seams
    // in `coarse:metal` at metalness 1.0, i.e. a MIRROR whose only image is
    // the sky: the iron crown photographed as ice and copper read near-black
    // at any sun not overhead (RN-81). Ore in rock is MINERAL: dielectric
    // base with a modest sheen, and the sparkle comes from the ore ORM's
    // authored roughness spread (0.42..1.0 multiplier on this constant), not
    // from mirror metalness. 0.72 x 0.42 puts a facet crest at 0.30, a wet
    // glint; the dusty matrix stays near 0.72.
    //
    // THESE TWO ARE NOW A BASE, NOT A RESPONSE, whenever `rock` is true, and
    // the distinction is the whole of RockShader.ts. The injected GLSL turns
    // `roughnessFactor` (which is `roughness x ormG` at that point) into
    // `authored x ormG` by dividing this constant straight back out, so with
    // the channel ON these numbers decide nothing at all: the FAMILY MAP
    // supplies the variation and the AUTHORED ROLE supplies the level. They
    // decide the fallback, and only the fallback, when the channel is off.
    //
    // WHICH IS WHY THE MATTE BASE MOVES OFF ZERO, AND ONLY THEN.
    // `assertPartMatBase` throws unless both are > 0, because a zero
    // denominator is a total and silent loss of the channel rather than a
    // visible one, and `coarse:matte` has always been metalness 0.0. 0.02 is
    // enough for the ratio to carry and changes nothing it multiplies: every
    // role in that bucket authors metalness 0.0 (Rock, RockDark, Sand, Soil,
    // Regolith), so `partM = metalnessFactor x (0.0 / 0.02)` is 0 and the
    // EFFECTIVE metalness stays exactly 0. With the channel off it stays the
    // literal 0.0, which is what makes `?rockmat=0` bit-exact with the build
    // before this pass rather than merely similar to it.
    metalness: ore ? 0.25 : metal ? 1.0 : rock ? 0.02 : 0.0,
    roughness: ore ? 0.72 : metal ? 0.38 : 0.88,
    // The leaf roles are authored double sided (of_lib DOUBLE_SIDED). Side
    // still keys on metalness ONLY, not on the new surface split, so the
    // bucketing change cannot move a silhouette: this is a materials pass.
    side: metal ? THREE.FrontSide : THREE.DoubleSide,
  });
  material.name = `nodes:${name}`;
  attachSurface(material, name.split(':')[0] as Family, `nodes:${name}`);
  // WIND (RN-98): the harvest trees' crowns sway; trunks stay near-rigid by
  // never being hooked (Bark is `coarse`, so it is not in this batch). The
  // hook keys on the FOLIAGE families (RN-181 moved the leaf roles out of
  // `flat` into `leaf`; `grass` never reaches a node but is listed so the
  // rule reads as what it means). `flat` is deliberately NOT hooked any
  // more: after the move it can only hold non-plants (Water, Oil), and a
  // swaying pool surface was exactly the latent wrong-sway the old prefix
  // permitted. Boulder roles are coarse or (since RN-158) `ore`.
  if (name.startsWith('leaf:') || name.startsWith('grass:')) {
    applyWind(material, `nodes:${name}`);
  }
  // THE PER-MINERAL CHANNEL, on the mineral families only. `mineralFamily`
  // carries the reason the other three are excluded; the short form is that
  // `leaf:` and `grass:` are already hooked one branch up and a material
  // holds ONE `onBeforeCompile`, so hooking them here would not add a channel,
  // it would delete the wind. The assert runs before the install so a bad
  // base is a throw at boot rather than a channel that is quietly inert.
  if (rock) {
    assertPartMatBase(material);
    applyRockMat(material, `nodes:${name}`);
  }
  // RN-2201. Same rule as the props: the two hooks above chain the sky-ambient
  // splice themselves, and this installs the standalone hook on the batches
  // that have neither (a `coarse:` bark batch, or anything at all under
  // `?wind=0 ?rockmat=0`). A tree trunk lit by a floor while its own leaves are
  // lit by the sky is the shape this closes.
  applyPropSkyAmbient(material, `nodes:${name}`);
  const mesh = new THREE.BatchedMesh(START_CAPACITY, s.verts, s.idx, material);
  mesh.name = `nodes:${name}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // A whole-batch cull would only ever be a false negative: a node batch
  // always has something in it near the player.
  mesh.frustumCulled = false;
  mesh.sortObjects = false;
  // PER-INSTANCE CULLING, and the line it replaces was RIGHT WHEN WRITTEN.
  // It said per-instance culling "cost more than they save at this object
  // count", and the object count was the 60 m clearing's two dozen nodes.
  // WG-116 put a 620 m ring of trees in these same batches, so the count is
  // now over a thousand and most of them are behind the player or outside a
  // given shadow cascade. `?nodecull=0` is the one-binary control.
  mesh.perObjectFrustumCulled = cull;
  group.add(mesh);
  return { mesh, live: 0, free: [], cap: START_CAPACITY };
}
