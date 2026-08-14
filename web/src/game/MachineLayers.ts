// ONE BatchedMesh PER AUTHORED FAMILY, and the slot bookkeeping that keeps them
// in step. RN-1478, the second half of RN-1203.
//
// WHY A LAYER AND NOT A SAMPLER. `MachineBatch` drew everything with one
// material pinned to `panel`, so the smelter's `Rock` hearth, every belt's
// `Rubber` deck, the foundation's `RockDark` body, the pad's blast slab and the
// station's `Plate` all wore plate seams and rivet rows. `RuinSites` and
// `PlayerRig` fix the same defect by calling `attachSurface(mat,
// familyForMaterial(mat), ...)` once per authored material, which a merged
// batch cannot do because a `BatchedMesh` carries ONE material (three r185
// accepts `Material|Array<Material>` but has no per-geometry material index and
// its internal geometry has no groups).
//
// The other way out is to bind every family's maps onto the one material and
// select per fragment off a baked family index, which is what `rendering.md`
// section 7 proposed. THE SAMPLER BUDGET REFUSES IT, and this is the arithmetic:
// the machine program already binds `map`, `normalMap`, `roughnessMap`,
// `metalnessMap` and `aoMap` (five units even though the last three are one ORM
// image, because three allocates a unit per sampler UNIFORM), plus the PMREM
// `envMap`, plus one `directionalShadowMap` per cascade and `ShadowRig` runs
// three. That is 9 of the 16 units WebGL2 guarantees per stage. An extra family
// needs its albedo, its normal and its ORM, so 3 units each, so at most TWO
// extra families fit, and `beltCargo` already authors three. A ceiling of three
// families total would also make A4's `rust` and `paintchip` (RN-1474, RN-1475)
// unwireable on any machine that also carries stone or rubber. So the cost goes
// where there is headroom: DRAW CALLS, one per family per pass, counted in the
// lane report rather than assumed to be free.
//
// SLOTS STAY ALIGNED ACROSS LAYERS, which is what lets the pool stay ONE pool.
// Every `acquire` adds an instance to EVERY layer in the same order, so slot n
// means the same machine in all of them; a layer with nothing to draw for that
// template points at its own `absent` geometry (three degenerate vertices) and
// is left invisible. That is deliberately not a "skip the layer" branch: three's
// `addInstance` hands back a monotonic id per mesh, and a layer that skipped one
// add would be off by one for the rest of the session, silently drawing the
// wrong machine's hearth.

import * as THREE from 'three';
import { attachSurface, type Family } from '../render/instancing/Surfaces.js';
import { attachShadowLod, emptyIndex, indexRow, publishLadders, type LodIndex }
  from '../render/ShadowLod.js';
import { addLadder, tierSize, type FamilyTiers } from './MachineGeometry.js';

export interface Layer {
  readonly family: Family;
  readonly material: THREE.MeshStandardMaterial;
  readonly mesh: THREE.BatchedMesh;
  /** Template key -> tier 0's geometry id. Absent when this layer draws
   *  nothing for that template, which is the question `place` asks. */
  readonly geomId: Map<string, number>;
  /** The same map reversed, for `drawnKeyAt`'s read-back. The `absent`
   *  geometry is deliberately NOT in it, so a layer that is standing in for a
   *  template it does not carry answers `undefined` rather than a wrong key. */
  readonly geomKey: Map<number, string>;
  readonly lod: LodIndex;
  /** Three degenerate vertices: what a slot points at in a layer with nothing
   *  to draw for its template. */
  readonly absent: number;
}

/**
 * A geometry with the same attribute set as `sample` and no area.
 *
 * The attribute set is COPIED rather than declared, because `BatchedMesh`
 * throws on a mismatched one and `MachineGeometry.normalize` is the only
 * authority on what that set is (position, normal, uv, color, aRole, and
 * `aPartMat` only when the per-part channel is live). Declaring it here would
 * be a second authority that breaks the day the first one gains a channel.
 */
export function absentGeometry(sample: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(sample.attributes)) {
    const a = sample.getAttribute(name) as THREE.BufferAttribute;
    g.setAttribute(name,
      new THREE.BufferAttribute(new Float32Array(3 * a.itemSize), a.itemSize));
  }
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 0, 0]), 1));
  g.computeBoundingSphere();
  return g;
}

/** Every family the gathered templates authored, dominant first.
 *
 *  ORDERED BY TIER-0 VERTEX COUNT because layer 0 is the one `MachineBatch`
 *  publishes as `.material` and reads matrices back from, and the dominant
 *  family is the one a reader means by "the machine material". Ties break
 *  alphabetically so the order is a function of the assets and not of Map
 *  insertion, i.e. not of which template happened to load first. */
export function familyOrder(per: ReadonlyMap<string, FamilyTiers>): Family[] {
  const size = new Map<Family, number>();
  for (const ft of per.values()) {
    for (const [fam, tiers] of ft.byFamily) {
      const g = tiers[0];
      const n = g === null ? 0
        : (g.getAttribute('position') as THREE.BufferAttribute).count;
      size.set(fam, (size.get(fam) ?? 0) + n);
    }
  }
  return [...size.keys()].sort((a, b) => (size.get(b) as number) - (size.get(a) as number)
    || a.localeCompare(b));
}

/**
 * Build one `BatchedMesh` per family, each with its own material and its own
 * shadow-LOD ladders.
 *
 * `make` is `MachineBatch.makeMaterial`, passed in rather than imported so the
 * published metalness/metalness literals stay in the one file
 * `tools/blender/render_machines.py` regex-reads (that parser takes the FIRST
 * `new THREE.MeshStandardMaterial({...})` in `MachineBatch.ts`, so the
 * construction must not move here).
 */
export function buildLayers(name: string, capacity: number,
                            make: (family: Family) => THREE.MeshStandardMaterial,
                            per: ReadonlyMap<string, FamilyTiers>): Layer[] {
  const out: Layer[] = [];
  for (const family of familyOrder(per)) {
    let verts = 0;
    let idx = 0;
    let sample: THREE.BufferGeometry | null = null;
    for (const ft of per.values()) {
      const tiers = ft.byFamily.get(family);
      if (tiers === undefined) continue;
      const s = tierSize(tiers);
      verts += s.verts;
      idx += s.idx;
      sample ??= tiers.find((g) => g !== null) ?? null;
    }
    if (sample === null) continue;
    const material = make(family);
    attachSurface(material, family, `machines:${name}:${family}`);
    // +3 and +3 for the absent geometry. Reserved rather than hoped for: the
    // pools are sized at construction and `addGeometry` past them throws.
    const mesh = new THREE.BatchedMesh(capacity, verts + 3, idx + 3, material);
    mesh.name = `${name}:${family}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The factory is always within a few tens of metres of the player, so a
    // whole-batch cull is only ever a false negative (NodeBatch measured it).
    mesh.frustumCulled = false;
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = false;
    const absent = mesh.addGeometry(absentGeometry(sample));
    const lod = emptyIndex();
    const geomId = new Map<string, number>();
    const geomKey = new Map<number, string>();
    const rows = [];
    for (const [key, ft] of per) {
      const tiers = ft.byFamily.get(family);
      if (tiers === undefined) continue;
      const row = addLadder(mesh, `${name}:${family}:${key}`, tiers);
      rows.push(row);
      indexRow(lod, row);
      // Tier 0 can be null for a family that appears only in a coarser tier,
      // which no shipped asset does; `idAt` would then hand the cascade the
      // first rung that exists, so the eye must not be pointed at -1.
      geomId.set(key, row.ids.find((v) => v >= 0) ?? absent);
      for (const id of row.ids) if (id >= 0) geomKey.set(id, key);
    }
    attachShadowLod(mesh, lod);
    publishLadders(`${name}:${family}`, rows);
    out.push({ family, material, mesh, geomId, geomKey, lod, absent });
  }
  return out;
}
