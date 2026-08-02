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
import { copyUv } from '../render/instancing/Surfaces.js';
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
 * A template's geometry per tier, world-baked and merged, `null` for a tier the
 * asset does not ship.
 *
 * A template with an explicit `nodeMatch` has NO ladder by construction and gets
 * tier 0 only. That is not a limitation to fix later: `nodeMatch` exists exactly
 * for the meshes with no LOD chain in their names (`items_atlas.glb`'s
 * `Item_Log`, the pad's `LaunchClamp_Arm`), so inventing tiers 1 and 2 for them
 * would either match nothing or, worse, match a sibling's mesh.
 */
export function gatherTiers(def: MachineTemplate,
                            scene: THREE.Object3D): (THREE.BufferGeometry | null)[] {
  scene.updateWorldMatrix(true, true);
  const out: (THREE.BufferGeometry | null)[] = [null, null, null];
  const tiers = def.nodeMatch !== undefined ? 1 : LOD_MATCH.length;
  for (let t = 0; t < tiers; ++t) {
    const re = def.nodeMatch ?? LOD_MATCH[t];
    const list: THREE.BufferGeometry[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || m.name.startsWith('col_')) return;
      if (!re.test(m.name)) return;
      const src = m.material as THREE.MeshStandardMaterial;
      list.push(normalize(m.geometry, m.matrixWorld,
        src.color ?? new THREE.Color(1, 1, 1), roleOf(src.name, def)));
    });
    if (list.length === 0) continue;
    const g = list.length === 1 ? list[0] : (mergeGeometries(list, false) ?? list[0]);
    g.computeBoundingSphere();
    out[t] = g;
  }
  return out;
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

/** Bake colour and role per vertex so one material can draw every role. */
export function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4,
                          tint: THREE.Color, role: number): THREE.BufferGeometry {
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
