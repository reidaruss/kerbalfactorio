// RN-2265. STAND-WEIGHT DETERMINISM, and it needed its own tool because the
// PICTURE cannot prove it. Three fresh-process captures of one forestair build
// return every committed rectangle bit-identical to two decimals and THREE
// DIFFERENT PNG sha256s, which is NUMBERS.md's own same-process/fresh-process
// entry seen from the other side: the frame carries settle-tick state that the
// field does not. So the field is digested directly.
//
// It evaluates `ChunkCanopy.fillCanopyIndex` -- the exact function the terrain
// upload path calls, at the exact coordinates it calls it at -- over a fixed
// 256x256 body-frame grid spanning 8 km at the `forestair` site, and prints an
// FNV-1a32 over the raw float32 bytes plus the field's mean, min and max.
//
//   cd web
//   npx esbuild tools/smoke/rn2265field.ts --bundle --platform=node //     --format=esm --outfile=tools/smoke/rn2265field.mjs
//   node tools/smoke/rn2265field.mjs   # repeat in fresh processes
//   rm tools/smoke/rn2265field.mjs
//
// It is a .ts and not a .mjs because the field it digests is TypeScript and
// re-implementing it here would digest the copy rather than the shipped code.
import { fillCanopyIndex, BIOME_CANOPY_MU }
  from '../../src/render/geometry/ChunkCanopy.js';

const R = 6.0e5;
const lat = -19.85 * Math.PI / 180;
const lon = -72.7853 * Math.PI / 180;
const c = Math.cos(lat);
const p = [c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon)];
const up = p;
const e = [-Math.sin(lon), 0, Math.cos(lon)];
const n = [up[1] * e[2] - up[2] * e[1], up[2] * e[0] - up[0] * e[2],
  up[0] * e[1] - up[1] * e[0]];

const N = 256;
const SPAN = 8000;
const verts = N * N;
const pos = new Float32Array(verts * 3);
const hgt = new Float32Array(verts);
const bio = new Uint8Array(verts * 4);
const out = new Float32Array(verts);
const ax = p[0] * R, ay = p[1] * R, az = p[2] * R;
for (let j = 0; j < N; ++j) {
  for (let i = 0; i < N; ++i) {
    const u = (i / (N - 1) - 0.5) * SPAN;
    const v = (j / (N - 1) - 0.5) * SPAN;
    const k = j * N + i;
    pos[k * 3] = e[0] * u + n[0] * v;
    pos[k * 3 + 1] = e[1] * u + n[1] * v;
    pos[k * 3 + 2] = e[2] * u + n[2] * v;
    hgt[k] = 200 + 120 * Math.sin(u / 900) * Math.cos(v / 700);
    bio[k * 4] = 3;
    out[k] = -1;
  }
}
fillCanopyIndex(out, pos, hgt, bio, verts, ax, ay, az);
let h = 0x811c9dc5 >>> 0;
const b = new Uint8Array(out.buffer);
for (let i = 0; i < b.length; ++i) {
  h = (h ^ b[i]) >>> 0;
  h = Math.imul(h, 0x01000193) >>> 0;
}
let sum = 0, mn = Infinity, mx = -Infinity, nz = 0;
for (let i = 0; i < verts; ++i) {
  sum += out[i];
  if (out[i] < mn) mn = out[i];
  if (out[i] > mx) mx = out[i];
  if (out[i] > 0) nz++;
}
console.log(JSON.stringify({
  mu: BIOME_CANOPY_MU.map((x) => Number(x.toFixed(6))),
  verts, fnv1a32: h.toString(16).padStart(8, '0'),
  mean: Number((sum / verts).toFixed(9)),
  min: Number(mn.toFixed(9)), max: Number(mx.toFixed(9)), nonZero: nz,
}));
