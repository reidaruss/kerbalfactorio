// RN-840 / RN-842. Two runs, one mask.
//
// WHY THIS EXISTS RATHER THAN A SINGLE PROBE. The measurement is the SHADOWED
// GROUND of an airless body, and on an airless body the sky and the shadowed
// ground are the same colour, so no rule written on the shipping frame's own
// pixels can separate them. The first attempt split at a horizon ROW and, on a
// 200 km moon whose limb is a pronounced arc, put the corners of the sky into
// the ground band and reported `shadow.p50 = 0` over 58,112 pixels. A hard zero
// from a lit surface is not a small error, it is an impossible reading.
//
// So the mask comes from GEOMETRY: run 1 loads with `?clear=RRGGBB`, which
// Boot.ts uses to suppress the sky box entirely, leaving every pixel with no
// geometry behind it at the clear colour. That is an exact per-pixel sky test
// at any illumination on any body. Run 2 loads normally and is handed run 1's
// per-column boundary.
//
// THE TWO RUNS ARE ONLY COMPARABLE IF THEY DREW THE SAME GEOMETRY, and this
// script does not assume that, it CHECKS it: both runs pin the same seed, the
// same scenario, the same pose and the same solved sun, both wait for
// `chunks.converged`, and the ground pixel COUNTS are compared at the end. A
// mask built on a different chunk set would show up there as a population that
// changed size, and the script says so rather than reporting statistics over a
// misaligned split.
//
//   node tools/smoke/airlesspair.mjs --url=http://127.0.0.1:4231/ --body=cinder \
//     --scenario=ascent --lat=2 --lon=144 --alt=12000 --pitch=-12 --sundot=0.55
//
// Everything after the known flags is passed through to BOTH runs, so
// `--groundreliefamp=0` or `--terrainspec=0` applies to the pair and not to one
// half of it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'run.mjs');
const probe = join(here, 'probes', 'airless.js');

const KNOWN = new Set(['url', 'body', 'scenario', 'lat', 'lon', 'alt', 'pitch',
                       'yaw', 'sundot', 'width', 'height', 'clear', 'name', 'out']);
const args = new Map();
const passthrough = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m === null) continue;
  if (KNOWN.has(m[1])) args.set(m[1], m[2] ?? '1'); else passthrough.push(a);
}

const url = args.get('url') ?? 'http://127.0.0.1:4231/';
const body = args.get('body') ?? 'cinder';
const scenario = args.get('scenario') ?? 'ascent';
const lat = Number(args.get('lat') ?? 2.0);
const lon = Number(args.get('lon') ?? 144.0);
const alt = Number(args.get('alt') ?? 12000);
const pitch = Number(args.get('pitch') ?? -12);
const yaw = Number(args.get('yaw') ?? 0);
const sundot = Number(args.get('sundot') ?? 0.55);
const width = args.get('width') ?? '1600';
const height = args.get('height') ?? '900';
// Saturated magenta: no terrain palette entry is near it, so a stray match is a
// bug and not a coincidence, and it is visible instantly if a frame is opened.
const clear = args.get('clear') ?? 'ff00ff';
const name = args.get('name') ?? 'pose';
const out = args.get('out') ?? null;

const pose = { name, lat, lon, alt, yaw, pitch, sundot };

const tmp = mkdtempSync(join(tmpdir(), 'of-airless-'));
const runOne = (extra, evalArgs, outPng) => {
  // The mask is 1,600 integers under 900, so the serialised argument is about
  // 8 kB against Windows' 32 kB command line. It is passed INLINE and not
  // through a file because `spawnSync` with an argv ARRAY does not invoke a
  // shell, so there is no quoting layer to get wrong, and because adding an
  // `@file` form to `run.mjs` would be editing a harness four lanes share for
  // the benefit of one script.
  const argv = [
    runner, `--url=${url}`, `--body=${body}`, `--scenario=${scenario}`,
    `--lat=${lat}`, `--lon=${lon}`, `--width=${width}`, `--height=${height}`,
    `--evalfile=${probe}`, `--evalargs=${JSON.stringify(evalArgs)}`,
    ...extra, ...passthrough,
  ];
  if (outPng !== null && outPng !== undefined) argv.push(`--out=${outPng}`);
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = `${r.stdout}${r.stderr}`;
  const m = text.match(/\{[\s\S]*\n\}/);
  if (m === null) {
    console.error(text.slice(-4000));
    throw new Error('airlesspair: no JSON in runner output');
  }
  return { json: JSON.parse(m[0]), text };
};

// --- run 1: the mask ---------------------------------------------------------
const a = runOne([`--clear=${clear}`],
                 { clear, emitMask: true, poses: [pose] }, null);
const rowA = a.json.eval.rows[0];
if (!a.json.eval.valid) {
  console.error('airlesspair: the MASK run failed its own fixtures, so nothing');
  console.error('  downstream of it means anything:', a.json.eval.fails);
  process.exit(1);
}
const maskCols = rowA.maskCols;
if (!Array.isArray(maskCols)) throw new Error('airlesspair: run 1 emitted no mask');

// --- run 2: the shipping frame, measured through run 1's mask ----------------
const b = runOne([], { maskCols, poses: [pose] }, out);
const rowB = b.json.eval.rows[0];

// --- the alignment check, which is the reason this is not two loose runs -----
const dn = Math.abs(rowA.ground.n - rowB.ground.n);
const aligned = dn === 0;
const strip = (r) => ({
  elevationDot: r.elevationDot, sun: r.sun, air: r.air,
  maskSource: r.maskSource, maskSkyFrac: r.maskSkyFrac, edgeDropped: r.maskEdgeDropped,
  ground: r.ground, sky: r.sky, starPx: r.starPx,
  otsu: r.otsu, shadowFrac: r.shadowFrac,
  shadow: r.shadow, sunlit: r.sunlit, shadowOverSunlit: r.shadowOverSunlit,
});

console.log(JSON.stringify({
  pose,
  passthrough,
  // Both runs' fixture verdicts. Run 2's mask is carried, so its own
  // clear-colour assertions do not apply and it reports `valid` on the rest.
  validMaskRun: a.json.eval.valid,
  validShipRun: b.json.eval.valid,
  failsShipRun: b.json.eval.fails,
  // THE ALIGNMENT CLAIM, stated as a number rather than assumed. Identical
  // ground-pixel counts mean the two runs drew the same silhouette, which is
  // what makes run 1's split a legitimate partition of run 2's frame.
  alignment: { groundPxMask: rowA.ground.n, groundPxShip: rowB.ground.n,
               delta: dn, aligned },
  maskRun: strip(rowA),
  shipRun: strip(rowB),
  // WHETHER THE MASK FRAME IS ALSO A MEASUREMENT FRAME. Removing the sky box
  // removes the environment capture, which changes stock-material props and
  // must NOT change the terrain, because TerrainShader lights itself and never
  // reads `scene.environment`. If these deltas are small the two frames are
  // interchangeable for terrain work and one run does; if they are not, the
  // mask run is a mask and nothing else.
  skyBoxEffectOnGround: {
    meanDelta: +(rowB.ground.mean - rowA.ground.mean).toFixed(3),
    p50Delta: +(rowB.ground.p50 - rowA.ground.p50).toFixed(2),
    shadowP50Delta: (rowA.shadow && rowB.shadow)
      ? +(rowB.shadow.p50 - rowA.shadow.p50).toFixed(2) : null,
  },
}, null, 2));

rmSync(tmp, { recursive: true, force: true });
if (!aligned) {
  console.error(`airlesspair: MISALIGNED, the two runs drew different silhouettes `
    + `(${dn} px). The split is not a partition of the measured frame.`);
  process.exit(1);
}
