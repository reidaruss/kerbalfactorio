// =============================================================================
// diag.mjs — determinism DIAGNOSTIC, not a test.
//
// Runs when parity.mjs reports a divergence. It separates the only two things
// that can differ between the native g++ build and the WASM build:
//   (a) libm  — sin/cos/asin/atan2/... are NOT bit-specified by IEEE-754, so
//               mingw-w64's libm and emscripten's musl libm may differ by 1 ULP.
//   (b) codegen — the compiler reassociating or contracting float arithmetic.
//
// It probes each libm function directly, then walks a real 33x33 terrain quad
// stage by stage (dir -> latitude -> temperature/moisture -> raw height ->
// biome -> designed height) and reports, per stage, how many of the 1089
// vertices differ. The first stage that differs is the root cause; everything
// downstream of it is fallout.
//
//   node web/wasm/test/diag.mjs
// (requires web/wasm/build/dump_expected.exe --diag to have been run; this
//  script invokes it itself)
// =============================================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import createOrbitalFoundryCore from '../dist/of-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const exe = join(here, '..', 'build', 'dump_expected.exe');

const _dv = new DataView(new ArrayBuffer(8));
function bits(x) {
  _dv.setFloat64(0, x, false);
  return _dv.getBigUint64(0, false).toString(16).padStart(16, '0');
}
/** Signed ULP distance between two doubles (0 = bit-identical). */
function ulps(a, b) {
  _dv.setFloat64(0, a, false); let ia = _dv.getBigInt64(0, false);
  _dv.setFloat64(0, b, false); let ib = _dv.getBigInt64(0, false);
  const flip = (v) => (v < 0n ? 0x8000000000000000n - v : v);
  const d = flip(ia) - flip(ib);
  return d < 0n ? -d : d;
}

const M = await createOrbitalFoundryCore();
const native = JSON.parse(execFileSync(exe, ['--diag'], { encoding: 'utf8' })
    .replace(/^﻿/, ''));

console.log('Determinism diagnostic: WASM (emscripten/musl) vs native (mingw-w64)\n');

// --- (a) libm --------------------------------------------------------------
const FN = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan2', 'sqrt', 'floor',
            'fabs', 'exp', 'log', 'pow'];
console.log('  libm probe (per function: differing inputs / total, worst ULP)');
for (let f = 0; f < FN.length; ++f) {
  let diff = 0, worst = 0n, total = 0;
  for (const rec of native.libm[f]) {
    const got = M._of_diag_libm(f, rec.a, rec.b);
    total++;
    const u = ulps(got, rec.r);
    if (u !== 0n) { diff++; if (u > worst) worst = u; }
  }
  const flag = diff ? '  <-- DIFFERS' : '';
  console.log(`    ${FN[f].padEnd(7)} ${String(diff).padStart(3)}/${total}   worst ${worst} ULP${flag}`);
}

// --- (a2) THE ROOT PROBE: tan over the real cube-sphere lattice arguments ----
// cubed_sphere.h's warp() is `tan(s * pi/4)` and unitDir is the ONLY producer of
// sampled directions. Height is position-hashed from that direction's raw bits,
// so any tan difference is amplified from 1 ULP into a completely different
// height. This sweep is the single number that decides cross-toolchain parity.
{
  const buf = readFileSync(join(here, 'diag_tan.bin'));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0, gTotal = 0, gDiff = 0;
  console.log('\n  tan() over the cube-sphere lattice arguments, per LOD level:');
  const rows = [];
  for (let L = 0; L <= 14; ++L) {
    const span = 2 ** L;
    const step = span > 511 ? Math.floor(span / 511) : 1;
    let diff = 0, n = 0;
    for (let i = 0; i <= span; i += step) {
      const s = -1.0 + 2.0 * (i / span);            // latticeCoord(i, L)
      const a = s * 0.78539816339744830961;
      const want = dv.getFloat64(off, true); off += 8;
      const got = M._of_diag_libm(2, a, 0);
      n++;
      if (ulps(got, want) !== 0n) diff++;
    }
    gTotal += n; gDiff += diff;
    rows.push(`L${String(L).padStart(2)} ${String(diff).padStart(3)}/${String(n).padStart(3)}`);
  }
  for (let i = 0; i < rows.length; i += 5) console.log('    ' + rows.slice(i, i + 5).join('   '));
  console.log(`    TOTAL ${gDiff}/${gTotal} lattice directions differ ` +
              `(${(100 * gDiff / gTotal).toFixed(2)}%) by 1 ULP in tan`);
  console.log('    -> each one becomes a DIFFERENT position hash -> a different height.');
}

// --- (b) the terrain pipeline, stage by stage -------------------------------
const STAGE = ['dirX', 'dirY', 'dirZ', 'latitude', 'temperature', 'moisture',
               'rawHeight', 'designedHeight'];
const buf = readFileSync(join(here, 'diag_scan.bin'));
const dvn = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const body = M._of_body_create_forge(native.seedLo, native.seedHi);
const RECORD = 8 * 8 + 4;   // 8 doubles + 1 int32 per vertex in the .bin
const totals = STAGE.map(() => ({ diff: 0, worst: 0n, example: null }));
let bDiff = 0, total = 0;
let quadsWithAnyDiff = 0;

// The exact quads the streamer produced in the parity fixture (3 budgeted
// updates around the same observer) — the set whose content diverged.
const sId = M._of_streamer_create(body, 1.0, 0.6, 6, 0, 0.5, 16);
M._of_observer_latlon_alt(body, 0, 0.30, 0.70, 20000.0);
{
  const p = M._of_scratch_f64() >>> 3;
  var OX = M.HEAPF64[p], OY = M.HEAPF64[p + 1], OZ = M.HEAPF64[p + 2];
}
const QUADS = [];
for (let u = 0; u < 3; ++u) {
  const ready = M._of_streamer_update(sId, OX, OY, OZ);
  M._of_streamer_ready_keys(sId);
  const kp = M.HEAP32.subarray(M._of_scratch_i32() >>> 2,
                               (M._of_scratch_i32() >>> 2) + ready * 4);
  for (let i = 0; i < ready; ++i) {
    QUADS.push([kp[i * 4], kp[i * 4 + 1], kp[i * 4 + 2], kp[i * 4 + 3]]);
  }
}
M._of_streamer_destroy(sId);

const depthHisto = new Map();
for (const q of QUADS) depthHisto.set(q[1], (depthHisto.get(q[1]) || 0) + 1);

for (let f = 0; f < QUADS.length; ++f) {
  const [qf, qd, qx, qy] = QUADS[f];
  const n = M._of_diag_scan_quad(body, qf, qd, qx, qy);
  const f64 = M.HEAPF64.subarray(M._of_scratch_f64() >>> 3,
                                 (M._of_scratch_f64() >>> 3) + n * 8);
  const i32 = M.HEAP32.subarray(M._of_scratch_i32() >>> 2,
                                (M._of_scratch_i32() >>> 2) + n);
  const base = f * n * RECORD;
  let quadDirty = false;
  for (let s = 0; s < STAGE.length; ++s) {
    for (let v = 0; v < n; ++v) {
      const want = dvn.getFloat64(base + v * RECORD + s * 8, true);
      const got = f64[v * 8 + s];
      const u = ulps(got, want);
      if (u !== 0n) {
        totals[s].diff++;
        if (s === 7) quadDirty = true;    // designedHeight: what the mesh draws
        if (u > totals[s].worst) {
          totals[s].worst = u;
          totals[s].example = { f, v, got, want };
        }
      }
    }
  }
  for (let v = 0; v < n; ++v) {
    if (i32[v] !== dvn.getInt32(base + v * RECORD + 64, true)) bDiff++;
  }
  if (quadDirty) quadsWithAnyDiff++;
  total += n;
}

console.log(`\n  terrain pipeline over the ${QUADS.length} quads the streamer built ` +
            `(${total} vertices), stage by stage`);
console.log(`  quad depths: ${[...depthHisto.entries()].sort((a, b) => a[0] - b[0])
    .map(([d, c]) => `d${d}x${c}`).join(' ')}`);
for (let s = 0; s < STAGE.length; ++s) {
  const t = totals[s];
  const pct = (100 * t.diff / total).toFixed(3);
  console.log(`    ${STAGE[s].padEnd(16)} ${String(t.diff).padStart(5)}/${total} (${pct.padStart(7)}%)` +
              `  worst ${t.worst} ULP` +
              (t.example ? `   e.g. face${t.example.f} v${t.example.v}: ` +
                           `${bits(t.example.got)} vs ${bits(t.example.want)}` : ''));
}
console.log(`    ${'biome (classify)'.padEnd(16)} ${String(bDiff).padStart(5)}/${total} ` +
            `(${(100 * bDiff / total).toFixed(3).padStart(7)}%)  <- integer: any diff is a FLIPPED CLASSIFICATION`);
console.log(`\n  chunks (33x33 = 1089 verts) with >=1 differing designed height: ` +
            `${quadsWithAnyDiff}/${QUADS.length}`);
console.log(`  -> a per-vertex rate of p makes the per-chunk rate 1-(1-p)^1089, ` +
            `which is why\n     a ~0.1%/vertex flip shows up as most chunks differing.`);
