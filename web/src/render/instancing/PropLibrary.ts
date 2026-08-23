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
import { CANOPY_ATLAS, SHARED_ATLAS } from '../../assets/Registry.js';
import { LAYER_PROPS } from '../Scenes.js';
import { attachFarShadowSkip } from '../ShadowLod.js';
import { isFoliageMaterial } from '../ScatterLook.js';
import { isCrownImpostorMaterial } from './CrownNormal.js';
import { normalize, setBaseShade, setLeafVar, type BaseBake }
  from './PropGeometry.js';
import { applyPropSkyAmbient } from '../materials/PropSkyAmbient.js';
import { applyWind } from './PropWind.js';
import { attachSurface, familyForRole, roleOfMaterialName, surfacesReady }
  from './Surfaces.js';
import { emptyLods, groupTiers, meshAtTier, PROP_LODS,
  type PropPart } from './PropLods.js';

// The barrel: `ScatterEmit` and `Scatter` name `PropPart` through this module
// and did before the ladder existed, so the type moves and no import site does.
export { geomAtTier, PROP_LODS } from './PropLods.js';
export type { PropPart } from './PropLods.js';

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

/**
 * RN-2233. THE FAR CANOPY'S OWN BATCH KEY, and it is `DETAIL_SUFFIX`'s argument
 * word for word with one number changed.
 *
 * A canopy tree never enters a shadow cascade, and that is now a THEOREM rather
 * than a hope: `ScatterTuning.CANOPY_NEAR_M` is 550 m, the tier is exactly zero
 * inside it, and `ShadowRig`'s furthest cascade split is 300 m. So every canopy
 * instance in the world is beyond every cascade, always, and the whole shadow
 * pass over them is arithmetic with no image attached. The invariant is
 * ASSERTED at boot (`BootBodyScope`) rather than trusted, because it is two
 * numbers in two files and either could move.
 *
 * WHY A SUFFIX AND NOT `attachFarShadowSkip`. That function already existed for
 * this and it is the right tool at the scale it was built for: it hides the
 * impostor rung per instance inside `onBeforeShadow`. Per INSTANCE, per
 * CASCADE, per FRAME -- a `getGeometryIdAt` and a `setVisibleAt` each, then a
 * `_visibilityChanged` that re-forms the batch's draw list. At RN-2202's
 * few-thousand canopy that is invisible. At the 4.2 km reach it is 22,945 trees
 * on four material parts, so 91,780 instances walked three times a frame, and
 * the measured flyover was 21.4 ms of near pass for 322,312 triangles -- a
 * frame whose GPU work is a tenth of the forestfloor's and which cost seven
 * times the frame. `castShadow = false` on the mesh means the cascade never
 * calls the hook at all, so the walk does not happen rather than happening
 * cheaply.
 *
 * Same two consequences the detail suffix gets for free and both are wanted:
 * the canopy gets its OWN pool ceiling instead of sharing `OF_Bark` and the
 * three leaf materials with the near biome props, and `stats().perMaterial`
 * reports the far tier separately, so a shortfall in one layer can no longer
 * hide inside the other. `?canopy=0` omits the atlas url entirely, so these
 * batches are never created and the suffix never appears.
 */
const CANOPY_SUFFIX = ':canopy';

interface Batch {
  mesh: THREE.BatchedMesh;
  free: number[];
  /** Slots ever handed out: the batch's high-water mark, not its live count. */
  live: number;
  /** Current reservation. Doubles on demand up to `maxCap` (DW-28). */
  cap: number;
  /** RN-2260. This batch's own ceiling: `CANOPY_MAX_CAPACITY` for the canopy
   *  suffix's batch, `MAX_CAPACITY` for every other. Read by `grow()` instead
   *  of the module constant so one class's worst case cannot inflate every
   *  other batch's guessed guard rail. */
  maxCap: number;
  grows: number;
  refused: number;
  warned: boolean;
  /** At least one geometry in this batch carries the base-contact gradient. */
  shaded: boolean;
  /** The baked colour bytes, saved lazily the first time `setBaseShade(false)`
   *  is called so the toggle can put them back. Zero cost until then. */
  savedColour: Uint8Array | null;
  /** Foliage bake: which batches sway (PropWind) and carry the tip tint;
   *  `savedTint` is `setLeafVar`'s lazy copy, zero cost until toggled off. */
  foliage: boolean;
  savedTint: Uint8Array | null;
  /** RN-2203. Geometry ids in THIS batch that are the `_LOD3` impostor rung.
   *  Collected during registration because that is the only place the rung's
   *  identity is known; consumed once, after every atlas is in, to install the
   *  far-shadow skip. */
  far: Set<number>;
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
 *
 * This is the ceiling for every batch EXCEPT the canopy's own (see
 * `CANOPY_MAX_CAPACITY` below, RN-2260). Left unmoved for `:detail` and the
 * near biome batches: nothing measured has asked them for more than the
 * `OF_Grass` figure this constant was already raised for, and a blanket raise
 * would be a guard that guards nothing for those classes while still growing
 * their worst-case reservation for no measured reason.
 */
const MAX_CAPACITY = 65536;
/**
 * RN-2260. THE CANOPY'S OWN CEILING, dedicated rather than shared, because the
 * shared 65,536 truncated a real forest. RN-2240's single-material card
 * (rendering.md 2.15) collapsed every canopy tree from four material parts to
 * one (`OF_Leaf:canopy` only; `Bark`/`LeafDeep`/`LeafLight` are now refused at
 * `ScatterEmit.emit` before they ever reach `acquire`), so the tier's whole
 * instance demand, which used to be spread across four batches, now lands on
 * ONE. The WG-220 density lane's own worst-case FOREST emission is 77,998
 * canopy trees (NUMBERS.md RN-2260 row) -- past the shared ceiling by 12,462,
 * a silent 16% of the stand not drawn (HUD read `POOL FULL` but no probe
 * gated on it).
 *
 * RN-2675 (lane N17). RAISED AGAIN, 131,072 -> 262,144, and this time the
 * worst measured case does NOT overflow the OLD ceiling: WG-304's density-
 * honest cap fix (world-gen.md 6.16.13) landed `forestair` at 120,854 live
 * instances, 92.2% of 131,072, `poolRefused` 0. The case for raising ahead of
 * an overflow rather than after one:
 *
 * 1. HEADROOM IS THIN AND THE ONLY MEASURED LEVER IS SATURATED. The one
 *    density step this campaign measured (`?canopychunkkm2=` 2,400 -> 4,800)
 *    added 3,712 instances for +0.0043 of the guard's `rho`; only 10,218
 *    slots (2.75 such steps) sit between the shipped count and the old
 *    ceiling. But `?canopychunkkm2=9600` is bit-identical to shipped in every
 *    field (world-gen.md 6.16.13, post-merge verifier) -- that lever is
 *    already saturated, so headroom cannot be read off it and "2.75 steps
 *    from overflow" is a real but THIN number against the project's history
 *    of landing several such steps in one day (WG-295/301/304 all landed
 *    2026-08-22).
 * 2. THE ONE LEVER THIS LANE COULD MEASURE FRESH TURNED OUT SMALL, AND THAT
 *    IS RECORDED RATHER THAN QUIETLY DROPPED. This lane's own deliverable 2
 *    gives `CANOPY_CHUNK_MAX` a page param (`?canopychunkmax=`,
 *    ScatterTuning.ts), the one ceiling in the chain the WG-304 post-merge
 *    verifier flagged as unsweepable, so it could finally be swept. MEASURED
 *    on this build, `forestair`, one page param apart, outcome-read off
 *    `scatter.canopyProps`/`capScaleMin` (rendering.md 2.45 has the full
 *    ladder): raising `canopychunkmax` from the shipped 32,768 takes
 *    `forestair` from 120,854 to an ASYMPTOTE of **121,925** at 40,000 and
 *    beyond (`capScaleMin` reaches 1.0000 there and 100,000/200,000 read
 *    identically), i.e. relieving that one ceiling entirely is worth only
 *    **+1,071 instances, not the ~32,000 a naive area-rule estimate
 *    (`4800 * 13.54 km2`) predicts** -- an earlier draft of this comment
 *    quoted that estimate as a "measured ceiling" before the sweep actually
 *    ran and it was wrong by 30x; the real `want` at that chunk is density-
 *    limited, not area-ceiling-limited, once the ceiling stops binding. So
 *    THIS specific lever is not the overflow risk either.
 * 3. THE HONEST BASIS IS THEREFORE THE GENERIC ONE: headroom for a FEW MORE
 *    density-table changes of the one size this campaign actually measured
 *    (3,712), not a specific named mechanism, because both mechanisms this
 *    lane checked are saturated. Sized like every other ceiling in this file:
 *    the next power-of-two double from `START_CAPACITY` (2,048). This is NOT
 *    "infinity" -- it is a single, bounded doubling, the same one arithmetic
 *    step RN-2260 itself took, and it is free until the batch actually grows
 *    into it (point 4).
 * 4. `?canopychunkmax=` DEFAULTS TO THE SHIPPED 32,768 (ScatterTuning.ts), so
 *    NONE of this is live in the shipped binary today: `forestair` still
 *    reads 120,854 with this commit, unmoved, and `grow()` still stops
 *    doubling at the same 131,072-covering point it always did (2,048 ->
 *    4,096 -> ... -> 131,072 covers 120,854 in the same 6 doublings either
 *    ceiling allows). The raise only matters the day something ELSE grows
 *    live usage past 131,072.
 *
 * MEMORY. Same arithmetic as `MAX_CAPACITY`'s own comment, doubled again:
 * AT THE NEW CEILING, 262,144 slots is about 21.0 MB of texture (up from
 * 10.5 MB at the old ceiling) plus about 26.2 MB of CPU-side typed array, and
 * ONLY the canopy's single `OF_Leaf:canopy` batch can ever reserve it. AT THE
 * SHIPPED DEFAULT, this raise costs exactly nothing: live usage is unmoved at
 * 120,854 and `grow()`'s doubling ladder does not change, which is why
 * `render.vramMB` reads bit-identical before and after in every measurement
 * this lane took (see rendering.md 2.45). **THAT READING MUST NOT BE READ AS
 * "THE RAISE IS FREE" ON ITS OWN, PER RN-2166**: `render.vramMB` is a field
 * that does not count instance-pool textures at all (it read 104.2 unmoved
 * across six freshly-uploaded 1024-square terrain textures in the lane that
 * found it), so it would report the same 114.8 even if this raise DID cost
 * something. The 10.5 MB / 13.1 MB delta the OLD ceiling's own comment
 * states, and the further 10.5 MB / 13.1 MB this raise adds ON TOP OF IT IF
 * THE BATCH EVER GROWS INTO IT, are the priced costs; `vramMB`'s unmoved
 * reading is corroborating evidence that nothing grew into it TODAY, not
 * evidence about what growing into it would cost.
 */
const CANOPY_MAX_CAPACITY = 262144;
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
  /** RN-2204. The same, WIDENED to the biome batches; `?propcullbiome=0` is
   *  the pre-widening state and therefore the control. */
  private cullBiome = true;
  /** False registers LOD0 as the far geometry too (?proplod2=0). */
  private lod2Enabled = true;

  static async load(
    urls: readonly string[], scene: THREE.Scene, growable = true,
    cullDetail = true, lod2Enabled = true, farShadowFromM = 0,
    cullBiome = true,
  ): Promise<PropLibrary> {
    const lib = new PropLibrary();
    lib.growable = growable;
    lib.cullDetail = cullDetail;
    lib.cullBiome = cullBiome;
    lib.lod2Enabled = lod2Enabled;
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
    // RN-2233. The canopy atlas reads its identity from `CANOPY_ATLAS` on the
    // identical terms, and it is the same one-place answer: `BootObserver`
    // already composes the url list out of that constant.
    const canopy = new Set<string>(CANOPY_ATLAS);
    for (let i = 0; i < gltfs.length; ++i) {
      const suffix = detail.has(unique[i]) ? DETAIL_SUFFIX
        : canopy.has(unique[i]) ? CANOPY_SUFFIX : '';
      lib.register(gltfs[i].scene, suffix);
    }
    for (const b of lib.batches.values()) scene.add(b.mesh);
    // RN-2203. THE IMPOSTOR RUNG DOES NOT CAST. Installed here rather than in
    // `batchFor`, because a batch collects impostor ids from every atlas that
    // shares its material and the set is only complete once all of them are
    // registered. `farShadowFromM` is the range at which the rung is CHOSEN
    // (`ScatterTuning.CANOPY_LOD3_M`), passed in rather than imported so this
    // render-layer class does not reach into the world layer for a number.
    // See ShadowLod.attachFarShadowSkip for the measurement and the gate.
    if (farShadowFromM > 0) {
      for (const b of lib.batches.values()) {
        attachFarShadowSkip(b.mesh, b.far, farShadowFromM);
      }
    }
    // The probe surface, on the `Surfaces.ts` precedent and for its reason:
    // this is a measurement hook, not gameplay, so it is not routed through
    // `window.__of`. It is also the only route this lane has to a one-binary
    // control, since every constructor argument here comes from `Boot.ts`.
    (window as unknown as { __ofProps: unknown }).__ofProps = {
      setBaseShade: (on: boolean): number => lib.setBaseShade(on),
      setLeafVar: (on: boolean): number => setLeafVar(lib.batches.values(), on),
      stats: (): unknown => lib.stats(),
    };
    return lib;
  }

  private register(root: THREE.Object3D, suffix: string): void {
    root.updateWorldMatrix(true, true);
    // Grouped by `PropLods.groupTiers`, which keys the rung by its PARSED tier
    // index instead of by "is it zero". See that file's header: the else-branch
    // this replaces put every non-zero tier into one slot, so the far geometry
    // was whichever mesh `traverse` reached last and a `_LOD3` would silently
    // become the LOD2.
    const prims: { name: string; materialName: string; mesh: THREE.Mesh }[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || m.name.startsWith('col_')) return;
      prims.push({
        name: m.name,
        materialName: (m.material as THREE.Material).name || 'OF_Default',
        mesh: m,
      });
    });
    for (const [stem, perMat] of groupTiers(prims)) {
      const list: PropPart[] = [];
      for (const [mat, rungs] of perMat) {
        // The NEAREST rung this asset ships, which is LOD0 for everything in
        // the project and is still derived rather than assumed: a prop that
        // shipped only a far rung used to draw it near, and still does.
        const near = meshAtTier(rungs, PROP_LODS - 1) === null
          ? null : (rungs[0] ?? meshAtTier(rungs, PROP_LODS - 1));
        if (near === null || near === undefined) continue;
        const key = mat + suffix;
        // RN-2204: `cull` is now the SAME answer for both layers, and the
        // widening is the point. See `batchFor`'s note: per-instance culling
        // was measured OFF for the biome props at 9,340 instances in the NEAR
        // pass, and that measurement never looked at the three shadow cascades,
        // where the same batch is swept again with a box a fraction the size.
        // RN-2233. `suffix === ''` is now TWO refusals rather than one: the
        // understorey does not cast because a 0.36 m card's shadow is a few
        // pixels under a tuft already casting one, and the far canopy does not
        // cast because `CANOPY_NEAR_M` (550 m) puts every one of its instances
        // outside `ShadowRig`'s furthest cascade (300 m). Two different
        // arguments, one predicate; see `CANOPY_SUFFIX` for the second and for
        // the boot assertion that keeps it true.
        const batch = this.batchFor(key, mat, near.mesh.material as THREE.Material,
          suffix === '',
          this.cullDetail && (suffix !== '' || this.cullBiome),
          suffix === CANOPY_SUFFIX);
        // RN-62: EVERY prop takes a base-contact gradient, and the only
        // question is which profile (it used to be plants or nothing, which
        // left boulders meeting the terrain along a hard silhouette). The
        // predicate is imported from `ScatterLook` rather than rewritten,
        // because two copies of "which materials are plants" drift.
        const bake: BaseBake = isFoliageMaterial(mat) ? 'foliage' : 'mineral';
        // RN-2590. THE CROWN IMPOSTOR'S SHADING NORMAL IS A DIFFERENT
        // CONSTRUCTION FROM A TUFT'S, and this is the one place the material
        // NAME is still in hand: `normalize` sees a BufferGeometry and could
        // only guess from its shape. The predicate is imported rather than
        // rewritten, on the same argument the `bake` line above gives for
        // importing `isFoliageMaterial`: two copies of "which material is the
        // crown card" drift. See CrownNormal.ts.
        const crown = isCrownImpostorMaterial(mat);
        batch.shaded = true;
        const lods = emptyLods();
        // `?proplod2=0` gives the UNDERSTOREY nothing but its LOD0, so every
        // tier resolves back down to it: the state the understorey shipped in
        // before RN-45 authored the detail cards' LOD2. Standing rule 7, and it
        // matters more than usual because the saving is an ASSET change, so the
        // only other before/after would be a pair of BUILDS, which cannot hold
        // the streamed chunk set equal. SCOPED to the understorey: over every
        // batch it read 2,303,735 against 972,049, but most of that is the
        // BIOME props' LOD2, shipping since W4 and not that pass's to claim.
        // Scoped it reads 1,087,719 against 972,049.
        //
        // ONE DELIBERATE DIFFERENCE FROM THE OLD CONTROL: it used to add the
        // LOD0 geometry to the batch TWICE (once per named slot) and hand the
        // far slot the duplicate. The ladder maps the far tiers back to rung 0
        // instead, so the pixels are the same and the vertex pool holds one
        // copy rather than two.
        const flat = suffix !== '' && !this.lod2Enabled;
        for (let t = 0; t < PROP_LODS; ++t) {
          const m = flat ? (t === 0 ? near : null) : rungs[t];
          if (m === null || m === undefined) continue;
          lods[t] = batch.mesh.addGeometry(
            normalize(m.mesh.geometry, m.mesh.matrixWorld, bake, crown));
          if (t === PROP_LODS - 1) batch.far.add(lods[t]);
        }
        list.push({ material: key, lods });
      }
      if (list.length > 0 && !this.parts.has(stem)) this.parts.set(stem, list);
    }
  }

  private batchFor(
    key: string, role: string, source: THREE.Material, casts: boolean,
    cull: boolean, isCanopy: boolean,
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
    // gets the per-role family. `flat_roles` (Water, Ice, Glass, Skin, Oil,
    // EmissiveState) register and take NOTHING, a recorded decision rather
    // than an omission (surfaces.json's reason per role). Leaf/Grass are NOT
    // in that set since RN-181 (RN-1500: this comment still said they were):
    // they wear the `leaf`/`grass` albedo CARD families, unit-UV alpha-tested
    // textures, same `attachSurface` call as any other family.
    attachSurface(material as THREE.MeshStandardMaterial,
      familyForRole(roleOfMaterialName(role)), `props:${key}`);
    // WIND (RN-97): plants only, the same imported predicate the bake uses,
    // so a rock can never inherit a breeze. Design and ?wind=0 semantics live
    // in PropWind.ts's header.
    // RN-2605. `crown` picks `PropWind`'s second shared hook, which chains the
    // back-face normal fold on top of the wind and the sky ambient. Same
    // imported predicate as the bake five lines up, so "which material is the
    // crown card" has one definition in the whole file. See CrownFaceFold.ts.
    const crownCard = isCrownImpostorMaterial(role);
    if (isFoliageMaterial(role)) {
      applyWind(material as THREE.MeshStandardMaterial, `props:${key}`,
        crownCard);
    }
    // RN-2201. THE SKY AMBIENT (PropSkyAmbient.ts). Foliage batches already
    // spent their one `onBeforeCompile` on the wind and take the term by that
    // hook chaining to it; the mineral and bark batches have no hook at all, so
    // this installs the standalone one for them. Ordered AFTER the wind because
    // it reads the material's current hook to decide which case it is in, and
    // it is a no-op with `?wind=0` on a foliage batch only in the sense that
    // the standalone hook is then the one that carries the term.
    applyPropSkyAmbient(material, `props:${key}`, isFoliageMaterial(role),
      crownCard);
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
      mesh, free: [], live: 0, cap: cap0,
      maxCap: isCanopy ? CANOPY_MAX_CAPACITY : MAX_CAPACITY,
      grows: 0, refused: 0, warned: false,
      shaded: false, savedColour: null,
      foliage: isFoliageMaterial(role), savedTint: null, far: new Set<number>(),
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
    const next = this.growable ? Math.min(b.maxCap, b.cap * 2) : b.cap;
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
    let capacity = 0; let grows = 0; let baseShaded = 0; let ceiling = 0;
    const perMaterial = [];
    for (const [name, b] of this.batches) {
      capacity += b.cap; grows += b.grows; ceiling += b.maxCap;
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
    //
    // RN-2260. `ceiling` is now the SUM of each batch's own `maxCap` rather
    // than `batches.size * MAX_CAPACITY`: the canopy batch's ceiling is
    // `CANOPY_MAX_CAPACITY` and every other batch's is `MAX_CAPACITY`, so a
    // flat multiply would overstate every non-canopy batch's guard and (once
    // there is more than one canopy-suffixed batch) understate the canopy's.
    return {
      name: 'props', batches: this.batches.size, props: this.parts.size,
      instances: this.instancesLive, exhausted: this.exhausted,
      capacity, ceiling, grows,
      refused: this.exhausted, growable: this.growable, baseShaded, perMaterial,
    };
  }
}
