// TURNING AN AUTHORED .glb INTO ONE BATCHABLE GEOMETRY.
//
// Split out of MachineBatch when FS-40's probe read-back pushed that file past
// the 400-line cap, and split along a seam that was already there: MachineBatch
// owns the INSTANCE POOL and the material, and this owns the pure function that
// bakes a template's meshes into the single attribute layout that pool draws.
// Nothing here touches three's batching state, and nothing in MachineBatch
// reads a source scene.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { copyUv, familyForRole, isTilingFamily, roleOfMaterialName, type Family }
  from '../render/instancing/Surfaces.js';
import { bakeMachineMat } from '../render/materials/MachineMat.js';
import { type LodRow } from '../render/ShadowLod.js';
import { surfaceDeviation, triCount } from '../render/ShadowLodMeasure.js';

/**
 * aRole: what a vertex is, so one material can serve the authored roles.
 *
 * The two ARC roles are the belt CURVES (W7). A curve's deck is a quarter
 * annulus, so scrolling the band along local Z (which is what a straight tile
 * does) would run the cargo diagonally across the corner. The role carries which
 * corner it is, the only thing the shader needs to find the arc centre, and it
 * costs no extra attribute.
 */
export const ROLE_BODY = 0, ROLE_STATUS = 1, ROLE_FLOW = 2;
export const ROLE_ARC_L = 3, ROLE_ARC_R = 4;

export interface MachineTemplate {
  url: string;
  root: string;
  flowMaterial?: string;
  /** Set on the curve tiles: which way the quarter turn goes. */
  arc?: 'l' | 'r';
  /** Which meshes of the source scene belong to this template; defaults to the
   *  `_LOD0` suffix every machine file uses. `items_atlas.glb` (FS-28) names its
   *  meshes `Item_Log` with no LOD chain, so belt cargo passes a pattern. */
  nodeMatch?: RegExp;
}

/** The default: a machine file's own drawing LOD. */
export const LOD0 = /_LOD0(?:_\d+)?$/;

/**
 * The whole ladder. EVERY machine .glb in this project ships `_LOD1` and
 * `_LOD2` and this file read neither: `smelter.glb` carries 592 / 192 / 48
 * triangles and drew 592 four times over (once for the eye, once per shadow
 * cascade), and `launch_pad.glb` carried 608 + 96 triangles of tiers that
 * nothing had ever loaded. `NodeBatch` had the identical defect and the tree
 * lane took the distance half of it; this is the SHADOW half, which is a
 * separate saving on a separate pass (see `render/ShadowLod.ts`).
 */
export const LOD_MATCH = [LOD0, /_LOD1(?:_\d+)?$/, /_LOD2(?:_\d+)?$/] as const;

/**
 * A template's geometry per tier, SPLIT BY AUTHORED FAMILY, world-baked and
 * merged, `null` for a tier a family does not appear in (which includes every
 * tier the asset does not ship).
 *
 * RN-1478 IS THE SPLIT AND THE SPLIT IS THE WHOLE FIX. `MachineBatch` used to
 * take one merged geometry per tier and draw it with one material pinned to
 * `panel`, so a smelter's `Rock` hearth and a belt's `Rubber` deck wore plate
 * seams and rivet rows. A `BatchedMesh` carries ONE material (three r185:
 * `Material|Array<Material>` with no per-geometry index, and the internal
 * geometry has no groups), so the family cannot be resolved per instance and it
 * cannot be resolved per fragment without spending sampler units the machine
 * program does not have. It CAN be resolved per authored MATERIAL, which is
 * what this does: bucket the primitives by `familyForRole` of their own
 * material name, dedupe, and hand `MachineBatch` one geometry per family so it
 * can hand each one the surface the asset actually asked for.
 *
 * A CARD FAMILY IS FOLDED BACK INTO `base`, and `Surfaces.isTilingFamily`
 * carries the argument: these UVs are metres and a card is unit space. So is
 * `flat`, which is not a map at all and whose parts are already handled by
 * `MachineMat`'s bare flag (RN-1203).
 *
 * A template with an explicit `nodeMatch` has NO ladder by construction and gets
 * tier 0 only. That is not a limitation to fix later: `nodeMatch` exists exactly
 * for the meshes with no LOD chain in their names (`items_atlas.glb`'s
 * `Item_Log`, the pad's `LaunchClamp_Arm`), so inventing tiers 1 and 2 for them
 * would either match nothing or, worse, match a sibling's mesh.
 */
export interface FamilyTiers {
  /** Family -> its three tiers. Only families the asset actually authors. */
  byFamily: Map<Family, (THREE.BufferGeometry | null)[]>;
  /** Tier 0 with every family merged back together, for the ghost preview,
   *  which is one translucent copy of the whole machine and not a material
   *  study. Built here rather than by the caller so the ghost cannot drift
   *  from what the batch drew. */
  lod0: THREE.BufferGeometry | null;
  /** RN-2385. What this template's fire is, as a light source. Null for the
   *  templates that author no `ember` family, which is most of them. */
  emit: EmitterSource | null;
}

/**
 * RN-2385. THE EMITTER, MEASURED OFF THE SHIPPED GEOMETRY.
 *
 * `EmissiveLight.ts` needs a position and an emitting AREA to turn a radiance
 * into an irradiance, and both are properties of the asset rather than choices
 * a renderer gets to make. `build_smelter.py`'s own header states the design
 * target it authored the firebox to ("Fire seen through a peep hole and a
 * sight strip is 0.083 m2"), so measuring the .glb rather than transcribing
 * that number also means the two can be compared instead of trusted.
 *
 * In the TEMPLATE's own space: `normalize` has already applied each
 * primitive's world matrix, so this is the same space the instance matrix is
 * about to be applied to.
 */
export interface EmitterSource {
  x: number; y: number; z: number;
  /** Total triangle area, m2. Sets the POWER. */
  area: number;
  /**
   * The source's own SIZE, which is what the inverse square has to be softened
   * by, and it is NOT `sqrt(area / PI)`.
   *
   * That was the first version and the picture refused it. An on-axis
   * Lambertian disc of radius R gives `E = PI * L * R^2 / (R^2 + d^2)`, which
   * is exactly `L * A / (d^2 + R^2)`, so `R = sqrt(A / PI)` is right for a
   * source whose area is CONTIGUOUS AND ROUND. The smelter's is neither: it is
   * a 0.30 x 0.22 peep and a 0.86 x 0.05 sight strip a third of a metre apart
   * on the same door, so `sqrt(A / PI)` came out at 0.28 m while the thing is
   * nearly a metre across. The door casting sits 0.04 m from that plane, and
   * `1 / (0.0016 + 0.078)` blew it to lava in `RN2385_after_smelternight_lamp0`
   * before this was fixed.
   *
   * So the softening radius is the source's own SECOND MOMENT: the area
   * weighted RMS distance of the emitting surface from its centroid, times
   * sqrt(2), which is the factor that turns an RMS back into the radius of the
   * uniform disc with that moment. For a genuinely round contiguous patch the
   * two agree to the digit and this changes nothing; for a spread-out one it
   * reports what is actually there. `max` of the two, so a source can never be
   * softened by LESS than its own area implies.
   */
  radius: number;
  /** Reported so the two can be compared rather than trusted. */
  discRadius: number;
  rmsRadius: number;
}

/**
 * Area-weighted centroid and total area of one geometry's triangles. Area
 * weighted rather than vertex averaged, because a peep hole tessellated into
 * four triangles and a sight strip into two must not vote equally per vertex:
 * the centroid of the LIGHT is where the emitting surface is, not where the
 * mesh happens to be dense.
 */
export function measureEmitter(g: THREE.BufferGeometry): EmitterSource | null {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  const idx = g.getIndex();
  if (pos === undefined || idx === null) return null;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  let area = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i + 2 < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    ab.subVectors(b, a); ac.subVectors(c, a);
    const tri = n.crossVectors(ab, ac).length() * 0.5;
    if (!(tri > 0)) continue;
    area += tri;
    cx += tri * (a.x + b.x + c.x) / 3;
    cy += tri * (a.y + b.y + c.y) / 3;
    cz += tri * (a.z + b.z + c.z) / 3;
  }
  if (area <= 0) return null;
  const ox = cx / area, oy = cy / area, oz = cz / area;
  // Second pass for the second moment. Two passes rather than one, because the
  // centroid it is measured about is not known until the first one finishes.
  let m2 = 0;
  for (let i = 0; i + 2 < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    ab.subVectors(b, a); ac.subVectors(c, a);
    const tri = n.crossVectors(ab, ac).length() * 0.5;
    if (!(tri > 0)) continue;
    const dx = (a.x + b.x + c.x) / 3 - ox;
    const dy = (a.y + b.y + c.y) / 3 - oy;
    const dz = (a.z + b.z + c.z) / 3 - oz;
    m2 += tri * (dx * dx + dy * dy + dz * dz);
  }
  const disc = Math.sqrt(area / Math.PI);
  const rms = Math.sqrt(m2 / area) * Math.SQRT2;
  return { x: ox, y: oy, z: oz, area,
    radius: Math.max(disc, rms), discRadius: disc, rmsRadius: rms };
}

/** Merge a bucket, keeping the single-element case allocation free exactly as
 *  the pre-split code did. */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = list.length === 1 ? list[0] : (mergeGeometries(list, false) ?? list[0]);
  g.computeBoundingSphere();
  return g;
}

export function gatherTiers(def: MachineTemplate, scene: THREE.Object3D,
                            base: Family): FamilyTiers {
  scene.updateWorldMatrix(true, true);
  const byFamily = new Map<Family, (THREE.BufferGeometry | null)[]>();
  let lod0: THREE.BufferGeometry | null = null;
  const tiers = def.nodeMatch !== undefined ? 1 : LOD_MATCH.length;
  for (let t = 0; t < tiers; ++t) {
    const re = def.nodeMatch ?? LOD_MATCH[t];
    const per = new Map<Family, THREE.BufferGeometry[]>();
    const all: THREE.BufferGeometry[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || m.name.startsWith('col_')) return;
      if (!re.test(m.name)) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const g = normalize(m.geometry, m.matrixWorld,
        src.color ?? new THREE.Color(1, 1, 1), roleOf(src.name, def), src);
      const role = roleOfMaterialName(src.name);
      const authored = familyForRole(role);
      const fam = isTilingFamily(authored) ? authored : base;
      const bucket = per.get(fam);
      if (bucket === undefined) per.set(fam, [g]);
      else bucket.push(g);
      all.push(g);
    });
    if (all.length === 0) continue;
    for (const [fam, list] of per) {
      let arr = byFamily.get(fam);
      if (arr === undefined) { arr = [null, null, null]; byFamily.set(fam, arr); }
      arr[t] = mergeAll(list);
    }
    if (t === 0) lod0 = mergeAll(all);
  }
  // RN-2385. Off the MERGED tier-0 `ember` geometry, so a template whose fire
  // is authored as several primitives (the smelter's peep and sight strip are
  // two) gets one source at their common area-weighted centroid rather than
  // one emitter per primitive eating the light budget.
  const emberG = byFamily.get('ember')?.[0] ?? null;
  const emit = emberG === null ? null : measureEmitter(emberG);
  return { byFamily, lod0, emit };
}

/** Vertices and indices a ladder needs, which a `BatchedMesh` must know before
 *  it exists. Summed over every tier that will be resident, not just tier 0. */
export function tierSize(tiers: readonly (THREE.BufferGeometry | null)[]):
{ verts: number; idx: number } {
  let verts = 0, idx = 0;
  for (const g of tiers) {
    if (g === null) continue;
    verts += (g.getAttribute('position') as THREE.BufferAttribute).count;
    idx += g.getIndex()?.count ?? 0;
  }
  return { verts, idx };
}

/** Add every tier to `mesh` and MEASURE what each one costs in silhouette
 *  error. The measurement, not a picked constant, is what admits a tier to a
 *  cascade; `render/ShadowLod.ts` carries the derivation. */
export function addLadder(mesh: THREE.BatchedMesh, label: string,
                          tiers: readonly (THREE.BufferGeometry | null)[]): LodRow {
  const ids: number[] = [];
  const dev: number[] = [];
  const tris: number[] = [];
  const base = tiers[0];
  for (let t = 0; t < tiers.length; ++t) {
    const g = tiers[t];
    ids.push(g === null ? -1 : mesh.addGeometry(g));
    tris.push(g === null ? 0 : triCount(g));
    dev.push(g === null || base === null || base === undefined ? Infinity
      : t === 0 ? 0 : surfaceDeviation(base, g));
  }
  return { label, ids, dev, tris };
}

export function roleOf(matName: string, def: MachineTemplate): number {
  if (matName.endsWith('EmissiveState')) return ROLE_STATUS;
  if (def.flowMaterial !== undefined && matName.endsWith(def.flowMaterial)) {
    return def.arc === 'l' ? ROLE_ARC_L : def.arc === 'r' ? ROLE_ARC_R : ROLE_FLOW;
  }
  return ROLE_BODY;
}

/**
 * Bake colour and role per vertex so one material can draw every role.
 *
 * `mat` is the SOURCE material again, and passing it is what turns the per-part
 * roughness and metalness channel on for this primitive (RN-1200). It is a
 * separate argument rather than something derived from `tint` for `NodeBatch`'s
 * reason: `MachineMat` owns whether a consuming hook will be compiled, and a
 * bake with no consumer is a dead per-vertex buffer that no program binds.
 *
 * ALL OR NONE ACROSS THE WHOLE PATH, which this gets structurally: the gate is
 * one module-level constant, so every primitive `mergeGeometries` and
 * `addGeometry` see carries the same attribute set. That matters because
 * `mergeGeometries` returns null on a mismatch and `gatherTiers` swallows it
 * with `?? list[0]`, so a partial bake would not be a wrong material, it would
 * be most of a machine silently gone.
 */
export function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4,
                          tint: THREE.Color, role: number,
                          mat?: THREE.MeshStandardMaterial): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  copyUv(src, g, pos.count, 'machines');   // UNCONDITIONAL. See Surfaces.copyUv.
  const col = new Float32Array(pos.count * 3);
  const rol = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; ++i) {
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
    rol[i] = role;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRole', new THREE.BufferAttribute(rol, 1));
  // The channel the merge used to throw away, carried exactly the way the
  // colour three lines up is. The proof that per-vertex data survives this
  // merge and the BatchedMesh behind it was already sitting there.
  if (mat !== undefined) bakeMachineMat(g, pos.count, mat, roleOfMaterialName(mat.name));
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
