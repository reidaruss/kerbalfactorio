// RN-2730. THE AEROSOL AMPLITUDE LADDER AT ANY POSE, WITH THE ARMING READ BACK
// OFF EACH PHOTOGRAPHED PAGE AND A REPEAT-CAPTURE NULL TAKEN IN THE SAME
// SESSION.
//
// WHY IT IS NOT `rn2660shots.mjs` WITH DIFFERENT FLAGS. That tool's arms are a
// fixed four and its readback is the treeline handle's. This lane's arms are a
// SWEEP over one continuous parameter, its readback is the atmosphere handle's
// (`artframe.js`'s `atmos` block, added by this lane), and it needs the thing
// no shot tool in this directory has ever taken: a SECOND capture of an
// identical arm, in the same session against the same server process, so that
// every delta in the table below can be read against the delta the instrument
// produces when nothing at all has changed.
//
// WORLD AUDIT R6 4.1 swept `?aerosol=` at `flyover` only. NUMBERS.md's RN-2700
// entry says a diff means nothing until its same-build null is measured, and
// that the null is a property of what MOVES in the frame rather than of the
// instrument, so it has to be re-taken per pose. `vista` and `limb` are new
// poses for this sweep and neither has ever had one.
//
//   node tools/smoke/rn2730arms.mjs --url=http://127.0.0.1:5730/ --shot=flyover
//   node tools/smoke/rn2730arms.mjs --url=http://127.0.0.1:5730/ --shot=vista \
//     --arms=1.00,0.75,0.50,0.25,0.00 --repeat=1.00
//   node tools/smoke/rn2730arms.mjs --url=... --shot=limb --out=../build/rn2730
//
// EVERY FLAG NEEDS AN `=`. `--arms=` is the amplitude list; the literal string
// is used in the file name so `1.00` and `1` are distinguishable arms in a
// directory listing. `--repeat=` names ONE arm to capture a second time as the
// null; it defaults to the first arm in the list. `--out=` is resolved against
// this script and defaults to a SCRATCH directory rather than the tracked
// `docs/screenshots`, because a sweep produces many more frames than a lane
// should commit and the committed set is chosen afterwards by eye.
//
// ONE FRESH NODE PROCESS, HENCE ONE FRESH BROWSER, PER CAPTURE. `run.mjs`
// launches and tears down its own browser, so `spawnSync` per arm is the
// per-capture process isolation the brief requires; nothing is reused across
// arms except the server, which is sentinel-checked by the caller.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5730/';
const shot = argv.get('--shot') ?? 'flyover';
const arms = (argv.get('--arms') ?? '1.00,0.75,0.50,0.25,0.00').split(',');
const repeat = argv.get('--repeat') ?? arms[0];
const tag = argv.get('--tag') ?? shot;
const outDir = argv.get('--out') === undefined
  // `web/dist-*/` is the one directory shape this repo's .gitignore already
  // covers for lane scratch, so a sweep of thirty frames cannot dirty the tree
  // by accident; the handful of frames Reid must judge are copied to
  // `docs/screenshots` deliberately afterwards.
  ? path.join(HERE, '..', '..', 'dist-rn2730-shots')
  : path.resolve(HERE, argv.get('--out'));
fs.mkdirSync(outDir, { recursive: true });

// `artframe.js`'s own scenario table, quoted rather than re-derived: `limb` is
// the only `orbit` shot in this lane's set and `vista` is the only `walk` one,
// and a wrong scenario silently photographs a different camera.
const SCEN = { flyover: 'surface', vista: 'walk', limb: 'orbit' };
const scen = SCEN[shot] ?? (shot.startsWith('vista') || shot.startsWith('meadow')
  ? 'walk' : 'surface');

// `--extra=a=1,b=0` forwards further page flags to EVERY arm, on
// `rn2685shots.mjs`'s own convention (each becomes `--a=1`). This lane uses it
// for the SUBJECT PROOFS rule 6 asks for -- `--atmos=0` deletes the sky box, so
// a rectangle that claims to hold sky must go to the void and a rectangle that
// claims to hold ground must not -- and for `--skyaero=0`, the sky ray's own
// aerosol switch, which is the second, independent direction on a null.
const extra = (argv.get('--extra') ?? '').split(',').filter(Boolean)
  .map((kv) => `--${kv}`);

function one(amp, out) {
  const args = [RUN, `--url=${url}`, `--scenario=${scen}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, `--out=${out}`, `--aerosol=${amp}`,
    ...extra];
  if (scen === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    process.stderr.write(r.stderr.slice(-2000));
    return null;
  }
}

const jobs = arms.map((a) => [a, `RN2730_${tag}_a${a}.png`])
  .concat([[repeat, `RN2730_${tag}_a${repeat}_null.png`]]);

let bad = 0;
for (const [amp, name] of jobs) {
  const out = path.join(outDir, name);
  const j = one(amp, out);
  if (j === null || j.valid !== true) {
    console.error(`a=${amp}: frame FAILED ${j === null ? '' : j.why}`); bad += 1; continue;
  }
  // THE ARMING, PRINTED BESIDE EVERY FRAME, and `sigma` is the product the
  // shader holds rather than the amplitude that was requested: an arm that
  // never reached the program prints the shipped 0.00014 here and is caught
  // instead of being tabulated as a null result.
  const at = j.atmos ?? {};
  const b = j.box ?? null;
  console.log(`a=${String(amp).padEnd(5)} sigma ${at.sigma} scaleM ${at.scaleM}`
    + ` baseM ${at.baseM === null ? 'null' : Number(at.baseM).toFixed(1)}`
    + ` atmosOn ${at.atmosOn}`
    + (b ? `   box luma ${b.luma} iqr ${b.iqr}` : '')
    + `   -> ${name}`);
}
console.log(`\nrn2730arms: ${bad === 0 ? 'ok' : `${bad} failure(s)`}  -> ${outDir}`);
process.exit(bad === 0 ? 0 : 1);
