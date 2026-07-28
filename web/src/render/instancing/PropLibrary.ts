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
import { SHARED_ATLAS } from '../../assets/Registry.js';
import { LAYER_PROPS } from '../Scenes.js';
import { isFoliageMaterial } from '../../world/ScatterLook.js';
import { normalize, setBaseShade } from './PropGeometry.js';
import { attachSurface, familyForRole, roleOfMaterialName, surfacesReady }
  from './Surfaces.js';

/** One primitive of one prop: which batch it lives in, and its two LOD ids. */
export interface PropPart {
  readonly material: string;
  readonly lod0: number;
  readonly lod2: number;
}

/**
 * Batch-key suffix for the ground-detail understorey, and THE reason this class
 * knows the understorey exists at all.
 *
 * MEASURED, at a fixed Hills camera, one binary, `?detail=0` as the control:
 * the understorey is 9,738 instances and it costs **1,003,112 of the frame's
 * 1,804,969 triangles and 12.3 ms of its 18.0 ms p50**. That is about 103
 * triangles for a card whose LOD0 is 18 to 42, because every card is drawn FOUR
 * times: the near pass plus three shadow cascades. Turning the whole shadow
 * layer off (`?shadows=0`) takes 1,203,460 triangles and 14.5 ms with it, which
 * is 67% of the triangles and 81% of the frame for shadows the player mostly
 * cannot see.
 *
 * A 0.36 m card's own cast shadow is a few pixels under a tuft that is already
 * casting one, so the understorey does not need to be in the shadow pass at
 * all. But `castShadow` is a property of the MESH, and the cards share their
 * materials with the biome tufts (`Detail_GrassCardA/B` and `Plains_GrassTuftA/B`
 * are all `OF_Grass`), so there is no way to spend it per prop without giving
 * the understorey its own batches. Hence the suffix.
 *
 * Two things fall out of it for free and both are wanted. The understorey gets
 * its OWN pool ceiling rather than sharing `OF_Grass` with the tufts, which is
 * the ceiling that was full at 16,384; and `stats().perMaterial` reports the two
 * layers separately, so a shortfall in one can no longer hide inside the other.
 */
const DETAIL_SUFFIX = ':detail';

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
  /** At least one geometry in this batch carries the base-contact gradient. */
  shaded: boolean;
  /** The baked colour bytes, saved lazily the first time `setBaseShade(false)`
   *  is called so the toggle can put them back. Zero cost until then. */
  savedColour: Uint8Array | null;
}

/**
 * DW-28: instance pools GROW and exhaustion is LOUD. This batch used to be a
 * fixed `CAPACITY = 7000` with no growth path, the exact shape the decision was
 * written about: `acquire` returned -1, `exhausted++` counted it, and the props
 * were simply not drawn while every other number on the HUD read healthy.
 *
 * Start at a size the first ring will actually use and double from there, so
 * capacity follows the PLAN rather than a second guessed constant. The start
 * size is NOT a capacity decision, it is a churn one: `setInstanceCount` copies
 * the indirect and matrix texture data on every doubling, and starting at 256
 * cost 22 reallocations during one 55 m walk. `?propgrow=0` pins the old fixed
 * 7,000 with no growth so before and after are one binary (standing rule 7).
 */
const START_CAPACITY = 2048;
const LEGACY_CAPACITY = 7000;
/**
 * Memory guard, and it is ONLY a memory guard (DW-28). Raised from 16,384,
 * which the `OF_Grass` batch reached and sat on: a Plains site read `live`
 * 16,384 with `refused` climbing, which is the decision working exactly as
 * designed and also a ceiling that a denser understorey has to pass through.
 *
 * The number is a memory budget, so here is the memory. `BatchedMesh` keeps one
 * RGBA32F matrix texel row per instance (16 floats, 64 B), a colour texel
 * (16 B once `setColorAt` is used), plus an indirect entry and a bounding
 * sphere, so a slot is about 100 B of CPU-side typed array and 80 B of texture.
 * 65,536 slots is therefore about 5.2 MB of texture per batch that actually
 * REACHES it, and a batch only reserves what it has grown into: `grow()` still
 * doubles from 2,048, so a batch that never fills never pays. Reported as
 * `vramEstimateMB` before and after.
 */
const MAX_CAPACITY = 65536;
/** Props are small; a 33^2 chunk's worth of geometry is a few thousand verts. */
const MAX_VERTS = 60000;

export class PropLibrary {
  private readonly batches = new Map<string, Batch>();
  private readonly parts = new Map<string, PropPart[]>();
  instancesLive = 0;
  exhausted = 0;

  /** False pins every batch at the old fixed 7,000 with no growth (?propgrow=0). */
  private growable = true;
  /** Per-instance frustum culling on the understorey batches (?propcull=0). */
  private cullDetail = true;

  static async load(
    urls: readonly string[], scene: THREE.Scene, growable = true,
    cullDetail = true,
  ): Promise<PropLibrary> {
    const lib = new PropLibrary();
    lib.growable = growable;
    lib.cullDetail = cullDetail;
    // Deduped by Loaders, so props_moon.glb is fetched once for its three biomes.
    // The manifest is awaited alongside, not after: this is the ONE batch path
    // that keeps a material per ROLE name, so it is the one that can express the
    // per-role family choice, and it must know the table before it builds one.
    const unique = [...new Set(urls)];
    const pending = Promise.all(unique.map((u) => loadGlb(u)));
    await surfacesReady();
    const gltfs = await pending;
    // Which atlas a geometry came from decides which batch it lands in, and the
    // answer is read from `SHARED_ATLAS` rather than passed in by the caller.
    // Boot.ts already composes the url list from exactly that constant, so
    // asking the registry here keeps the understorey's identity in ONE place
    // and costs the caller nothing. `?detail=0` simply omits the url, so the
    // detail batches are never created and the suffix never appears.
    const detail = new Set<string>(SHARED_ATLAS);
    for (let i = 0; i < gltfs.length; ++i) {
      lib.register(gltfs[i].scene, detail.has(unique[i]) ? DETAIL_SUFFIX : '');
    }
    for (const b of lib.batches.values()) scene.add(b.mesh);
    // The probe surface, on the `Surfaces.ts` precedent and for its reason:
    // this is a measurement hook, not gameplay, so it is not routed through
    // `window.__of`. It is also the only route this lane has to a one-binary
    // control, since every constructor argument here comes from `Boot.ts`.
    (window as unknown as { __ofProps: unknown }).__ofProps = {
      setBaseShade: (on: boolean): number => lib.setBaseShade(on),
      stats: (): unknown => lib.stats(),
    };
    return lib;
  }

  private register(root: THREE.Object3D, suffix: string): void {
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
        const key = mat + suffix;
        const batch = this.batchFor(key, mat, near.material as THREE.Material,
          suffix === '', suffix !== '' && this.cullDetail);
        // The base gradient goes on PLANTS, and the predicate is imported from
        // `ScatterLook` rather than rewritten here. Two copies of "which
        // materials are plants" drift, and the drift would show up as one leaf
        // role quietly failing to darken at its base.
        const shade = isFoliageMaterial(mat);
        batch.shaded = batch.shaded || shade;
        const lod0 = batch.mesh.addGeometry(normalize(near.geometry, near.matrixWorld, shade));
        const far = pair.lod2 ?? near;
        const lod2 = batch.mesh.addGeometry(normalize(far.geometry, far.matrixWorld, shade));
        list.push({ material: key, lod0, lod2 });
      }
      if (list.length > 0 && !this.parts.has(stem)) this.parts.set(stem, list);
    }
  }

  private batchFor(
    key: string, role: string, source: THREE.Material, casts: boolean,
    cull: boolean,
  ): Batch {
    const hit = this.batches.get(key);
    if (hit !== undefined) return hit;
    const material = source.clone();
    // The MATERIAL keeps the clean role name and the BATCH carries the suffix.
    // `Surfaces.roleOfMaterialName` parses `OF_<Role>` and reports anything it
    // cannot place as an unknown role, which is a console.error and therefore a
    // failed smoke run, so `OF_Grass:detail` must never reach it.
    material.name = role;
    // Per-instance colour, and the half of the pair that lives on the material.
    // See `normalize`: without this the white attribute is dead weight, and
    // without the attribute this renders every prop black.
    (material as THREE.MeshStandardMaterial).vertexColors = true;
    // The one path that keeps a material per role NAME, so it is the one that
    // gets the per-role family. `flat_roles` (Leaf, Grass, Water, Ice, Glass,
    // Skin, Oil, EmissiveState) register and take NOTHING, which is a recorded
    // decision rather than an omission: see surfaces.json's reason per role.
    attachSurface(material as THREE.MeshStandardMaterial,
      familyForRole(roleOfMaterialName(role)), `props:${key}`);
    const cap0 = this.growable ? START_CAPACITY : LEGACY_CAPACITY;
    const mesh = new THREE.BatchedMesh(cap0, MAX_VERTS, MAX_VERTS * 3, material);
    mesh.name = `props:${key}`;
    // The whole point of the split. See DETAIL_SUFFIX for the measurement.
    mesh.castShadow = casts;
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
    // ...AND THE MEASUREMENT THAT SET IT WENT STALE WHEN THE COUNT CHANGED,
    // which is the interesting half. That trade was struck at 9,340 props. The
    // understorey now runs at about 33,000 in one batch, and it is a RING
    // centred on the player, so roughly three quarters of it is behind the
    // camera and every one of those instances is still a `multiDrawElements`
    // range the driver walks. Culling is therefore measured again per batch
    // rather than inherited, and `?propcull=` is the isolation.
    mesh.perObjectFrustumCulled = cull;
    const batch: Batch = {
      mesh, free: [], live: 0, cap: cap0, grows: 0, refused: 0, warned: false,
      shaded: false, savedColour: null,
    };
    this.batches.set(key, batch);
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

  /** See `PropGeometry.setBaseShade`. Returns how many batches were touched. */
  setBaseShade(on: boolean): number {
    return setBaseShade(this.batches.values(), on);
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
   * Multiply one instance's albedo. Set ONCE, where the slot is acquired, and
   * deliberately NOT in `place`: `place` is the rebase path and runs for every
   * live part every time the floating origin moves, while a prop's colour is a
   * property of its placement and never changes after it. Writing it there
   * would be a per-frame upload of a texture that has not changed.
   *
   * A reused slot is always retinted because the sampler that acquires it also
   * tints it, so a freed slot cannot inherit its predecessor's colour.
   */
  tint(material: string, slot: number, c: THREE.Color): void {
    const b = this.batches.get(material);
    if (b === undefined || slot < 0) return;
    b.mesh.setColorAt(slot, c);
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
    refused: number; growable: boolean; baseShaded: number;
    perMaterial: {
      name: string; live: number; cap: number; refused: number; casts: boolean;
      shaded: boolean;
    }[];
  } {
    let capacity = 0; let grows = 0; let baseShaded = 0;
    const perMaterial = [];
    for (const [name, b] of this.batches) {
      capacity += b.cap; grows += b.grows;
      if (b.shaded) baseShaded++;
      // `casts` is published because it is now the difference between two
      // batches of the same material, and a triangle count that does not say
      // which batches were in the shadow pass cannot be read.
      perMaterial.push({
        name, live: b.live, cap: b.cap, refused: b.refused,
        casts: b.mesh.castShadow, shaded: b.shaded,
      });
    }
    perMaterial.sort((a, b) => b.live - a.live);
    // `refused` IS `exhausted`: every refused acquire is one instance that was
    // placed and is not on screen. They are one number under two names because
    // the HUD contract asks for `refused` and the older probes read `exhausted`.
    return {
      name: 'props', batches: this.batches.size, props: this.parts.size,
      instances: this.instancesLive, exhausted: this.exhausted,
      capacity, ceiling: this.batches.size * MAX_CAPACITY, grows,
      refused: this.exhausted, growable: this.growable, baseShaded, perMaterial,
    };
  }
}
