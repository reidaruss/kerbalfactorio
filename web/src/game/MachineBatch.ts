// Every placed machine, belt tile and inserter in ONE POOL, drawn by one
// BatchedMesh PER AUTHORED SURFACE FAMILY (DW-11, RN-1478), whose emissive is
// driven per instance from the section 6 stream.
//
// WHY ONE BATCH AND NOT ONE PER MATERIAL. A shadow cascade redraws every batch,
// so eight materials times the main pass plus three cascades gives the whole
// instancing saving back (NodeBatch measured it on the clearing). The five
// aRole values bake their COLOUR into a vertex attribute and share one draw.
//
// AND WHY ONE PER FAMILY IS NOT THAT, WHICH IS RN-1478. `attachSurface(m,
// 'panel', ...)` was called UNCONDITIONALLY here, so a machine's authored role
// never reached `familyForRole` and every part wore `panel`: manufacture out of
// plate, seams, rivet rows, a weld bead. Measured off the shipped .glb, the
// batches this class serves author FOUR tiling families between them, not eight
// (`panel`; `stone` on the smelter hearth, the foundation body and the pad's
// blast slab; `coarse` on every belt deck and the station's torn structure;
// `suitplate` on the station deck), and no single batch authors more than
// three. So the split is 5 meshes to 14, it is bounded by what the assets
// declare, and `MachineLayers.ts` carries the sampler arithmetic that rules out
// doing it on one material instead.
//
// DW-8 IS STILL THIS FILE'S REASON TO EXIST. There is no AnimationMixer
// anywhere: a belt's motion is a per-INSTANCE flow value, uploaded as one texel,
// that scrolls a procedural band along the deck's own local axis. The same texel
// carries the machine's VisualState. The GLSL moved to
// `render/materials/MachineFx.ts` when the split pushed this file past the cap;
// ONE hook object is shared by every layer, or three compiles one program per
// layer for a shader that is character-for-character identical.
//
// THE POOL IS STILL ONE POOL, and that is what keeps every caller unchanged. A
// slot is acquired in every layer at once and therefore means the same machine
// in all of them; a layer with nothing to draw for that template points at three
// degenerate vertices and stays invisible. See `MachineLayers.ts`.
//
// FS-16: THE POOL GROWS, AND WHEN IT CANNOT IT SAYS SO. This class shipped with
// `CAPACITY = 256` and no growth path, and past it a machine existed in the
// plan, ticked, produced and was never drawn. The measurement and the argument
// for doubling are in `InstancePools.ts`; the fix is here.

import * as THREE from 'three';
import { CAPACITY, MAX_CAPACITY, registerPool, type PoolReport }
  from './InstancePools.js';
import { noteShaderOrder, type Family } from '../render/instancing/Surfaces.js';
import { injectPartMat } from '../render/materials/PartMaterial.js';
import { injectMachineFx } from '../render/materials/MachineFx.js';
import { injectEmissiveLight } from '../render/materials/EmissiveLight.js';
import { MachineEmitters } from './MachineEmitters.js';
import { assertMachineBase, machineMatEnabled } from '../render/materials/MachineMat.js';
import { SHADOW_LOD_ON } from '../render/ShadowLod.js';
import { iblDiagOverride } from '../render/IblDiag.js'; // RN-1521, see IblDiag.ts
import { buildLayers, type Layer } from './MachineLayers.js';
import { gatherTiers, type FamilyTiers, type MachineTemplate }
  from './MachineGeometry.js';

export type { MachineTemplate };

/** Per-instance fx channels, in the order the shader reads them. */
export interface Fx { flow: number; density: number; state: number; level: number }

/**
 * The family a role falls back to when its authored one cannot be worn here:
 * `flat` (the recorded decision not to map a role, already handled by
 * `MachineMat`'s bare flag) and the two CARD families (`Surfaces.isTilingFamily`
 * carries the argument). It is `panel` because that is what every machine wore
 * before this pass, so a fallback is a role that did not move.
 */
const BASE: Family = 'panel';

export class MachineBatch {
  readonly group = new THREE.Group();
  /** One merged geometry per file, for the ghost preview to reuse. The WHOLE
   *  machine, every family, because a ghost is one translucent copy and not a
   *  material study. */
  readonly merged = new Map<string, THREE.BufferGeometry>();
  private readonly layers: Layer[] = [];
  /** Templates that produced geometry, i.e. what `acquire` will answer to. */
  private readonly keys = new Set<string>();
  /** Slot -> the template it is currently pointed at, which is what decides
   *  WHICH layers may show it. */
  private readonly slotKey: string[] = [];
  /** Slot -> whether the caller has placed it. Visibility is this AND the
   *  layer carrying geometry for `slotKey`, so `place` cannot un-hide a layer
   *  that has nothing to draw. */
  private readonly shown: boolean[] = [];
  private fxData!: Float32Array;
  private fxTex!: THREE.DataTexture;
  private readonly uniforms = {
    uFx: { value: null as THREE.DataTexture | null },
    uFxW: { value: 1 },
    uTime: { value: 0 },
  };
  /** ONE hook object for every layer's material: three's program cache key
   *  stringifies it, so a per-material closure would be a per-material
   *  program. */
  private readonly hook = (shader: {
    vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown>;
  }): void => { this.compile(shader, false); };
  /**
   * RN-2385. The same hook for the `ember` family, which is the only one that
   * draws fire. TWO MODULE-SHAPED OBJECTS AND NOT A CLOSURE PER MATERIAL: the
   * cache-key warning above still binds, and this is one extra hook per BATCH,
   * attached to at most one layer of it. The ember layer already compiled its
   * own program (it is the only machine material carrying an emissive map), so
   * this costs no permutation; `programs` is quoted before and after.
   */
  private readonly hookEmber = (shader: {
    vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown>;
  }): void => { this.compile(shader, true); };
  /** RN-2385. Slot -> live fire, for the pools whose templates have one. */
  private readonly emitters = new MachineEmitters();
  private compile(shader: {
    vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown>;
  }, ember: boolean): void {
    noteShaderOrder(this.name, shader.fragmentShader);
    // RN-1200. The per-part channel, spliced into the hook DW-8 already spent.
    // It lands BEFORE the fx edits and that is safe rather than lucky: it
    // anchors on the roughness, metalness, normal and AO chunks, all of which
    // `noteShaderOrder` asserts sit either side of `<emissivemap_fragment>`
    // and none of which IS `<emissivemap_fragment>`. Both add to
    // `#include <common>` and both keep the needle, so the two declaration
    // blocks stack rather than displace each other.
    if (machineMatEnabled()) injectPartMat(shader);
    injectMachineFx(shader, this.uniforms, ember);
    // RN-2385. LAST, so the emitter's `irradiance +=` lands at
    // `lights_fragment_begin` and cannot be displaced by either splice above:
    // both of those anchor on `<common>` and `<emissivemap_fragment>`, which
    // `noteShaderOrder` already asserts sit before the lighting block.
    injectEmissiveLight(shader as unknown as
      { uniforms: Record<string, THREE.IUniform>; fragmentShader: string });
  }
  /** Slots released by demolition, reused before any new one is added. */
  private readonly free: number[] = [];
  private live = 0;
  /** Instances ever added, i.e. the id range three considers valid. */
  private added = 0;
  private cap: number;
  private grows = 0;
  private refused = 0;
  private warned = false;

  /** `capacity` is a parameter because a BASE reaches many more instances than
   *  a factory does. It is a STARTING size, not a limit: see the header. */
  constructor(capacity = CAPACITY, private readonly name = 'factoryMachines',
              private readonly ceiling = MAX_CAPACITY) {
    this.group.name = name;
    this.cap = Math.max(1, Math.min(capacity, ceiling));
    this.allocFx(this.cap);
    registerPool(this);
  }

  /** The DOMINANT family's material, or null before `build`. Kept because it
   *  is this class's published handle on "the machine material"; every layer's
   *  is in `surfaceReport()` under `machines:<pool>:<family>`. */
  get material(): THREE.MeshStandardMaterial | null {
    return this.layers.length === 0 ? null : this.layers[0].material;
  }

  /** Instances this pool can currently hold. Grows; never shrinks. */
  get capacity(): number { return this.cap; }

  /** Wall-independent sim time, so a driven run scrolls at the real rate. */
  setTime(t: number): void { this.uniforms.uTime.value = t; }

  /**
   * (Re)allocate the per-instance fx texture for `cap` instances. Square, and
   * the old contents are copied FLAT. That is exact, not lucky: the shader reads
   * texel (id % w, id / w), whose flat offset is id * 4 whatever `w` is, so a
   * plain `set` preserves every live slot across a resize.
   */
  private allocFx(cap: number): void {
    const w = Math.max(1, Math.ceil(Math.sqrt(cap)));
    const data = new Float32Array(w * w * 4);
    if (this.fxData !== undefined) data.set(this.fxData.subarray(0, data.length));
    const tex = new THREE.DataTexture(data, w, w, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.fxTex?.dispose();
    this.fxData = data;
    this.fxTex = tex;
    this.uniforms.uFx.value = tex;
    this.uniforms.uFxW.value = w;
  }

  /** The stock material every layer starts from. `family` decides only which
   *  shared surface `MachineLayers` then attaches to it. */
  private makeMaterial(family: Family): THREE.MeshStandardMaterial {
    // THESE TWO STAY NUMERIC LITERALS, AND IN THIS FILE.
    // `tools/blender/render_machines.py` regex-reads them out of the FIRST
    // `new THREE.MeshStandardMaterial({...})` here to state what the game draws,
    // and raises rather than guess. RN-1200: they are also the BASE the per-part
    // channel divides back out, so `assertMachineBase` checks them against
    // `MachineMat`'s copy at boot. RN-1478 does not move them: a family changes
    // which MAPS a material wears, never the base the maps modulate.
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.55,
    });
    m.name = `factory:machines:${family}`;
    assertMachineBase(m); iblDiagOverride(m);
    m.userData.uniforms = this.uniforms;
    m.onBeforeCompile = family === 'ember' ? this.hookEmber : this.hook;
    return m;
  }

  /**
   * Register every template at once. Two passes, for the reason NodeBatch
   * documents: a BatchedMesh sizes its vertex and index pools at construction,
   * so the totals must be known before the first one exists.
   *
   * RN-681: the totals are the WHOLE LADDER, not tier 0, because every machine
   * file ships `_LOD1`/`_LOD2` and the cascades used to rasterise the eye's
   * mesh. `render/ShadowLod.ts` carries the rule that admits a tier to a
   * cascade; `?shadowlod=0` keeps tiers 1 and 2 out of the pools entirely, so
   * the negative control restores the previous geometry count and vertex-buffer
   * size, not merely the previous draw.
   *
   * RN-1478: and the totals are now per FAMILY, because each family is its own
   * mesh with its own pools. A family in tier 0 and not in tier 2 (the
   * smelter's hearth is exactly that) has no rung there, and `idAt` hands the
   * cascade the coarsest rung that exists.
   */
  build(templates: ReadonlyMap<string, { def: MachineTemplate; scene: THREE.Object3D }>): void {
    const per = new Map<string, FamilyTiers>();
    for (const [key, t] of templates) {
      const ft = gatherTiers(t.def, t.scene, BASE);
      if (ft.lod0 === null) continue;
      if (!SHADOW_LOD_ON) {
        for (const tiers of ft.byFamily.values()) { tiers[1] = null; tiers[2] = null; }
      }
      per.set(key, ft);
      this.merged.set(key, ft.lod0);
      this.emitters.learn(key, ft.emit);   // RN-2385
    }
    if (per.size === 0) return;
    for (const L of buildLayers(this.name, this.cap,
                                (f) => this.makeMaterial(f), per)) {
      this.layers.push(L);
      this.group.add(L.mesh);
    }
    for (const key of per.keys()) this.keys.add(key);
  }

  /**
   * A slot drawing `key`'s geometry, or -1 when the CEILING has been reached.
   *
   * -1 used to mean "the pool is 256 and you are the 257th", the silent wall
   * the packaging spike measured. It now only ever means the template is
   * unknown or the hard ceiling is exhausted, and the second is counted.
   */
  acquire(key: string): number {
    if (this.layers.length === 0 || !this.keys.has(key)) return -1;
    // A FREED SLOT IS REUSED rather than a new one added. Demolition made this
    // load bearing: addInstance only ever grows, so a player who put down and
    // pulled up belts would exhaust the pool with invisible slots.
    const reuse = this.free.pop();
    if (reuse !== undefined) {
      this.live++;
      this.point(reuse, key);
      return reuse;
    }
    if (this.live >= this.cap && !this.grow()) return -1;
    this.live++;
    // EVERY LAYER ADDS, INCLUDING THE ONES WITH NOTHING TO DRAW. three hands
    // back a monotonic id per mesh, so a layer that skipped an add would be off
    // by one for the rest of the session and would draw a different machine's
    // parts at this machine's matrix. Checked rather than assumed, because the
    // symptom is a wrong picture and not a crash.
    let slot = -1;
    for (const L of this.layers) {
      const s = L.mesh.addInstance(L.geomId.get(key) ?? L.absent);
      if (slot < 0) slot = s;
      else if (s !== slot) {
        console.error(`[of] ${this.name}: layer '${L.family}' returned slot ${s}`
          + ` where layer '${this.layers[0].family}' returned ${slot}. The`
          + ' machine layers are out of step and parts will draw on the wrong'
          + ' machines.');
      }
    }
    this.shown[slot] = false;
    this.point(slot, key);
    this.added = Math.max(this.added, slot + 1);
    return slot;
  }

  /** Point one slot at `key` in every layer, and set each layer's visibility
   *  to "the caller placed it AND I have something to draw for it". */
  private point(slot: number, key: string): void {
    this.slotKey[slot] = key;
    this.emitters.point(slot, key);   // RN-2385
    const on = this.shown[slot] === true;
    for (const L of this.layers) {
      const g = L.geomId.get(key);
      L.mesh.setGeometryIdAt(slot, g ?? L.absent);
      L.mesh.setVisibleAt(slot, on && g !== undefined);
    }
  }

  /**
   * FS-40 PROBE SURFACE: which template a slot is ACTUALLY going to be drawn
   * with, read straight out of three's own per-instance geometry index, and the
   * matrix it will actually be drawn with.
   *
   * Deliberately NOT a mirror of `FactoryView.drawn` or of anything else this
   * client decided. The defect FS-40 exists for is "the view worked out the tile
   * is a corner and the batch drew the straight mesh anyway", and a read-back
   * that reports the decision instead of the state cannot see that class at all.
   *
   * RN-1478 keeps that property across the split by asking the LAYERS and not
   * `slotKey`: a layer standing in for a template it does not carry points at
   * its `absent` geometry, which is in no `geomKey`, so it answers `undefined`.
   */
  drawnKeyAt(slot: number): string | null {
    if (this.layers.length === 0 || slot < 0 || slot >= this.added) return null;
    for (const L of this.layers) {
      const k = L.geomKey.get(L.mesh.getGeometryIdAt(slot));
      if (k !== undefined) return k;
    }
    return null;
  }

  /** The 16 elements of the matrix `slot` will be drawn with, column-major. */
  matrixAt(slot: number): number[] | null {
    if (this.layers.length === 0 || slot < 0 || slot >= this.added) return null;
    const m = new THREE.Matrix4();
    this.layers[0].mesh.getMatrixAt(slot, m);
    return [...m.elements];
  }

  /**
   * Double the pool. False only at the ceiling, and then LOUDLY.
   *
   * `setInstanceCount` keeps every live instance: it copies the indirect and
   * matrix texture data across, so no slot is re-added and no transform is
   * lost. The geometry pools are untouched because growth adds instances of
   * geometry that is already resident.
   */
  private grow(): boolean {
    if (this.layers.length === 0) return false;
    const next = Math.min(this.ceiling, this.cap * 2);
    if (next <= this.cap) {
      this.refused++;
      if (!this.warned) {
        this.warned = true;
        console.error(`[of] instance pool '${this.name}' is FULL at ${this.cap}`
          + ' instances: buildings past this exist and tick but are NOT DRAWN');
      }
      return false;
    }
    for (const L of this.layers) L.mesh.setInstanceCount(next);
    this.cap = next;
    this.allocFx(next);
    this.grows++;
    return true;
  }

  /**
   * Re-point a live slot at a different template's geometry. Returns false when
   * the key is unknown, so a caller can keep whatever was already drawn.
   *
   * A belt tile becomes a CURVE the moment a neighbour is laid beside it, which
   * is a change of mesh with no change of instance, so re-acquiring the slot
   * would churn the batch and lose the transform for a frame.
   */
  setGeometry(slot: number, key: string): boolean {
    if (this.layers.length === 0 || slot < 0 || !this.keys.has(key)) return false;
    this.point(slot, key);
    return true;
  }

  /** Hide a slot and give it back to the pool. Idempotent. */
  release(slot: number): void {
    if (this.layers.length === 0 || slot < 0 || this.free.includes(slot)) return;
    this.hide(slot);
    this.setFx(slot, { flow: 0, density: 0, state: 0, level: 0 });
    this.emitters.clear(slot);   // RN-2385: a demolished furnace stops lighting
    this.free.push(slot);
    this.live = Math.max(0, this.live - 1);
  }

  place(slot: number, m: THREE.Matrix4): void {
    if (this.layers.length === 0 || slot < 0) return;
    this.shown[slot] = true;
    this.emitters.place(slot, m);   // RN-2385
    const key = this.slotKey[slot];
    for (const L of this.layers) {
      L.mesh.setMatrixAt(slot, m);
      L.mesh.setVisibleAt(slot, key !== undefined && L.geomId.has(key));
    }
  }

  /** Stop drawing a slot without giving it back. For churny link instances. */
  hide(slot: number): void {
    if (this.layers.length === 0 || slot < 0) return;
    this.shown[slot] = false;
    this.emitters.hide(slot);   // RN-2385: an undrawn machine lights nothing
    for (const L of this.layers) L.mesh.setVisibleAt(slot, false);
  }

  /** ONE texel per instance. This is the whole of DW-8's per-instance channel. */
  setFx(slot: number, fx: Fx): void {
    if (slot < 0 || slot >= this.cap) return;
    this.emitters.fx(slot, fx.state, fx.level);   // RN-2385
    const i = slot * 4;
    this.fxData[i] = fx.flow;
    this.fxData[i + 1] = fx.density;
    this.fxData[i + 2] = fx.state;
    this.fxData[i + 3] = fx.level;
  }

  /** One upload per frame, however many instances changed, plus RN-2385's one
   *  publish of whatever in this pool is currently on fire. */
  flush(): void {
    if (this.live > 0) this.fxTex.needsUpdate = true;
    this.emitters.flush();
  }

  /** RN-2385. What this pool contributes to the light budget. */
  emitterStats(): { templates: number; slots: number; live: number } {
    return this.emitters.stats();
  }

  geometryFor(key: string): THREE.BufferGeometry | null {
    return this.merged.get(key) ?? null;
  }

  /**
   * What this pool is doing. `refused` is the number that matters: it is the
   * count of buildings that exist, tick and produce and are NOT on screen, and
   * it is what the HUD budget line and `probes/scale.js` assert on.
   */
  stats(): PoolReport {
    return {
      name: this.name, batches: this.layers.length,
      instances: this.live, capacity: this.cap, ceiling: this.ceiling,
      grows: this.grows, refused: this.refused,
    };
  }
}
