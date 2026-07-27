// TURNING AN AUTHORED .glb INTO ONE BATCHABLE GEOMETRY.
//
// Split out of MachineBatch when FS-40's probe read-back pushed that file past
// the 400-line cap, and split along a seam that was already there: MachineBatch
// owns the INSTANCE POOL and the material, and this owns the pure function that
// bakes a template's meshes into the single attribute layout that pool draws.
// Nothing here touches three's batching state, and nothing in MachineBatch
// reads a source scene.

import * as THREE from 'three';
import { copyUv } from '../render/instancing/Surfaces.js';

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
