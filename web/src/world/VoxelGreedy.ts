// Greedy meshing of of::worldgen::exposedFaces into rectangles.
//
// exposedFaces emits ONE quad per exposed unit face. A 20 m tunnel wall is 400
// of them; drawn one for one that is 800 triangles for a flat rectangle. The
// greedy pass merges coplanar faces into maximal rectangles, which is the whole
// reason this module exists, and it does it per (axis, sign, slice) plane so the
// output is still exact: every merged rectangle covers exactly the faces it
// replaces, never a face that was not emitted.
//
// Positions come out in metres RELATIVE TO an anchor cell (standing rule 6), so
// the caller can place the mesh from a 64-bit anchor and keep f32 vertices small.
// Nothing here samples terrain: the face list IS the surface authority's answer.

/** Faces as /core hands them over: 5 i32 per face, [cx,cy,cz,axis,sign]. */
export interface FaceList {
  readonly i32: Int32Array;
  readonly count: number;
}

export interface GreedyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Rectangles emitted; `faces / quads` is the merge ratio worth reporting. */
  quads: number;
  faces: number;
}

const EMPTY: GreedyMesh = {
  positions: new Float32Array(0), normals: new Float32Array(0),
  indices: new Uint32Array(0), quads: 0, faces: 0,
};

/** The two axes spanning the plane perpendicular to `axis`, in a fixed order. */
function planeAxes(axis: number): [number, number] {
  return axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
}

/**
 * Merge `faces` into rectangles and emit triangles. `anchor` is the cell whose
 * MINIMUM corner becomes local (0,0,0); `cellM` is the voxel edge in metres.
 */
export function greedyMesh(
  faces: FaceList, anchor: [number, number, number], cellM: number,
): GreedyMesh {
  if (faces.count <= 0) return EMPTY;

  // Bucket by (axis, sign, slice index). The slice is the face's coordinate
  // along `axis`, so every face in a bucket is genuinely coplanar. The bucket
  // CARRIES its axis/sign/slice: recovering them from the key by rescanning the
  // face list would make this O(faces * planes).
  interface Plane {
    axis: number; sign: number; slice: number;
    rows: Map<number, Set<number>>;
  }
  const buckets = new Map<string, Plane>();
  const c = [0, 0, 0];
  for (let f = 0; f < faces.count; ++f) {
    const o = f * 5;
    c[0] = faces.i32[o]; c[1] = faces.i32[o + 1]; c[2] = faces.i32[o + 2];
    const axis = faces.i32[o + 3];
    const sign = faces.i32[o + 4];
    const slice = c[axis];
    const key = `${axis}:${sign}:${slice}`;
    let plane = buckets.get(key);
    if (plane === undefined) {
      plane = { axis, sign, slice, rows: new Map() };
      buckets.set(key, plane);
    }
    const [au, av] = planeAxes(axis);
    let row = plane.rows.get(c[au]);
    if (row === undefined) { row = new Set(); plane.rows.set(c[au], row); }
    row.add(c[av]);
  }

  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  let quads = 0;

  for (const { axis, sign, slice, rows } of buckets.values()) {
    // Greedy over the plane: for each unconsumed (u,v), grow along v, then grow
    // the whole run along u while every row still covers it.
    for (const u of [...rows.keys()].sort((a, b) => a - b)) {
      const row = rows.get(u);
      if (row === undefined) continue;
      for (const v0 of [...row].sort((a, b) => a - b)) {
        if (!row.has(v0)) continue;     // consumed by an earlier rectangle
        let v1 = v0;
        while (row.has(v1 + 1)) v1++;
        let u1 = u;
        for (;;) {
          const next = rows.get(u1 + 1);
          if (next === undefined) break;
          let ok = true;
          for (let v = v0; v <= v1 && ok; ++v) if (!next.has(v)) ok = false;
          if (!ok) break;
          u1++;
        }
        for (let uu = u; uu <= u1; ++uu) {
          const r = rows.get(uu);
          if (r === undefined) continue;
          for (let v = v0; v <= v1; ++v) r.delete(v);
        }
        emitRect(pos, nrm, idx, axis, sign, slice, u, u1, v0, v1, anchor, cellM);
        quads++;
      }
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    indices: new Uint32Array(idx),
    quads,
    faces: faces.count,
  };
}

/** One merged rectangle: 4 verts, 2 triangles, wound to face `sign`. */
function emitRect(
  pos: number[], nrm: number[], idx: number[],
  axis: number, sign: number, slice: number,
  u0: number, u1: number, v0: number, v1: number,
  anchor: [number, number, number], cellM: number,
): void {
  const [au, av] = planeAxes(axis);
  // The face plane: the cell's low corner plus one cell when the face is +.
  const w = (slice + (sign > 0 ? 1 : 0) - anchor[axis]) * cellM;
  const a0 = (u0 - anchor[au]) * cellM;
  const a1 = (u1 + 1 - anchor[au]) * cellM;
  const b0 = (v0 - anchor[av]) * cellM;
  const b1 = (v1 + 1 - anchor[av]) * cellM;

  const base = pos.length / 3;
  const put = (a: number, b: number): void => {
    const p = [0, 0, 0];
    p[axis] = w; p[au] = a; p[av] = b;
    pos.push(p[0], p[1], p[2]);
    const n = [0, 0, 0];
    n[axis] = sign;
    nrm.push(n[0], n[1], n[2]);
  };
  put(a0, b0); put(a1, b0); put(a1, b1); put(a0, b1);
  // planeAxes gives a right-handed (axis, au, av) triple, so a + face is CCW in
  // (au, av) and a - face is the reverse. Getting this backwards makes a tunnel
  // whose walls are invisible from inside, which is the one view that matters.
  if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
