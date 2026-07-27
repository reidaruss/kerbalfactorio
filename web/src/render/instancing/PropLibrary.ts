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
  /** Current reservation. Doubles on demand up to MAX_CAPACITY (DW-28). */
  cap: number;
  grows: number;
  refused: number;
  warned: boolean;
}

/**
 * DW-28: instance pools GROW and exhaustion is LOUD. This batch used to be a
 * fixed `CAPACITY = 7000` per material with no growth path, which is the exact
 * shape the decision was written about: `acquire` returned -1, `exhausted++`
 * counted it, and the props were simply not drawn while every other number on
 * the HUD read healthy. It bound in practice: Plains asks for 0.1068 grass and
 * flower instances per square metre in the OF_Grass role, and the 170 m scatter
 * radius is 90,792 m2, so the demand is about 9,700 slots against 7,000.
 *
 * Start at a size the first ring will actually use and double from there,
 * exactly as `MachineBatch.grow()` does, so capacity follows the PLAN rather
 * than a second guessed constant. The start size is NOT a capacity decision, it
 * is a churn one: `setInstanceCount` copies the indirect and matrix texture
 * data on every doubling, and starting at 256 cost 22 reallocations during one
 * 55 m walk. `?propgrow=0` pins the old fixed 7,000 with no growth so the
 * before and after are measurable in one binary (standing rule 7).
 */
const START_CAPACITY = 2048;
const LEGACY_CAPACITY = 7000;
/** Memory guard, matching InstancePools.MAX_CAPACITY. Reaching it is counted. */
const MAX_CAPACITY = 16384;
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

  /** False pins every batch at the old fixed 7,000 with no growth (?propgrow=0). */
  private growable = true;

  static async load(
    urls: readonly string[], scene: THREE.Scene, growable = true,
  ): Promise<PropLibrary> {
    const lib = new PropLibrary();
    lib.growable = growable;
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
    const cap0 = this.growable ? START_CAPACITY : LEGACY_CAPACITY;
    const mesh = new THREE.BatchedMesh(cap0, MAX_VERTS, MAX_VERTS * 3, material);
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
    const batch: Batch = {
      mesh, free: [], live: 0, cap: cap0, grows: 0, refused: 0, warned: false,
    };
    this.batches.set(name, batch);
    return batch;
  }

  /**
   * Slots are allocated LAZILY and never deleted, so a batch's instance array
   * only ever reaches its own high-water mark. Priming the whole reservation up
   * front cost 2.5 s at boot and, worse, made every frame walk 70,000 slots
   * across ten batches when the scene held 9,000 props in five of them. Growth
   * therefore only moves the RESERVATION; `addInstance` still runs lazily.
   */

  /**
   * Hide or show the whole foliage layer. Standing rule 7's isolation, but done
   * at RUNTIME rather than by a query flag on purpose: measuring how much of
   * the ground the props cover means differencing two frames, and a page reload
   * cannot guarantee the same camera, the same streamed set or the same sun.
   * Toggling the batches inside one settled frame can.
   */
  setVisible(on: boolean): void {
    for (const b of this.batches.values()) b.mesh.visible = on;
  }

  partsOf(stem: string): readonly PropPart[] | null { return this.parts.get(stem) ?? null; }
  get propCount(): number { return this.parts.size; }
  get batchCount(): number { return this.batches.size; }
  get materials(): string[] { return [...this.batches.keys()]; }

  acquire(material: string): number {
    const b = this.batches.get(material);
    if (b === undefined) return -1;
    const reused = b.free.pop();
    if (reused !== undefined) { this.instancesLive++; return reused; }
    if (b.live >= b.cap && !this.grow(b, material)) { this.exhausted++; return -1; }
    b.live++;
    this.instancesLive++;
    return b.mesh.addInstance(0);
  }

  /**
   * Double one batch's reservation. False only at the ceiling, and then LOUDLY
   * (DW-28). `setInstanceCount` copies the indirect and matrix texture data
   * across, so every live slot keeps its transform and its geometry id.
   */
  private grow(b: Batch, name: string): boolean {
    const next = this.growable ? Math.min(MAX_CAPACITY, b.cap * 2) : b.cap;
    if (next <= b.cap) {
      b.refused++;
      if (!b.warned) {
        b.warned = true;
        console.error(`[of] prop pool '${name}' is FULL at ${b.cap} instances:`
          + ' props past this are placed and are NOT DRAWN');
      }
      return false;
    }
    b.mesh.setInstanceCount(next);
    b.cap = next;
    b.grows++;
    return true;
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

  /**
   * The shape `InstancePools.PoolReport` asks for, so `registerPool` puts the
   * foliage layer on the same HUD line as the machines and `POOL FULL: n NOT
   * DRAWN` covers it too. `perMaterial` is the number a probe needs: it is the
   * per-role DEMAND, which is what a fixed cap used to hide.
   */
  stats(): {
    name: string; batches: number; props: number; instances: number;
    exhausted: number; capacity: number; ceiling: number; grows: number;
    refused: number; growable: boolean;
    perMaterial: { name: string; live: number; cap: number; refused: number }[];
  } {
    let capacity = 0; let grows = 0;
    const perMaterial = [];
    for (const [name, b] of this.batches) {
      capacity += b.cap; grows += b.grows;
      perMaterial.push({ name, live: b.live, cap: b.cap, refused: b.refused });
    }
    perMaterial.sort((a, b) => b.live - a.live);
    // `refused` IS `exhausted`: every refused acquire is one instance that was
    // placed and is not on screen. They are one number under two names because
    // the HUD contract asks for `refused` and the older probes read `exhausted`.
    return {
      name: 'props', batches: this.batches.size, props: this.parts.size,
      instances: this.instancesLive, exhausted: this.exhausted,
      capacity, ceiling: this.batches.size * MAX_CAPACITY, grows,
      refused: this.exhausted, growable: this.growable, perMaterial,
    };
  }
}
