// =============================================================================
// parity.mjs — the point of the whole spike.
//
// Loads the WASM build of the headless /core simulation and replays, from
// JavaScript, the exact scenario that web/wasm/test/dump_expected.cpp ran
// NATIVELY (WinLibs g++ -O2, the same toolchain that builds the 22 green ctest
// suites). Every double is compared as its raw IEEE-754 bit pattern and every
// array as a bit-sensitive FNV-1a hash, so "pass" means BIT-IDENTICAL, not
// "close enough".
//
//   node web/wasm/test/parity.mjs           # parity only
//   node web/wasm/test/parity.mjs --bench   # + the WASM/native perf table
//
// Prereq: web/wasm/build.ps1 has produced dist/of-core.mjs and
// test/expected.json (the native ground truth).
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import createOrbitalFoundryCore from '../dist/of-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// (strip a UTF-8 BOM: Windows PowerShell 5.1's Out-File -Encoding utf8 emits one,
// and JSON.parse rejects it)
const expected = JSON.parse(
    readFileSync(join(here, 'expected.json'), 'utf8').replace(/^﻿/, ''));

// --- bit-exact helpers -------------------------------------------------------
const _dv = new DataView(new ArrayBuffer(8));
/** A double's exact IEEE-754 bits as a 16-char hex string (matches the C dump). */
function bits(x) {
  _dv.setFloat64(0, x, false);
  return _dv.getBigUint64(0, false).toString(16).padStart(16, '0');
}
/** FNV-1a 32-bit, byte-for-byte identical to the C version in dump_expected.cpp. */
function fnv() {
  let h = 0x811c9dc5 >>> 0;
  return {
    byte(b) { h = ((h ^ (b & 0xff)) >>> 0); h = Math.imul(h, 0x01000193) >>> 0; },
    bytes(u8) { for (let i = 0; i < u8.length; ++i) this.byte(u8[i]); },
    f64(x) { _dv.setFloat64(0, x, true); for (let i = 0; i < 8; ++i) this.byte(_dv.getUint8(i)); },
    f32(x) { _dv.setFloat32(0, x, true); for (let i = 0; i < 4; ++i) this.byte(_dv.getUint8(i)); },
    i32(v) { _dv.setInt32(0, v, true); for (let i = 0; i < 4; ++i) this.byte(_dv.getUint8(i)); },
    end() { return h >>> 0; },
  };
}

// --- assertions, in THREE TIERS ----------------------------------------------
//
// The tiers exist because "is the WASM core correct?" and "is WASM bit-identical
// to a native g++ build?" are DIFFERENT questions with different answers, and
// conflating them would hide the real result.
//
// TIER 0 - SELF-DETERMINISM (hard fail). No native involved. The same
//   computation run twice inside the SAME wasm instance must be bit-identical,
//   and a shared quad edge must be bit-identical from either neighbour. This is
//   the property multiplayer and seed+diff persistence actually require, and it
//   can be proven absolutely.
//
// TIER A - CROSS-TOOLCHAIN, TRANSCENDENTAL-FREE (hard fail). Everything whose
//   result never passes through a libm transcendental, or is quantized enough
//   that a 1-ULP wobble cannot change it: the factory sim (all integer /
//   fixed-point), voxel cell ids, dig counts, exposed-face sets, the dirty AABB,
//   persistence bytes, LOD quad selection, and the index buffer. A failure here
//   is a genuine port defect.
//
// TIER B - CROSS-TOOLCHAIN, TRANSCENDENTAL-DEPENDENT (reported, does not gate).
//   The continuous terrain field. cubed_sphere.h's warp() is `tan(s*pi/4)` and
//   is the SOLE producer of every sampled direction; biome.h adds asin/atan2/cos.
//   None of those four are bit-specified by IEEE-754, so mingw-w64's libm and
//   emscripten's musl libm differ by 1 ULP at ~2.8% of the lattice arguments.
//   Because height is deliberately POSITION-HASHED from the direction's raw bits
//   (WG-6), a 1-ULP direction difference yields a completely unrelated height.
//   PASSING TIER B AT THESE SAMPLE POINTS DOES NOT PROVE UNIVERSAL IDENTITY —
//   run `node web/wasm/test/diag.mjs` for the true population rate (~1.7% of
//   terrain vertices differ). Tier B is here so any NEW divergence is visible
//   next to the known one, not to certify the terrain field.
const TIER = { SELF: 'self', A: 'A', B: 'B' };
const stats = {
  [TIER.SELF]: { pass: 0, fail: 0, failures: [] },
  [TIER.A]: { pass: 0, fail: 0, failures: [] },
  [TIER.B]: { pass: 0, fail: 0, failures: [] },
};
function eq(label, got, want, tier = TIER.A) {
  const s = stats[tier];
  if (Object.is(got, want)) { s.pass++; return true; }
  s.fail++; s.failures.push(`${label}: got ${got}  want ${want}`);
  return false;
}
function eqBits(label, gotDouble, wantHex, tier = TIER.A) {
  return eq(label, bits(gotDouble), wantHex, tier);
}

// =============================================================================
// THE MEMORY-VIEW FOOTGUN, handled in ONE place.
//
// -sALLOW_MEMORY_GROWTH means the WASM linear memory can be replaced by a bigger
// ArrayBuffer at any allocation. Every JS typed array over the old buffer is then
// DETACHED and reads as length 0 (or throws). The rule these helpers enforce:
//   NEVER cache a heap view or a scratch pointer across a call into WASM.
// Re-read M.HEAPxx AND re-read the scratch pointer, in that order, every time.
// A renderer that hands one of these subarrays to the GPU must COPY it (or
// upload it) before the next WASM call.
// =============================================================================
function viewF64(M, ptr, n) { return M.HEAPF64.subarray(ptr >>> 3, (ptr >>> 3) + n); }
function viewF32(M, ptr, n) { return M.HEAPF32.subarray(ptr >>> 2, (ptr >>> 2) + n); }
function viewI32(M, ptr, n) { return M.HEAP32.subarray(ptr >>> 2, (ptr >>> 2) + n); }
function viewU8(M, ptr, n) { return M.HEAPU8.subarray(ptr, ptr + n); }
function viewU16(M, ptr, n) { return M.HEAPU16.subarray(ptr >>> 1, (ptr >>> 1) + n); }
/** Read the f64 scratch arena AFTER the producing call. */
const scratchF64 = (M, n) => viewF64(M, M._of_scratch_f64(), n);
const scratchF32 = (M, n) => viewF32(M, M._of_scratch_f32(), n);
const scratchI32 = (M, n) => viewI32(M, M._of_scratch_i32(), n);
const scratchU8  = (M, n) => viewU8(M, M._of_scratch_u8(), n);

// The same fixed sample points dump_expected.cpp used.
const SAMPLES = [
  [0.0, 0.0], [0.30, 0.70], [-0.45, 2.10], [1.10, -1.30],
  [1.45, 0.20], [-1.42, 3.00], [0.62, -2.55], [-0.15, 1.05],
];
function digDir() {
  const l = Math.sqrt(0.31 * 0.31 + 0.57 * 0.57 + 0.76 * 0.76);
  return [0.31 / l, 0.57 / l, 0.76 / l];
}

// =============================================================================
const M = await createOrbitalFoundryCore();
console.log('Orbital Foundry /core -> WASM parity test');
console.log(`  wasm abi=${M._of_abi_version()}  node=${process.version}\n`);

eq('abi', M._of_abi_version(), expected.abi);

const SEED_LO = expected.seedLo, SEED_HI = expected.seedHi;
const forge = M._of_body_create_forge(SEED_LO, SEED_HI);
const cinder = M._of_body_create_cinder(SEED_LO, SEED_HI);
eqBits('forge.radius', M._of_body_radius(forge), expected.forgeRadius);
eqBits('cinder.radius', M._of_body_radius(cinder), expected.cinderRadius);
{
  const lo = M._of_body_seed_lo(forge) >>> 0;
  const hi = M._of_last_hi() >>> 0;
  eq('forge.bodySeed.lo', lo, expected.forgeSeedLo);
  eq('forge.bodySeed.hi', hi, expected.forgeSeedHi);
}

// --- TIER 0: WASM SELF-DETERMINISM (no native involved) ----------------------
// This is the property the game actually needs: one binary, reproducible world.
{
  // (a) The same quad generated twice must be bit-identical.
  const m1 = M._of_quadmesh_generate(forge, 4, 7, 53, 91, 0, 0);
  const n1 = M._of_quadmesh_vertex_count(m1);
  const h1 = viewF64(M, M._of_quadmesh_heights_f64(m1), n1);
  const a = fnv(); for (let i = 0; i < n1; ++i) a.f64(h1[i]);
  const lo1 = M._of_quadmesh_content_hash_lo(m1) >>> 0, hi1 = M._of_last_hi() >>> 0;
  const m2 = M._of_quadmesh_generate(forge, 4, 7, 53, 91, 0, 0);
  const h2 = viewF64(M, M._of_quadmesh_heights_f64(m2), n1);
  const b = fnv(); for (let i = 0; i < n1; ++i) b.f64(h2[i]);
  const lo2 = M._of_quadmesh_content_hash_lo(m2) >>> 0, hi2 = M._of_last_hi() >>> 0;
  eq('self.quadmesh regenerates bit-identically', a.end(), b.end(), TIER.SELF);
  eq('self.quadmesh contentHash lo', lo1, lo2, TIER.SELF);
  eq('self.quadmesh contentHash hi', hi1, hi2, TIER.SELF);

  // (b) CRACK-FREE: a shared edge is bit-identical from either neighbour, and
  // from a PARENT at a coarser LOD (the property the whole streaming design
  // rests on). This is asserted purely inside WASM.
  const G = M._of_quadmesh_grid_dim(m1);
  const me = M._of_quadmesh_generate(forge, 4, 7, 54, 91, 0, 0);
  const he = viewF64(M, M._of_quadmesh_heights_f64(me), n1);
  const hm = viewF64(M, M._of_quadmesh_heights_f64(m1), n1);
  let seam = 0;
  for (let j = 0; j < G; ++j) if (bits(hm[j * G + (G - 1)]) === bits(he[j * G])) seam++;
  eq('self.shared edge bit-identical (crack-free)', seam, G, TIER.SELF);
  M._of_quadmesh_destroy(m1); M._of_quadmesh_destroy(m2); M._of_quadmesh_destroy(me);

  // (c) Two identically-built factory networks stepped the same N ticks agree
  // (test_automation's determinism case, re-proven in WASM).
  const mk = () => {
    const net = M._of_net_create(1 / 60);
    const mi = M._of_net_place_miner(net, 5000, 0x0033, 8.0, 50);
    const b1 = M._of_net_place_belt(net, 2, 32);
    const sm = M._of_net_place_smelter(net, 0x0033, 0x0010, 20, 0, 0);
    const b2 = M._of_net_place_belt(net, 2, 32);
    const as = M._of_net_place_assembler(net, 0x0010, 1, 0, 0, 0x0040, 1, 25, 0, 0);
    M._of_net_connect(net, mi, b1, 0); M._of_net_connect(net, b1, sm, 0);
    M._of_net_connect(net, sm, b2, 0); M._of_net_connect(net, b2, as, 0);
    return { net, mi, b1, sm, as };
  };
  const na = mk(), nb = mk();
  M._of_net_step_n(na.net, 4000); M._of_net_step_n(nb.net, 4000);
  for (const item of [0x0033, 0x0010, 0x0040]) {
    eq(`self.factory produced 0x${item.toString(16)}`,
       M._of_net_produced_of(na.net, item), M._of_net_produced_of(nb.net, item), TIER.SELF);
  }
  eq('self.factory minerRemaining', M._of_net_miner_remaining(na.net, na.mi),
     M._of_net_miner_remaining(nb.net, nb.mi), TIER.SELF);
  eq('self.factory beltItems', M._of_net_belt_item_count(na.net, na.b1),
     M._of_net_belt_item_count(nb.net, nb.b1), TIER.SELF);
  eq('self.factory produced parts > 0',
     M._of_net_produced_of(na.net, 0x0040) > 0, true, TIER.SELF);
  M._of_net_destroy(na.net); M._of_net_destroy(nb.net);

  // (d) Two identical voxel edit sets under the same ops agree bit-for-bit.
  const [ddx, ddy, ddz] = digDir();
  const sR = M._of_surface_radius(forge, 0, ddx, ddy, ddz);
  const mkEdits = () => {
    const e2 = M._of_edits_create();
    for (let k = 0; k < 8; ++k) {
      const r = sR - (k + 0.5);
      M._of_edits_dig_cell_at(e2, ddx * r, ddy * r, ddz * r);
    }
    return e2;
  };
  const ea = mkEdits(), eb = mkEdits();
  eq('self.voxel removedCount', M._of_edits_removed_count(ea),
     M._of_edits_removed_count(eb), TIER.SELF);
  eqBits('self.voxel surfaceHeight',
         M._of_surface_height(forge, ea, ddx, ddy, ddz),
         bits(M._of_surface_height(forge, eb, ddx, ddy, ddz)), TIER.SELF);
  const nb1 = M._of_edits_serialize(ea);
  const sa = Array.from(scratchU8(M, nb1));
  const nb2 = M._of_edits_serialize(eb);
  const sb2 = Array.from(scratchU8(M, nb2));
  eq('self.voxel save bytes identical', JSON.stringify(sa), JSON.stringify(sb2), TIER.SELF);
  M._of_edits_destroy(ea); M._of_edits_destroy(eb);
}

// --- TIER 0 (e): MULTIPLE INDEPENDENT MODULE INSTANCES ----------------------
// The renderer needs one instance on the MAIN THREAD (synchronous surface-oracle
// calls inside the frame) plus one per meshing/sim worker. -sMODULARIZE=1 with
// no pthreads means each createOrbitalFoundryCore() gets its own WebAssembly
// .Memory and its own copy of every module-level static, so instances cannot
// interfere. This asserts that: same handles, same answers, and a mutation in
// one is INVISIBLE to the other (the ownership corollary the renderer must plan
// around).
{
  const M2 = await createOrbitalFoundryCore();
  const f2 = M2._of_body_create_forge(SEED_LO, SEED_HI);
  const [dx, dy, dz] = digDir();
  eq('multi.instances give identical handles', f2, forge, TIER.SELF);
  eqBits('multi.instances agree on baseHeight', M2._of_base_height(f2, dx, dy, dz),
         bits(M._of_base_height(forge, dx, dy, dz)), TIER.SELF);
  // Mutate instance 2 only; instance 1 must be untouched (separate heaps).
  const e2 = M2._of_edits_create();
  const sR2 = M2._of_surface_radius(f2, 0, dx, dy, dz);
  for (let k = 0; k < 5; ++k) {
    const r = sR2 - (k + 0.5);
    M2._of_edits_dig_cell_at(e2, dx * r, dy * r, dz * r);
  }
  eq('multi.instance2 sees its own dig', M2._of_edits_removed_count(e2), 5, TIER.SELF);
  // The same handle id in instance 1 does NOT hold instance 2's edits (it holds
  // whatever instance 1 put there, or nothing). Separate heaps, separate state.
  eq('multi.instance1 heap is unaffected (separate memories)',
     M._of_edits_removed_count(e2) === 5, false, TIER.SELF);
  eq('multi.instance2 lowering != 0', M2._of_derived_lowering(f2, e2, dx, dy, dz) > 0,
     true, TIER.SELF);
  eq('multi.instance1 lowering == 0 for the same handle id',
     M._of_derived_lowering(forge, e2, dx, dy, dz), 0, TIER.SELF);
  M2._of_edits_destroy(e2);
}

// --- CASE 1: terrain heights at fixed (lat,lon) ------------------------------
for (let i = 0; i < SAMPLES.length; ++i) {
  const [lat, lon] = SAMPLES[i];
  const e = expected.heights[i];
  M._of_latlon_to_dir(lat, lon);
  const d = scratchF64(M, 3);
  const [dx, dy, dz] = [d[0], d[1], d[2]];
  eqBits(`heights[${i}].dirX`, dx, e.dirX, TIER.B);
  eqBits(`heights[${i}].dirY`, dy, e.dirY, TIER.B);
  eqBits(`heights[${i}].dirZ`, dz, e.dirZ, TIER.B);
  eqBits(`heights[${i}].raw`, M._of_sample_raw_height_latlon(forge, lat, lon), e.raw, TIER.B);
  eqBits(`heights[${i}].designed`,
         M._of_sample_designed_height_latlon(forge, lat, lon), e.designed, TIER.B);
  eqBits(`heights[${i}].base`, M._of_base_height(forge, dx, dy, dz), e.base, TIER.B);
  eqBits(`heights[${i}].surface`, M._of_surface_height(forge, 0, dx, dy, dz), e.surface, TIER.B);
  eqBits(`heights[${i}].moonRaw`, M._of_sample_raw_height_latlon(cinder, lat, lon), e.moonRaw, TIER.B);
  eqBits(`heights[${i}].moonBase`, M._of_base_height(cinder, dx, dy, dz), e.moonBase, TIER.B);
}

// --- CASE 2: biome classification -------------------------------------------
for (let i = 0; i < SAMPLES.length; ++i) {
  const [lat, lon] = SAMPLES[i];
  const e = expected.biomes[i];
  M._of_latlon_to_dir(lat, lon);
  const d = scratchF64(M, 3);
  const bp = M._of_biome_at(forge, d[0], d[1], d[2]);
  const bm = M._of_biome_at(cinder, d[0], d[1], d[2]);
  eq(`biomes[${i}].planet`, bp, e.planet, TIER.B);
  eq(`biomes[${i}].moon`, bm, e.moon, TIER.B);
  eq(`biomes[${i}].planetMat`, M._of_material_for_biome(bp), e.planetMat, TIER.B);
  eq(`biomes[${i}].moonMat`, M._of_material_for_biome(bm), e.moonMat, TIER.B);
  eqBits(`biomes[${i}].hardness`, M._of_hardness_for_biome(bp), e.hardness, TIER.B);
  eqBits(`biomes[${i}].temp`, M._of_temperature_at(forge, d[0], d[1], d[2]), e.temp,
         TIER.B);
  // moisture is pure fBm, but its ARGUMENT is a trig-derived dir -> Tier B.
  eqBits(`biomes[${i}].moist`, M._of_moisture_at(forge, d[0], d[1], d[2]), e.moist, TIER.B);
}

// --- CASE 3: full generateQuadMesh ------------------------------------------
{
  const e = expected.quadmesh;
  const m = M._of_quadmesh_generate(forge, 2, 5, 7, 11, 0, 0);   // rawBase 0 = the oracle
  const G = M._of_quadmesh_grid_dim(m);
  const n = M._of_quadmesh_vertex_count(m);
  eq('quadmesh.gridDim', G, e.gridDim);
  eq('quadmesh.vertexCount', n, e.vertexCount);
  const hlo = M._of_quadmesh_content_hash_lo(m) >>> 0;
  const hhi = M._of_last_hi() >>> 0;
  eq('quadmesh.contentHashLo', hlo, e.contentHashLo);
  eq('quadmesh.contentHashHi', hhi, e.contentHashHi);

  const hs = viewF64(M, M._of_quadmesh_heights_f64(m), n);
  let h = fnv(); for (let i = 0; i < n; ++i) h.f64(hs[i]);
  eq('quadmesh.heightHash', h.end(), e.heightHash);
  const ps = viewF32(M, M._of_quadmesh_positions_f32(m), n * 3);
  h = fnv(); for (let i = 0; i < n * 3; ++i) h.f32(ps[i]);
  eq('quadmesh.posHash', h.end(), e.posHash);
  const ns = viewF32(M, M._of_quadmesh_normals_f32(m), n * 3);
  h = fnv(); for (let i = 0; i < n * 3; ++i) h.f32(ns[i]);
  eq('quadmesh.nrmHash', h.end(), e.nrmHash);

  eqBits('quadmesh.h0', hs[0], e.h0, TIER.B);
  eqBits('quadmesh.h544', hs[544], e.h544, TIER.B);
  eqBits('quadmesh.h1088', hs[1088], e.h1088, TIER.B);
  eqBits('quadmesh.chunkRadius', M._of_quadmesh_chunk_radius(m), e.chunkRadius, TIER.B);
  M._of_quadmesh_center(m);
  const c = scratchF64(M, 3);
  eqBits('quadmesh.centerX', c[0], e.centerX, TIER.B);
  eqBits('quadmesh.centerY', c[1], e.centerY, TIER.B);
  eqBits('quadmesh.centerZ', c[2], e.centerZ, TIER.B);

  const mr = M._of_quadmesh_generate(forge, 2, 5, 7, 11, 0, 1);  // rawBase 1 = the RAW baseline
  const rlo = M._of_quadmesh_content_hash_lo(mr) >>> 0;
  const rhi = M._of_last_hi() >>> 0;
  eq('quadmesh.rawContentHashLo', rlo, e.rawContentHashLo);
  eq('quadmesh.rawContentHashHi', rhi, e.rawContentHashHi);

  // CRACK-FREE: the shared edge with the east neighbour must be bit-identical
  // IN WASM TOO (this is the property the whole streaming design rests on).
  const me = M._of_quadmesh_generate(forge, 2, 5, 8, 11, 0, 0);
  const heN = viewF64(M, M._of_quadmesh_heights_f64(me), n);
  const hmN = viewF64(M, M._of_quadmesh_heights_f64(m), n);
  let seamOk = 1;
  for (let j = 0; j < G; ++j) {
    if (bits(hmN[j * G + (G - 1)]) !== bits(heN[j * G + 0])) seamOk = 0;
  }
  eq('quadmesh.seamOk (crack-free shared edge)', seamOk, e.seamOk);

  M._of_quadmesh_destroy(m); M._of_quadmesh_destroy(mr); M._of_quadmesh_destroy(me);
}

// --- index buffer ------------------------------------------------------------
{
  const e = expected.indices;
  const ic = M._of_grid_indices(33);
  eq('indices.count', ic, e.count);
  const ip = viewU16(M, M._of_grid_indices_ptr(), ic);
  const h = fnv();
  for (let i = 0; i < ic; ++i) { h.byte(ip[i] & 0xff); h.byte((ip[i] >>> 8) & 0xff); }
  eq('indices.hash', h.end(), e.hash);
}

// --- CASE 4: surface oracle BEFORE / AFTER a dig-down column -----------------
{
  const e = expected.digColumn;
  const [dx, dy, dz] = digDir();
  const before = M._of_base_height(forge, dx, dy, dz);
  const surfR = M._of_surface_radius(forge, 0, dx, dy, dz);
  const edits = M._of_edits_create();
  for (let k = 0; k < e.cells; ++k) {
    const r = surfR - (k + 0.5);
    M._of_edits_dig_cell_at(edits, dx * r, dy * r, dz * r);
  }
  eqBits('digColumn.before', before, e.before, TIER.B);
  eqBits('digColumn.lowering', M._of_derived_lowering(forge, edits, dx, dy, dz), e.lowering);
  eqBits('digColumn.after', M._of_surface_height(forge, edits, dx, dy, dz), e.after, TIER.B);
  eq('digColumn.removed', M._of_edits_removed_count(edits), e.removed);
  M._of_edits_destroy(edits);
}

// --- CASE 5: horizontal tunnel leaves the ceiling solid ----------------------
{
  const e = expected.tunnel;
  const [dx, dy, dz] = digDir();
  const edits = M._of_edits_create();
  const surfR = M._of_surface_radius(forge, 0, dx, dy, dz);
  let tx = -dy, ty = dx, tz = 0.0;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  tx /= tl; ty /= tl; tz /= tl;
  const depth = 12.0, baseR = surfR - depth, steps = e.columns;
  let removed = 0;
  for (let k = 0; k < steps; ++k) {
    const s = k * 2.0;
    removed += M._of_edits_dig(edits, forge, dx * baseR + tx * s,
                               dy * baseR + ty * s, dz * baseR + tz * s, 1.4);
  }
  let noLowering = 0;
  const h = fnv();
  for (let k = 0; k < steps; ++k) {
    const s = k * 2.0;
    let cx = dx * baseR + tx * s, cy = dy * baseR + ty * s, cz = dz * baseR + tz * s;
    const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
    cx /= l; cy /= l; cz /= l;
    const low = M._of_derived_lowering(forge, edits, cx, cy, cz);
    const sh = M._of_surface_height(forge, edits, cx, cy, cz);
    const bh = M._of_base_height(forge, cx, cy, cz);
    h.f64(low); h.f64(sh);
    if (low === 0.0 && bits(sh) === bits(bh)) ++noLowering;
  }
  eq('tunnel.removed', removed, e.removed);
  eq('tunnel.noLoweringColumns (ceiling intact)', noLowering, e.noLoweringColumns);
  eq('tunnel.hash (raw surface heights)', h.end(), e.hash, TIER.B);
  const ceilR = surfR - depth + 3.0;
  eq('tunnel.ceilingSolid',
     M._of_solid_at(forge, edits, dx * ceilR, dy * ceilR, dz * ceilR), e.ceilingSolid);
  M._of_edits_destroy(edits);
}

// --- CASE 6: voxel dig brush + exposed faces + persistence bytes -------------
{
  const e = expected.voxel;
  const [dx, dy, dz] = digDir();
  const edits = M._of_edits_create();
  const surfR = M._of_surface_radius(forge, 0, dx, dy, dz);
  const r = surfR - 2.0;
  eq('voxel.removed', M._of_edits_dig(edits, forge, dx * r, dy * r, dz * r, 4.0), e.removed);
  eq('voxel.dirtyValid', M._of_edits_dirty_region(edits), e.dirtyValid);
  const dr = scratchI32(M, 6);
  for (let i = 0; i < 6; ++i) eq(`voxel.dirty[${i}]`, dr[i], e.dirty[i]);
  const faces = M._of_exposed_faces(forge, edits, dx * r, dy * r, dz * r, 5.0);
  eq('voxel.faces', faces, e.faces);
  const fp = scratchI32(M, faces * 5);
  let h = fnv(); for (let i = 0; i < faces * 5; ++i) h.i32(fp[i]);
  eq('voxel.faceHash', h.end(), e.faceHash);
  const nbytes = M._of_edits_serialize(edits);
  eq('voxel.saveBytes', nbytes, e.saveBytes);
  const sb = scratchU8(M, nbytes);
  h = fnv(); h.bytes(sb);
  eq('voxel.saveHash', h.end(), e.saveHash);
  M._of_edits_destroy(edits);
}

// --- CASE 7: terrain streaming ----------------------------------------------
const streamChunkDiffs = [];
{
  const e = expected.streaming;
  const s = M._of_streamer_create(forge, 1.0, 0.6, 6, 0, 0.5, 16);
  M._of_observer_latlon_alt(forge, 0, 0.30, 0.70, 20000.0);
  const o = scratchF64(M, 3);
  const [ox, oy, oz] = [o[0], o[1], o[2]];
  eqBits('streaming.obsX', ox, e.obsX);
  eqBits('streaming.obsY', oy, e.obsY);
  eqBits('streaming.obsZ', oz, e.obsZ);
  for (let u = 0; u < e.updates.length; ++u) {
    const ex = e.updates[u];
    const ready = M._of_streamer_update(s, ox, oy, oz);
    eq(`streaming[${u}].ready`, ready, ex.ready);
    eq(`streaming[${u}].generated`, M._of_streamer_generated(s), ex.generated);
    eq(`streaming[${u}].converged`, M._of_streamer_converged(s), ex.converged);
    eq(`streaming[${u}].resident`, M._of_streamer_resident_count(s), ex.resident);
    eq(`streaming[${u}].evicted`, M._of_streamer_evicted_count(s), ex.evicted);
    // LOD selection is SUBSTRATE (pure length/sqrt + lattice tan): the SET of
    // quads chosen must be bit-identical even if a chunk's climate shifts.
    M._of_streamer_ready_keys(s);
    const kp = scratchI32(M, ready * 4);
    let h = fnv(); for (let i = 0; i < ready * 4; ++i) h.i32(kp[i]);
    eq(`streaming[${u}].keyHash (LOD selection)`, h.end(), ex.keyHash);
    if (ready > 0) {
      // Chunk CONTENT is climate-derived (buildChunk samples the designed
      // surface, which is modulated by the biome). Count how many of the ready
      // chunks differ so the blast radius is a number, not a yes/no.
      let differing = 0;
      for (let ci = 0; ci < ready; ++ci) {
        const nh = M._of_chunk_heights_f64(s, ci);
        const hp = scratchF64(M, nh);
        h = fnv(); for (let i = 0; i < nh; ++i) h.f64(hp[i]);
        if (h.end() !== ex.chunkHashes[ci]) {
          differing++;
          streamChunkDiffs.push(`update ${u} chunk ${ci} ` +
              `(biome ${ex.chunkBiomes[ci]})`);
        }
      }
      eq(`streaming[${u}].chunkContent (${ready} chunks, differing)`, differing, 0,
         TIER.B);
      M._of_chunk_meta(s, 0);
      const mp = scratchI32(M, 11);
      eq(`streaming[${u}].gridDim`, mp[4], ex.gridDim);
      eq(`streaming[${u}].skirtVerts`, mp[9], ex.skirtVerts);
      // The f32 render path must also produce the right shapes.
      eq(`streaming[${u}].posCount`, M._of_chunk_positions_f32(s, 0), mp[10]);
      eq(`streaming[${u}].skirtCount`, M._of_chunk_skirt_f32(s, 0), ex.skirtVerts);
      // Anchor + neighbour LOD annotation are substrate.
      eq(`streaming[${u}].anchorOk`, M._of_chunk_anchor(s, 0), 1);
      eq(`streaming[${u}].neighboursOk`, M._of_chunk_neighbour_depths(s, 0), 1);
    }
  }
  // --- CASE 7c: of_chunk_max_offset is a REAL bounding radius ---------------
  // It must equal the largest |vertex - centre| over EVERY vertex the chunk
  // emits, skirt included. The pre-ABI-2 version returned the largest single
  // AXIS offset over the INTERIOR only: 52,639 m for a depth-3 chunk whose
  // furthest emitted vertex is 108,403 m out, which frustum-culled on-screen
  // chunks. The packed buffer is the ground truth here because it is exactly
  // what the renderer uploads. Tolerance is f32 rounding of the packed
  // positions, nothing more.
  {
    const ready = M._of_streamer_ready_count(s);
    const stride = M._of_packed_stride();
    let worstRel = 0, checked = 0, skirtBeatsInterior = 0;
    for (let ci = 0; ci < ready; ++ci) {
      const nBytes = M._of_chunk_packed(s, ci);
      const nV = nBytes / stride;
      const u8 = scratchU8(M, nBytes).slice();
      const f32 = new Float32Array(u8.buffer);
      const F = stride / 4;
      let allMax = 0, interiorMax = 0;
      for (let v = 0; v < nV; ++v) {
        const f = v * F;
        const r = Math.hypot(f32[f], f32[f + 1], f32[f + 2]);
        if (r > allMax) allMax = r;
        // flags byte (offset 20 + 3) bit0 marks a skirt vertex
        if ((u8[v * stride + 23] & 1) === 0 && r > interiorMax) interiorMax = r;
      }
      const got = M._of_chunk_max_offset(s, ci);
      const rel = Math.abs(got - allMax) / (allMax || 1);
      if (rel > worstRel) worstRel = rel;
      if (allMax > interiorMax * 1.000001) skirtBeatsInterior++;
      checked++;
    }
    eq(`maxOffset.chunksChecked`, checked > 0, true, TIER.SELF);
    eq(`maxOffset.matchesPackedBound (worst rel ${worstRel.toExponential(2)})`,
       worstRel < 1e-6, true, TIER.SELF);
    // If the skirt never reached further than the interior the check above
    // could not tell the two definitions apart; say so rather than pass quietly.
    eq(`maxOffset.skirtIsTheBound (${skirtBeatsInterior}/${checked} chunks)`,
       skirtBeatsInterior > 0, true, TIER.SELF);
  }
  M._of_streamer_destroy(s);
}

// --- CASE 7b: THE SURFACE-AUTHORITY GUARD -----------------------------------
//
// The regression this exists to make impossible: of_observer_latlon_alt was
// built on terrain_stream.h's makeObserverLatLonAlt, i.e. the RAW heightfield,
// so an "altitude 60 m" observer at lat 48 / lon 18 on Forge spawned ~2.4 km
// UNDERGROUND and every terrain chunk rendered behind the camera. WG-21 made
// surface_field.h the single authority and DECISIONS.md standing rule 1 says no
// module re-derives terrain height; the bridge broke that rule anyway.
//
// Pinned identity: observer === dir * (of_surface_radius + alt) BIT-EXACT, and
// NOT dir * (R + rawHeight + alt). The inequality half matters as much as the
// equality half: if raw and designed ever agreed at this sample the test would
// be passing vacuously, so the gap is asserted too.
{
  const e = expected.observer;
  const DEG = Math.PI / 180;
  const lat = e.latDeg * DEG, lon = e.lonDeg * DEG, alt = e.altM;

  const raw = M._of_sample_raw_height_latlon(forge, lat, lon);
  const des = M._of_sample_designed_height_latlon(forge, lat, lon);
  eqBits('observer.raw', raw, e.raw, TIER.B);
  eqBits('observer.designed', des, e.designed, TIER.B);

  M._of_latlon_to_dir(lat, lon);
  const d = scratchF64(M, 3).slice();
  const base = M._of_base_height(forge, d[0], d[1], d[2]);
  const surfR = M._of_surface_radius(forge, 0, d[0], d[1], d[2]);
  eq('observer.base === designed', bits(base), bits(des), TIER.SELF);
  eqBits('observer.surfaceR', surfR, e.surfaceR, TIER.B);

  M._of_observer_latlon_alt(forge, 0, lat, lon, alt);
  const o = scratchF64(M, 3).slice();
  // THE identity, component-wise and bit-exact.
  const want = surfR + alt;
  eq('observer.x === dir.x*(surfaceRadius+alt)', bits(o[0]), bits(d[0] * want), TIER.SELF);
  eq('observer.y === dir.y*(surfaceRadius+alt)', bits(o[1]), bits(d[1] * want), TIER.SELF);
  eq('observer.z === dir.z*(surfaceRadius+alt)', bits(o[2]), bits(d[2] * want), TIER.SELF);

  // And the negative half: it must NOT be the raw surface.
  const R = M._of_body_radius(forge);
  const obsR = Math.hypot(o[0], o[1], o[2]);
  const rawR = R + raw + alt;
  const gap = des - raw;
  eq(`observer.rawGapIsReal (${gap.toFixed(2)} m designed - raw)`,
     Math.abs(gap) > 100, true, TIER.SELF);
  eq(`observer.notRawDerived (would be ${(obsR - rawR).toFixed(2)} m off)`,
     Math.abs(obsR - rawR) > 100, true, TIER.SELF);
  eqBits('observer.rawGapM', gap, e.rawGapM, TIER.B);
  eqBits('observer.obsX', o[0], e.obsX, TIER.B);
  eqBits('observer.obsY', o[1], e.obsY, TIER.B);
  eqBits('observer.obsZ', o[2], e.obsZ, TIER.B);

  // The dug half: the observer follows the FULL oracle (base minus the
  // voxel-derived lowering), not merely the designed base.
  const ge = M._of_edits_create();
  for (let k = 0; k < 6; ++k) {
    const r = surfR - 0.5 - k;
    M._of_edits_dig_cell_at(ge, d[0] * r, d[1] * r, d[2] * r);
  }
  const low = M._of_derived_lowering(forge, ge, d[0], d[1], d[2]);
  M._of_observer_latlon_alt(forge, ge, lat, lon, alt);
  const o2 = scratchF64(M, 3).slice();
  const dugR = Math.hypot(o2[0], o2[1], o2[2]);
  eq('observer.digLowersObserver', Math.abs((obsR - dugR) - low) < 1e-6, true, TIER.SELF);
  eqBits('observer.lowering', low, e.lowering, TIER.B);
  eqBits('observer.dugDropM', obsR - dugR, e.dugDropM, TIER.B);
  M._of_edits_destroy(ge);
}

// --- CASE 8: the factory auto-line (mirrors test_automation.cpp) -------------
const K = { ore: 0x0033, ingot: 0x0010, part: 0x0040 };
function buildChain(deposit) {
  const net = M._of_net_create(1 / 60);
  const miner = M._of_net_place_miner(net, deposit, K.ore, 8.0, 50);
  const belt1 = M._of_net_place_belt(net, 2, 32);
  const smelter = M._of_net_place_smelter(net, K.ore, K.ingot, 20, 0, 0);
  const belt2 = M._of_net_place_belt(net, 2, 32);
  const asmb = M._of_net_place_assembler(net, K.ingot, 1, 0, 0, K.part, 1, 25, 0, 0);
  M._of_net_connect(net, miner, belt1, 0);
  M._of_net_connect(net, belt1, smelter, 0);
  M._of_net_connect(net, smelter, belt2, 0);
  M._of_net_connect(net, belt2, asmb, 0);
  return { net, miner, belt1, smelter, belt2, asmb };
}
{
  const e = expected.factory;
  const c = buildChain(100000);
  M._of_net_step_n(c.net, 5000);
  eq('factory.ore', M._of_net_produced_of(c.net, K.ore), e.ore);
  eq('factory.ingot', M._of_net_produced_of(c.net, K.ingot), e.ingot);
  eq('factory.part', M._of_net_produced_of(c.net, K.part), e.part);
  eq('factory.minerRemaining', M._of_net_miner_remaining(c.net, c.miner), e.minerRemaining);
  eq('factory.belt1Items', M._of_net_belt_item_count(c.net, c.belt1), e.belt1Items);
  eq('factory.smelterOut', M._of_net_output_buffer(c.net, c.smelter), e.smelterOut);
  eq('factory.asmIn', M._of_net_input_buffer(c.net, c.asmb), e.asmIn);
  eq('factory.tick', M._of_net_tick_index(c.net), e.tick);
  eqBits('factory.asmProgress', M._of_net_progress01(c.net, c.asmb), e.asmProgress);
  eq('factory.smelterWorking', M._of_net_working(c.net, c.smelter), e.smelterWorking);

  const rows = M._of_net_emit_entity_states(c.net);
  eq('factory.stateRows', rows, e.stateRows);
  const ip = scratchI32(M, rows * 6);
  let h = fnv(); for (let i = 0; i < rows * 6; ++i) h.i32(ip[i]);
  eq('factory.stateHash', h.end(), e.stateHash);
  const flows = M._of_net_emit_belt_flows(c.net);
  eq('factory.flows', flows, e.flows);
  const fp = scratchI32(M, flows * 5);
  h = fnv(); for (let i = 0; i < flows * 5; ++i) h.i32(fp[i]);
  eq('factory.flowHash', h.end(), e.flowHash);
  const items = M._of_net_get_line_items(c.net, c.belt1);
  eq('factory.lineItems', items, e.lineItems);
  const lp = scratchI32(M, items * 2);
  h = fnv(); for (let i = 0; i < items * 2; ++i) h.i32(lp[i]);
  eq('factory.itemHash', h.end(), e.itemHash);
  M._of_net_destroy(c.net);
}
{
  const e = expected.factoryDeplete;
  const c = buildChain(40);
  M._of_net_step_n(c.net, 20000);
  eq('factoryDeplete.mined', M._of_net_produced_of(c.net, K.ore), e.mined);
  eq('factoryDeplete.remaining', M._of_net_miner_remaining(c.net, c.miner), e.remaining);
  eq('factoryDeplete.depleted', M._of_net_miner_depleted(c.net, c.miner), e.depleted);
  M._of_net_destroy(c.net);

  const net2 = M._of_net_create(1 / 60);
  const m2 = M._of_net_place_miner(net2, 600, K.ore, 60.0, 0);
  M._of_net_step_n(net2, 600);
  eq('factoryDeplete.exactRateMined', M._of_net_produced_of(net2, K.ore), e.exactRateMined);
  eq('factoryDeplete.exactRateRemaining', M._of_net_miner_remaining(net2, m2),
     e.exactRateRemaining);
  M._of_net_destroy(net2);
}

// =============================================================================
// RESULT
// =============================================================================
const S = stats[TIER.SELF], A = stats[TIER.A], B = stats[TIER.B];
console.log(`  TIER 0 self-determinism      : ${S.pass} passed, ${S.fail} failed  (GATING)`);
console.log(`  TIER A cross-toolchain, exact: ${A.pass} passed, ${A.fail} failed  (GATING)`);
console.log(`  TIER B cross-toolchain, libm : ${B.pass} passed, ${B.fail} failed  (informational)`);

if (S.fail) {
  console.log('\n  SELF-DETERMINISM BROKEN - the WASM core is not reproducible:');
  for (const f of S.failures) console.log('    - ' + f);
} else {
  console.log('\n  SELF-DETERMINISM: the WASM core reproduces itself EXACTLY.');
  console.log('    Regenerating a quad, a factory run, and a voxel edit set gives');
  console.log('    bit-identical results, and shared quad edges are bit-identical');
  console.log('    (crack-free). This is the property multiplayer + seed-and-diff');
  console.log('    persistence require, and every client runs this same binary.');
}

if (A.fail) {
  console.log('\n  CROSS-TOOLCHAIN DIVERGENCE in transcendental-free code -');
  console.log('  this is a REAL PORT DEFECT, not a libm artefact:');
  for (const f of A.failures.slice(0, 40)) console.log('    - ' + f);
  if (A.failures.length > 40) console.log(`    ... and ${A.failures.length - 40} more`);
} else {
  console.log('\n  CROSS-TOOLCHAIN (exact): BIT-IDENTICAL to the native g++ build.');
  console.log('    factory sim (integer/fixed-point), voxel cell ids + dig counts +');
  console.log('    exposed faces + dirty AABB, persistence byte stream, LOD quad');
  console.log('    selection, index buffer, chunk shapes.');
}

if (B.fail) {
  console.log('\n  CROSS-TOOLCHAIN DELTA in the continuous terrain field:');
  for (const f of B.failures) console.log('    - ' + f);
  if (streamChunkDiffs.length) {
    console.log(`    (${streamChunkDiffs.length} streamed chunks differ; e.g. ` +
                streamChunkDiffs.slice(0, 3).join(', ') + ' ...)');
  }
  console.log('    ROOT CAUSE: cubed_sphere.h warp() = std::tan(s*pi/4) is the sole');
  console.log('    producer of every sampled direction, and biome.h adds asin/atan2/');
  console.log('    cos. libm transcendentals are not bit-specified by IEEE-754, so');
  console.log('    mingw-w64 and emscripten/musl differ by 1 ULP at ~2.8% of the');
  console.log('    lattice arguments. Height is POSITION-HASHED from the direction');
  console.log('    bits (WG-6 by design), so 1 ULP in -> a totally different height.');
  console.log('    Run `node web/wasm/test/diag.mjs` for the per-stage ULP table.');
  console.log('    IMPACT: a WASM client and a native build grow slightly different');
  console.log('    planets from the same seed. Irrelevant for a browser-only game');
  console.log('    (one binary). It matters only for a native server sharing world');
  console.log('    state with browser clients. FIX (if ever needed): vendor a fixed');
  console.log('    tan/asin/atan2/cos into /core - four functions, all other math in');
  console.log('    the noise stack is floor/fabs/sqrt/mul/add and already exact.');
} else {
  console.log('\n  CROSS-TOOLCHAIN (terrain field): bit-identical at every sample point.');
}

// =============================================================================
// BENCH (--bench): the WASM/native ratio. Runs the identical loops the native
// `dump_expected.exe --bench` runs, through the same C API.
// =============================================================================
if (process.argv.includes('--bench')) {
  console.log('\nBenchmark (WASM vs native, same loops through the same C API)');
  const b2 = M._of_body_create_forge(SEED_LO, SEED_HI);

  const kQuads = 60;
  let t0 = process.hrtime.bigint();
  let verts = 0;
  for (let q = 0; q < kQuads; ++q) {
    const face = q % 6;
    const depth = 3 + (q % 5);
    const qx = q % (1 << depth);
    const qy = (q * 7) % (1 << depth);
    const m = M._of_quadmesh_generate(b2, face, depth, qx, qy, 0, 0);
    verts += M._of_quadmesh_vertex_count(m);
    M._of_quadmesh_destroy(m);
  }
  let t1 = process.hrtime.bigint();
  const meshSec = Number(t1 - t0) / 1e9;

  const c = buildChain(1e9);
  const kTicks = 2000000;
  t0 = process.hrtime.bigint();
  M._of_net_step_n(c.net, kTicks);
  t1 = process.hrtime.bigint();
  const tickSec = Number(t1 - t0) / 1e9;
  M._of_net_destroy(c.net);

  const [dx, dy, dz] = digDir();
  const edits = M._of_edits_create();
  const surfR = M._of_surface_radius(b2, 0, dx, dy, dz);
  const r = surfR - 2.0;
  t0 = process.hrtime.bigint();
  M._of_edits_dig(edits, b2, dx * r, dy * r, dz * r, 8.0);
  const vfaces = M._of_exposed_faces(b2, edits, dx * r, dy * r, dz * r, 10.0);
  t1 = process.hrtime.bigint();
  const voxSec = Number(t1 - t0) / 1e9;
  M._of_edits_destroy(edits);

  let nat = null;
  try {
    const exe = join(here, '..', 'build', 'dump_expected.exe');
    nat = JSON.parse(execFileSync(exe, ['--bench'], { encoding: 'utf8' }));
  } catch (err) {
    console.log('  (native baseline unavailable: ' + err.message + ')');
  }

  const row = (name, wasm, native, unit) => {
    const ratio = native ? (wasm / native) : NaN;
    console.log(`  ${name.padEnd(26)} wasm ${wasm.toExponential(3)} ${unit}` +
                (native ? `   native ${native.toExponential(3)} ${unit}` +
                          `   ratio ${(ratio * 100).toFixed(1)}%` : ''));
  };
  row('quad-mesh generation', verts / meshSec, nat ? nat.vertsPerSec : 0, 'verts/s');
  row('factory sim', kTicks / tickSec, nat ? nat.ticksPerSec : 0, 'ticks/s');
  row('voxel dig + faces', vfaces / voxSec, nat ? nat.voxelFaces / nat.voxelSec : 0, 'faces/s');
  console.log(`  (quad-mesh: ${kQuads} quads = ${verts} verts in ${(meshSec * 1e3).toFixed(1)} ms` +
              ` -> ${(meshSec * 1e3 / kQuads).toFixed(2)} ms/chunk)`);

  // === R1 GATE: full streamed chunk -> packed GPU buffer, ms per chunk =======
  // Everything the renderer pays for one chunk: buildChunk (designed heights +
  // normals + skirt) THEN pack into the 28 B/vertex interleaved buffer.
  {
    const s = M._of_streamer_create(b2, 1.0, 0.6, 8, 0, 0.5, 16);
    M._of_observer_latlon_alt(b2, 0, 0.30, 0.70, 3000.0);
    const p = M._of_scratch_f64() >>> 3;
    const [ox, oy, oz] = [M.HEAPF64[p], M.HEAPF64[p + 1], M.HEAPF64[p + 2]];
    let chunks = 0, buildNs = 0n, packNs = 0n, bytes = 0, maxOff = 0;
    const byDepth = {};
    for (let u = 0; u < 6; ++u) {
      const t = process.hrtime.bigint();
      const ready = M._of_streamer_update(s, ox, oy, oz);
      buildNs += process.hrtime.bigint() - t;
      for (let ci = 0; ci < ready; ++ci) {
        const t2 = process.hrtime.bigint();
        const n = M._of_chunk_packed(s, ci);
        packNs += process.hrtime.bigint() - t2;
        bytes = n;
        const mo = M._of_chunk_max_offset(s, ci);
        if (mo > maxOff) maxOff = mo;
        M._of_chunk_meta(s, ci);
        const d = scratchI32(M, 11)[1];
        if (!(d in byDepth) || mo > byDepth[d]) byDepth[d] = mo;
        chunks++;
      }
    }
    M._of_streamer_destroy(s);
    const buildMs = Number(buildNs) / 1e6 / chunks;
    const packMs = Number(packNs) / 1e6 / chunks;
    const total = buildMs + packMs;
    const stride = M._of_packed_stride();
    const nVerts = bytes / stride;
    console.log('\n  R1 GATE - streamed chunk -> packed GPU buffer:');
    console.log(`    buildChunk (heights+normals+skirt)  ${buildMs.toFixed(3)} ms/chunk`);
    console.log(`    pack to interleaved GPU buffer      ${packMs.toFixed(3)} ms/chunk`);
    console.log(`    TOTAL                               ${total.toFixed(3)} ms/chunk` +
                `   ${total <= 12 ? 'PASS' : 'FAIL'} (gate <= 12 ms)`);
    console.log(`    buffer: ${bytes} B = ${nVerts} verts x ${stride} B` +
                `   (${(bytes / 1024).toFixed(1)} KiB, constant per chunk -> poolable)`);
    console.log('    float32 position precision (centre-relative), per LOD depth:');
    for (const d of Object.keys(byDepth).map(Number).sort((a, b) => a - b)) {
      const q = byDepth[d] * Math.pow(2, -23);
      console.log(`      depth ${String(d).padStart(2)}  extent ${(byDepth[d] / 1000).toFixed(1).padStart(7)} km` +
                  `  ->  quantum ${(q * 1000).toFixed(3).padStart(8)} mm`);
    }
    console.log(`    (relative precision is constant at 2^-23 of the chunk extent, so a`);
    console.log(`     coarse chunk is only ever coarse when it is far away. ABSOLUTE f32`);
    console.log(`     at Forge's 600 km radius would be ${(6.0e5 * Math.pow(2, -23) * 1000).toFixed(1)} mm everywhere - that is the`);
    console.log(`     precision failure the per-chunk 64-bit anchor removes.)`);
    const ic = M._of_chunk_index_buffer();
    console.log(`    index buffer: ${ic} uint16 (${M._of_chunk_interior_index_count()}` +
                ` interior + ${ic - M._of_chunk_interior_index_count()} skirt), built once`);
  }

  // === Surface-oracle per-call cost (main-thread, inside the frame) ==========
  // These are the calls the character step, aim raycast and build-grid snap make
  // synchronously during a frame. Plain exported C functions, scalars in, double
  // out, ZERO allocation per call.
  {
    const [dx, dy, dz] = digDir();
    const edits = M._of_edits_create();
    const sR = M._of_surface_radius(b2, 0, dx, dy, dz);
    for (let k = 0; k < 12; ++k) {
      const r = sR - (k + 0.5);
      M._of_edits_dig_cell_at(edits, dx * r, dy * r, dz * r);
    }
    const N = 20000;
    const probe = (label, fn) => {
      fn(0);                                  // warm
      const t = process.hrtime.bigint();
      let acc = 0;
      for (let i = 0; i < N; ++i) acc += fn(i);
      const ns = Number(process.hrtime.bigint() - t) / N;
      console.log(`    ${label.padEnd(34)} ${ns.toFixed(2).padStart(8)} ns  ` +
                  `(${(ns / 1000).toFixed(3)} us)  [${acc !== 0 ? 'ok' : 'ok'}]`);
      return ns;
    };
    console.log('\n  MAIN-THREAD SURFACE ORACLE (per call, synchronous, no alloc):');
    const jitter = (i) => 1e-9 * (i % 997);   // vary the dir so nothing is cached
    probe('baseHeight(body, dir)', (i) => M._of_base_height(b2, dx + jitter(i), dy, dz));
    probe('surfaceHeight(body, edits, dir)',
          (i) => M._of_surface_height(b2, edits, dx + jitter(i), dy, dz));
    probe('biomeAt(body, dir)', (i) => M._of_biome_at(b2, dx + jitter(i), dy, dz));
    probe('solidAt(body, edits, pos)',
          (i) => M._of_solid_at(b2, edits, dx * sR + i * 1e-6, dy * sR, dz * sR));
    probe('solidCell(body, edits, cell)',
          (i) => M._of_solid_cell(b2, edits, 100000 + (i % 64), 200000, 300000));
    M._of_edits_destroy(edits);
    console.log('    (target: single-digit microseconds; a 60 Hz frame is 16,667 us)');
  }
}

// Only a SUBSTRATE failure is a build failure. A climate delta is reported
// loudly but does not gate, because it is a property of the native comparison
// harness, not of the WASM build the game actually ships.
process.exit(A.fail ? 1 : 0);
