// WG-51: the terrain surface-art precision experiment, offline and from first
// principles.
//
// WHY THIS EXISTS. The rendering lane's detail bump produced concentric arcs
// across the ground and NO NUMBER SAW IT: the term moved 35% of the near band
// with a healthy peak either way, and a screenshot is what caught it
// (RN-45, `docs/screenshots/RN45_iso_bump.png`). A defect invisible to every
// metric is a defect that will come back, so before spending a chunk format on
// the cure I wanted the disease reproduced from arithmetic alone, with no
// shader, no GPU, no driver and no three.js in the loop.
//
// It reproduces. This tool renders the same field three ways at the same
// camera:
//
//   A  TRUTH   the field evaluated in float64 on the exact position
//   B  DEFECT  the field evaluated in float32 on planet-centred metres, which
//              is what `TerrainShader.ts:185` does today (`pM`)
//   C  FIX     the field evaluated in float32 on a per-chunk phase reduced in
//              float64 by `web/src/world/ChunkPhase.ts`
//
// B shows the arcs. A and C do not. That confirmation is independent of the
// rendering lane's measurement rather than a restatement of it.
//
// AND IT PRODUCES THE NUMBER THAT WAS MISSING. Screen derivatives are taken on
// 2x2 quads exactly as hardware takes them, and the tool reports the fraction of
// quads whose screen derivative of the field is EXACTLY 0.0 in both axes. An
// intensity histogram cannot see that and a mean cannot see that; it is one
// cheap integer and it separates defect from truth by two orders of magnitude.
// It belongs in the rendering lane's probe as an assertion.
//
// THAT STATISTIC HAS ITS OWN BLIND SPOT AND IT IS NAMED HERE RATHER THAN
// DISCOVERED LATER. The fourth mode, `finefix`, reduces only the FINEST octave
// and leaves the macro ladder on `pM`. It scores 0.00% dead quads, exactly like
// truth and like the full fix, because the fine octave's live derivative is
// enough to keep the SUM off zero everywhere. And it is still visibly wrong:
// `WG51_artphase_finefix.png` has the arcs and the lattice plainly in it, and
// its field sits 2.5e-3 from truth where the full fix sits 2.0e-6, a factor of
// 1,224. So the dead-quad count is NECESSARY AND NOT SUFFICIENT, the field
// agreement is the number that separates a partial fix from a real one, and the
// picture is still the arbiter. That is the same lesson RN-45 learned the
// expensive way, arriving this time from the other direction: it is not that
// numbers cannot see this defect, it is that each number sees only part of it.
//
// The practical consequence, which is what sizes the payload: EVERY octave that
// feeds the derivative must be reduced. Fixing one is not enough.
//
// A NOTE ON GETTING THIS WRONG FIRST, because it is the same failure this
// project keeps paying for. The first version of this tool put the ground patch
// at z = R with x and y small, and the defect did NOT reproduce: 0.00% zero
// quads, identical to truth. The model was wrong, not the diagnosis. In that
// orientation two of the three components of `pM` are small and therefore
// exact, so the quantisation had nowhere to land. A generic direction on the
// sphere puts all three components at 1e5 scale, which is the situation a
// player is actually in everywhere except on three great circles. A control
// that accidentally removes the thing it is controlling for reports success.
//
// Run:  node --experimental-strip-types web/tools/precision/artphase.ts
// Out:  docs/screenshots/WG51_artphase_{truth,defect,fix}.png and a table.
//
// The field, the hash, the interpolant, the octave wavelengths and their phase
// offsets are transcribed from `web/src/render/materials/TerrainArt.glsl.ts`
// (RN-45) so this models the shipped shader and not one I would have written.

import { packPhases, reconstructAxis } from '../../src/world/ChunkPhase.ts';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../../docs/screenshots');

// ---------------------------------------------------------------------------
// Constants, taken from the shipped code rather than chosen here.
// ---------------------------------------------------------------------------

/** Forge's radius. DW-18. */
const R_BODY = 600_000;
/** CameraRig.ts:27, vertical field of view in degrees. */
const FOV_DEG = 60;
/** RN-45's measurement frame. */
const W = 1280, H = 720;
/** The eye height the walker stands at. */
const EYE_M = 1.8;
/** Pitched down so the frame runs from about 2 m to about 30 m of ground,
 *  which is exactly the band RN-45 photographed the arcs in. */
const PITCH_DEG = -26;

/** TerrainArt.glsl.ts:121-123. Wavelength, weight, and the phase offset that is
 *  added AFTER the divide, in lattice cells. */
const OCT = [
  { L: 186.0, w: 0.42, off: 0.0 },
  { L: 47.5, w: 0.36, off: 19.7 },
  { L: 11.9, w: 0.22, off: 53.1 },
];
/** ART_FINE_M, TerrainArt.glsl.ts:258; used at TerrainShader.ts:224. */
const FINE = { L: 4.2, w: 0.9, off: 7.3 };

/** DW-19: depth 14 gives 1.808 m vertex spacing on a 33x33 grid. */
const CHUNK_M = 1.808 * 32;

/** Declared contrast stretch on the bump shading, applied identically to all
 *  three modes. See the note at the shading site. */
const GAIN = 14;

/** A generic direction on the sphere. Deliberately not axis-aligned: see the
 *  note at the top of this file. */
const DIR = (() => {
  const v = [0.5137, 0.6221, 0.5913];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n] as const;
})();

const f32 = Math.fround;

// ---------------------------------------------------------------------------
// The field. One transcription of the GLSL, parameterised by a rounding
// function, so the arithmetics differ ONLY in precision.
// ---------------------------------------------------------------------------

/** Dave Hoskins hash13, TerrainArt.glsl.ts:72-76. */
function hash13(x: number, y: number, z: number, q: (v: number) => number): number {
  const fr = (v: number) => q(v - Math.floor(v));
  let px = fr(q(x * 0.1031)), py = fr(q(y * 0.1031)), pz = fr(q(z * 0.1031));
  const d = q(q(px * q(pz + 31.32)) + q(q(py * q(py + 31.32)) + q(pz * q(px + 31.32))));
  px = q(px + d); py = q(py + d); pz = q(pz + d);
  return fr(q(q(px + py) * pz));
}

/**
 * Value noise on an EXPLICIT (integer cell, fractional offset) triple.
 * TerrainArt.glsl.ts:78-93. Both arithmetics reduce to this form, and they
 * differ only in how the triple was obtained, which is the thing being measured.
 */
function vnoiseCell(
  i: readonly [number, number, number],
  f: readonly [number, number, number],
  q: (v: number) => number,
): number {
  const sm = (t: number) => q(t * q(t * q(3 - 2 * t)));
  const sx = sm(f[0]), sy = sm(f[1]), sz = sm(f[2]);
  const mix = (a: number, b: number, t: number) => q(a + q(t * q(b - a)));
  const h = (dx: number, dy: number, dz: number) => hash13(i[0] + dx, i[1] + dy, i[2] + dz, q);
  const n00 = mix(h(0, 0, 0), h(1, 0, 0), sx);
  const n10 = mix(h(0, 1, 0), h(1, 1, 0), sx);
  const n01 = mix(h(0, 0, 1), h(1, 0, 1), sx);
  const n11 = mix(h(0, 1, 1), h(1, 1, 1), sx);
  return mix(mix(n00, n10, sy), mix(n01, n11, sy), sz);
}

type Mode = 'truth' | 'defect' | 'fix' | 'finefix';
type V3 = readonly [number, number, number];

/** The chunk anchor covering a body-frame position. The anchor is the centre. */
function anchorFor(p: V3): V3 {
  return [
    (Math.floor(p[0] / CHUNK_M) + 0.5) * CHUNK_M,
    (Math.floor(p[1] / CHUNK_M) + 0.5) * CHUNK_M,
    (Math.floor(p[2] / CHUNK_M) + 0.5) * CHUNK_M,
  ];
}

/** Cache of ChunkPhase reductions, keyed by chunk. The reduction is per chunk
 *  by design; recomputing it per pixel would be a lie about its cost. */
const phaseCache = new Map<string, Float32Array>();
const WAVELENGTHS = [OCT[0].L, OCT[1].L, OCT[2].L, FINE.L];
function phasesFor(a: V3): Float32Array {
  const k = `${a[0]}|${a[1]}|${a[2]}`;
  let p = phaseCache.get(k);
  if (!p) { p = packPhases({ x: a[0], y: a[1], z: a[2] }, WAVELENGTHS); phaseCache.set(k, p); }
  return p;
}

/**
 * The height field the bump takes a derivative of.
 *
 * `pTrue` is the exact body-frame position in float64. `pGpu` is what the GPU
 * would hold for `pM` in this mode. In DEFECT they differ by up to half a ULP
 * at 6e5 m; in TRUTH and FIX the GPU never forms a 6e5 intermediate at all.
 */
function artHeight(pTrue: V3, pGpu: V3, mode: Mode): number {
  // ALL THREE MODES EVALUATE THE SAME NOISE FUNCTION IN THE SAME PRECISION.
  // Only the way the lattice coordinate is obtained differs, because that is
  // the one variable under test.
  //
  // The first version of this let TRUTH run the hash in float64 too, and truth
  // and fix then drew visibly different terrain. That was not a precision
  // result, it was a modelling artefact: `hash13` is a chain of `fract` and is
  // chaotic across precisions, so float64 and float32 give unrelated values for
  // the same cell rather than nearby ones. A control that changes two things at
  // once measures neither.
  const q = f32;
  const anchor = mode === 'fix' || mode === 'finefix' ? anchorFor(pTrue) : null;
  const packed = anchor ? phasesFor(anchor) : null;

  let h = 0;
  const octs = [...OCT, FINE];
  for (let k = 0; k < octs.length; ++k) {
    const o = octs[k];
    const cell: number[] = [], frac: number[] = [];
    for (let a = 0; a < 3; ++a) {
      // `finefix` reduces ONLY the finest octave and leaves the macro ladder
      // on pM. It exists to size the payload: 6 floats per chunk if it is
      // enough, 24 if it is not. The fine octave carries about 5.7x the
      // gradient of the next one down, so it is a fair question and not one to
      // answer by intuition.
      const fixThis = mode === 'fix' || (mode === 'finefix' && k === 3);
      if (fixThis) {
        // The whole fix: the integer cell comes from a float64 reduction done
        // once per chunk, and the shader only ever adds a small local offset.
        const r = reconstructAxis(packed!, k, a, pTrue[a] - anchor![a], o.L);
        const t = f32(r.frac + o.off);
        const fl = Math.floor(t);
        cell.push(r.cell + fl);
        frac.push(f32(t - fl));
      } else if (mode === 'truth') {
        // The ideal: the lattice coordinate obtained exactly, in float64, then
        // handed to the same float32 noise. This is the shader it would be
        // fair to compare against, and it is unreachable from `pM`.
        const t = pTrue[a] / o.L + o.off;
        const fl = Math.floor(t);
        cell.push(fl);
        frac.push(f32(t - fl));
      } else {
        // What the shader does today: divide a planet-scale float32 by L.
        // Getting the SOURCE wrong here is how the first run of this tool
        // reported truth and defect agreeing on 69,033 of 212,480 quads, to
        // the digit. Two numbers agreeing to the last digit is a wiring
        // diagnosis, never a coincidence.
        const t = f32(f32(f32(pGpu[a]) / f32(o.L)) + o.off);
        const fl = Math.floor(t);
        cell.push(fl);
        frac.push(f32(t - fl));
      }
    }
    const n = vnoiseCell(cell as unknown as V3, frac as unknown as V3, q);
    const contrib = k === 3 ? q(o.w * q(n - 0.5)) : q(o.w * q(2 * n - 1));
    h = q(h + contrib);
  }
  return h;
}

// ---------------------------------------------------------------------------
// The camera and the floating-origin path, modelled honestly.
// ---------------------------------------------------------------------------

/** Tangent frame at DIR: east, north, up. */
const UP = DIR;
const EAST = (() => {
  const a: V3 = Math.abs(UP[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e: number[] = [
    a[1] * UP[2] - a[2] * UP[1],
    a[2] * UP[0] - a[0] * UP[2],
    a[0] * UP[1] - a[1] * UP[0],
  ];
  const n = Math.hypot(e[0], e[1], e[2]);
  return [e[0] / n, e[1] / n, e[2] / n] as const;
})();
const NORTH = [
  UP[1] * EAST[2] - UP[2] * EAST[1],
  UP[2] * EAST[0] - UP[0] * EAST[2],
  UP[0] * EAST[1] - UP[1] * EAST[0],
] as const;

/** The observer's body-frame position: the floating origin, in float64. */
const ORIGIN: V3 = [UP[0] * (R_BODY + EYE_M), UP[1] * (R_BODY + EYE_M), UP[2] * (R_BODY + EYE_M)];

interface Sample { hit: boolean; pTrue: V3; pGpu: V3; distM: number; }

function castPixel(px: number, py: number): Sample {
  const tanHalf = Math.tan((FOV_DEG * Math.PI) / 360);
  const ndcX = ((px + 0.5) / W) * 2 - 1;
  const ndcY = 1 - ((py + 0.5) / H) * 2;
  const dx = ndcX * tanHalf * (W / H);
  const dz = ndcY * tanHalf;
  const p = (PITCH_DEG * Math.PI) / 180;
  const cy = Math.cos(p), sy = Math.sin(p);
  // Local ray: x east, y north (forward), z up.
  const ly = dz * -sy + cy;
  const lz = dz * cy + sy;
  const len = Math.hypot(dx, ly, lz);
  const ex = dx / len, ny = ly / len, uz = lz / len;
  if (uz >= -1e-9) return { hit: false, pTrue: [0, 0, 0], pGpu: [0, 0, 0], distM: 0 };
  const t = EYE_M / -uz;
  // The tangent plane is the ground. Curvature over 30 m is 0.75 mm and is
  // irrelevant to an experiment about millimetres of pixel footprint; the
  // ABSOLUTE magnitude is the entire point and is kept exactly.
  const u = ex * t, v = ny * t;
  const pTrue: V3 = [
    UP[0] * R_BODY + EAST[0] * u + NORTH[0] * v,
    UP[1] * R_BODY + EAST[1] * u + NORTH[1] * v,
    UP[2] * R_BODY + EAST[2] * u + NORTH[2] * v,
  ];
  // The GPU path: vWorld is engine space (small, precise as a float32 varying);
  // uBodyCenter is -origin uploaded as a float32 vec3, magnitude 6e5, therefore
  // quantised. pM = vWorld - uBodyCenter is formed in float32.
  const pGpu: V3 = [
    f32(f32(pTrue[0] - ORIGIN[0]) - f32(-ORIGIN[0])),
    f32(f32(pTrue[1] - ORIGIN[1]) - f32(-ORIGIN[1])),
    f32(f32(pTrue[2] - ORIGIN[2]) - f32(-ORIGIN[2])),
  ];
  return { hit: true, pTrue, pGpu, distM: t };
}

// ---------------------------------------------------------------------------

interface Result {
  rgba: Uint8Array; zeroQuadFrac: number; quads: number; zeroQuads: number;
  hbuf: Float64Array;
}

function render(mode: Mode, samples: Sample[]): Result {
  const hbuf = new Float64Array(W * H);
  for (let i = 0; i < W * H; ++i) {
    const s = samples[i];
    if (s.hit) hbuf[i] = artHeight(s.pTrue, s.pGpu, mode);
  }
  const rgba = new Uint8Array(W * H * 4);
  let quads = 0, zeroQuads = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i00 = y * W + x, i10 = i00 + 1, i01 = i00 + W;
      const i11 = i01 + 1;
      if (!samples[i00].hit || !samples[i10].hit || !samples[i01].hit || !samples[i11].hit) continue;
      const dhdx = hbuf[i10] - hbuf[i00];
      const dhdy = hbuf[i01] - hbuf[i00];
      quads++;
      if (dhdx === 0 && dhdy === 0) zeroQuads++;
      // Screen-space step in metres of ground, from the exact positions.
      const sx = Math.hypot(
        samples[i10].pTrue[0] - samples[i00].pTrue[0],
        samples[i10].pTrue[1] - samples[i00].pTrue[1],
        samples[i10].pTrue[2] - samples[i00].pTrue[2]) || 1e-9;
      const sy2 = Math.hypot(
        samples[i01].pTrue[0] - samples[i00].pTrue[0],
        samples[i01].pTrue[1] - samples[i00].pTrue[1],
        samples[i01].pTrue[2] - samples[i00].pTrue[2]) || 1e-9;
      // Mikkelsen surface gradient, then one key light. The absolute look does
      // not matter; what matters is that a derivative of exactly zero shades
      // identically to its neighbours and a stepped one does not.
      //
      // GAIN is a contrast stretch and it is declared rather than hidden. At
      // the shipped bump strength the effect is a few counts, which is exactly
      // why RN-45's band statistics could not see it; a picture that is honest
      // about amplitude would be a picture of nothing. The SAME gain is applied
      // to all three modes, so the comparison between them is untouched.
      const nx = (dhdx / sx) * -0.55 * GAIN, ny = (dhdy / sy2) * -0.55 * GAIN, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      const lam = Math.max(0, (nx * 0.40 + ny * -0.30 + nz * 0.866) / nl);
      const v = Math.max(0, Math.min(255, Math.round(255 * (0.5 + 2.2 * (lam - 0.72)))));
      for (const i of [i00, i10, i01, i11]) {
        rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
      }
    }
  }
  return { rgba, quads, zeroQuads, zeroQuadFrac: quads ? zeroQuads / quads : 0, hbuf };
}

// ---------------------------------------------------------------------------
// A minimal PNG writer. The repo has no image library and this is not worth one.
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; ++i) {
    c ^= buf[i];
    for (let k = 0; k < 8; ++k) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(path: string, rgba: Uint8Array, w: number, h: number): void {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < h; ++y) {
    raw[y * (w * 4 + 1)] = 0;
    src.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------------------

function ulpAt(x: number): number {
  const a = new Float32Array(1); a[0] = x;
  const i = new Uint32Array(a.buffer); i[0] += 1;
  return a[0] - f32(x);
}

function pixelFootprintM(distM: number): number {
  const perp = (2 * Math.tan((FOV_DEG * Math.PI) / 360) * distM) / H;
  return perp / Math.max(EYE_M / distM, 1e-6);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('WG-51 terrain surface-art precision experiment');
  console.log(`  radius ${R_BODY} m  fov ${FOV_DEG}  ${W}x${H}  eye ${EYE_M} m  pitch ${PITCH_DEG}`);
  console.log(`  ground direction ${DIR.map((v) => v.toFixed(4)).join(', ')}`);
  console.log(`  planet-centred components ${DIR.map((v) => (v * R_BODY).toFixed(0)).join(', ')} m`);
  console.log('');
  const ulpM = Math.max(...DIR.map((v) => ulpAt(v * R_BODY)));
  console.log(`  float32 ULP on the worst component of pM : ${ulpM.toFixed(6)} m`);
  console.log('');
  console.log('   range   pixel footprint    quantum / footprint');
  for (const d of [2, 3, 5, 8, 15, 30]) {
    const fp = pixelFootprintM(d);
    console.log(`   ${String(d).padStart(3)} m   ${(fp * 1000).toFixed(2).padStart(9)} mm` +
      `      ${(ulpM / fp).toFixed(2).padStart(7)}x`);
  }
  console.log('');

  const samples: Sample[] = new Array(W * H);
  for (let y = 0; y < H; ++y) for (let x = 0; x < W; ++x) samples[y * W + x] = castPixel(x, y);

  console.log('   mode    screen derivative EXACTLY zero        ms');
  const got: Partial<Record<Mode, Result>> = {};
  for (const mode of ['truth', 'defect', 'finefix', 'fix'] as Mode[]) {
    const t0 = Date.now();
    const r = render(mode, samples);
    got[mode] = r;
    writePng(resolve(OUT_DIR, `WG51_artphase_${mode}.png`), r.rgba, W, H);
    console.log(`   ${mode.padEnd(7)} ${String(r.zeroQuads).padStart(7)} / ${r.quads} quads` +
      ` = ${(100 * r.zeroQuadFrac).toFixed(2).padStart(6)}%   ${String(Date.now() - t0).padStart(6)}`);
  }
  console.log('');

  // Field agreement against the ideal. This is the half the zero-quad count
  // cannot tell you: a mode could have a perfectly live derivative of the WRONG
  // field. The fix has to reconstruct the same ground, not merely a smooth one.
  console.log('   agreement with truth, over the whole frame');
  const t = got.truth!.hbuf;
  for (const mode of ['defect', 'finefix', 'fix'] as Mode[]) {
    const b = got[mode]!.hbuf;
    let maxAbs = 0, sum = 0, n = 0;
    for (let i = 0; i < W * H; ++i) {
      if (!samples[i].hit) continue;
      const d = Math.abs(b[i] - t[i]);
      if (d > maxAbs) maxAbs = d;
      sum += d; n++;
    }
    console.log(`   ${mode.padEnd(7)} max |h - h_truth| ${maxAbs.toExponential(3)}` +
      `   mean ${(sum / n).toExponential(3)}`);
  }
  console.log('');
  console.log(`  wrote ${OUT_DIR}`);
}

main();
