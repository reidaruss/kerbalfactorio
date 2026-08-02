// The geometric half of `ShadowLod.ts`: how far a cruder tier's surface sits
// from the one the eye is drawn, in metres, measured off the very geometries the
// batch is about to hand the GPU. Split from `ShadowLod.ts` because that file
// crossed the 400-line cap and this is the seam that was already there: nothing
// here knows what a cascade is, and nothing in `ShadowLod.ts` touches a vertex.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// THE MEASUREMENT.
// ---------------------------------------------------------------------------

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision
 *  Detection section 5.1.5), written out rather than vectorised because it runs
 *  a few million times at load and allocating three Vector3s per call is the
 *  only way to make that slow. */
function pointTri2(px: number, py: number, pz: number, t: Float32Array, o: number): number {
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const abx = t[o + 3] - ax, aby = t[o + 4] - ay, abz = t[o + 5] - az;
  const acx = t[o + 6] - ax, acy = t[o + 7] - ay, acz = t[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let cx: number, cy: number, cz: number;
  if (d1 <= 0 && d2 <= 0) { cx = ax; cy = ay; cz = az; } else {
    const bpx = px - (ax + abx), bpy = py - (ay + aby), bpz = pz - (az + abz);
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - (ax + acx), cpy = py - (ay + acy), cpz = pz - (az + acz);
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { cx = ax + abx; cy = ay + aby; cz = az + abz; }
    else if (d6 >= 0 && d5 <= d6) { cx = ax + acx; cy = ay + acy; cz = az + acz; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      cx = ax + abx * v; cy = ay + aby * v; cz = az + abz * v;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      cx = ax + acx * w; cy = ay + acy * w; cz = az + acz * w;
    } else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      cx = ax + abx + (acx - abx) * w;
      cy = ay + aby + (acy - aby) * w;
      cz = az + abz + (acz - abz) * w;
    } else {
      const den = 1 / (va + vb + vc);
      const v = vb * den, w = vc * den;
      cx = ax + abx * v + acx * w; cy = ay + aby * v + acy * w; cz = az + abz * v + acz * w;
    }
  }
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  return dx * dx + dy * dy + dz * dz;
}

let devMs = 0;
let devCalls = 0;

/** Load-time cost of the whole measurement, so it is a published number rather
 *  than a hidden boot regression. */
export function measureStats(): { calls: number; ms: number } {
  return { calls: devCalls, ms: Math.round(devMs * 100) / 100 };
}

/**
 * The maximum distance any point of `base`'s surface sits from `tier`'s, in
 * metres. Both geometries must already be in the frame they will be DRAWN in
 * (world-baked and merged), because that is the frame the shadow map samples.
 *
 * ONE-SIDED, base -> tier, and that is the conservative direction. It measures
 * what the tier REMOVED, which is failure modes 1 to 3 above: a deleted bolt
 * head, a lifted footing, a vanished crossarm all report their own full size.
 * The reverse direction would measure geometry a tier ADDED, which a decimation
 * cannot do; `tris` is carried on the row so a non-monotone ladder is visible in
 * the report rather than silently trusted.
 *
 * Sampled at LOD0's vertices rather than over its faces. A decimator moves
 * vertices, so a removed feature's extremum is a vertex; a face interior can
 * only deviate less than its own corners once the corners are inside the bound.
 */
export function surfaceDeviation(base: THREE.BufferGeometry,
                                 tier: THREE.BufferGeometry): number {
  const t0 = performance.now();
  const bp = base.getAttribute('position') as THREE.BufferAttribute | undefined;
  const tp = tier.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (bp === undefined || tp === undefined) return Infinity;
  const ti = tier.getIndex();
  const nTri = (ti === null ? tp.count : ti.count) / 3;
  if (nTri < 1) return Infinity;
  // Triangles flat, plus a per-triangle AABB, so the inner loop rejects on six
  // compares before it does any arithmetic. Without it this is minutes.
  const tri = new Float32Array(nTri * 9);
  const box = new Float32Array(nTri * 6);
  const src = tp.array as ArrayLike<number>;
  for (let f = 0; f < nTri; ++f) {
    for (let k = 0; k < 3; ++k) {
      const v = (ti === null ? f * 3 + k : ti.getX(f * 3 + k)) * 3;
      tri[f * 9 + k * 3] = src[v];
      tri[f * 9 + k * 3 + 1] = src[v + 1];
      tri[f * 9 + k * 3 + 2] = src[v + 2];
    }
    for (let a = 0; a < 3; ++a) {
      const x = tri[f * 9 + a], y = tri[f * 9 + 3 + a], z = tri[f * 9 + 6 + a];
      box[f * 6 + a] = Math.min(x, y, z);
      box[f * 6 + 3 + a] = Math.max(x, y, z);
    }
  }
  const bsrc = bp.array as ArrayLike<number>;
  let worst = 0;
  for (let i = 0; i < bp.count; ++i) {
    const px = bsrc[i * 3], py = bsrc[i * 3 + 1], pz = bsrc[i * 3 + 2];
    let best = Infinity;
    for (let f = 0; f < nTri; ++f) {
      const o = f * 6;
      const ex = px < box[o] ? box[o] - px : px > box[o + 3] ? px - box[o + 3] : 0;
      const ey = py < box[o + 1] ? box[o + 1] - py : py > box[o + 4] ? py - box[o + 4] : 0;
      const ez = pz < box[o + 2] ? box[o + 2] - pz : pz > box[o + 5] ? pz - box[o + 5] : 0;
      if (ex * ex + ey * ey + ez * ez >= best) continue;
      const d = pointTri2(px, py, pz, tri, f * 9);
      if (d < best) best = d;
    }
    if (best > worst) worst = best;
  }
  devMs += performance.now() - t0;
  devCalls++;
  return Math.sqrt(worst);
}

/** Triangles in a geometry, for the ladder's monotonicity column. */
export function triCount(g: THREE.BufferGeometry): number {
  const idx = g.getIndex();
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  return Math.floor((idx !== null ? idx.count : (pos?.count ?? 0)) / 3);
}
