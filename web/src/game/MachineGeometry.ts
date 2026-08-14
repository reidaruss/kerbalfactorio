// TURNING AN AUTHORED .glb INTO ONE BATCHABLE GEOMETRY.
//
// Split out of MachineBatch when FS-40's probe read-back pushed that file past
// the 400-line cap, and split along a seam that was already there: MachineBatch
// owns the INSTANCE POOL and the material, and this owns the pure function that
// bakes a template's meshes into the single attribute layout that pool draws.
// Nothing here touches three's batching state, and nothing in MachineBatch
// reads a source scene.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { copyUv, familyForRole, isTilingFamily, roleOfMaterialName, type Family }
  from '../render/instancing/Surfaces.js';
import { bakeMachineMat } from '../render/materials/MachineMat.js';
import { type LodRow } from '../render/ShadowLod.js';
import { surfaceDeviation, triCount } from '../render/ShadowLodMeasure.js';

/**
 * aRole: what a vertex is, so one material can serve the authored roles.
 *
 * The two ARC roles are the belt CURVES (W7). A curve's deck is a quarter
 * annulus, so scrolling the band along local Z (which is what a straight tile
 * does) would run the cargo diagonally across the corner. The role carries which
 * corner it is, the only thing the shader needs to find the arc centre, and it
 * costs no extra attribute.
 */
export const ROLE_BODY = 0, ROLE_STATUS = 1, ROLE_FLOW = 2;
export const ROLE_ARC_L = 3, ROLE_ARC_R = 4;

export interface MachineTemplate {
  url: string;
  root: string;
  flowMaterial?: string;
  /** Set on the curve tiles: which way the quarter turn goes. */
  arc?: 'l' | 'r';
  /** Which meshes of the source scene belong to this template; defaults to the
   *  `_LOD0` suffix every machine file uses. `items_atlas.glb` (FS-28) names its
   *  meshes `Item_Log` with no LOD chain, so belt cargo passes a pattern. */
  nodeMatch?: RegExp;
}

/** The default: a machine file's own drawing LOD. */
export const LOD0 = /_LOD0(?:_\d+)?$/;

/**
 * The whole ladder. EVERY machine .glb in this project ships `_LOD1` and
 * `_LOD2` and this file read neither: `smelter.glb` carries 592 / 192 / 48
 * triangles and drew 592 four times over (once for the eye, once per shadow
 * cascade), and `launch_pad.glb` carried 608 + 96 triangles of tiers that
 * nothing had ever loaded. `NodeBatch` had the identical defect and the tree
 * lane took the distance half of it; this is the SHADOW half, which is a
 * separate saving on a separate pass (see `render/ShadowLod.ts`).
 */
export const LOD_MATCH = [LOD0, /_LOD1(?:_\d+)?$/, /_LOD2(?:_\d+)?$/] as const;

/**
 * A template's geometry per tier, SPLIT BY AUTHORED FAMILY, world-baked and
 * merged, `null` for a tier a family does not appear in (which includes every
 * tier the asset does not ship).
 *
 * RN-1478 IS THE SPLIT AND THE SPLIT IS THE WHOLE FIX. `MachineBatch` used to
 * take one merged geometry per tier and draw it with one material pinned to
 * `panel`, so a smelter's `Rock` hearth and a belt's `Rubber` deck wore plate
 * seams and rivet rows. A `BatchedMesh` carries ONE material (three r185:
 * `Material|Array<Material>` with no per-geometry index, and the internal
 * geometry has no groups), so the family cannot be resolved per instance and it
 * cannot be resolved per fragment without spending sampler units the machine
 * program does not have. It CAN be resolved per authored MATERIAL, which is
 * what this does: bucket the primitives by `familyForRole` of their own
 * material name, dedupe, and hand `MachineBatch` one geometry per family so it
 * can hand each one the surface the asset actually asked for.
 *
 * A CARD FAMILY IS FOLDED BACK INTO `base`, and `Surfaces.isTilingFamily`
 * carries the argument: these UVs are metres and a card is unit space. So is
 * `flat`, which is not a map at all and whose parts are already handled by
 * `MachineMat`'s bare flag (RN-1203).
 *
 * A template with an explicit `nodeMatch` has NO ladder by construction and gets
 * tier 0 only. That is not a limitation to fix later: `nodeMatch` exists exactly
 * for the meshes with no LOD chain in their names (`items_atlas.glb`'s
 * `Item_Log`, the pad's `LaunchClamp_Arm`), so inventing tiers 1 and 2 for them
 * would either match nothing or, worse, match a sibling's mesh.
 */
export interface FamilyTiers {
  /** Family -> its three tiers. Only families the asset actually authors. */
  byFamily: Map<Family, (THREE.BufferGeometry | null)[]>;
  /** Tier 0 with every family merged back together, for the ghost preview,
   *  which is one translucent copy of the whole machine and not a material
   *  study. Built here rather than by the caller so the ghost cannot drift
   *  from what the batch drew. */
  lod0: THREE.BufferGeometry | null;
}

/** Merge a bucket, keeping the single-element case allocation free exactly as
 *  the pre-split code did. */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = list.length === 1 ? list[0] : (mergeGeometries(list, false) ?? list[0]);
  g.computeBoundingSphere();
  return g;
}

export function gatherTiers(def: MachineTemplate, scene: THREE.Object3D,
                            base: Family): FamilyTiers {
  scene.updateWorldMatrix(true, true);
  const byFamily = new Map<Family, (THREE.BufferGeometry | null)[]>();
  let lod0: THREE.BufferGeometry | null = null;
  const tiers = def.nodeMatch !== undefined ? 1 : LOD_MATCH.length;
  for (let t = 0; t < tiers; ++t) {
    const re = def.nodeMatch ?? LOD_MATCH[t];
    const per = new Map<Family, THREE.BufferGeometry[]>();
    const all: THREE.BufferGeometry[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || m.name.startsWith('col_')) return;
      if (!re.test(m.name)) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const g = normalize(m.geometry, m.matrixWorld,
        src.color ?? new THREE.Color(1, 1, 1), roleOf(src.name, def), src);
      const role = roleOfMaterialName(src.name);
      const authored = familyForRole(role);
      const fam = isTilingFamily(authored) ? authored : base;
      const bucket = per.get(fam);
      if (bucket === undefined) per.set(fam, [g]);
      else bucket.push(g);
      all.push(g);
    });
    if (all.length === 0) continue;
    for (const [fam, list] of per) {
      let arr = byFamily.get(fam);
      if (arr === undefined) { arr = [null, null, null]; byFamily.set(fam, arr); }
      arr[t] = mergeAll(list);
    }
    if (t === 0) lod0 = mergeAll(all);
  }
  return { byFamily, lod0 };
}

/** Vertices and indices a ladder needs, which a `BatchedMesh` must know before
 *  it exists. Summed over every tier that will be resident, not just tier 0. */
export function tierSize(tiers: readonly (THREE.BufferGeometry | null)[]):
{ verts: number; idx: number } {
  let verts = 0, idx = 0;
  for (const g of tiers) {
    if (g === null) continue;
    verts += (g.getAttribute('position') as THREE.BufferAttribute).count;
    idx += g.getIndex()?.count ?? 0;
  }
  return { verts, idx };
}

/** Add every tier to `mesh` and MEASURE what each one costs in silhouette
 *  error. The measurement, not a picked constant, is what admits a tier to a
 *  cascade; `render/ShadowLod.ts` carries the derivation. */
export function addLadder(mesh: THREE.BatchedMesh, label: string,
                          tiers: readonly (THREE.BufferGeometry | null)[]): LodRow {
  const ids: number[] = [];
  const dev: number[] = [];
  const tris: number[] = [];
  const base = tiers[0];
  for (let t = 0; t < tiers.length; ++t) {
    const g = tiers[t];
    ids.push(g === null ? -1 : mesh.addGeometry(g));
    tris.push(g === null ? 0 : triCount(g));
    dev.push(g === null || base === null || base === undefined ? Infinity
      : t === 0 ? 0 : surfaceDeviation(base, g));
  }
  return { label, ids, dev, tris };
}

export function roleOf(matName: string, def: MachineTemplate): number {
  if (matName.endsWith('EmissiveState')) return ROLE_STATUS;
  if (def.flowMaterial !== undefined && matName.endsWith(def.flowMaterial)) {
    return def.arc === 'l' ? ROLE_ARC_L : def.arc === 'r' ? ROLE_ARC_R : ROLE_FLOW;
  }
  return ROLE_BODY;
}

/**
 * Bake colour and role per vertex so one material can draw every role.
 *
 * `mat` is the SOURCE material again, and passing it is what turns the per-part
 * roughness and metalness channel on for this primitive (RN-1200). It is a
 * separate argument rather than something derived from `tint` for `NodeBatch`'s
 * reason: `MachineMat` owns whether a consuming hook will be compiled, and a
 * bake with no consumer is a dead per-vertex buffer that no program binds.
 *
 * ALL OR NONE ACROSS THE WHOLE PATH, which this gets structurally: the gate is
 * one module-level constant, so every primitive `mergeGeometries` and
 * `addGeometry` see carries the same attribute set. That matters because
 * `mergeGeometries` returns null on a mismatch and `gatherTiers` swallows it
 * with `?? list[0]`, so a partial bake would not be a wrong material, it would
 * be most of a machine silently gone.
 */
export function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4,
                          tint: THREE.Color, role: number,
                          mat?: THREE.MeshStandardMaterial): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  copyUv(src, g, pos.count, 'machines');   // UNCONDITIONAL. See Surfaces.copyUv.
  const col = new Float32Array(pos.count * 3);
  const rol = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; ++i) {
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
    rol[i] = role;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRole', new THREE.BufferAttribute(rol, 1));
  // The channel the merge used to throw away, carried exactly the way the
  // colour three lines up is. The proof that per-vertex data survives this
  // merge and the BatchedMesh behind it was already sitting there.
  if (mat !== undefined) bakeMachineMat(g, pos.count, mat, roleOfMaterialName(mat.name));
  const idx = src.getIndex();
  if (idx !== null) g.setIndex(idx.clone());
  else {
    const seq = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; ++i) seq[i] = i;
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  g.applyMatrix4(world);
  g.computeBoundingSphere();
  return g;
}
