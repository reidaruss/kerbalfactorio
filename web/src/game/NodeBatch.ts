// Every harvest node's art in one BatchedMesh PER MATERIAL (DW-11).
//
// The clearing used to be 24 cloned Groups. A clone is one THREE.Mesh per glTF
// primitive, glTF splits a multi-material mesh into one primitive per material,
// and a tree is bark plus two leaf materials, so 24 nodes drew about 25 times
// and the surface sat at 156 to 165 against a 150 budget. This is the same
// collapse PropLibrary already does for the biome props, and for the same
// reason: the budget is the MATERIAL count, not the object count.
//
// THE VARIANT IS A GEOMETRY ID, NOT A VISIBILITY FLIP. A node owns exactly one
// instance per material for its whole life; depleting it calls setGeometryIdAt
// to point that instance at the Half or Low geometry. So a node costs one slot,
// never three, and switching variant uploads one integer rather than rebuilding
// anything. The three variants share a pivot by contract (ASSET-SPECS 2.7), so
// the instance matrix does not change either.
//
// A variant that does not use a material (a Low tree has no leaves) sets that
// instance invisible instead. Nothing is deleted, so no slot is ever recycled.

import * as THREE from 'three';

/** The depletion variants, in the order their geometry ids are stored. */
export const VARIANTS = ['Full', 'Half', 'Low'] as const;

/** One material a piece of node art uses, and its geometry per variant (-1 = absent). */
export interface NodePart {
  readonly material: string;
  readonly geom: number[];
}

interface Batch {
  mesh: THREE.BatchedMesh;
  live: number;
}

/** Instances per material. 24 nodes today, and the ring is authored, not streamed. */
const CAPACITY = 128;

/** Strip to what every geometry in a batch must agree about (see PropLibrary). */
function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
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

/** A candidate primitive found in a template, before any batch exists. */
interface Found {
  file: string;
  variant: number;
  material: string;
  source: THREE.Material;
  geometry: THREE.BufferGeometry;
  world: THREE.Matrix4;
}

export class NodeBatch {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly parts = new Map<string, NodePart[]>();

  constructor() { this.group.name = 'harvestNodeBatches'; }

  /**
   * Register every template at once. Two passes on purpose: a BatchedMesh sizes
   * its vertex and index pools at construction, so the totals have to be known
   * before the first one is made. Guessing high allocates tens of megabytes of
   * dead buffer per material.
   */
  build(templates: ReadonlyMap<string, { root: string; scene: THREE.Object3D }>): void {
    const found: Found[] = [];
    for (const [file, t] of templates) {
      t.scene.updateWorldMatrix(true, true);
      t.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh !== true || m.name.startsWith('col_')) return;
        // GLTFLoader appends _0/_1/... per primitive of a multi-material mesh.
        const hit = /^(.*)_LOD0(?:_\d+)?$/.exec(m.name);
        if (hit === null) return;
        const v = VARIANTS.indexOf(hit[1].replace(`${t.root}_`, '') as typeof VARIANTS[number]);
        if (v < 0) return;   // a Stump or anything else outside the three variants
        found.push({
          file, variant: v, geometry: m.geometry, world: m.matrixWorld,
          material: (m.material as THREE.Material).name || 'OF_Default',
          source: m.material as THREE.Material,
        });
      });
    }

    const size = new Map<string, { verts: number; idx: number; src: THREE.Material }>();
    for (const f of found) {
      const s = size.get(f.material) ?? { verts: 0, idx: 0, src: f.source };
      s.verts += (f.geometry.getAttribute('position') as THREE.BufferAttribute).count;
      s.idx += f.geometry.getIndex()?.count
        ?? (f.geometry.getAttribute('position') as THREE.BufferAttribute).count;
      size.set(f.material, s);
    }
    for (const [name, s] of size) this.batches.set(name, this.makeBatch(name, s));

    for (const f of found) {
      const b = this.batches.get(f.material);
      if (b === undefined) continue;
      const list = this.parts.get(f.file) ?? [];
      let part = list.find((p) => p.material === f.material);
      if (part === undefined) {
        part = { material: f.material, geom: [-1, -1, -1] };
        list.push(part);
        this.parts.set(f.file, list);
      }
      // One primitive per (variant, material) is the authored shape; if a file
      // ever splits one, the first wins and the rest would need their own part.
      if (part.geom[f.variant] < 0)
        part.geom[f.variant] = b.mesh.addGeometry(normalize(f.geometry, f.world));
    }
  }

  private makeBatch(name: string,
                    s: { verts: number; idx: number; src: THREE.Material }): Batch {
    const material = s.src.clone();
    material.name = name;
    const mesh = new THREE.BatchedMesh(CAPACITY, s.verts, s.idx, material);
    mesh.name = `nodes:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The clearing is 60 m across and always around the player, so a whole-batch
    // cull would only ever be a false negative; per-instance culling and sorting
    // cost more than they save at this object count (PropLibrary measured it).
    mesh.frustumCulled = false;
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = false;
    this.group.add(mesh);
    return { mesh, live: 0 };
  }

  partsOf(file: string): readonly NodePart[] | null { return this.parts.get(file) ?? null; }

  /** A slot in `material`'s batch, or -1 if the batch is full or unknown. */
  acquire(material: string): number {
    const b = this.batches.get(material);
    if (b === undefined || b.live >= CAPACITY) return -1;
    b.live++;
    return b.mesh.addInstance(0);
  }

  /** Point a slot at a variant's geometry and place it. -1 geometry hides it. */
  set(material: string, slot: number, geom: number, m: THREE.Matrix4): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    if (geom < 0) { b.mesh.setVisibleAt(slot, false); return; }
    b.mesh.setGeometryIdAt(slot, geom);
    b.mesh.setMatrixAt(slot, m);
    b.mesh.setVisibleAt(slot, true);
  }

  /** Move a slot without touching which geometry it draws. The per-frame path. */
  move(material: string, slot: number, m: THREE.Matrix4): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    b.mesh.setMatrixAt(slot, m);
  }

  stats(): { batches: number; materials: string[]; instances: number } {
    let n = 0;
    for (const b of this.batches.values()) n += b.live;
    return { batches: this.batches.size, materials: [...this.batches.keys()], instances: n };
  }
}
