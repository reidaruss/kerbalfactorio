// Every Tier 1 biome prop, registered once into one BatchedMesh PER MATERIAL
// (DW-11, ARCHITECTURE.md 6.2). The 41 props across 10 atlases use 12 material
// roles between them, so the whole foliage layer is at most 12 draws no matter
// how many thousand instances are on screen, and typically 4 to 6 because only
// the biomes actually under the player have anything visible.
//
// Material, not atlas, is the grouping. ASSET-SPECS 3.2 says exactly this: "the
// real budget is the material count, because the renderer batches by material".
// An atlas-shaped batch would redraw OF_Rock once per biome.
//
// A prop is usually SEVERAL primitives (Forest_FallenLog is three), and glTF
// splits those into one Mesh per material, so one placed prop is one instance in
// each of its materials' batches, all carrying the same matrix.

import * as THREE from 'three';
import { loadGlb } from '../../assets/Loaders.js';
import { LAYER_PROPS } from '../Scenes.js';

/** One primitive of one prop: which batch it lives in, and its two LOD ids. */
export interface PropPart {
  readonly material: string;
  readonly lod0: number;
  readonly lod2: number;
}

interface Batch {
  mesh: THREE.BatchedMesh;
  free: number[];
  /** Slots ever handed out: the batch's high-water mark, not its live count. */
  live: number;
}

const CAPACITY = 7000;
/** Props are small; a 33^2 chunk's worth of geometry is a few thousand verts. */
const MAX_VERTS = 60000;

/** Strip everything a BatchedMesh cannot bind consistently across geometries. */
function normalize(src: THREE.BufferGeometry, worldMatrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  const idx = src.getIndex();
  // Every geometry in a batch must agree about having an index (three throws
  // otherwise), and a prop authored as a triangle soup would break the batch.
  if (idx !== null) g.setIndex(idx.clone());
  else {
    const seq = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; ++i) seq[i] = i;
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  g.applyMatrix4(worldMatrix);
  g.computeBoundingSphere();
  return g;
}

export class PropLibrary {
  private readonly batches = new Map<string, Batch>();
  private readonly parts = new Map<string, PropPart[]>();
  instancesLive = 0;
  exhausted = 0;

  static async load(urls: readonly string[], scene: THREE.Scene): Promise<PropLibrary> {
    const lib = new PropLibrary();
    // Deduped by Loaders, so props_moon.glb is fetched once for its three biomes.
    const gltfs = await Promise.all([...new Set(urls)].map((u) => loadGlb(u)));
    for (const g of gltfs) lib.register(g.scene);
    for (const b of lib.batches.values()) scene.add(b.mesh);
    return lib;
  }

  private register(root: THREE.Object3D): void {
    root.updateWorldMatrix(true, true);
    const byStem = new Map<string, Map<string, { lod0: THREE.Mesh | null; lod2: THREE.Mesh | null }>>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || m.name.startsWith('col_')) return;
      const hit = /^(.*)_LOD(\d)(?:_\d+)?$/.exec(m.name);
      if (hit === null) return;
      const stem = hit[1];
      const mat = (m.material as THREE.Material).name || 'OF_Default';
      const perMat = byStem.get(stem) ?? new Map();
      byStem.set(stem, perMat);
      const slot = perMat.get(mat) ?? { lod0: null, lod2: null };
      if (hit[2] === '0') slot.lod0 = m; else slot.lod2 = m;
      perMat.set(mat, slot);
    });
    for (const [stem, perMat] of byStem) {
      const list: PropPart[] = [];
      for (const [mat, pair] of perMat) {
        const near = pair.lod0 ?? pair.lod2;
        if (near === null) continue;
        const batch = this.batchFor(mat, near.material as THREE.Material);
        const lod0 = batch.mesh.addGeometry(normalize(near.geometry, near.matrixWorld));
        const far = pair.lod2 ?? near;
        const lod2 = batch.mesh.addGeometry(normalize(far.geometry, far.matrixWorld));
        list.push({ material: mat, lod0, lod2 });
      }
      if (list.length > 0 && !this.parts.has(stem)) this.parts.set(stem, list);
    }
  }

  private batchFor(name: string, source: THREE.Material): Batch {
    const hit = this.batches.get(name);
    if (hit !== undefined) return hit;
    const material = source.clone();
    material.name = name;
    const mesh = new THREE.BatchedMesh(CAPACITY, MAX_VERTS, MAX_VERTS * 3, material);
    mesh.name = `props:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.layers.set(LAYER_PROPS);
    // BOTH per-instance culling and sorting are OFF, and that is a MEASUREMENT
    // against section 6.2, which says per-instance frustum culling "matters most
    // here". For 150-triangle props it costs far more than it saves.
    // BatchedMesh.onBeforeRender walks every live slot once per pass (main plus
    // three shadow cascades) doing a getMatrixAt, a bounding-sphere copy, a
    // transform and a frustum test: 9,340 props over four passes measured
    // 8.2 ms of near-pass CPU with sorting and 11.1 ms without. With all three
    // flags false the method EARLY-RETURNS unless visibility changed, so the
    // steady-state cost is zero and the scatter ring redraws about twice the
    // triangles it needs to. That trade is worth taking at this triangle count
    // and stops being worth it for the factory's larger meshes at W6.
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = false;
    const batch: Batch = { mesh, free: [], live: 0 };
    this.batches.set(name, batch);
    return batch;
  }

  /**
   * Slots are allocated LAZILY and never deleted, so a batch's instance array
   * only ever reaches its own high-water mark. Priming all 7,000 up front cost
   * 2.5 s at boot and, worse, made every frame walk 70,000 slots across ten
   * batches when the scene held 9,000 props in five of them.
   */

  partsOf(stem: string): readonly PropPart[] | null { return this.parts.get(stem) ?? null; }
  get propCount(): number { return this.parts.size; }
  get batchCount(): number { return this.batches.size; }
  get materials(): string[] { return [...this.batches.keys()]; }

  acquire(material: string): number {
    const b = this.batches.get(material);
    if (b === undefined) return -1;
    const reused = b.free.pop();
    if (reused !== undefined) { this.instancesLive++; return reused; }
    if (b.live >= CAPACITY) { this.exhausted++; return -1; }
    b.live++;
    this.instancesLive++;
    return b.mesh.addInstance(0);
  }

  release(material: string, slot: number): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    b.mesh.setVisibleAt(slot, false);
    b.free.push(slot);
    this.instancesLive--;
  }

  place(material: string, slot: number, geomId: number, m: THREE.Matrix4): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    b.mesh.setGeometryIdAt(slot, geomId);
    b.mesh.setMatrixAt(slot, m);
    b.mesh.setVisibleAt(slot, true);
  }

  stats(): { batches: number; props: number; instances: number; exhausted: number; capacity: number } {
    return {
      batches: this.batches.size, props: this.parts.size,
      instances: this.instancesLive, exhausted: this.exhausted,
      capacity: this.batches.size * CAPACITY,
    };
  }
}
