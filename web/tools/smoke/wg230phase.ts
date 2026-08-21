// WG-230. THE WORLD PHASE'S DETERMINISM DIGEST AND ITS PRECISION TABLE, and it
// is a separate tool for RN-2265's reason: a PNG cannot prove either claim.
// Three fresh-process captures of one build return bit-identical committed
// rectangles and three different PNG sha256s, so a field that must be equal
// across processes is digested directly instead of photographed.
//
// It digests `ChunkPhase.reduceAnchorPhase` -- the exact function
// `ChunkBatch.fillPhase` calls -- over the real quadtree anchor set at the
// `forestfloor` site: every chunk centre of every depth from 4 to 15, on the
// tangent lattice the streamer walks, so the digest covers the whole range of
// anchor magnitudes the attribute actually sees rather than one nice number.
//
//   cd web
//   npx esbuild tools/smoke/wg230phase.ts --bundle --platform=node \
//     --format=esm --outfile=tools/smoke/wg230phase.mjs
//   node tools/smoke/wg230phase.mjs   # repeat in fresh processes
//   rm tools/smoke/wg230phase.mjs
//
// IT ALSO CHECKS THE THING A DIGEST CANNOT: that the shader's float32
// reconstruction of `aPhase + position / P` lands on the true float64
// coordinate. Equal-across-processes and CORRECT are two claims and a digest
// only makes the first one.
import {
  PHASE_PERIOD_M, phaseQuantumM, phasePeriodDivides, reduceAnchorPhase,
} from '../../src/world/ChunkPhase.js';

const f32 = Math.fround;
const R = 6.0e5;
// forestfloor's committed pose (artframe.js SHOTS).
const lat = -19.85 * Math.PI / 180;
const lon = -72.7853 * Math.PI / 180;
const cl = Math.cos(lat);
const up = [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)];
const e = [-Math.sin(lon), 0, Math.cos(lon)];
const nn = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2],
  up[0] * e[1] - up[1] * e[0]];

/** Depth-0 cube-face edge in metres, from the shipped max-depth quad. */
const FINE_CHUNK_M = 28.93;
const MAX_DEPTH = 15;
const FACE_EDGE_M = FINE_CHUNK_M * 2 ** MAX_DEPTH;

/** Anchors: an 8x8 block of chunk centres at every depth 4..15. */
const anchors: Array<[number, number, number]> = [];
for (let d = 4; d <= MAX_DEPTH; ++d) {
  const edge = FACE_EDGE_M / 2 ** d;
  for (let j = 0; j < 8; ++j) {
    for (let i = 0; i < 8; ++i) {
      const u = (i - 3.5) * edge;
      const v = (j - 3.5) * edge;
      anchors.push([
        up[0] * R + e[0] * u + nn[0] * v,
        up[1] * R + e[1] * u + nn[1] * v,
        up[2] * R + e[2] * u + nn[2] * v,
      ]);
    }
  }
}

const packed = new Float32Array(anchors.length * 3);
for (let k = 0; k < anchors.length; ++k) {
  const [x, y, z] = anchors[k];
  const p = reduceAnchorPhase({ x, y, z });
  packed[k * 3] = p[0];
  packed[k * 3 + 1] = p[1];
  packed[k * 3 + 2] = p[2];
}

let h = 0x811c9dc5 >>> 0;
const bytes = new Uint8Array(packed.buffer);
for (let i = 0; i < bytes.length; ++i) {
  h = (h ^ bytes[i]) >>> 0;
  h = Math.imul(h, 0x01000193) >>> 0;
}

/**
 * THE RECONSTRUCTION CHECK. Every step is rounded to float32 exactly as the
 * GPU rounds it; a mirror keeping float64 intermediates would prove nothing.
 * `truth` is the same quantity in float64, reduced by the same whole number of
 * periods the chunk's own phase removed, so the two are comparable.
 */
function worstReconstructionM(localRadiusM: number): number {
  let worst = 0;
  for (const [x, y, z] of anchors) {
    const p = reduceAnchorPhase({ x, y, z });
    for (let s = -1; s <= 1; s += 2) {
      for (let a = 0; a < 3; ++a) {
        const anchorA = a === 0 ? x : a === 1 ? y : z;
        const r = s * localRadiusM;
        const got = f32(p[a] + f32(f32(r) / PHASE_PERIOD_M));
        const q = anchorA / PHASE_PERIOD_M;
        const truth = (q - Math.floor(q)) + r / PHASE_PERIOD_M;
        const err = Math.abs(got - truth) * PHASE_PERIOD_M;
        if (err > worst) worst = err;
      }
    }
  }
  return worst;
}

/**
 * `pM`'s quantum for the same fragment: a generic point on a 600 km sphere has
 * components near R/sqrt(3) = 346,410 m, which sits in [2^18, 2^19), so one
 * float32 ULP is 2^(18-23). WG-50 measured this and named 2^(19-23) as the
 * worst case rather than the typical one.
 */
const PM_QUANTUM_M = 2 ** (18 - 23);

/** Ground pixel footprint in metres at view distance d, 1280x720 at fov 60. */
const footM = (d: number): number => 3.56e-3 * (d / 2);

/** The resident quad edge at view distance d, from splitRatio 1.4. */
function residentEdgeM(d: number): number {
  let edge = FACE_EDGE_M;
  while (edge / d > 1.4 && edge > FINE_CHUNK_M) edge /= 2;
  return edge;
}

const BANDS = [2, 75, 600, 37947];
const table = BANDS.map((d) => {
  const edge = residentEdgeM(d);
  // Interior half-diagonal of the quad: the largest |position| a vertex holds.
  const rLocal = (edge / 2) * Math.SQRT2;
  const q = phaseQuantumM(rLocal);
  return {
    viewM: d,
    residentQuadEdgeM: Number(edge.toFixed(2)),
    localRadiusM: Number(rLocal.toFixed(1)),
    footprintM: Number(footM(d).toPrecision(4)),
    phaseQuantumM: Number(q.toPrecision(4)),
    pmQuantumM: PM_QUANTUM_M,
    improvement: Number((PM_QUANTUM_M / q).toPrecision(4)),
    phaseQuantaPerPixel: Number((footM(d) / q).toPrecision(4)),
    pmQuantaPerPixel: Number((footM(d) / PM_QUANTUM_M).toPrecision(4)),
    worstReconstructionM: Number(worstReconstructionM(rLocal).toPrecision(4)),
  };
});

console.log(JSON.stringify({
  tool: 'wg230phase',
  periodM: PHASE_PERIOD_M,
  anchors: anchors.length,
  digest: h.toString(16).padStart(8, '0'),
  // A digest of a field that is all zeros is also stable, so the spread is
  // published beside it: this must look like a uniform [0,1).
  min: Math.min(...packed),
  max: Math.max(...packed),
  mean: packed.reduce((a, b) => a + b, 0) / packed.length,
  // The seam rule, exercised on the two periods a far rung is likeliest to
  // want and on one that must be refused.
  divides: { 2: phasePeriodDivides(2), 8: phasePeriodDivides(8), 3: phasePeriodDivides(3) },
  bands: table,
}, null, 2));
