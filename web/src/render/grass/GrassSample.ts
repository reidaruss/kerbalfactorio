// ONE CHUNK, ONE RUNG, ONE PACKED INSTANCE SET. RN-2145.
//
// It samples the chunk's OWN vertex buffer, exactly as ScatterSample does and
// for the reason Scatter.ts states in its header: a blade placed by bilinear
// interpolation inside one grid cell of the mesh THAT IS ON SCREEN cannot float
// above the ground or sink into it, in the same structural way the walker
// cannot disagree with the mesh. It is also free, because the positions, the
// normals, the relief and the biome are already in memory.
//
// DETERMINISM. Every number here is `frac(hash32(cellSeed, k * 8 + n))` where
// `cellSeed` is derived from the chunk KEY STRING, so the same seed grows the
// same carpet, a chunk that streams out and back in is byte-identical, and a
// golden screenshot reproduces. The cell mix is 0x1b873593 and NOT Scatter's
// 0x27d4eb2f, deliberately: sharing the mix would put every blade at the same
// (u, w) a prop already occupies and the carpet would grow in rows through the
// scatter's own lattice.

import * as THREE from 'three';
import type { ChunkView } from '../../world/ChunkView.js';
import type { ChunkGeometryPool } from '../geometry/ChunkGeometryPool.js';
import type { WaterOracle } from '../../world/WaterOracle.js';
import {
  CELLS, DIM, MAX_CELL_M, WET_REJECT_M, hash32, keyHash, frac,
} from '../../world/ScatterTuning.js';
import { biomeColorArray, terrainAlbedo } from '../materials/BiomePalette.js';
import { coverAlbedo, coverOf } from './GrassPalette.js';
import { BUILD_LEAD, MIN_SLOPE_COS } from './GrassTuning.js';

/** Per cell, per rung. Bounds a pathological cell rather than an intended one:
 *  the near rung asks for 46 at the eye, so 96 is headroom and not a target,
 *  and `capped` counts every time it binds. */
const MAX_PER_CELL = 96;

export interface GrassSampleDeps {
  readonly pool: ChunkGeometryPool;
  readonly water: WaterOracle | null;
  readonly editsHandle: () => number;
  /** The live eye vector the driver copies into, not a snapshot. */
  readonly eye: THREE.Vector3;
  readonly maxReliefM: number;
}

export interface RungSpec {
  readonly salt: number;
  /** Cells further than this from the eye grow nothing for this rung. */
  readonly reachM: number;
  readonly widthM: number;
  readonly heightM: number;
  /** Instances per m2 at a range, BEFORE the biome's cover multiplier. Must be
   *  the same curve the shader evaluates, or supply and demand disagree and the
   *  carpet either thins or wastes. */
  readonly densityAt: (d: number) => number;
}

export interface Sampled {
  n: number;
  local: Float32Array;
  param: Float32Array;
  col: Uint8Array;
  /** Cells that grew something, and their total ground area in m2. The
   *  denominator `placedPerM2` is published over. */
  cells: number;
  areaM2: number;
  /** What the density curve ASKED for, so delivered/asked is a real ratio and
   *  not a count beside a plausible total. */
  wanted: number;
  capped: number;
}

const EMPTY: Sampled = {
  n: 0, local: new Float32Array(0), param: new Float32Array(0),
  col: new Uint8Array(0), cells: 0, areaM2: 0, wanted: 0, capped: 0,
};

const PALETTE = biomeColorArray();
const SUB = new THREE.Color();
const COV = new THREE.Color();

/** Linear to sRGB, the 8-bit encode. Kept local rather than routed through
 *  THREE.Color.getHex so the three channels are written without an allocation
 *  and without a hex round trip, on a path that runs tens of thousands of
 *  times per chunk. */
function enc(x: number): number {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

function bilerp(
  a: Float32Array, i00: number, i10: number, i01: number, i11: number,
  c: number, u: number, w: number,
): number {
  const top = a[i00 + c] + (a[i10 + c] - a[i00 + c]) * u;
  const bot = a[i01 + c] + (a[i11 + c] - a[i01 + c]) * u;
  return top + (bot - top) * w;
}

export function sampleGrass(
  d: GrassSampleDeps, v: ChunkView, rung: RungSpec,
): Sampled {
  const cover = coverOf(v.biome);
  if (!(cover.k > 0)) return EMPTY;
  const pos = d.pool.positions(v.pooled);
  const cell = Math.hypot(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]);
  if (!(cell > 0) || cell > MAX_CELL_M) return EMPTY;
  const nrm = d.pool.batch(v.pooled).normals(v.pooled.slot);
  const hgt = d.pool.heights(v.pooled);
  const keyBase = keyHash(v.key);
  const a = v.anchor;
  const ar = Math.hypot(a.x, a.y, a.z) || 1;
  const upx = a.x / ar, upy = a.y / ar, upz = a.z / ar;
  const biomeCol = PALETTE[v.biome] ?? PALETTE[0];
  const cellArea = cell * cell;
  const reach2 = (rung.reachM + cell) * (rung.reachM + cell);

  // THE WATER GATE, hoisted per chunk exactly as ScatterSample hoists it, and
  // MIND THE SENSE: `wetR` zero means the body is dry and the whole test is one
  // comparison. A dry planet is bit-for-bit what it was before this existed.
  let wetR = d.water !== null && d.water.hasWater ? d.water.levelRadius() : 0;
  const disc = d.water?.disc ?? null;
  if (wetR > 0 && disc !== null) {
    const dot = (a.x * disc.dirX + a.y * disc.dirY + a.z * disc.dirZ) / ar;
    const arcM = Math.acos(Math.max(-1, Math.min(1, dot))) * ar;
    if (arcM > disc.basinRadiusM + cell * CELLS * 1.5) wetR = 0;
  }
  const edits = wetR > 0 ? d.editsHandle() : 0;

  // Sized from the curve at the closest a cell in this chunk can be, plus the
  // cell count, then trimmed to `n` on the way out. Over-allocating a scratch
  // is cheaper than growing one inside the loop.
  const est = Math.min(CELLS * CELLS * MAX_PER_CELL,
    Math.ceil(rung.densityAt(0) * cover.k * cellArea) * CELLS * CELLS);
  const local = new Float32Array(est * 3);
  const param = new Float32Array(est * 4);
  const col = new Uint8Array(est * 4);
  let n = 0, cells = 0, capped = 0;
  let wanted = 0;

  for (let cy = 0; cy < CELLS; ++cy) {
    for (let cx = 0; cx < CELLS; ++cx) {
      const i00 = (cy * DIM + cx) * 3;
      const dx = v.pos.x + pos[i00] - d.eye.x;
      const dy = v.pos.y + pos[i00 + 1] - d.eye.y;
      const dz = v.pos.z + pos[i00 + 2] - d.eye.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach2) continue;
      const nx = nrm[i00] / 127, ny = nrm[i00 + 1] / 127, nz = nrm[i00 + 2] / 127;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const slopeCos = (nx * upx + ny * upy + nz * upz) / nl;
      if (slopeCos < MIN_SLOPE_COS) continue;
      if (wetR > 0) {
        const wx = a.x + pos[i00], wy = a.y + pos[i00 + 1], wz = a.z + pos[i00 + 2];
        const wl = Math.hypot(wx, wy, wz);
        // NORMALIZED: depthAt takes a DIRECTION and not a point (RN-46's bug).
        if (wl < wetR
          && d.water!.depthAt(wx / wl, wy / wl, wz / wl, edits) > WET_REJECT_M) {
          continue;
        }
      }

      // THE BUILD DENSITY LEADS THE LIVE ONE (GrassTuning.BUILD_LEAD), so a
      // cell has supply for the whole band it was built in and the shader's
      // demand never exceeds it. That is what turns a rebuild into a change of
      // what EXISTS rather than a change of what is SEEN.
      const dist = Math.sqrt(d2);
      const want = rung.densityAt(dist * BUILD_LEAD) * cover.k;
      let per = Math.ceil(want * cellArea);
      if (per <= 0) continue;
      if (per > MAX_PER_CELL) { per = MAX_PER_CELL; capped++; }
      wanted += want * cellArea;

      // The ground's own albedo here, by the same rule the terrain fragment
      // draws it with (BiomePalette.terrainAlbedo is the acknowledged CPU twin
      // of those four lines), then rotated toward cover green at constant
      // luminance. THIS IS THE HARD REQUIREMENT: the colour is the ground's.
      const band = hgt[cy * DIM + cx] / (d.maxReliefM || 1);
      terrainAlbedo(biomeCol, Math.max(0, Math.min(1, slopeCos)), band, SUB);
      coverAlbedo(SUB, v.biome, COV);
      const cr = enc(COV.r), cg = enc(COV.g), cb = enc(COV.b);

      const i10 = i00 + 3, i01 = i00 + DIM * 3, i11 = i01 + 3;
      const seed = (keyBase ^ Math.imul(cy * CELLS + cx, 0x1b873593)
        ^ rung.salt) >>> 0;
      cells++;
      for (let k = 0; k < per && n < est; ++k) {
        const u = frac(hash32(seed, k * 8));
        const w = frac(hash32(seed, k * 8 + 1));
        const yaw = frac(hash32(seed, k * 8 + 2)) * Math.PI * 2;
        const j0 = frac(hash32(seed, k * 8 + 3));
        const j1 = frac(hash32(seed, k * 8 + 4));
        local[n * 3] = bilerp(pos, i00, i10, i01, i11, 0, u, w);
        local[n * 3 + 1] = bilerp(pos, i00, i10, i01, i11, 1, u, w);
        local[n * 3 + 2] = bilerp(pos, i00, i10, i01, i11, 2, u, w);
        param[n * 4] = yaw;
        param[n * 4 + 1] = rung.widthM * (0.82 + 0.36 * j1);
        param[n * 4 + 2] = rung.heightM * cover.h * (0.72 + 0.56 * j0);
        // THE DEMAND THRESHOLD, in the same instances-per-m2 the shader
        // computes, with the biome's cover multiplier divided back out so the
        // shader does not need to know the biome. Instance k appears once the
        // live density has reached (k+1) instances over this cell's own area.
        param[n * 4 + 3] = (k + 1) / (cellArea * cover.k);
        col[n * 4] = cr; col[n * 4 + 1] = cg; col[n * 4 + 2] = cb;
        col[n * 4 + 3] = Math.round(j0 * 255);
        ++n;
      }
    }
  }
  return {
    // `local` is SLICED and not subarrayed: the pool retains it for the rebase
    // path, and a subarray would pin the whole over-allocated scratch for as
    // long as the chunk is resident. `param` and `col` are copied into the pool
    // on the next line of the caller, so a view is enough for them.
    n, local: local.slice(0, n * 3), param: param.subarray(0, n * 4),
    col: col.subarray(0, n * 4), cells, areaM2: cells * cellArea, wanted, capped,
  };
}
