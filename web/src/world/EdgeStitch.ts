// LOD T-junction removal by EDGE STITCHING (ARCHITECTURE.md 4.5 mechanism 2).
//
// Where a fine chunk abuts a coarser one, the coarse side draws a single
// straight segment across a span that the fine side subdivides. Every fine
// vertex strictly inside that span that does not sit on the coarse segment
// leaves a sliver of background showing: on flat ground it is subpixel, on a
// cliff it is the tall dark slit visible in docs/screenshots/W1_streaming.png.
//
// The fix is to snap those vertices onto the coarse segment. It is exact, not
// approximate, and it needs no extra data from /core:
//
//   * kGridDim is 33, so a chunk edge is vertices 0..32 of a shared lattice.
//   * A quad at depth d spans lattice [qx<<5, (qx+1)<<5] at level d+5, and its
//     depth d-1 neighbour spans the same ground at level d+4. Converting, the
//     coarse vertices land on the fine EVEN indices exactly (and on multiples
//     of 2^k when the neighbour is k levels coarser).
//   * cubed_sphere.h derives every vertex from its INTEGER lattice point, so a
//     shared lattice point is the same direction bits and the same height bits
//     on both sides. The coincident vertices are therefore bit-identical, and a
//     lerp between two of them lies exactly on the coarse triangle's edge.
//
// Vertices at multiples of the stride are never written, so stitching is safe
// in place and the two edges of a corner cannot fight over it.

const G = 33;

/** Strides per edge, in the neighbourDepth order [-X, +X, -Y, +Y]. 1 = no snap. */
export type EdgeStrides = [number, number, number, number];

export const NO_STITCH: EdgeStrides = [1, 1, 1, 1];

export function stridesEqual(a: EdgeStrides, b: EdgeStrides): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function anyStitch(s: EdgeStrides): boolean {
  return s[0] > 1 || s[1] > 1 || s[2] > 1 || s[3] > 1;
}

/** Vertex index of position `m` (0..32) along edge `e`. */
function vertexOn(e: number, m: number): number {
  if (e === 0) return m * G;                 // -X: i = 0,  j = m
  if (e === 1) return m * G + (G - 1);       // +X: i = 32, j = m
  if (e === 2) return m;                     // -Y: j = 0,  i = m
  return (G - 1) * G + m;                    // +Y: j = 32, i = m
}

/**
 * Snap the T-junction vertices of every coarser edge onto the coarse segment.
 * `position` and `height` are the pooled attribute arrays and are written in
 * place. Normals are deliberately left alone: cubed_sphere.h already sets edge
 * normals to the radial direction on BOTH sides, so they already agree.
 */
export function stitchEdges(
  position: Float32Array, height: Float32Array, strides: EdgeStrides,
): number {
  let moved = 0;
  for (let e = 0; e < 4; ++e) {
    const stride = strides[e];
    if (stride <= 1) continue;
    for (let m = 1; m < G - 1; ++m) {
      const r = m % stride;
      if (r === 0) continue;
      const lo = m - r;
      const hi = lo + stride;
      const t = r / stride;
      const a = vertexOn(e, lo) * 3;
      const b = vertexOn(e, hi) * 3;
      const c = vertexOn(e, m) * 3;
      position[c] = position[a] + (position[b] - position[a]) * t;
      position[c + 1] = position[a + 1] + (position[b + 1] - position[a + 1]) * t;
      position[c + 2] = position[a + 2] + (position[b + 2] - position[a + 2]) * t;
      const ha = vertexOn(e, lo), hb = vertexOn(e, hi), hc = vertexOn(e, m);
      height[hc] = height[ha] + (height[hb] - height[ha]) * t;
      moved++;
    }
  }
  return moved;
}

/**
 * How much coarser the resident neighbour across edge `e` is, as a stride.
 *
 * `isVisible` must report FALSE for a chunk hidden because its four children
 * cover it, or the depth-2 shells that TerrainStreamer keeps resident for the
 * whole body would be found as everyone's neighbour and the whole planet would
 * snap to a 7 km grid.
 *
 * A balanced quadtree differs by at most one level, so the search stops at two.
 */
export function neighbourStrides(
  faceId: number, depth: number, qx: number, qy: number,
  isVisible: (key: string) => boolean,
  maxLevelsCoarser = 2,
): EdgeStrides {
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];
  const span = 2 ** depth;
  const out: EdgeStrides = [1, 1, 1, 1];
  for (let e = 0; e < 4; ++e) {
    const nx = qx + dx[e];
    const ny = qy + dy[e];
    // Off-face neighbours share no lattice, so there is nothing to snap onto.
    if (nx < 0 || ny < 0 || nx >= span || ny >= span) continue;
    for (let k = 0; k <= maxLevelsCoarser && depth - k >= 0; ++k) {
      if (isVisible(`${faceId}:${depth - k}:${nx >> k}:${ny >> k}`)) {
        out[e] = 1 << k;
        break;
      }
    }
  }
  return out;
}
