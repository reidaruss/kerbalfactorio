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
//
// TWO BATCHES, NOT EIGHT, and that is a MEASUREMENT. One batch per material is
// what PropLibrary does and it left the clearing at 28 draws, no better than the
// clones, because a shadow cascade redraws every batch: eight materials times
// the main pass plus three cascades is the whole saving given back. The six node
// files use eight roles but only TWO shading families (matte dielectric, and the
// two metallic ores), and the roles are untextured flat colours, so the colour
// is baked into a vertex attribute and the family is the batch. Eight batches
// become two, and the shadow multiplier stops mattering.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge one family's primitives into a single geometry. One is already merged. */
function concat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 1) return list[0];
  const g = mergeGeometries(list, false);
  if (g === null) return list[0];
  g.computeBoundingSphere();
  return g;
}

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
  /**
   * Slots handed back by `release`, ready to be handed out again.
   *
   * A BatchedMesh instance cannot be deleted, so a re-populated clearing used to
   * consume a fresh slot for every node it laid and never give the old ones
   * back. That was survivable at 24 nodes and is not now that a patch's outcrops
   * are nodes too: the third regrow would cross the capacity, `acquire` would
   * start returning -1, and the world would come back with pieces of it simply
   * not drawn, silently and only sometimes.
   */
  free: number[];
}

/** Instances per material. 24 nodes today, and the ring is authored, not streamed. */
const CAPACITY = 128;

/**
 * Strip to what every geometry in a batch must agree about (see PropLibrary),
 * and BAKE the source material's colour into a per-vertex attribute so several
 * roles can share one material. `mat.color` is already in the renderer's linear
 * working space (GLTFLoader converted it), which is the space three expects a
 * vertex colour to be in, so the components copy across untouched.
 */
function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4,
                   tint: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; ++i) {
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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

/** Which shading family a role belongs to. The role's own metalness decides. */
function familyOf(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return (s.metalness ?? 0) > 0.5 ? 'metal' : 'matte';
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
          material: familyOf(m.material as THREE.Material),
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

    // Everything a file draws in one family, for one variant, MERGES into one
    // geometry. A tree's Full variant is bark plus two leaf roles: three
    // primitives that are now one, so the node needs one instance rather than
    // three and the shadow pass sees a third of the work.
    const merged = new Map<string, THREE.BufferGeometry[]>();
    for (const f of found) {
      const key = `${f.file}|${f.variant}|${f.material}`;
      const list = merged.get(key) ?? [];
      list.push(normalize(f.geometry, f.world,
        (f.source as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)));
      merged.set(key, list);
    }
    for (const [key, list] of merged) {
      const [file, vs, family] = key.split('|');
      const b = this.batches.get(family);
      if (b === undefined) continue;
      const parts = this.parts.get(file) ?? [];
      let part = parts.find((p) => p.material === family);
      if (part === undefined) {
        part = { material: family, geom: [-1, -1, -1] };
        parts.push(part);
        this.parts.set(file, parts);
      }
      part.geom[Number(vs)] = b.mesh.addGeometry(concat(list));
    }
  }

  private makeBatch(name: string,
                    s: { verts: number; idx: number; src: THREE.Material }): Batch {
    const metal = name === 'metal';
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true,
      metalness: metal ? 1.0 : 0.0,
      roughness: metal ? 0.38 : 0.88,
      // The leaf roles are authored double sided (of_lib DOUBLE_SIDED) and they
      // share this batch with the trunk, so the whole matte family takes the
      // leaves' side setting. Nothing here is thick enough to show the cost.
      side: metal ? THREE.FrontSide : THREE.DoubleSide,
    });
    material.name = `nodes:${name}`;
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
    return { mesh, live: 0, free: [] };
  }

  partsOf(file: string): readonly NodePart[] | null { return this.parts.get(file) ?? null; }

  /** A slot in `material`'s batch, or -1 if the batch is full or unknown. */
  acquire(material: string): number {
    const b = this.batches.get(material);
    if (b === undefined) return -1;
    const reused = b.free.pop();
    if (reused !== undefined) { b.live++; return reused; }
    if (b.live >= CAPACITY) return -1;
    b.live++;
    return b.mesh.addInstance(0);
  }

  /** Hand a slot back: hidden now, reusable by the next acquire. */
  release(material: string, slot: number): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0 || b.free.includes(slot)) return;
    b.mesh.setVisibleAt(slot, false);
    b.free.push(slot);
    b.live--;
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

  stats(): { batches: number; materials: string[]; instances: number;
             free: number; capacity: number } {
    let n = 0;
    let free = 0;
    for (const b of this.batches.values()) { n += b.live; free += b.free.length; }
    return { batches: this.batches.size, materials: [...this.batches.keys()],
      instances: n, free, capacity: CAPACITY };
  }
}
