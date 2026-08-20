// SHADOW-CASCADE LOD: which mesh a batch draws into a shadow map, derived from
// that cascade's own texel size and from a MEASURED property of the asset.
//
// THE DEFECT THIS EXISTS FOR. `MachineBatch` and `NodeBatch` both set
// `castShadow = true` on a `BatchedMesh` whose per-instance geometry id is the
// LOD0 mesh, and `ShadowRig` runs three cascades. So every machine triangle was
// rasterised FOUR times: once for the eye and once per cascade. At the smelter's
// post-raise 2,276 triangles and the 22-smelter reference base that is
// 22 x 2276 x 4 = 200,288 triangles, against a 660,385-triangle frame. The art
// direction cannot be paid for out of that.
//
// WHY A CASCADE IS THE RIGHT PLACE TO SPEND A CRUDER MESH, and distance is not.
// The tree lane's `NODE_LOD1_M` / `NODE_LOD2_M` pays 81.9% on the forest because
// 2,226 trees sit in a 620 m ring. A factory does not: the player builds within
// tens of metres of it, so a distance ladder never fires on a machine. The
// shadow pass is different in kind. A shadow map is a depth field sampled on a
// fixed world-space grid; detail finer than that grid cannot appear in it no
// matter which mesh produced it. Drawing LOD0 into a cascade is therefore not
// "higher quality", it is arithmetic with no image attached.
//
// ================== THE RULE, AND WHY IT IS NOT A CONSTANT ==================
//
// A picked constant ("cascade 0 gets LOD1") is sized against today's asset set,
// which is this project's catalogued hidden-assumption failure: it holds until
// somebody authors a lazier LOD1, and then it fails silently and looks fine in
// every aggregate. So the tier is derived from two measurements instead:
//
//   texel(c)  the cascade's own world metres per shadow texel, published by
//             `ShadowRig` out of the same `(2 * r) / mapSize` it already uses
//             for texel snapping. On the high tier cascade 0 is 15.47 mm
//             (rendering.md section 2.1), cascade 1 is 56.25 mm and cascade 2 is
//             210.94 mm. It is READ, never assumed: a quality tier with one
//             1024 cascade publishes 126.6 mm and the rule re-derives itself.
//
//   dev(G,L)  the MEASURED maximum distance from tier L's surface back to
//             tier 0's, in metres, computed at build time from the very
//             geometries the batch is about to draw (`surfaceDeviation` below).
//             A bolt head that LOD1 removed contributes its own height here.
//             A tier that shrinks a machine's base contributes that shift.
//
//   A cascade may draw the CRUDEST tier L for which dev(G,L) <= texel(c).
//
// WHY THE COMPARISON IS ONE TEXEL. The shadow map already quantises every
// silhouette to its own sampling grid, and section 2.1 records the PCF kernel as
// one texel wide. A caster displaced by less than one texel moves the lit/shadow
// boundary by less than the filter footprint that is already blurring it, so the
// error introduced is bounded by the quantisation that is there anyway. One
// texel is also the STRICTER of the two defensible choices: the Nyquist floor
// for "a feature this map could resolve at all" is two texels, and `?shadowlodk`
// exists so that claim can be measured rather than argued.
//
// ================= THE FAILURE MODE, NAMED BEFORE MEASURING =================
//
// This is the half that goes silently wrong, so it is written down here BEFORE
// any pair was taken. A cascade drawing a cruder mesh can:
//
//   1. SHIFT A SHADOW'S EDGE. The tier's silhouette differs from LOD0's, so the
//      terminator on the ground moves. Bounded by dev(G,L) in world units, which
//      is exactly what the rule caps at one texel.
//   2. DETACH A CONTACT SHADOW. If the tier lifts or shrinks a machine's
//      footprint, the dark seam where it meets the ground opens into a gap. This
//      is the most legible of the three because the eye reads it as the object
//      floating. Also bounded by dev, and it is the reason dev is measured from
//      LOD0's vertices to the tier's SURFACE and not between vertex sets: a base
//      ring that LOD1 lifted by 30 mm reports 30 mm, not 0.
//   3. MAKE A THIN FEATURE VANISH FROM ITS OWN SHADOW. A power-pole crossarm or
//      a conveyor leg that the tier deleted casts nothing. Its deviation is its
//      full size, so it disqualifies its own tier from any cascade fine enough
//      to have drawn it.
//
// Grazing sun is where all three are worst: shadows are longest, so an angular
// error is a longer displacement on the ground, and the contact seam is the part
// of the frame the eye is actually looking at. That is where the pairs are taken.

import * as THREE from 'three';

import { budgetFor, NEAREST_CASTER_M } from './ShadowLodK.js';

// The k policy moved to `ShadowLodK.ts` at RN-696, because it stopped being one
// number: a texel's SCREEN footprint differs 3x between cascade 0 and the other
// two, so one k in texels is three different k's to the eye. That file carries
// the derivation and the measurement that forced it.

/**
 * THE BOOT DEFAULT IS A FIXTURE, not an inference (rendering.md section 2.6).
 * `Number(null)` is 0, and this project has shipped two features switched off
 * because every probe passed an explicit flag and nothing ever exercised the
 * missing one. So a MISSING parameter is parsed as missing, the resolved default
 * is published beside the raw string, and `report()` carries both.
 */
const RAW = new URLSearchParams(self.location.search).get('shadowlod');
export const SHADOW_LOD_ON = RAW === null ? true : RAW !== '0';
/** The raw query value, for the report's boot-default fixture. */
export const SHADOW_LOD_RAW = RAW;

/** One tier ladder: geometry ids per tier and the deviation that admits them. */
export interface LodRow {
  readonly label: string;
  /** Geometry id per tier, -1 where the asset ships no such tier. */
  readonly ids: number[];
  /** Metres. `dev[0]` is 0 by construction; absent tiers are +Infinity. */
  readonly dev: number[];
  /** Triangles per tier, for the invariant table and the monotonicity guard. */
  readonly tris: number[];
}

/** Per geometry id: the ladder it sits on and which rung it is. */
export interface LodIndex { row: (LodRow | null)[]; tier: number[] }

export function emptyIndex(): LodIndex { return { row: [], tier: [] }; }

/** Register one ladder's ids into an index. Ids must already exist in the mesh. */
export function indexRow(ix: LodIndex, row: LodRow): void {
  for (let t = 0; t < row.ids.length; ++t) {
    const id = row.ids[t];
    if (id < 0) continue;
    ix.row[id] = row;
    ix.tier[id] = t;
  }
}

// ---------------------------------------------------------------------------
// The cascade registry. `ShadowRig` publishes; the batches read.
//
// Keyed on the shadow CAMERA because that is the only object three's shadow pass
// hands a caster (`WebGLShadowMap.renderObject` passes `shadowCamera`, never the
// light). Recomputed every frame by the rig, because the ortho box is refitted
// every frame and a cached texel would be a stale number the moment the quality
// tier changed.
// ---------------------------------------------------------------------------

interface Cascade { name: string; texelM: number; nearM: number; farM: number }

const byCamera = new WeakMap<THREE.Camera, Cascade>();
const published: Cascade[] = [];

/** `nearM` is the cascade's own near working distance: the previous split, or
 *  `NEAREST_CASTER_M` for cascade 0, which has no split below it. It is what the
 *  texel's screen footprint is evaluated at. */
export function publishCascade(name: string, cam: THREE.Camera, texelM: number,
                               nearM: number, farM = 0): void {
  const c: Cascade = { name, texelM, nearM, farM };
  byCamera.set(cam, c);
  const at = published.findIndex((p) => p.name === name);
  if (at < 0) published.push(c);
  else {
    published[at].texelM = texelM;
    published[at].nearM = nearM;
    // RN-2203. Defaulted to 0 rather than to a split table, and 0 is READ as
    // "unknown" by the far-shadow skip, which then keeps every caster. A
    // publisher that has not been taught the far distance therefore loses the
    // optimisation instead of losing a shadow.
    published[at].farM = farM;
  }
}

/** The cascade a shadow camera belongs to, or null for one nobody published. */
export function cascadeOf(cam: THREE.Camera): Cascade | null {
  return byCamera.get(cam) ?? null;
}

/** Metres per shadow texel for a cascade, or 0 for a camera nobody published. */
export function texelOf(cam: THREE.Camera): number {
  return byCamera.get(cam)?.texelM ?? 0;
}

/**
 * The crudest tier this cascade may draw. Tier 0 whenever the texel is unknown,
 * which is the safe direction: an unregistered shadow camera draws exactly what
 * it drew before this file existed.
 */
export function tierFor(dev: readonly number[], texelM: number,
                        nearM = NEAREST_CASTER_M): number {
  if (!SHADOW_LOD_ON || !(texelM > 0)) return 0;
  const budget = budgetFor(texelM, nearM);
  let t = 0;
  for (let i = 1; i < dev.length; ++i) if (dev[i] <= budget) t = i;
  return t;
}

/** Walk DOWN to the finest tier at or below `t` that the asset actually ships,
 *  which is `NodeBatch.geomAt`'s rule and for its reason: an asset with no far
 *  tier must behave exactly as it did before this file learned tiers existed. */
function idAt(row: LodRow, t: number): number {
  for (let i = Math.min(t, row.ids.length - 1); i >= 0; --i) {
    if (row.ids[i] >= 0) return row.ids[i];
  }
  return -1;
}

interface Swappable {
  instanceCount: number;
  getGeometryIdAt(i: number): number;
  setGeometryIdAt(i: number, g: number): this;
  /**
   * THREE'S OWN DIRTY FLAG, AND THE WHOLE FEATURE HANGS OFF IT.
   *
   * `BatchedMesh.onBeforeRender` opens with
   *
   *     if ( ! this._visibilityChanged && ! this.perObjectFrustumCulled
   *          && ! this.sortObjects ) return;
   *
   * and `setGeometryIdAt` sets `geometryIndex` WITHOUT setting that flag
   * (BatchedMesh.js:1200). `MachineBatch` turns both of the other two off, so
   * the first version of this file swapped every machine's geometry id three
   * times a frame and three never re-read one of them: the cascades kept
   * whatever draw ranges the previous eye pass had built, i.e. LOD0.
   *
   * IT MEASURED AS ALMOST NOTHING AND THAT IS THE POINT. 262,958 swaps on the
   * 78-building base against a frame delta of +63 triangles. The per-template
   * arithmetic said the belts alone should have paid 13,780. A saving that
   * exists in a counter and not in the frame is the exact shape this project
   * calls an opinion, and the only reason it was caught is that the invariant
   * table was taken before the claim was written.
   *
   * The flag is private in three and there is no public invalidator. It is
   * touched here, in one place, with the citation above, and only when a swap
   * actually happened, so a batch that changed nothing keeps three's early-out
   * and stays bit-exact with the build before this file.
   */
  _visibilityChanged: boolean;
}

/** `swaps` is cumulative since boot and only ever proves the hook FIRES;
 *  `instances` is the largest batch any cascade swept, which is a max and not a
 *  last-write, because a pool with no instances ran last and reported zero. */
const stats = { swaps: 0, instances: 0, saved: 0, passes: 0, batches: 0 };

/**
 * THE LAST COMPLETE FRAME'S SAVING, which is the only form of this number that
 * an A/B can be checked against.
 *
 * The first version divided the lifetime total by a frame count and reported
 * 4,407 where the settled-frame A/B measured 16,117. Neither was wrong: the
 * average is taken over every frame since boot, most of which were spent walking
 * to the site with no factory in them, so a lifetime mean of a quantity that
 * grows with the scene necessarily understates the scene. Keeping the LAST value
 * per (batch, cascade) and summing them is the frame, by construction, because
 * every batch is visited exactly once per cascade per frame.
 *
 * IT IS STILL AN UPPER BOUND, AND THE FRAME IS STILL THE AUTHORITY. This counts
 * every instance whose id it swapped; it does not model `perObjectFrustumCulled`,
 * which runs AFTER the swap and drops instances outside the cascade's own box. So
 * it is exact for `MachineBatch` (which turns per-instance culling off, because a
 * factory is always near the player) and an over-count for `NodeBatch` (which
 * turns it on, because a 620 m ring of trees is mostly outside any one cascade).
 * Measured, on the four scenes: the built factory agrees to 5.7% because it is
 * mostly machines, and FOREST REPORTS 12,274 AGAINST A FRAME DELTA OF EXACTLY
 * ZERO, because every node whose tier the rule would have changed is culled out
 * of the cascade that would have drawn it. That row is the reason this comment
 * exists: a counter that cannot see the cull will happily report a saving that
 * no pixel ever received.
 */
const lastPass: Map<THREE.Camera, number>[] = [];
function frameSaving(): number {
  let n = 0;
  for (const m of lastPass) for (const v of m.values()) n += v;
  return n;
}

/**
 * Make one `BatchedMesh` draw its tier ladder into the shadow cascades and its
 * LOD0 into the eye.
 *
 * The swap is a plain write to three's own per-instance geometry index, which is
 * what `onBeforeRender` reads to build the multi-draw ranges; `onBeforeShadow`
 * calls that same builder with the shadow camera, so the ranges rebuilt for a
 * cascade are the tier's. The per-instance frustum cull follows automatically,
 * because it takes its bounds from the same id.
 *
 * IT IS RESTORED AFTER EVERY CASCADE, not after the last one. Restoring once at
 * the end would be one fewer pass over the instances and would leave the batch
 * in a tier-dependent state if three ever reorders or interleaves the shadow
 * lights; this way the only state that survives a cascade is the one the eye
 * pass is entitled to see.
 *
 * A slot whose CURRENT tier is already coarser than the cascade asks for keeps
 * it. That is what composes with `NodeBatch`'s distance ladder: a tree at 200 m
 * is already LOD2 and must not be promoted back to LOD1 by a near cascade.
 */
export function attachShadowLod(mesh: THREE.BatchedMesh, ix: LodIndex): void {
  if (!SHADOW_LOD_ON) return;
  stats.batches++;
  const m = mesh as unknown as Swappable;
  const mine = new Map<THREE.Camera, number>();
  lastPass.push(mine);
  // Flat (slot, previousId) pairs. Reused across frames so a steady state
  // allocates nothing.
  const saved: number[] = [];
  const base = THREE.BatchedMesh.prototype.onBeforeShadow;
  mesh.onBeforeShadow = function onBeforeShadow(renderer, object, camera,
                                                shadowCamera, geometry,
                                                depthMaterial, group): void {
    const cascade = cascadeOf(shadowCamera);
    const texel = cascade === null ? 0 : cascade.texelM;
    saved.length = 0;
    let pass = 0;
    if (cascade !== null && texel > 0) {
      stats.passes++;
      const n = m.instanceCount;
      stats.instances = n;
      for (let i = 0; i < n; ++i) {
        const cur = m.getGeometryIdAt(i);
        const row = ix.row[cur];
        if (row === undefined || row === null) continue;
        const want = Math.max(ix.tier[cur], tierFor(row.dev, texel, cascade.nearM));
        const next = idAt(row, want);
        if (next < 0 || next === cur) continue;
        saved.push(i, cur);
        m.setGeometryIdAt(i, next);
        stats.swaps++;
        // TRIANGLES REMOVED, not swaps performed. A swap counter says the hook
        // ran; only this says the hook did anything, and the difference between
        // the two is the whole of the defect above. It is directly comparable
        // to the frame delta an A/B measures: if they disagree, one of them is
        // lying and the frame is not the one to doubt.
        const cut = row.tris[ix.tier[cur]] - row.tris[ix.tier[next]];
        stats.saved += cut;
        pass += cut;
      }
      // See `Swappable._visibilityChanged`. Without this the cascade rasterises
      // the ranges the last EYE pass built and the swap is a no-op with a
      // counter attached.
      if (saved.length > 0) m._visibilityChanged = true;
    }
    mine.set(shadowCamera, pass);
    base.call(this, renderer, object, camera, shadowCamera, geometry,
              depthMaterial, group);
  };
  // AND THE RESTORE MUST INVALIDATE TOO, which is the half that would have been
  // a real defect rather than a missing saving. `onBeforeRender` clears the flag
  // as it rebuilds, so after the last cascade the ranges on the mesh are the
  // CRUDEST tier's. The eye pass calls `onBeforeRender`, which would take the
  // early-out and draw cascade 2's mesh to the player.
  mesh.onAfterShadow = function onAfterShadow(): void {
    if (saved.length === 0) return;
    for (let k = saved.length - 2; k >= 0; k -= 2) m.setGeometryIdAt(saved[k], saved[k + 1]);
    saved.length = 0;
    m._visibilityChanged = true;
  };
}

// ---------------------------------------------------------------------------
// RN-2203: THE FAR RUNG DOES NOT CAST.
//
// The rule above coarsens a caster and can never remove one, because it is
// derived from a DEVIATION and a deviation is always finite. That is right for
// a machine and wrong for the far half of a forest, and the measurement says
// which: at `forestfloor`, one build, three interleaved repeats,
//
//     base        1,616,640 triangles   74 calls
//     shadows=0     782,595             46      -> 834,045 are shadow-only
//     props=0       882,340             50      -> 734,300 of the frame is props
//
// so the props are 45 per cent of the frame and, since a prop batch is drawn in
// the eye pass plus three cascades, about two thirds of the shadow total. The
// ladder cannot touch any of it: `NodeLadder`'s own note records that the tree
// crowns deviate 925 mm at LOD1 and 3,126 mm at LOD2 against cascade texels of
// 15.47, 56.25 and 210.94 mm, so every foliage rung is refused at every cascade
// and only boulders are ever admitted.
//
// WHAT IS TRUE OF AN IMPOSTOR THAT IS NOT TRUE OF AN LOD. A prop drawing its
// `_LOD3` card is past `CANOPY_LOD3_M` (420 m) or `NODE_LOD3_M` (310 m). The
// shadow cascades split at 22, 80 and 300 m, so EVERY instance at the impostor
// rung is already outside the last cascade's box: its shadow does not exist in
// the image, and the triangles are submitted only for the driver to clip. This
// is not a quality trade, it is the removal of work with no image attached, in
// the same sense `ShadowLod`'s header opens with.
//
// IT IS STILL GATED ON THE SPLITS RATHER THAN ASSUMED. `NEAREST_CASTER_M` and
// the cascade the mesh is being drawn for are both published; the skip only
// fires for a cascade whose own far distance is inside the impostor threshold,
// so lowering `CANOPY_LOD3_M` under a split, or a quality tier with a longer
// last cascade, silently turns it off instead of silently eating a shadow.

/** Registered per batch: which geometry ids ARE the impostor rung, and the
 *  range past which that rung is chosen. */
interface FarSkip { ids: Set<number>; fromM: number }
const farSkips: { mesh: THREE.Object3D; skip: FarSkip }[] = [];
const farStats = { batches: 0, hidden: 0, passes: 0, skipped: 0 };
/** Batches that TOOK the skip and batches that were OFFERED it and had no
 *  impostor rung to skip. Both published: "one batch registered" is a number
 *  nobody can act on, and "which one" is. */
const farNames: string[] = [];
const farEmpty: string[] = [];

/**
 * Make `mesh` leave its impostor-rung instances out of any shadow cascade that
 * cannot reach them. `ids` are the geometry ids of that rung in THIS batch;
 * `fromM` is the distance at which the rung is selected.
 *
 * Composes with `attachShadowLod` by construction, because the two never touch
 * the same instance: this one only acts on slots ALREADY at the impostor rung,
 * and that rung is never a tier `attachShadowLod` can promote to (it walks
 * DOWN, and an impostor's deviation is refused by every cascade anyway).
 */
export function attachFarShadowSkip(mesh: THREE.BatchedMesh, ids: Set<number>,
                                    fromM: number): void {
  if (!SHADOW_LOD_ON || ids.size === 0) { farEmpty.push(mesh.name); return; }
  farStats.batches++;
  farNames.push(mesh.name);
  const m = mesh as unknown as Swappable & {
    getVisibleAt(i: number): boolean;
    setVisibleAt(i: number, v: boolean): unknown;
  };
  const hidden: number[] = [];
  const prevBefore = mesh.onBeforeShadow;
  const prevAfter = mesh.onAfterShadow;
  mesh.onBeforeShadow = function onBeforeShadow(renderer, object, camera,
                                                shadowCamera, geometry,
                                                depthMaterial, group): void {
    // CHAINED FIRST, so a batch that also carries the tier ladder gets its
    // swap done before this decides which slots are at the impostor rung.
    // Order matters and this is the safe one: the ladder only ever makes a
    // slot COARSER, so a slot it moved to the impostor rung is one this should
    // also skip, and a slot it moved off one cannot exist.
    prevBefore.call(this, renderer, object, camera, shadowCamera, geometry,
      depthMaterial, group);
    hidden.length = 0;
    const cascade = cascadeOf(shadowCamera);
    // A cascade nobody published, or one that reaches past the impostor
    // threshold, keeps every caster: see the gate note above.
    if (cascade === null || !(cascade.farM > 0) || cascade.farM > fromM) return;
    farStats.passes++;
    const n = m.instanceCount;
    for (let i = 0; i < n; ++i) {
      if (!ids.has(m.getGeometryIdAt(i)) || !m.getVisibleAt(i)) continue;
      hidden.push(i);
      m.setVisibleAt(i, false);
      farStats.hidden++;
    }
    if (hidden.length > 0) { farStats.skipped += hidden.length; m._visibilityChanged = true; }
  };
  mesh.onAfterShadow = function onAfterShadow(renderer, object, camera,
                                              shadowCamera, geometry,
                                              depthMaterial, group): void {
    for (let k = hidden.length - 1; k >= 0; --k) m.setVisibleAt(hidden[k], true);
    if (hidden.length > 0) m._visibilityChanged = true;
    hidden.length = 0;
    prevAfter.call(this, renderer, object, camera, shadowCamera, geometry,
      depthMaterial, group);
  };
  farSkips.push({ mesh, skip: { ids, fromM } });
}

/** For the probe surface: how many batches carry the skip, and whether it has
 *  ever actually removed a caster. A registered skip that never fires is the
 *  vacuous green this project keeps catching, so both are published. */
export function farSkipStats(): {
  batches: number; passes: number; skipped: number; registered: number;
  on: string[]; noImpostor: string[];
} {
  return { batches: farStats.batches, passes: farStats.passes,
    skipped: farStats.skipped, registered: farSkips.length,
    on: [...farNames], noImpostor: [...farEmpty] };
}

const ladders: { pool: string; rows: LodRow[] }[] = [];

/** Publish one pool's ladders so a probe can read the rule's INPUTS, not just
 *  its output: the deviations, the tiers they buy at each published texel, and
 *  the triangles each rung costs. */
export function publishLadders(pool: string, rows: LodRow[]): void {
  const at = ladders.findIndex((l) => l.pool === pool);
  if (at < 0) ladders.push({ pool, rows });
  else ladders[at].rows = rows;
}

/** Accessors for `ShadowLodReport.ts`, which owns the probe surface. Exported
 *  rather than the mutable arrays themselves so nothing outside can write them. */
export function cascadesPublished(): readonly Cascade[] { return published; }
export function laddersPublished(): readonly { pool: string; rows: LodRow[] }[] {
  return ladders;
}
export function swapStats(): { swaps: number; instances: number; saved: number;
  passes: number; batches: number } {
  return { ...stats };
}
export { frameSaving };
