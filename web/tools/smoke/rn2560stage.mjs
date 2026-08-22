// RN-2560 (rendering, LANE N9). THE FAR TREELINE'S LIVE/DEAD MAP, per pose and
// per committed rectangle.
//
// WHY A NEW TOOL AND NOT AN AMPLITUDE SWEEP. The term had been reported moving
// a rectangle by exactly 0.00 counts on BOTH sides of its own range, and
// NUMBERS.md's own entry (RN-2514) says a term that is GATED OFF sweeps as a
// weak term rather than as a missing one. So the branch is painted rather than
// scaled: `?treelinepaint=3+k` paints stage k at 0.20 and every other terrain
// fragment EXACTLY BLACK, which is the one value that survives an ACES grade
// unambiguously, and a rectangle's own mean over that arm is then a direct
// reading of how much of it sat at that stage.
//
//   stage 0  the SCALED terrain program drew it, so the whole term is
//            compiled out of that fragment by `#ifndef OF_SCALED`
//   stage 1  near program, outer gate refused (amp 0, reach 0, or vCanopy 0)
//   stage 2  gate passed, inside OF_TREE_NEAR_M: zero BY DESIGN
//   stage 3  Beer-Lambert evaluated, coverage effectively nothing
//   stage 4  evaluated AND contributing: the term is LIVE here
//
// EVERY ARM RUNS WITH `terrainhaze=0`, and that is load-bearing rather than
// tidy: aerial perspective is `col * T + Lin`, so at range the additive floor
// paints a "black" fragment the colour of the air and the exactness of the
// zero is gone. `terrainhaze=0` is the terrain's own isolator (RN-2540) and it
// reaches BOTH programs, which is what keeps the stage-0 rung readable.
//
//   node tools/smoke/rn2560stage.mjs --url=http://127.0.0.1:5960/ \
//     --shots=meadow,meadowfield,forestair,flyover,vista,mtnslope
//
// `--extra=` appends page params to every arm; `--png=<prefix>` also writes the
// stage-hue frame (`?treelinepaint=1`) and the coverage frame
// (`?treelinepaint=2`) per shot. The prefix is passed to `run.mjs --out`, which
// resolves against the REPO ROOT and not the cwd, so it reads
// `docs/screenshots/RN2560` and never `../docs/...`.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5960/';
const shots = (argv.get('--shots') ?? 'forestair').split(',');
const extra = (argv.get('--extra') ?? '').split('+').filter(Boolean);
const pngPrefix = argv.get('--png');
const jsonOut = argv.get('--json');

// artframe.js's own scenario split, copied from rn2540arms.mjs so a row here is
// comparable with a row there.
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' || s === 'vista' || s === 'vistadawn' || s === 'vistanoon'
  || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot, params, outPng) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  if (outPng) args.push(`--out=${outPng}`);
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  for (const f of [...params, ...extra]) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-500) };
  }
}

/** Every committed rectangle on a capture, `box` first then `extra`, in order. */
function rectsOf(e) {
  const out = [];
  // `world` FIRST, and it is not decoration: a committed rectangle can be on
  // the wrong side of the horizon (NUMBERS.md, RN-2475) and answer for ground
  // it does not contain, so the whole frame is read beside them.
  if (e.world) out.push(['world', e.world]);
  if (e.box) out.push(['box', e.box]);
  for (const [k, v] of Object.entries(e.extra ?? {})) {
    if (v && typeof v.luma === 'number') out.push([k, v]);
  }
  return out;
}

const rows = [];
for (const shot of shots) {
  const arms = [];
  for (let k = 0; k <= 4; ++k) {
    const e = once(shot, [`treelinepaint=${3 + k}`, 'terrainhaze=0'],
      pngPrefix ? `${pngPrefix}_${shot}_s${k}.png` : null);
    arms.push(e);
  }
  if (pngPrefix) {
    once(shot, ['treelinepaint=1', 'terrainhaze=0'],
      `${pngPrefix}_${shot}_stage.png`);
    once(shot, ['treelinepaint=2', 'terrainhaze=0'],
      `${pngPrefix}_${shot}_cover.png`);
  }
  const t0 = arms[0].treeline ?? {};
  console.log(`\n== ${shot}  valid=${arms.map((a) => a.valid).join('/')}`
    + `  paintUniform=${arms.map((a) => (a.treeline ?? {}).paint).join('/')}`
    + `  reachM=${(t0.reachM ?? NaN).toFixed?.(1) ?? t0.reachM}`
    + `  toneLive=${(t0.tone ?? {}).live}`);
  console.log('   rectangle        s0 SCALED   s1 GATE-OFF  s2 <690m'
    + '    s3 ZERO      s4 LIVE');
  const names = rectsOf(arms[0]).map(([n]) => n);
  for (const n of names) {
    const cells = arms.map((e) => {
      const r = rectsOf(e).find(([m]) => m === n);
      return r ? r[1].luma : NaN;
    });
    console.log(`   ${n.padEnd(14)} ` + cells
      .map((v) => (Number.isFinite(v) ? v.toFixed(2) : '--').padStart(11)).join(' '));
    rows.push({ shot, rect: n, s0: cells[0], s1: cells[1], s2: cells[2],
      s3: cells[3], s4: cells[4] });
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
