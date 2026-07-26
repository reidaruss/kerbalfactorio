// THE glTF entry point, wired exactly once (ARCHITECTURE.md section 9.2).
//
// No KTX2Loader and no MeshoptDecoder yet, and that is a measurement rather than
// an omission: every Tier 0 and Tier 1 asset is untextured PBR roles
// (ASSET-SPECS section 2.8 defers a texture pipeline until the payload would
// cross 1 MB), so there is nothing for a transcoder to transcode, and the whole
// 42-file set is 2.43 MB against a 25 MB critical-preload budget. Both loaders
// go in behind this one function the moment a texture or a meshopt pass ships.
//
// Loads are DEDUPED by path. Two systems asking for props_forest.glb get one
// fetch and one parse, which is what stops the scatter pass from re-parsing an
// atlas per biome instance.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export interface AssetLoadStats {
  files: number;
  ms: number;
  bytes: number;
}

export const assetStats: AssetLoadStats = { files: 0, ms: 0, bytes: 0 };

export function loadGlb(path: string): Promise<GLTF> {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  const t0 = performance.now();
  const p = loader.loadAsync(path).then((g) => {
    assetStats.files++;
    assetStats.ms += performance.now() - t0;
    return g;
  });
  cache.set(path, p);
  return p;
}

/** First descendant with this exact name, or null. Node names are the contract. */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/**
 * Every mesh under `root`, with the collision proxies removed.
 *
 * ASSET-SPECS section 2.5: a `col_*` node is a broadphase box authored for the
 * physics layer, and it is inside the same file as the render meshes. Adding one
 * to a scene draws a grey cube through the middle of the asset, so the filter
 * belongs at the loader boundary and not in every consumer.
 */
export function renderMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh !== true) return;
    if (m.name.startsWith('col_')) return;
    out.push(m);
  });
  return out;
}

/**
 * Hide every LOD level except `keep` (`_LOD0` / `_LOD2`), and drop `col_*`.
 *
 * The trailing `(_\d+)?` is load-bearing. GLTFLoader splits a multi-PRIMITIVE
 * mesh into one three.Mesh per primitive named `<mesh>_0`, `<mesh>_1`, ..., and
 * the player body has six materials, so its LOD0 arrives as `Player_LOD0_0`
 * through `Player_LOD0_5`. A `_LOD(\d)$` anchor matches none of them, every LOD
 * level draws at once, and the only symptom is the draw count: 103 instead of
 * 49, with LOD1 and LOD2 z-fighting invisibly inside LOD0.
 */
export function selectLod(root: THREE.Object3D, keep: string): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh !== true) return;
    if (m.name.startsWith('col_')) { m.visible = false; return; }
    const lod = /_LOD(\d)(_\d+)?$/.exec(m.name);
    if (lod !== null) m.visible = `_LOD${lod[1]}` === keep;
  });
}
