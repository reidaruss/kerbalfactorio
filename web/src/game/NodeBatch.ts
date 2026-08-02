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
// A FEW BATCHES, NOT EIGHT, and that is a MEASUREMENT. One batch per material is
// what PropLibrary does and it left the clearing at 28 draws, no better than the
// clones, because a shadow cascade redraws every batch: eight materials times
// the main pass plus three cascades is the whole saving given back. The six node
// files use eight roles but few shading families, and colour is baked into a
// vertex attribute, so the FAMILY is the batch and the shadow multiplier stops
// mattering. The family is now (surface, metalness) rather than metalness alone
// - see `familyOf`, where the reason is that Leaf and Grass must not inherit
// Rock's normal map.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAX_CAPACITY, registerPool, type PoolReport } from './InstancePools.js';
import { attachSurface, copyUv, familyForMaterial, type Family }
  from '../render/instancing/Surfaces.js';
import { applyWind } from '../render/instancing/PropWind.js';
import { attachShadowLod, emptyIndex, indexRow, publishLadders, type LodRow }
  from '../render/ShadowLod.js';
import { surfaceDeviation, triCount } from '../render/ShadowLodMeasure.js';

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
/** LOD tiers per variant. The assets author 0, 1 and 2; anything past this is
 *  ignored rather than silently folded into the far slot, which is the defect
 *  `PropLibrary`'s else-branch still carries. */
export const LODS = 3;

/** How far a node draws its LOD0 / LOD1 geometry, in metres OF ITS OWN SIZE.
 *
 * The comparison is `distance / scale`, not distance, and that is the whole
 * point: since WG-116 a tree's scale carries its yield and the world holds
 * trees from 0.82 to 2.39 of the authored height, so one absolute distance
 * would either pop the big ones or pay LOD0 for the small ones. Screen size is
 * what an LOD is actually about and distance over size is its cheap proxy.
 *
 * The two numbers were measured, not chosen: world-gen.md section 6.5.
 */
export const NODE_LOD1_M = 55;
export const NODE_LOD2_M = 165;
/** Fraction of a threshold a node must cross back through before it switches
 *  down again. Without it a node sitting on a boundary rewrites its geometry id
 *  every frame, which is cheap per node and is not cheap at a thousand. */
export const NODE_LOD_HYST = 0.12;

/** One material a piece of node art uses, and its geometry per (variant, LOD),
 *  -1 = absent. THREE LODs, because every node .glb in the project has shipped
 *  `_LOD1` and `_LOD2` meshes since it was authored and this file loaded
 *  neither: a harvest tree drew its 791-triangle LOD0 at 600 m while the 16
 *  triangle impostor the same file contained was dead bytes. */
export interface NodePart {
  readonly material: string;
  readonly geom: number[][];
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
  /** THIS batch's current instance count. It doubles; see `grow`. */
  cap: number;
}

/**
 * DW-28. Instances per material, as a STARTING size that doubles on demand up
 * to a ceiling, never a fixed wall.
 *
 * This was a hard `128` with no growth path and a silent `-1` on exhaustion,
 * which is the exact failure DW-28 exists to prevent and which this project has
 * paid for twice: a fixed 256 in `MachineBatch` stopped the factory drawing at
 * about 150 machines while every indicator read healthy, and the same shape in
 * `PropLibrary` was measured this week to be costing 25% of the foliage. The
 * comment on `free` two dozen lines above even PREDICTED it ("the third regrow
 * would cross the capacity, `acquire` would start returning -1, and the world
 * would come back with pieces of it simply not drawn, silently and only
 * sometimes"), which makes it the most expensive kind of known bug.
 *
 * The start is deliberately still small, because the clearing genuinely holds a
 * couple of dozen nodes: growth is for the case nobody predicted, and paying
 * for 16,384 instances up front to guard against it is the opposite mistake.
 */
const START_CAPACITY = 128;

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
  copyUv(src, g, pos.count, 'nodes');   // UNCONDITIONAL. See Surfaces.copyUv.
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

/**
 * Which batch a role belongs to: `<surface>:<shading>`, and BOTH halves matter.
 *
 * Metalness alone put Leaf and Grass in the same bucket as Rock and Bark. That
 * was free while nothing was textured and it stopped being free the moment the
 * bucket got a map, because Leaf and Grass are `flat_roles`: the texture pass
 * recorded a reason for each ("sub-pixel blades at any real viewing distance",
 * "a double-sided card whose normal map fights the flat-shaded silhouette"), and
 * a rock normal map on a foliage card is worse than no map at all. Splitting on
 * the surface family is what preserves that decision through the batching.
 *
 * The cost is at most two extra batches, which at 53 draws of a 150 budget is
 * the cheap side of the trade (ASSET-SPECS 2.9).
 */
function familyOf(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return `${familyForMaterial(m)}:${(s.metalness ?? 0) > 0.5 ? 'metal' : 'matte'}`;
}

/** A candidate primitive found in a template, before any batch exists. */
interface Found {
  file: string;
  variant: number;
  lod: number;
  material: string;
  source: THREE.Material;
  geometry: THREE.BufferGeometry;
  world: THREE.Matrix4;
}

export class NodeBatch {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly parts = new Map<string, NodePart[]>();

  /** DW-28 bookkeeping: doublings taken, and instances REFUSED at the ceiling.
   *  `refused` must stay 0 and is what the HUD line and a probe assert on. */
  private grows = 0;
  private refused = 0;
  private warned = false;

  /** `cull` is `?nodecull` (WG-118). Held rather than applied at once, because
   *  no batch exists until `build`. */
  constructor(private readonly cull = true) {
    this.group.name = 'harvestNodeBatches';
    // On the SAME HUD line as the machines, the structures and the props, so
    // one query covers every pool in the client and a new one cannot be added
    // without appearing there. That derivation is the whole point of the
    // registry: DW-28's failure was invisible precisely because nothing
    // published it.
    registerPool(this);
  }

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
        const hit = /^(.*)_LOD(\d)(?:_\d+)?$/.exec(m.name);
        if (hit === null) return;
        const lod = Number(hit[2]);
        if (!(lod >= 0 && lod < LODS)) return;
        const v = VARIANTS.indexOf(hit[1].replace(`${t.root}_`, '') as typeof VARIANTS[number]);
        if (v < 0) return;   // a Stump or anything else outside the three variants
        found.push({
          file, variant: v, lod, geometry: m.geometry, world: m.matrixWorld,
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
    for (const [name, s] of size)
      this.batches.set(name, this.makeBatch(name, s, this.cull));

    // Everything a file draws in one family, for one variant, MERGES into one
    // geometry. A tree's Full variant is bark plus two leaf roles: three
    // primitives that are now one, so the node needs one instance rather than
    // three and the shadow pass sees a third of the work.
    const merged = new Map<string, THREE.BufferGeometry[]>();
    for (const f of found) {
      const key = `${f.file}|${f.variant}|${f.lod}|${f.material}`;
      const list = merged.get(key) ?? [];
      list.push(normalize(f.geometry, f.world,
        (f.source as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)));
      merged.set(key, list);
    }
    // The concatenated geometry is KEPT (RN-684), because the shadow-LOD rule is
    // measured off the very mesh the batch is about to draw and not off the
    // source primitives: `concat` is where the variant's several roles become
    // the one silhouette a cascade will rasterise.
    const geo = new Map<string, THREE.BufferGeometry>();
    for (const [key, list] of merged) {
      const [file, vs, ls, family] = key.split('|');
      const b = this.batches.get(family);
      if (b === undefined) continue;
      const parts = this.parts.get(file) ?? [];
      let part = parts.find((p) => p.material === family);
      if (part === undefined) {
        part = {
          material: family,
          geom: Array.from({ length: VARIANTS.length },
            () => new Array<number>(LODS).fill(-1)),
        };
        parts.push(part);
        this.parts.set(file, parts);
      }
      const g = concat(list);
      geo.set(key, g);
      part.geom[Number(vs)][Number(ls)] = b.mesh.addGeometry(g);
    }
    this.ladder(geo);
  }

  /**
   * THE SECOND SAVING ON THE NODES, and it is not the one the tree lane took.
   *
   * `NODE_LOD1_M` / `NODE_LOD2_M` is a DISTANCE ladder and it pays 81.9% on the
   * forest because the trees are spread over a 620 m ring. It does nothing at
   * all for the tree three metres away, which still draws its LOD0 into all
   * three cascades. This is that other half: a cascade whose texels are 211 mm
   * cannot resolve a leaf card either way, whatever the node's distance says.
   *
   * The two COMPOSE and do not fight, because `attachShadowLod` takes the
   * coarser of the two: a node already at LOD2 for distance is never promoted
   * back to LOD1 by a near cascade. Rocks, spires and trees all cast, so all
   * three are in it.
   *
   * WHAT IT ACTUALLY PAYS, measured, and it is small: -470 triangles at the
   * RN-15 camera, -1,880 at Plains and ZERO at Forest. The trees are the reason.
   * `tree_conifer`'s Full variant deviates 925 mm at LOD1 and 3,126 mm at LOD2,
   * and `tree_broadleaf`'s leaf row 1,070 mm, so the crowns are refused at every
   * cascade and only the boulders and spires (58 to 110 mm at LOD1) are ever
   * admitted. A node ladder authored for DISTANCE is not a ladder authored for
   * a 15.47 mm texel, and this is the number that says so.
   */
  private ladder(geo: ReadonlyMap<string, THREE.BufferGeometry>): void {
    const rows: LodRow[] = [];
    for (const [family, b] of this.batches) {
      const ix = emptyIndex();
      for (const [file, parts] of this.parts) {
        for (const part of parts) {
          if (part.material !== family) continue;
          for (let v = 0; v < VARIANTS.length; ++v) {
            const ids = part.geom[v];
            const base = geo.get(`${file}|${v}|0|${family}`);
            if (base === undefined) continue;
            const row: LodRow = {
              label: `${file}|${VARIANTS[v]}|${family}`,
              ids,
              tris: ids.map((_, l) => {
                const g = geo.get(`${file}|${v}|${l}|${family}`);
                return g === undefined ? 0 : triCount(g);
              }),
              dev: ids.map((_, l) => {
                if (l === 0) return 0;
                const g = geo.get(`${file}|${v}|${l}|${family}`);
                return g === undefined ? Infinity : surfaceDeviation(base, g);
              }),
            };
            rows.push(row);
            indexRow(ix, row);
          }
        }
      }
      attachShadowLod(b.mesh, ix);
    }
    publishLadders('nodes', rows);
  }

  private makeBatch(name: string,
                    s: { verts: number; idx: number; src: THREE.Material },
                    cull: boolean): Batch {
    const metal = name.endsWith(':metal');
    const ore = name.startsWith('ore:');
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true,
      // RN-158: the ore SEAM bucket. The old world had iron and copper seams
      // in `coarse:metal` at metalness 1.0, i.e. a MIRROR whose only image is
      // the sky: the iron crown photographed as ice and copper read near-black
      // at any sun not overhead (RN-81). Ore in rock is MINERAL: dielectric
      // base with a modest sheen, and the sparkle comes from the ore ORM's
      // authored roughness spread (0.42..1.0 multiplier on this constant), not
      // from mirror metalness. 0.72 x 0.42 puts a facet crest at 0.30, a wet
      // glint; the dusty matrix stays near 0.72.
      metalness: ore ? 0.25 : metal ? 1.0 : 0.0,
      roughness: ore ? 0.72 : metal ? 0.38 : 0.88,
      // The leaf roles are authored double sided (of_lib DOUBLE_SIDED). Side
      // still keys on metalness ONLY, not on the new surface split, so the
      // bucketing change cannot move a silhouette: this is a materials pass.
      side: metal ? THREE.FrontSide : THREE.DoubleSide,
    });
    material.name = `nodes:${name}`;
    attachSurface(material, name.split(':')[0] as Family, `nodes:${name}`);
    // WIND (RN-98): the harvest trees' crowns sway; trunks stay near-rigid by
    // never being hooked (Bark is `coarse`, so it is not in this batch). The
    // hook keys on the FOLIAGE families (RN-181 moved the leaf roles out of
    // `flat` into `leaf`; `grass` never reaches a node but is listed so the
    // rule reads as what it means). `flat` is deliberately NOT hooked any
    // more: after the move it can only hold non-plants (Water, Oil), and a
    // swaying pool surface was exactly the latent wrong-sway the old prefix
    // permitted. Boulder roles are coarse or (since RN-158) `ore`.
    if (name.startsWith('leaf:') || name.startsWith('grass:')) {
      applyWind(material, `nodes:${name}`);
    }
    const mesh = new THREE.BatchedMesh(START_CAPACITY, s.verts, s.idx, material);
    mesh.name = `nodes:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A whole-batch cull would only ever be a false negative: a node batch
    // always has something in it near the player.
    mesh.frustumCulled = false;
    mesh.sortObjects = false;
    // PER-INSTANCE CULLING, and the line it replaces was RIGHT WHEN WRITTEN.
    // It said per-instance culling "cost more than they save at this object
    // count", and the object count was the 60 m clearing's two dozen nodes.
    // WG-116 put a 620 m ring of trees in these same batches, so the count is
    // now over a thousand and most of them are behind the player or outside a
    // given shadow cascade. `?nodecull=0` is the one-binary control.
    mesh.perObjectFrustumCulled = cull;
    this.group.add(mesh);
    return { mesh, live: 0, free: [], cap: START_CAPACITY };
  }

  partsOf(file: string): readonly NodePart[] | null { return this.parts.get(file) ?? null; }

  /**
   * The geometry id for one part at (variant, lod), FALLING BACK TOWARDS LOD0.
   *
   * `bush_scrub`, `oil_seep` and `water_pool` author LOD0 and LOD1 only, so a
   * literal lookup at LOD2 would hand `set` a -1 and make them invisible past
   * 165 m: a silent disappearance, which is the DW-28 failure shape. Walking
   * down instead means an asset with no far tier behaves exactly as it did
   * before this file learned that LODs existed.
   */
  geomAt(part: NodePart, variant: number, lod: number): number {
    const row = part.geom[variant];
    if (row === undefined) return -1;
    for (let l = Math.min(lod, LODS - 1); l >= 0; --l) {
      if (row[l] >= 0) return row[l];
    }
    return -1;
  }

  /** A slot in `material`'s batch, or -1 only at the CEILING, and then loudly. */
  acquire(material: string): number {
    const b = this.batches.get(material);
    if (b === undefined) return -1;
    const reused = b.free.pop();
    if (reused !== undefined) { b.live++; return reused; }
    if (b.live >= b.cap && !this.grow(b)) return -1;
    b.live++;
    return b.mesh.addInstance(0);
  }

  /**
   * Double one batch. False ONLY at the ceiling, and then it says so on the
   * console once and counts every refusal after it.
   *
   * `setInstanceCount` keeps every live instance (it copies the indirect and
   * matrix texture data across), so no slot is re-added and no transform is
   * lost, which is the same mechanism `MachineBatch.grow` uses and the reason
   * growth is safe mid-frame.
   */
  private grow(b: Batch): boolean {
    const next = Math.min(MAX_CAPACITY, b.cap * 2);
    if (next <= b.cap) {
      this.refused++;
      if (!this.warned) {
        this.warned = true;
        console.error(`[of] POOL FULL: node pool is at ${b.cap} instances;`
          + ' harvest nodes past this exist and can be mined but are NOT DRAWN');
      }
      return false;
    }
    b.mesh.setInstanceCount(next);
    b.cap = next;
    this.grows++;
    return true;
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

  /**
   * Per-instance colour multiplier. Build-time only: nothing calls this per
   * frame, so the 16 B/instance `setColorAt` adds to the batch is paid once.
   *
   * WHY THIS DID NOT EXIST. Every scatter prop has had a per-instance tint since
   * the understorey landed (`ScatterLook.tintFor`), but nodes never got one, so
   * the fourteen trees in the spawn clearing were the same two meshes at the
   * same size in the same colour, differing only in yaw. That is the first thing
   * the player sees and it read as a clone army. The batch could always do this
   * (`BatchedMesh` carries the attribute); nothing was writing it.
   *
   * A NODE IS TINTED ONCE AND EVERY PART TAKES THE SAME COLOUR. Trunk and canopy
   * are separate material batches, so tinting them independently would drift a
   * tree's bark away from its own leaves and read as a broken asset rather than
   * as variety. `NodeField` therefore draws one colour per PLACEMENT and applies
   * it across that placement's slots.
   */
  tint(material: string, slot: number, c: THREE.Color): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    b.mesh.setColorAt(slot, c);
  }

  /** Move a slot without touching which geometry it draws. The per-frame path. */
  move(material: string, slot: number, m: THREE.Matrix4): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    b.mesh.setMatrixAt(slot, m);
  }

  /** Exactly the shape `InstancePools.PoolReport` asks for, so `registerPool`
   *  puts this batch on the same HUD line as the machines and the props and a
   *  probe asserts `refused === 0` on all of them with one query. `capacity` is
   *  the SMALLEST live batch's, because that is the one that will exhaust
   *  first and a maximum would hide it. */
  stats(): PoolReport {
    let n = 0;
    let cap = 0;
    for (const b of this.batches.values()) {
      n += b.live;
      cap = cap === 0 ? b.cap : Math.min(cap, b.cap);
    }
    return { name: 'nodes', batches: this.batches.size, instances: n,
      capacity: cap, ceiling: MAX_CAPACITY, grows: this.grows,
      refused: this.refused };
  }

  /** Free slots and which materials exist, for a probe that wants the detail
   *  the shared PoolReport shape has no room for. */
  detail(): { materials: string[]; free: number } {
    let free = 0;
    for (const b of this.batches.values()) free += b.free.length;
    return { materials: [...this.batches.keys()], free };
  }
}
