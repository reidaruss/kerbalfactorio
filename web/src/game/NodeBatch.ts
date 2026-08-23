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
import { MAX_CAPACITY, registerPool, type PoolReport } from './InstancePools.js';
import { LODS, VARIANTS, type Batch, type NodePart } from './NodeBatchTypes.js';
import { ROCK_CHANNEL, concat, mineralFamily, normalize, scanTemplates }
  from './NodeGeometry.js';
import { makeBatch } from './NodeMaterial.js';
import { ladder } from './NodeLadder.js';
import { NODE_LOD3_M } from './NodeBatchTypes.js';
import { cascadesPublished, SHADOW_LOD_ON } from '../render/ShadowLod.js';

// The barrel keeps every symbol this file used to publish, so no import site
// outside it changes (BT-276 rule 1). NodeField.ts takes the three distances and
// NodePart; RuinSites.ts takes the hysteresis.
export { LODS, NODE_LOD1_M, NODE_LOD2_M, NODE_LOD3_M, NODE_LOD_HYST,
  NODE_LOD_M, VARIANTS } from './NodeBatchTypes.js';
export type { NodePart } from './NodeBatchTypes.js';

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
    const found = scanTemplates(templates);

    const size = new Map<string, { verts: number; idx: number; src: THREE.Material }>();
    for (const f of found) {
      const s = size.get(f.material) ?? { verts: 0, idx: 0, src: f.source };
      s.verts += (f.geometry.getAttribute('position') as THREE.BufferAttribute).count;
      s.idx += f.geometry.getIndex()?.count
        ?? (f.geometry.getAttribute('position') as THREE.BufferAttribute).count;
      size.set(f.material, s);
    }
    for (const [name, s] of size)
      this.batches.set(name, makeBatch(this.group, name, s, this.cull));

    // Everything a file draws in one family, for one variant, MERGES into one
    // geometry. A tree's Full variant is bark plus two leaf roles: three
    // primitives that are now one, so the node needs one instance rather than
    // three and the shadow pass sees a third of the work.
    //
    // THE PER-PART BAKE IS GATED ON THE HOOK, and the gate is per FAMILY, not
    // per primitive. `mineralFamily` is the same predicate `makeBatch` installs
    // the hook with, so the attribute is written exactly when a program that
    // reads it will be compiled: no dead buffer on a `leaf:` batch nobody
    // hooks, and none at all under `?rockmat=0`, which is what keeps that flag
    // bit-exact rather than merely equivalent-looking.
    //
    // ALL OR NONE WITHIN A BATCH, which this gets for free by keying on the
    // family: a family is constant across a merge key AND across a batch, so
    // every geometry `mergeGeometries` and `addGeometry` see carries the same
    // attribute set. That matters because `mergeGeometries` returns null on a
    // mismatch and `concat` swallows it with `?? list[0]`, so a partial bake
    // would not be a wrong material, it would be most of a node silently gone.
    const merged = new Map<string, THREE.BufferGeometry[]>();
    for (const f of found) {
      const key = `${f.file}|${f.variant}|${f.lod}|${f.material}`;
      const list = merged.get(key) ?? [];
      const src = f.source as THREE.MeshStandardMaterial;
      list.push(normalize(f.geometry, f.world, src.color ?? new THREE.Color(1, 1, 1),
        ROCK_CHANNEL && mineralFamily(f.material) ? src : null));
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
    ladder(this.batches, this.parts, geo);
    // WG-320. Computed ONCE, here, because it is a property of the authored
    // assets and cannot change at runtime. See `farWhole` and `shadowsOff`.
    for (const name of this.batches.keys()) this.far.set(name, this.farWhole(name));
  }

  partsOf(file: string): readonly NodePart[] | null { return this.parts.get(file) ?? null; }

  /**
   * WG-320. PER BATCH: can EVERY instance in this batch be hidden from a
   * cascade once it reaches the impostor rung?
   *
   * This is the same predicate `attachFarShadowSkip` acts on rather than a
   * paraphrase of it: that hook hides an instance iff the instance's CURRENT
   * geometry id is in this batch's impostor-rung set, and `geomAt` walks DOWN
   * towards LOD0 when a rung is absent (`bush_scrub`, `oil_seep` and
   * `water_pool` author LOD0 and LOD1 only). So one part with no `_LOD3` keeps
   * ITS batch casting, and only its batch.
   *
   * A (part, variant) whose WHOLE row is -1 passes: that variant does not use
   * this material at all (a Low tree has no leaves), `set` has made the slot
   * invisible, and an invisible instance is drawn into nothing.
   *
   * PER BATCH AND NOT PER FIELD, and that is a measurement rather than a
   * preference: a first pass asked the question per placed node and ANDed the
   * answers across the whole field, and at `forestair` it read false forever
   * because the ring carries boulder art alongside the trees. One asset with
   * no impostor rung was cancelling the saving for every tree in the ring.
   */
  private farWhole(family: string): boolean {
    let seen = false;
    for (const parts of this.parts.values()) {
      for (const p of parts) {
        if (p.material !== family) continue;
        seen = true;
        for (let v = 0; v < VARIANTS.length; ++v) {
          const row = p.geom[v];
          if (row === undefined) continue;
          if (row[LODS - 1] >= 0) continue;
          // Absent rung. Only forgivable when the variant draws nothing here.
          if (row.some((id) => id >= 0)) return false;
        }
      }
    }
    return seen;
  }

  /**
   * WG-320. TAKE THE NODE BATCHES OUT OF THE SHADOW PASSES, or put them back.
   *
   * `allTier3` is the caller's claim that every live node is at the impostor
   * rung. Combined with `farWhole` for a batch, `attachFarShadowSkip` would
   * hide every one of that batch's instances from every cascade, so the three
   * cascade passes over it draw NOTHING -- and they are not cheap: each one
   * walks every instance three times over (the tier ladder's swap loop, this
   * skip's own hide loop, and three's per-instance frustum test inside
   * `onBeforeShadow`), then walks them again to restore. WG-320 measured that
   * at 0.385 us per node per frame at `forestair`, 42 per cent of the whole
   * per-node cost, for a shadow that provably does not exist.
   *
   * TWO MORE GATES, BOTH READ RATHER THAN ASSUMED, and both fail towards
   * KEEPING the shadow: `SHADOW_LOD_ON` (`?shadowlod=0` disarms the hook this
   * argument rests on) and every published cascade's own far distance being
   * inside `NODE_LOD3_M` (a longer last cascade WOULD reach a node at the
   * impostor rung, which is the exact gate `attachFarShadowSkip` applies per
   * cascade). A quality tier that changes either one silently turns this off
   * instead of silently eating a shadow, which is that function's own stated
   * discipline.
   */
  shadowsOff(allTier3: boolean): void {
    this.shadowArmed = SHADOW_LOD_ON && this.cascadesInside();
    const on = allTier3 && this.shadowArmed;
    if (on === this.shadowOffAsked) return;
    this.shadowOffAsked = on;
    this.shadowOffBatches = 0;
    for (const [name, b] of this.batches) {
      const off = on && (this.far.get(name) ?? false);
      b.mesh.castShadow = !off;
      if (off) this.shadowOffBatches++;
    }
  }

  /** Batches currently out of the shadow passes, and how many there are in
   *  total. Published as a PAIR so "the gate fired" and "the gate reached
   *  everything" are different readings: one asset with no impostor rung keeps
   *  its own batch casting and that shows up here as 3 of 5, not as a false. */
  shadowOffBatches = 0;
  get batchCount(): number { return this.batches.size; }
  /** The gate's other precondition on its own: the hook is armed and every
   *  published cascade stops inside the impostor threshold. */
  shadowArmed = false;
  private shadowOffAsked = false;
  private readonly far = new Map<string, boolean>();

  private cascadesInside(): boolean {
    const cs = cascadesPublished();
    if (cs.length === 0) return false;
    for (const c of cs) if (!(c.farM > 0) || c.farM > NODE_LOD3_M) return false;
    return true;
  }

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

  /** WG-320, `?nodefast=check` only. Read back the matrix a slot currently
   *  holds, so the skip's identity claim is checked against what the renderer
   *  will read rather than against this class's own memory of it. */
  matrixAt(material: string, slot: number, out: THREE.Matrix4): boolean {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return false;
    b.mesh.getMatrixAt(slot, out);
    return true;
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
