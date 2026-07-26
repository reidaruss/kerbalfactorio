// Agent-facing reads over the resident chunk set. Split out of TerrainStream so
// that class keeps only steady-state responsibilities and stays inside the
// 400-line cap (ARCHITECTURE.md 2.2 rule 1). Nothing here runs in the frame
// path except probeStakes, and that only while the jitter probe is armed.

import type * as THREE from 'three';
import type { ChunkView } from './ChunkView.js';

/** Index of the centre vertex of a 33x33 grid, in position-array elements. */
const CENTRE_ELEMENT = (33 * 16 + 16) * 3;
const NEAREST_SLOTS = 8;

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
  slots: (ChunkView | null)[], d2s: Float64Array,
): number {
  slots.fill(null);
  d2s.fill(Infinity);
  for (const v of views) {
    if (!v.isNear || !v.mesh.visible) continue;
    const d2 = v.mesh.position.distanceToSquared(cam);
    if (d2 >= d2s[NEAREST_SLOTS - 1]) continue;
    let i = NEAREST_SLOTS - 1;
    while (i > 0 && d2s[i - 1] > d2) { d2s[i] = d2s[i - 1]; slots[i] = slots[i - 1]; i--; }
    d2s[i] = d2; slots[i] = v;
  }
  let s = 0;
  for (let k = 0; k < NEAREST_SLOTS && s + 1 < maxStakes; ++k) {
    const v = slots[k];
    if (v === null) break;
    const arr = (v.mesh.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    for (const base of [0, CENTRE_ELEMENT]) {
      const o = s * 6;
      out[o] = v.mesh.position.x; out[o + 1] = v.mesh.position.y; out[o + 2] = v.mesh.position.z;
      out[o + 3] = arr[base]; out[o + 4] = arr[base + 1]; out[o + 5] = arr[base + 2];
      s++;
    }
  }
  return s;
}

/** window.__of.chunks(): live chunk state, for diagnosing placement by hand. */
export function dumpChunks(
  views: Iterable<ChunkView>, limit: number, nearOnly: boolean, nowSecs: number,
): unknown[] {
  const out: unknown[] = [];
  for (const v of views) {
    if (out.length >= limit) break;
    if (nearOnly && !v.isNear) continue;
    const attr = v.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let maxLocal = 0;
    for (let i = 0; i < arr.length; i += 3) {
      const r = arr[i] * arr[i] + arr[i + 1] * arr[i + 1] + arr[i + 2] * arr[i + 2];
      if (r > maxLocal) maxLocal = r;
    }
    out.push({
      key: v.key, depth: v.depth, near: v.isNear, biome: v.biome,
      parent: v.mesh.parent?.name ?? null,
      visible: v.mesh.visible,
      fadeAgeSecs: Math.round((nowSecs - v.fadeT0) * 1000) / 1000,
      material: (v.mesh.material as THREE.Material).name,
      meshPos: v.mesh.position.toArray().map((n) => Math.round(n)),
      scale: v.mesh.scale.x,
      distFromCamOriginM: Math.round(v.mesh.position.length() / (v.isNear ? 1 : 1e-5)),
      maxLocalM: Math.round(Math.sqrt(maxLocal)),
      bsRadius: Math.round(v.mesh.geometry.boundingSphere?.radius ?? -1),
      indexCount: v.mesh.geometry.getIndex()?.count ?? -1,
      v0: [arr[0], arr[1], arr[2]].map((n) => Math.round(n)),
    });
  }
  return out;
}
