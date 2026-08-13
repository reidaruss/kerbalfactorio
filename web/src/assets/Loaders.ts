// THE glTF entry point, wired exactly once (ARCHITECTURE.md section 9.2).
//
// KTX2Loader LANDED (RN-1462, A2a). The comment that used to sit here said
// "no KTX2Loader yet, and that is a measurement rather than an omission"
// because every Tier 0/1 asset was untextured. That premise died at DW-35:
// the shared surface families in `assets/textures/dist` are 7.4 MB of raw
// PNG (Surfaces.ts, ASSET-SPECS 2.8), which is well past the "revisit KTX2"
// trigger. This lane wires the LOADER, not a conversion: every file the
// manifest names today is still `.png` and still decodes exactly as before.
// A `.ktx2` file becomes real the day texgen (or a hand-authored test asset)
// ships one; see `loadTexture` below and Surfaces.ts's `makeTexture` family,
// which now call it instead of owning a `THREE.TextureLoader()` each.
//
// MeshoptDecoder is still NOT wired: no mesh compression pass has shipped and
// nothing in this lane's brief asked for one, so that half of the old
// sentence stays true and stays out of scope.
//
// TRANSCODER ASSETS SHIP LOCALLY, NOT FROM A CDN. The served build is LAN
// (CLAUDE.md), so `KTX2Loader.setTranscoderPath` points at a same-origin
// path; `scripts/sync-assets.mjs` copies the two Basis Universal files out of
// three's own npm package (`node_modules/three/examples/jsm/libs/basis/`)
// into `public/assets/basis/` on every `predev`/`prebuild`, the same way it
// already stages every other served asset.
//
// Loads are DEDUPED by path. Two systems asking for props_forest.glb get one
// fetch and one parse, which is what stops the scatter pass from re-parsing an
// atlas per biome instance.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { OFRenderer } from '../render/Renderer.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

const ktx2Loader = new KTX2Loader().setTranscoderPath('assets/basis/');
loader.setKTX2Loader(ktx2Loader);

/** True once `initKtx2` has run `detectSupport`, which three requires before
 *  transcoding anything: it is how the loader learns which compressed GPU
 *  format to target. Guards `loadTexture`'s `.ktx2` branch below. */
let ktx2Ready = false;

/**
 * Call once, right after the renderer exists (`Boot.ts`, before any KTX2
 * asset can load). `detectSupport` needs the concrete GPU context `OFRenderer`
 * deliberately hides everywhere else (DW-10 / WR-1), which is why this
 * crosses through `detectKtx2Support` rather than reaching for a renderer
 * field here.
 */
export function initKtx2(renderer: OFRenderer): void {
  renderer.detectKtx2Support(ktx2Loader);
  ktx2Ready = true;
}

/**
 * Load ONE standalone texture: the shared surface PNGs Surfaces.ts owns, not
 * a texture embedded in a glTF (those go through `loadGlb`/`ktx2Loader`
 * above via `KHR_texture_basisu`, automatically). `.ktx2` is opt-in PURELY by
 * file extension, read off the manifest's own `file` field: `surfaces.json`
 * names only `.png` files today (this lane converts none), so this function
 * is behaviourally identical to a bare `new THREE.TextureLoader().loadAsync`
 * until the day a family's manifest entry ends in `.ktx2`. Centralised here,
 * rather than left as a `.ktx2` branch inside each of Surfaces.ts's four
 * `make*Texture` helpers, so there is exactly one place that owns "how does a
 * standalone texture get decoded" the same way `loadGlb` is exactly one place
 * for glTF.
 */
export function loadTexture(url: string): Promise<THREE.Texture> {
  if (url.endsWith('.ktx2')) {
    if (!ktx2Ready) {
      throw new Error(`[of] Loaders: ${url} is a KTX2 texture requested `
        + 'before initKtx2(renderer) ran. detectSupport() needs the GPU '
        + 'context to pick a transcode target, so a KTX2 load issued before '
        + 'the renderer exists is a boot-order bug, not a texture that can '
        + 'silently fall back to an untranscoded read.');
    }
    return ktx2Loader.loadAsync(url);
  }
  return new THREE.TextureLoader().loadAsync(url);
}

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
