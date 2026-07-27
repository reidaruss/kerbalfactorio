// Agent-facing reads over the resident chunk set. Split out of TerrainStream so
// that class keeps only steady-state responsibilities and stays inside the
// 400-line cap (ARCHITECTURE.md 2.2 rule 1). Nothing here runs in the frame
// path except probeStakes, and that only while the jitter probe is armed.

import type * as THREE from 'three';
import type { ChunkView } from './ChunkView.js';
import type { ChunkGeometryPool } from '../render/geometry/ChunkGeometryPool.js';

/** Index of the centre vertex of a 33x33 grid, in position-array elements. */
const CENTRE_ELEMENT = (33 * 16 + 16) * 3;
/** Its right-hand neighbour in the same row: the DW-19 ground-resolution ruler. */
const CENTRE_NEXT_ELEMENT = (33 * 16 + 17) * 3;
const NEAREST_SLOTS = 8;

/**
 * DW-19: the ACHIEVED ground cell size of a chunk, measured off the packed
 * vertices rather than derived from the depth. `R * (pi/2) / 2^d / 32` is what
 * the quadtree intends; this is what arrived in the buffer, in chunk-local
 * metres, so a wrong depth or a wrong warp shows up here. Pool vertices are
 * always chunk-local METRES (the far scene applies FAR_SCALE on the instance
 * matrix, not to the buffer), so this needs no scale correction.
 */
function measuredCellM(arr: Float32Array): number {
  const dx = arr[CENTRE_NEXT_ELEMENT] - arr[CENTRE_ELEMENT];
  const dy = arr[CENTRE_NEXT_ELEMENT + 1] - arr[CENTRE_ELEMENT + 1];
  const dz = arr[CENTRE_NEXT_ELEMENT + 2] - arr[CENTRE_ELEMENT + 2];
  return Math.hypot(dx, dy, dz);
}

/**
 * Fill JitterProbe stake rows from the chunks nearest the CAMERA:
 * [anchor xyz (engine metres), local xyz (the f32 vertex offset)] per stake.
 * Two stakes per chunk, the corner vertex and the centre vertex, because the
 * quantization the GPU sees depends on BOTH the camera-to-anchor distance and
 * the vertex's own offset from that anchor.
 *
 * Distance is measured from the camera, not from the engine origin: three
 * composes modelViewMatrix in f64 and only downcasts the camera-relative
 * result, so selecting by origin distance would silently measure a different
 * thing at every rebase threshold.
 */
export function probeStakes(
  views: Iterable<ChunkView>, out: Float64Array, maxStakes: number, cam: THREE.Vector3,
  slots: (ChunkView | null)[], d2s: Float64Array, pool: ChunkGeometryPool,
): number {
  slots.fill(null);
  d2s.fill(Infinity);
  for (const v of views) {
    if (!v.isNear || !v.visible) continue;
    const d2 = v.pos.distanceToSquared(cam);
    if (d2 >= d2s[NEAREST_SLOTS - 1]) continue;
    let i = NEAREST_SLOTS - 1;
    while (i > 0 && d2s[i - 1] > d2) { d2s[i] = d2s[i - 1]; slots[i] = slots[i - 1]; i--; }
    d2s[i] = d2; slots[i] = v;
  }
  let s = 0;
  for (let k = 0; k < NEAREST_SLOTS && s + 1 < maxStakes; ++k) {
    const v = slots[k];
    if (v === null) break;
    const arr = pool.positions(v.pooled);
    for (const base of [0, CENTRE_ELEMENT]) {
      const o = s * 6;
      out[o] = v.pos.x; out[o + 1] = v.pos.y; out[o + 2] = v.pos.z;
      out[o + 3] = arr[base]; out[o + 4] = arr[base + 1]; out[o + 5] = arr[base + 2];
      s++;
    }
  }
  return s;
}

/** One DRAWN terrain vertex near a query centre. Heights are relief metres. */
export interface MeshVertexSample {
  /** Body-frame offset from the query centre, metres. The caller builds its own
   *  tangent basis from it: two vertices the same distance OUT from a centre can
   *  be a disc apart, so a radial distance alone cannot measure a step. */
  dx: number; dy: number; dz: number;
  /** Tangential metres from the query centre. */
  dM: number;
  /** |anchor + vertex| − bodyRadiusM: the height the player is looking at. */
  hM: number;
  depth: number;
}

/**
 * The vertices of the DRAWN near terrain within `radiusM` of a body-frame
 * centre, as (tangential distance, relief height) pairs.
 *
 * This exists because every levelling assertion this project has made reads the
 * surface ORACLE, and a player does not stand on the oracle, they look at the
 * mesh. The two agreeing is the whole of standing rule 1 and it was never once
 * measured on the terraforming path. Heights come from the pooled vertex buffer
 * that the GPU is drawing this frame, so nothing here can be right while the
 * picture is wrong.
 *
 * Skirt vertices share a direction with their edge vertex and hang below it, so
 * they appear in this list as a second, lower sample at nearly the same `dM`.
 * Callers that want the top surface take the max height per bucket; callers
 * measuring holes want them both, which is why they are not filtered here.
 */
export function meshVertsNear(
  views: Iterable<ChunkView>, pool: ChunkGeometryPool,
  cx: number, cy: number, cz: number, radiusM: number, bodyRadiusM: number,
  limit = 6000,
): MeshVertexSample[] {
  const cr = Math.hypot(cx, cy, cz) || 1;
  const ux = cx / cr, uy = cy / cr, uz = cz / cr;
  const out: MeshVertexSample[] = [];
  for (const v of views) {
    if (!v.isNear || !v.visible) continue;
    // Cheap reject: the chunk's own bounding sphere against the query disc,
    // measured on the 64-bit anchor so a rebase cannot move it.
    const ax = v.anchor.x - cx, ay = v.anchor.y - cy, az = v.anchor.z - cz;
    const reach = v.chunkRadiusM + radiusM + 4;
    if (ax * ax + ay * ay + az * az > reach * reach) continue;
    const arr = pool.positions(v.pooled);
    for (let i = 0; i < arr.length; i += 3) {
      const px = v.anchor.x + arr[i];
      const py = v.anchor.y + arr[i + 1];
      const pz = v.anchor.z + arr[i + 2];
      const r = Math.hypot(px, py, pz);
      if (r === 0) continue;
      // Tangential offset from the query axis: |p| sin(theta), which at these
      // scales is the ground distance a player would pace out.
      const along = px * ux + py * uy + pz * uz;
      const t2 = r * r - along * along;
      const d = t2 <= 0 ? 0 : Math.sqrt(t2);
      if (d > radiusM) continue;
      out.push({ dx: px - cx, dy: py - cy, dz: pz - cz,
        dM: d, hM: r - bodyRadiusM, depth: v.depth });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** window.__of.chunks(): live chunk state, for diagnosing placement by hand. */
export function dumpChunks(
  views: Iterable<ChunkView>, limit: number, nearOnly: boolean, nowSecs: number,
  pool: ChunkGeometryPool,
): unknown[] {
  const out: unknown[] = [];
  for (const v of views) {
    if (out.length >= limit) break;
    if (nearOnly && !v.isNear) continue;
    const arr = pool.positions(v.pooled);
    let maxLocal = 0;
    for (let i = 0; i < arr.length; i += 3) {
      const r = arr[i] * arr[i] + arr[i + 1] * arr[i + 1] + arr[i + 2] * arr[i + 2];
      if (r > maxLocal) maxLocal = r;
    }
    const batch = pool.batch(v.pooled);
    out.push({
      key: v.key, depth: v.depth, near: v.isNear, biome: v.biome,
      batch: batch.name,
      slot: v.pooled.slot,
      visible: v.visible,
      fadeAgeSecs: Math.round((nowSecs - v.fadeT0) * 1000) / 1000,
      material: (batch.material as THREE.Material).name,
      meshPos: v.pos.toArray().map((n) => Math.round(n)),
      scale: v.scale,
      distFromCamOriginM: Math.round(v.pos.length() / (v.isNear ? 1 : 1e-5)),
      cellM: Math.round(measuredCellM(arr) * 1000) / 1000,
      maxLocalM: Math.round(Math.sqrt(maxLocal)),
      bsRadius: Math.round(batch.boundingRadius(v.pooled.slot)),
      indexCount: batch.drawCount(v.pooled.slot),
      v0: [arr[0], arr[1], arr[2]].map((n) => Math.round(n)),
    });
  }
  return out;
}
