// WG-285. THE FIELD, PROJECTED INTO THE FRAME. A world-gen DIAGNOSTIC.
//
// THE QUESTION IT ANSWERS. Lane N9 (rendering.md 2.36.3) painted the far
// treeline's five control-flow rungs and found that 12.41 per cent of
// `forestair`'s terrain pixels are STAGE 1 -- the outer gate refused -- and that
// the region is one coherent horizontal band rather than scattered clearings.
// At that pose `reachM` is 3,500 and `toneLive` is true, so the only term in the
// gate that can be zero is `vCanopy`, which is world-gen's field. `vCanopy` has
// exactly three ways to be zero (`ChunkCanopy.fillCanopyIndex`): the vertex's
// BIOME places no canopy props (`mu <= 0`), the vertex is at or above
// `CANOPY_MAX_ALT_M`, or `canopyWeight` itself returns zero. This tool says
// WHICH, per pixel, and it does so without a browser.
//
// WHY A PIXEL MAP AND NOT A GRID. A grid over the ground answers "is there a
// band in the world" and cannot answer "is it THIS band". The finding is stated
// in rows of a 1600x900 frame, so the instrument has to land in the same frame:
// it reconstructs the `forestair` camera, marches one ray per sample pixel
// against the SURFACE AUTHORITY (`of_surface_radius`, the same wasm entry the
// client's oracle calls), and evaluates the canopy field at the hit with
// world-gen's OWN exported functions at the same body-frame metre coordinates
// `fillCanopyIndex` uses (`dir * (R + h)`, which is `anchor + position`).
// Nothing here re-implements either half.
//
// HOW THE RECONSTRUCTION IS PROVED RATHER THAN ASSERTED (NUMBERS.md, "a derived
// number agreeing with a measured one is evidence only when the two are the same
// quantity"). Three independent checks, all printed:
//   1. the SKY/GROUND boundary row per column, which is the frame's own
//      silhouette and is compared against the captured PNG's;
//   2. the stage SHARES, against 2.36.3's measured 1.46 / 12.41 / 0.01 / 0.01 /
//      86.10 -- computed here with the same near/far and 690 m cuts;
//   3. the s1 band's ROW SPAN, against the verifier's 82 contiguous rows.
// A wrong yaw, pitch or altitude fails all three at once and loudly.
//
//   cd web
//   npx esbuild tools/smoke/wg285field.ts --bundle --platform=node \
//     --format=esm --outfile=wasm/dist/wg285field.mjs
//   node wasm/dist/wg285field.mjs [--w 400] [--h 225] [--json out.json]
//   rm wasm/dist/wg285field.mjs
//
// THE OUTFILE GOES IN `wasm/dist/` AND THAT IS NOT TIDINESS. Emscripten's
// loader resolves `of-core.wasm` relative to the SCRIPT's own directory, so a
// bundle written anywhere else looks for the binary beside itself, does not
// find it, and fails at load on a path nobody typed. `rn2265field.ts` never met
// this because it imports no wasm.
//
// OTHER MODES, all cheap and all browser-free:
//   --plan <metres> [--plann N]   a plan view of the biomes around the eye
//   --transect <bearing deg>      biome and designed height along one bearing,
//                                 with each contiguous Beach run's WIDTH
//   --census <N>                  the biome split over N uniform directions
//   --lat / --lon / --alt         override the pose, for a site with no row
//
// It is a .ts and not a .mjs for `rn2265field.ts`'s reason: the field it reads
// is TypeScript, and re-implementing it here would measure the copy.
import { BIOME_CANOPY_MU } from '../../src/render/geometry/ChunkCanopy.js';
import {
  canopyWeight, groveAt, standAt, groveWeight,
  CANOPY_FLOOR_W, CANOPY_NEAR_FULL_M, CANOPY_FAR_RADIUS_M,
  STAND_LO, STAND_HI, GROVE_LO, GROVE_HI,
  TREELINE_BARE_M, TREELINE_FULL_M, TREELINE_WANDER_M,
} from '../../src/world/ScatterTuning.js';
import createCore from '../../wasm/dist/of-core.mjs';

/** `ChunkCanopy`'s own ceiling, re-derived here because it is not exported. */
const CANOPY_MAX_ALT_M = TREELINE_BARE_M + TREELINE_WANDER_M;
/** Where the near program hands over to the scaled shell (rendering.md 2.36). */
const NEAR_PROGRAM_M = 15000;

const DEG = Math.PI / 180;
type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add3 = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

interface Pose {
  name: string; lat: number; lon: number; altM: number;
  yaw: number; pitch: number; fov: number;
}
/** `probes/artframe.js`'s own rows, quoted field for field. */
const POSES: Record<string, Pose> = {
  forestair: { name: 'forestair', lat: -19.85, lon: -72.7853, altM: 1200, yaw: 300, pitch: -14, fov: 60 },
  flyover: { name: 'flyover', lat: -3.41413, lon: 150.27984, altM: 1200, yaw: 300, pitch: -14, fov: 60 },
};

function arg(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

async function main(): Promise<void> {
  const M = await createCore() as unknown as {
    _of_body_create_forge(lo: number, hi: number): number;
    _of_body_radius(b: number): number;
    _of_surface_radius(b: number, e: number, x: number, y: number, z: number): number;
    _of_biome_at(b: number, x: number, y: number, z: number): number;
    _of_abi_version(): number;
  };
  const body = M._of_body_create_forge(0x0bf00d01, 0);
  const R = M._of_body_radius(body);
  const surf = (d: V3): number => M._of_surface_radius(body, 0, d[0], d[1], d[2]);
  const biomeOf = (d: V3): number => M._of_biome_at(body, d[0], d[1], d[2]);

  const pose = { ...POSES[arg('--pose', 'forestair')] };
  // A bare lat/lon override, so a GUARD pose that has no row here can still be
  // asked what biomes its ground carries without inventing a shot for it.
  if (Number.isFinite(Number(arg('--lat', 'NaN')))) pose.lat = Number(arg('--lat', '0'));
  if (Number.isFinite(Number(arg('--lon', 'NaN')))) pose.lon = Number(arg('--lon', '0'));
  if (Number.isFinite(Number(arg('--alt', 'NaN')))) pose.altM = Number(arg('--alt', '0'));
  const W = Number(arg('--w', '400'));
  const H = Number(arg('--h', '225'));
  const maxM = Number(arg('--max', '60000'));

  // The eye. `ObserverCamera.update` -> `SurfaceOracle.observerPos`: altM is
  // above the DESIGNED SURFACE at the pose's own lat/lon, not above the datum.
  const cl = Math.cos(pose.lat * DEG);
  const up: V3 = [cl * Math.cos(pose.lon * DEG), Math.sin(pose.lat * DEG), cl * Math.sin(pose.lon * DEG)];
  const groundM = surf(up) - R;
  const eye: V3 = [up[0], up[1], up[2]].map((c) => c * (R + groundM + pose.altM)) as V3;

  // `ObserverCamera.rebuildBasis`: east = POLAR x up, north = up x east.
  const east = unit(cross([0, 1, 0], up));
  const north = unit(cross(up, east));
  const cp = Math.cos(pose.pitch * DEG), sp = Math.sin(pose.pitch * DEG);
  const fwd = unit([0, 1, 2].map((k) =>
    east[k] * Math.sin(pose.yaw * DEG) * cp + north[k] * Math.cos(pose.yaw * DEG) * cp
    + up[k] * sp) as V3);
  const right = unit(cross(fwd, up));
  const camUp = unit(cross(right, fwd));
  const tanV = Math.tan(pose.fov * 0.5 * DEG);
  const aspect = 16 / 9;

  // One ray, marched against the surface authority. Sphere-tracing with a step
  // bounded by the altitude above ground: a terrain slope steeper than about 68
  // degrees could in principle be stepped over, and none of this planet's
  // designed relief is (the scatter's own `MIN_SLOPE_COS` calls 57 degrees the
  // steepest ground it will stand on). The last interval is bisected 24 times,
  // which is sub-millimetre at 60 km.
  function march(d: V3): { hit: boolean; dir: V3; hM: number; rangeM: number } {
    let t = 0;
    let prevT = 0, prevAlt = pose.altM;
    while (t < maxM) {
      const p = add3(eye, d, t);
      const r = len(p);
      const dir: V3 = [p[0] / r, p[1] / r, p[2] / r];
      const alt = r - surf(dir);
      if (alt <= 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 24; ++k) {
          const mid = (lo + hi) * 0.5;
          const q = add3(eye, d, mid);
          const rq = len(q);
          const dq: V3 = [q[0] / rq, q[1] / rq, q[2] / rq];
          if (rq - surf(dq) <= 0) hi = mid; else lo = mid;
        }
        const q = add3(eye, d, hi);
        const rq = len(q);
        const dq: V3 = [q[0] / rq, q[1] / rq, q[2] / rq];
        return { hit: true, dir: dq, hM: surf(dq) - R, rangeM: hi };
      }
      prevT = t;
      t += Math.max(6, Math.min(600, alt * 0.4));
    }
    return { hit: false, dir: [0, 0, 0], hM: 0, rangeM: 0 };
  }

  // THE PLAN VIEW. A frame answers "is the band in the picture"; only a map of
  // the GROUND answers "what shape is it in the world", and a coastline and a
  // contour line look identical in one frame.
  const planM = Number(arg('--plan', '0'));
  if (planM > 0) {
    const N = Number(arg('--plann', '81'));
    const hist = new Map<number, number>();
    const rows: string[] = [];
    const glyph = ['O', 'b', 'P', 'F', 'H', 'M', 'X', 'r', 'g', 'c'];
    for (let jy = 0; jy < N; ++jy) {
      let line = '  ';
      for (let ix = 0; ix < N; ++ix) {
        const u = ((ix / (N - 1)) - 0.5) * planM;
        const v = (0.5 - (jy / (N - 1))) * planM;
        const d = unit([0, 1, 2].map((c) => up[c] * R + east[c] * u + north[c] * v) as V3);
        const b = biomeOf(d);
        hist.set(b, (hist.get(b) ?? 0) + 1);
        line += glyph[b] ?? '?';
      }
      rows.push(line);
    }
    console.log(`  PLAN ${planM} m across, ${N}x${N} samples, north up, east right, eye at centre`);
    console.log('  O Ocean  b Beach  P Plains  F Forest  H Hills  M Mountains  X Polar');
    for (const r of rows) console.log(r);
    console.log(`  plan biome share: ${[...hist].sort((a, b) => b[1] - a[1])
      .map(([b, q]) => `${glyph[b]}${((100 * q) / (N * N)).toFixed(1)}%`).join('  ')}`);
  }

  // The five rungs, named as lane N9 named them, plus the CAUSE decomposition
  // stage 1 alone cannot carry.
  // THE TRANSECT. A band's WIDTH is the number the diagnosis turns on, and a
  // frame measures it foreshortened. This walks the ground along one bearing
  // and prints biome and designed height, so "the beach is N kilometres wide"
  // is a measured metre count rather than an impression of a picture.
  const transectAz = Number(arg('--transect', 'NaN'));
  if (Number.isFinite(transectAz)) {
    const step = Number(arg('--tstep', '250'));
    const far = Number(arg('--tmax', '16000'));
    const tan: V3 = [0, 1, 2].map((c) =>
      north[c] * Math.cos(transectAz * DEG) + east[c] * Math.sin(transectAz * DEG)) as V3;
    console.log(`  TRANSECT bearing ${transectAz} deg, ${step} m steps to ${far} m`);
    let runB = 0, runStart = 0;
    for (let s = 0; s <= far; s += step) {
      const a = s / R;
      const d = unit([0, 1, 2].map((c) => up[c] * Math.cos(a) + tan[c] * Math.sin(a)) as V3);
      const b = biomeOf(d);
      const h = surf(d) - R;
      if (b === 1) { if (runB === 0) runStart = s; runB += step; } else if (runB > 0) {
        console.log(`    BEACH run ${runStart}..${s - step} m = ${runB - step} m wide`);
        runB = 0;
      }
      if (s % (step * 4) === 0) console.log(`    ${String(s).padStart(6)} m  biome ${b}  designed ${h.toFixed(1)} m`);
    }
    if (runB > 0) console.log(`    BEACH run ${runStart}..${far} m = ${runB} m wide (open at the end)`);
  }

  // THE CENSUS. Whether a biome's realised area is credible is a planet-scale
  // question and this site cannot answer it.
  const censusN = Number(arg('--census', '0'));
  if (censusN > 0) {
    const hist = new Map<number, number>();
    let seed = 12345;
    const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    for (let s = 0; s < censusN; ++s) {
      const z = rnd() * 2 - 1, th = rnd() * 2 * Math.PI, rr = Math.sqrt(1 - z * z);
      const b = biomeOf([rr * Math.cos(th), z, rr * Math.sin(th)]);
      hist.set(b, (hist.get(b) ?? 0) + 1);
    }
    const names = ['Ocean', 'Beach', 'Plains', 'Forest', 'Hills', 'Mountains', 'Polar'];
    console.log(`  PLANET CENSUS over ${censusN} uniform directions: ${[...hist]
      .sort((a, b) => b[1] - a[1])
      .map(([b, q]) => `${names[b] ?? b} ${((100 * q) / censusN).toFixed(2)}%`).join('  ')}`);
  }

  // THE HUD EXCLUSION IS N9's, NOT A CHOICE. `rn2560map.mjs` argmaxes with
  // `pngdiff.mjs`'s own window (left 210, bottom 80 of 1600x900), so a share
  // computed over the whole frame is not the same quantity as 2.36.3's.
  const hudLeft = Number(arg('--hudleft', '210')) / 1600;
  const hudBottom = 1 - Number(arg('--hudbottom', '80')) / 900;
  const inWindow = (i: number, j: number): boolean =>
    (i + 0.5) / W >= hudLeft && (j + 0.5) / H <= hudBottom;

  const stage = new Int8Array(W * H);      // -1 sky, 0..4 the rungs
  const cause = new Int8Array(W * H);      // 0 n/a, 1 biome mu, 2 altitude, 3 weight
  const biomeOfPx = new Int8Array(W * H).fill(-1);
  const altOfPx = new Float32Array(W * H);
  const rngOfPx = new Float32Array(W * H);
  const vOfPx = new Float32Array(W * H);
  const horizonRow = new Int16Array(W).fill(-1);

  for (let i = 0; i < W; ++i) {
    const ndcX = (2 * (i + 0.5)) / W - 1;
    for (let j = 0; j < H; ++j) {
      const k = j * W + i;
      const ndcY = 1 - (2 * (j + 0.5)) / H;
      const d = unit([0, 1, 2].map((c) =>
        fwd[c] + right[c] * ndcX * tanV * aspect + camUp[c] * ndcY * tanV) as V3);
      const h = march(d);
      if (!h.hit) { stage[k] = -1; continue; }
      if (horizonRow[i] < 0) horizonRow[i] = j;
      const b = biomeOf(h.dir);
      const mu = BIOME_CANOPY_MU[b] ?? 0;
      const p: V3 = [h.dir[0], h.dir[1], h.dir[2]].map((c) => c * (R + h.hM)) as V3;
      const w = (mu <= 0 || h.hM >= CANOPY_MAX_ALT_M)
        ? 0 : canopyWeight(h.hM, standAt(p[0], p[1], p[2]), groveAt(p[0], p[1], p[2]));
      const v = w > 0 ? w * mu : 0;
      biomeOfPx[k] = b; altOfPx[k] = h.hM; rngOfPx[k] = h.rangeM; vOfPx[k] = v;
      // The shader's own control flow, mirrored: the scaled program owns the
      // fragment past the chunk-depth handover; inside 690 m the term is zero
      // by design; otherwise the gate is `vCanopy > 0`.
      if (h.rangeM >= NEAR_PROGRAM_M) stage[k] = 0;
      else if (v <= 0) {
        stage[k] = 1;
        cause[k] = mu <= 0 ? 1 : h.hM >= CANOPY_MAX_ALT_M ? 2 : 3;
      } else if (h.rangeM <= CANOPY_NEAR_FULL_M) stage[k] = 2;
      else stage[k] = 4;
    }
  }

  // ---- the report -------------------------------------------------------
  const win = new Uint8Array(W * H);
  for (let j = 0; j < H; ++j) for (let i = 0; i < W; ++i) win[j * W + i] = inWindow(i, j) ? 1 : 0;
  const count = (p: (k: number) => boolean): number => {
    let n = 0;
    for (let k = 0; k < stage.length; ++k) if (win[k] === 1 && p(k)) n++;
    return n;
  };
  const terrain = count((k) => stage[k] >= 0);
  const share = (t: number): string => {
    const n = count((k) => stage[k] === t);
    return `${((100 * n) / terrain).toFixed(2)}% (${n})`;
  };
  const out: Record<string, unknown> = {};
  console.log(`wg285field  pose=${pose.name} abi=${M._of_abi_version()} R=${(R / 1000).toFixed(0)} km`);
  console.log(`  eye: lat ${pose.lat} lon ${pose.lon} ground ${groundM.toFixed(1)} m alt +${pose.altM} m`
    + ` yaw ${pose.yaw} pitch ${pose.pitch} fov ${pose.fov}`);
  console.log(`  grid ${W}x${H} rays, march cap ${maxM} m, terrain samples ${terrain}`);
  console.log(`  STAGE SHARES  s0 ${share(0)}  s1 ${share(1)}  s2 ${share(2)}  s4 ${share(4)}`);

  const causeName = ['-', 'BIOME mu=0', 'ALTITUDE cut', 'canopyWeight 0'];
  for (let c = 1; c <= 3; ++c) {
    const n = count((k) => stage[k] === 1 && cause[k] === c);
    if (n === 0) continue;
    const biomes = new Map<number, number>();
    let altLo = Infinity, altHi = -Infinity, rLo = Infinity, rHi = -Infinity;
    for (let k = 0; k < stage.length; ++k) {
      if (win[k] === 0 || stage[k] !== 1 || cause[k] !== c) continue;
      biomes.set(biomeOfPx[k], (biomes.get(biomeOfPx[k]) ?? 0) + 1);
      altLo = Math.min(altLo, altOfPx[k]); altHi = Math.max(altHi, altOfPx[k]);
      rLo = Math.min(rLo, rngOfPx[k]); rHi = Math.max(rHi, rngOfPx[k]);
    }
    console.log(`  s1 CAUSE ${causeName[c]}: ${n} px (${((100 * n) / terrain).toFixed(2)}% of terrain)`
      + `  biomes ${[...biomes].map(([b, q]) => `${b}:${q}`).join(' ')}`
      + `  alt ${altLo.toFixed(0)}..${altHi.toFixed(0)} m  range ${rLo.toFixed(0)}..${rHi.toFixed(0)} m`);
    out[`cause${c}`] = { n, altLo, altHi, rLo, rHi, biomes: [...biomes] };
  }

  // The band: per-row s1 share, and the longest contiguous run of rows over
  // half. Rows are quoted SCALED TO 900 so they can be read against the frame.
  const rowS1: number[] = [], rowTer: number[] = [];
  for (let j = 0; j < H; ++j) {
    let s1 = 0, ter = 0;
    for (let i = 0; i < W; ++i) {
      const k = j * W + i;
      if (win[k] === 0) continue;
      if (stage[k] >= 0) ter++;
      if (stage[k] === 1) s1++;
    }
    rowS1.push(s1); rowTer.push(ter);
  }
  let bestA = -1, bestB = -1, curA = -1;
  for (let j = 0; j <= H; ++j) {
    const on = j < H && rowTer[j] > 0 && rowS1[j] / rowTer[j] >= 0.5;
    if (on && curA < 0) curA = j;
    if (!on && curA >= 0) { if (j - curA > bestB - bestA) { bestA = curA; bestB = j; } curA = -1; }
  }
  const to900 = (j: number): number => Math.round((j * 900) / H);
  if (bestA >= 0) {
    let inBand = 0;
    for (let j = bestA; j < bestB; ++j) inBand += rowS1[j];
    const total = rowS1.reduce((a, b) => a + b, 0);
    console.log(`  S1 BAND: sample rows ${bestA}..${bestB - 1} = 900-frame rows ${to900(bestA)}..${to900(bestB)}`
      + ` (${to900(bestB) - to900(bestA)} rows of 900), holding ${((100 * inBand) / total).toFixed(1)}%`
      + ` of all s1 samples; peak row width ${(100 * Math.max(
        ...rowS1.slice(bestA, bestB).map((s, q) => s / Math.max(1, rowTer[bestA + q])))).toFixed(0)}%`);
    out.band = { a900: to900(bestA), b900: to900(bestB), inBandPct: (100 * inBand) / total };
  }
  console.log('  row profile (900-frame row: s1 share of that row\'s terrain, biome histogram)');
  for (let j = 0; j < H; ++j) {
    if (rowTer[j] === 0) continue;
    const f = rowS1[j] / rowTer[j];
    if (f < 0.02) continue;
    const bh = new Map<number, number>();
    for (let i = 0; i < W; ++i) {
      const k = j * W + i;
      if (win[k] === 1 && stage[k] >= 0) bh.set(biomeOfPx[k], (bh.get(biomeOfPx[k]) ?? 0) + 1);
    }
    console.log(`    r${String(to900(j)).padStart(3)}  s1 ${(100 * f).toFixed(0).padStart(3)}%`
      + `  ${[...bh].sort((a, b) => b[1] - a[1]).map(([b, q]) => `b${b}:${q}`).join(' ')}`);
  }

  // The silhouette, for the reconstruction check: the first terrain row per
  // column, scaled to 900. A captured frame's own sky/ground boundary is the
  // comparison and it is the strongest single test of yaw/pitch/altitude.
  const hz = [...horizonRow].filter((r) => r >= 0).map(to900);
  hz.sort((a, b) => a - b);
  console.log(`  HORIZON ROW (900-frame): min ${hz[0]} p50 ${hz[hz.length >> 1]} max ${hz[hz.length - 1]}`);
  out.horizon900 = [...horizonRow].map(to900);

  // The altitude distribution of each rung, because the whole question is
  // whether the band is an ALTITUDE contour or a BIOME polygon, and those two
  // predict different spreads: a contour is a narrow slice of altitude at any
  // range, a polygon is a range of altitudes bounded by a classifier band.
  for (const [t, label] of [[1, 'S1 (gate off)'], [4, 'S4 (live)']] as const) {
    const alts: number[] = [];
    for (let k = 0; k < stage.length; ++k) if (win[k] === 1 && stage[k] === t) alts.push(altOfPx[k]);
    if (alts.length === 0) continue;
    alts.sort((a, b) => a - b);
    const q = (f: number): string => alts[Math.min(alts.length - 1, Math.floor(f * alts.length))].toFixed(0);
    console.log(`  ${label} altitude m: min ${q(0)} p05 ${q(0.05)} p50 ${q(0.5)} p95 ${q(0.95)} max ${q(0.999)}`);
  }

  // A picture, because a share is not a shape. One character per sample column
  // group, one row per sample row group.
  const CW = Math.min(W, 100), CH = Math.min(H, 45);
  console.log('  MAP  . sky   B biome-mu-zero   A altitude   W weight   # live   ~ <690m   s scaled');
  for (let cy = 0; cy < CH; ++cy) {
    let line = '  ';
    for (let cx = 0; cx < CW; ++cx) {
      const i = Math.floor(((cx + 0.5) * W) / CW), j = Math.floor(((cy + 0.5) * H) / CH);
      const k = j * W + i;
      line += stage[k] < 0 ? '.' : stage[k] === 0 ? 's' : stage[k] === 2 ? '~'
        : stage[k] === 4 ? '#' : cause[k] === 1 ? 'B' : cause[k] === 2 ? 'A' : 'W';
    }
    console.log(line);
  }

  const jsonPath = arg('--json', '');
  if (jsonPath) {
    const fs = await import('node:fs');
    out.constants = {
      CANOPY_MAX_ALT_M, TREELINE_FULL_M, TREELINE_BARE_M, TREELINE_WANDER_M,
      CANOPY_FLOOR_W, STAND_LO, STAND_HI, GROVE_LO, GROVE_HI,
      CANOPY_NEAR_FULL_M, CANOPY_FAR_RADIUS_M,
      mu: BIOME_CANOPY_MU.map((x) => Number(x.toFixed(6))),
      groveFloorWeight: Number(groveWeight(0).toFixed(6)),
    };
    out.stage = [...stage]; out.cause = [...cause]; out.biome = [...biomeOfPx];
    out.alt = [...altOfPx].map((x) => Math.round(x)); out.range = [...rngOfPx].map((x) => Math.round(x));
    out.v = [...vOfPx].map((x) => Number(x.toFixed(5)));
    out.grid = { W, H, pose: pose.name };
    fs.writeFileSync(jsonPath, JSON.stringify(out));
    console.log(`  wrote ${jsonPath}`);
  }
}

void main();
