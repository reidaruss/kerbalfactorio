// RN-2685 (WORLD AUDIT R6). CAPTURE A NAMED SET OF `artframe.js` SHOTS AT 1x,
// SHIPPED ARM, KEEPING THE PNG AND THE PROBE'S OWN JSON REPORT SIDE BY SIDE.
//
// WHY IT EXISTS AND WHY IT IS NOT `rn2660shots.mjs`. That driver is an ARM
// driver: it captures ONE shot under four named flag arms and crops the band.
// An audit's first pass is the other shape entirely -- MANY shots, ONE arm --
// and doing it by hand is a shell loop whose scenario dispatch lives in one
// agent's history. This file holds the dispatch instead, read out of
// `probes/artframe.js`'s own manifest rather than remembered, so "re-take the
// hero set" is one argument.
//
// THE DISPATCH IS PARSED, NOT TRANSCRIBED. `artframe.js` publishes
// `scenario` and `needsSandbox` per shot in the manifest, and two shots
// (`smelternight`, and `smelterhero` whose block it spreads) are declared
// outside the manifest literal. Both forms are parsed here and a shot whose
// dispatch cannot be found is a REFUSAL, never a guess: NUMBERS.md's "a shot
// can be in the manifest and in no pose branch, and then it photographs the
// spawn with every field reading correct" is exactly the failure a
// hardcoded table reproduces.
//
// THE JSON IS KEPT. `writeshot.mjs` throws the report away except for a
// stderr line. Every number this audit publishes off a frame has to be
// re-readable from the frame's own capture, so the report is written to
// `<name>.json` beside the PNG.
//
// A NON-ZERO EXIT ON ANY SHOT'S FAILURE, and the failures are listed at the
// end rather than scrolled past.
//
//   node tools/smoke/rn2685shots.mjs --url=http://127.0.0.1:5686/ \
//     --shots=meadow,forestair,flyover --out=../../../../scratch/r6
//
// `--out` is resolved against THIS FILE's directory and defaults to the
// tracked `docs/screenshots`. `--extra=a=1,b=0` forwards page flags to every
// shot in the set (each becomes `--a=1`), which is how a control arm is taken
// without a second driver.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');
const TRACKED = path.join(HERE, '..', '..', '..', 'docs', 'screenshots');

const argv = new Map(process.argv.slice(2).map((a) => {
  const i = a.indexOf('=');
  return i === -1 ? [a, '1'] : [a.slice(0, i), a.slice(i + 1)];
}));
const url = argv.get('--url') ?? 'http://127.0.0.1:5686/';
const prefix = argv.get('--prefix') ?? 'R6';
const width = argv.get('--width') ?? '1600';
const height = argv.get('--height') ?? '900';
const extra = (argv.get('--extra') ?? '').split(',').filter(Boolean)
  .map((kv) => `--${kv}`);
const outDir = argv.get('--out') === undefined
  ? TRACKED : path.resolve(HERE, argv.get('--out'));
const shots = (argv.get('--shots') ?? '').split(',').filter(Boolean);
if (shots.length === 0) {
  console.error('rn2685shots: --shots=a,b,c is required');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// ---- the dispatch, parsed out of artframe.js ------------------------------
const src = fs.readFileSync(PROBE, 'utf8');
const dispatch = new Map();
// form 1: a manifest entry, `name: {` then the scenario line within 12 lines.
for (const m of src.matchAll(/^ {4}([a-zA-Z]+): \{$/gm)) {
  const tail = src.slice(m.index, m.index + 4000);
  const d = /\n\s*scenario: '([a-z]+)', needsSandbox: (true|false)/.exec(tail);
  if (d !== null) dispatch.set(m[1], { scenario: d[1], sandbox: d[2] === 'true' });
}
// form 2: `SHOTS.name = { ...SHOTS.other, ... }`, which inherits the dispatch.
for (const m of src.matchAll(/SHOTS\.([a-zA-Z]+)\s*=\s*\{\s*\.\.\.SHOTS\.([a-zA-Z]+)/g)) {
  const base = dispatch.get(m[2]);
  if (base !== undefined) dispatch.set(m[1], { ...base });
}

const missing = shots.filter((s) => !dispatch.has(s));
if (missing.length > 0) {
  console.error(`rn2685shots: no dispatch parsed for ${missing.join(', ')}.`
    + ` Known: ${[...dispatch.keys()].sort().join(', ')}`);
  process.exit(2);
}

// ---- capture --------------------------------------------------------------
const failed = [];
for (const shot of shots) {
  const { scenario, sandbox } = dispatch.get(shot);
  const args = [RUN, `--url=${url}`, `--scenario=${scenario}`,
    `--width=${width}`, `--height=${height}`,
    `--evalfile=${path.relative(process.cwd(), PROBE).split(path.sep).join('/')}`,
    `--evalargs=${JSON.stringify({ shot })}`, ...extra];
  if (sandbox) args.push('--sandbox=1');
  process.stderr.write(`rn2685shots: ${shot} (${scenario}${sandbox ? ', sandbox' : ''})`
    + `${extra.length > 0 ? ` ${extra.join(' ')}` : ''}\n`);
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`rn2685shots: ${shot} RUN FAILED (${r.status})`);
    console.error((r.stderr ?? '').split('\n').slice(-12).join('\n'));
    failed.push(shot); continue;
  }
  let report;
  try { report = JSON.parse(r.stdout); } catch {
    console.error(`rn2685shots: ${shot} produced no JSON report`);
    failed.push(shot); continue;
  }
  const png = report?.eval?.png;
  if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) {
    console.error(`rn2685shots: ${shot} report carries no png:`
      + ` valid=${JSON.stringify(report?.eval?.valid)}`
      + ` why=${JSON.stringify(report?.eval?.why)}`);
    failed.push(shot); continue;
  }
  const stem = path.join(outDir, `${prefix}_${shot}`);
  fs.writeFileSync(`${stem}.png`,
    Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'));
  const { png: _drop, ...rest } = report.eval;
  fs.writeFileSync(`${stem}.json`, `${JSON.stringify(rest, null, 1)}\n`);
  process.stderr.write(`  -> ${stem}.png  valid=${rest.valid}\n`);
}

if (failed.length > 0) {
  console.error(`\nrn2685shots: ${failed.length} FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.error(`\nrn2685shots: ${shots.length} of ${shots.length} captured into ${outDir}`);
