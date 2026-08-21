// RN-2495. THE AERIAL CROWN-CHROMA ARM SWEEPER (rendering, R4 LANE N3).
//
// `rn2320sweep.mjs` prints luma / warm / sat and that is the instrument L3 and
// M1 were judged on. It cannot see the thing THIS lane is about. "The crowns
// read blue-grey and the ground does not" is a statement about GREEN EXCESS --
// how far the green channel sits above the mean of the other two -- and a
// frame can hold its luma, its warm (R - B) and even its HSV `sat` while the
// green excess goes to zero, because `warm` is blind to G by construction and
// `sat` is a max-minus-min that a blue-and-red pair satisfies just as well as
// a green one does. So this tool publishes
//
//     gx = meanG - (meanR + meanB) / 2      counts, positive is green
//
// on every named rectangle, beside the numbers the other sweeper prints, so a
// row from this tool and a row from that one are on one scale and one capture.
//
// AND IT PAIRS EVERY ARM AGAINST `?canopy=0` ON THE SAME RECTANGLE, which is
// RN-2275's own instrument (2.19.4) reused rather than a new hand-placed
// crown rectangle: with the vegetation removed the box is the CLEARING, so
// `gx(shipped) - gx(canopy=0)` is the crowns' OWN chroma contribution with the
// pose, the range, the haze, the sun and the substrate common-mode by
// construction. Nothing is placed by eye and there is no rectangle for a later
// reader to argue about.
//
//   node tools/smoke/rn2495arms.mjs --url=http://127.0.0.1:5495/ \
//     --shots=forestair,forestairnoon --arms=,canopy=0,foliagetone=0,propsky=0
//
// `--arms` is a comma-separated list of page params; an EMPTY entry is the
// shipped arm. Fresh process per call site (WG-189's rule), same server.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5495/';
const shots = (argv.get('--shots') ?? 'forestair,forestairnoon').split(',');
const arms = (argv.get('--arms') ?? ',canopy=0').split(',');
const repeats = Number(argv.get('--repeats') ?? 1);
const rects = (argv.get('--rects') ?? 'box,under,hzBand').split(',');
const pngPrefix = argv.get('--png');

const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' || s === 'vista' || s === 'vistadawn' || s === 'vistanoon'
  || s === 'dawnsun' ? 'surface' : 'walk');

function once(shot, arm, outPng) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`];
  if (outPng) args.push(`--out=${outPng}`);
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  // `+` joins several page params into ONE arm, because this lane's own
  // negative control is two constants and not one (`canopysat=0.62+canopychloro=0`).
  for (const f of arm.split('+').filter(Boolean)) args.push(`--${f}`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    const j = JSON.parse(r.stdout);
    // WG-189's cost half rides the same capture rather than a second run: two
    // runs of the same arm cannot hold the streamed chunk set equal.
    return Object.assign(j.eval, { p50: j.stats?.frameMs?.p50, tri: j.stats?.triangles });
  } catch {
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

/** Green excess in counts. `rgb` is the probe's own mean triple. */
const gx = (s) => (s && s.rgb ? s.rgb[1] - (s.rgb[0] + s.rgb[2]) / 2 : NaN);

const seen = {};
for (const shot of shots) {
  for (const arm of arms) {
    for (let i = 0; i < repeats; ++i) {
      const tag = arm === '' ? 'SHIPPED' : arm;
      const outPng = pngPrefix
        ? `${pngPrefix}_${shot}_${(arm || 'shipped').replace(/[^a-z0-9]/gi, '')}.png` : null;
      const e = once(shot, arm, outPng);
      const cells = [shot.padEnd(15), tag.padEnd(20), `valid=${String(e.valid).padEnd(5)}`];
      for (const rn of rects) {
        const s = rn === 'box' ? e.box : (e.extra ?? {})[rn];
        if (!s) { cells.push(`${rn}=--`); continue; }
        cells.push(`${rn}[L=${s.luma.toFixed(2)} gx=${gx(s).toFixed(2)}`
          + ` warm=${s.warm.toFixed(2)} sat=${s.sat.toFixed(3)} iqr=${s.iqr.toFixed(2)}]`);
        seen[`${shot}|${tag}|${rn}`] = { luma: s.luma, gx: +gx(s).toFixed(2), warm: s.warm };
      }
      const w = e.world ?? {};
      cells.push(`world[L=${w.luma !== undefined ? w.luma.toFixed(2) : '--'}`
        + ` warm=${w.warm !== undefined ? w.warm.toFixed(2) : '--'}`
        + ` sat=${w.sat !== undefined ? w.sat.toFixed(3) : '--'}]`);
      cells.push(`p50=${e.p50 === undefined ? '--' : e.p50.toFixed(2)}ms`);
      if (e.valid === false) cells.push(`WHY=${e.why}`);
      console.log(cells.join(' '));
    }
  }
  // The crown's own chroma: the shipped arm minus the treeless arm, same
  // rectangle. Printed only when both arms were asked for in this run.
  for (const rn of rects) {
    const a = seen[`${shot}|SHIPPED|${rn}`];
    const b = seen[`${shot}|canopy=0|${rn}`];
    if (a && b) {
      console.log(`${shot.padEnd(15)} ${'CROWN-MINUS-CLEARING'.padEnd(20)}`
        + ` ${rn}: dGx=${(a.gx - b.gx).toFixed(2)}`
        + ` dLuma=${(a.luma - b.luma).toFixed(2)}`
        + ` dWarm=${(a.warm - b.warm).toFixed(2)}`);
    }
  }
}
