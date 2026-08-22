// WG-296. THE FRAME SET, one arm per tag, from ONE build and ONE server.
//
// A committed driver rather than a shell loop, on `rn2606shots.mjs`'s
// precedent and for NUMBERS.md's reason: a pair of frames whose two halves
// were captured by two hand-typed command lines is a pair whose difference
// includes whatever the typing differed in. Here the flag set is the ONLY
// thing that varies between tags.
//
//   node tools/smoke/wg295shots.mjs --url=http://127.0.0.1:5971/ \
//     --shots=flyover,forestair --prefix=WG295 \
//     --arms=off:canopytail=1+capfair=0,t1457:,t3:canopytail=3+canopymaxcell=256
//
// Each `--arms` entry is `tag:flags`, flags joined with `+` and without their
// leading dashes; an EMPTY flag list is the shipped arm. Frames land at
// `docs/screenshots/<prefix>_<shot>_<tag>_1x.png`.
import { execFileSync } from 'node:child_process';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m !== null) args.set(m[1], m[2]);
}
const url = args.get('url') ?? 'http://127.0.0.1:5971/';
const shots = (args.get('shots') ?? 'flyover').split(',').filter((s) => s.length > 0);
const prefix = args.get('prefix') ?? 'WG295';
const arms = (args.get('arms') ?? 'ship:').split(',');

for (const shot of shots) {
  const scenario = /^(flyover|forestair|limb)/.test(shot) ? 'surface' : 'walk';
  for (const entry of arms) {
    const i = entry.indexOf(':');
    const tag = i < 0 ? entry : entry.slice(0, i);
    const flags = (i < 0 ? '' : entry.slice(i + 1))
      .split('+').filter((s) => s.length > 0).map((s) => `--${s}`);
    const out = execFileSync(process.execPath, [
      'tools/smoke/run.mjs', `--url=${url}`, `--scenario=${scenario}`,
      '--width=1600', '--height=900', ...flags,
      '--evalfile=tools/smoke/probes/artframe.js',
      `--evalargs={"shot":"${shot}"}`,
    ], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    const png = `docs/screenshots/${prefix}_${shot}_${tag}_1x.png`;
    execFileSync(process.execPath, ['tools/smoke/writeshot.mjs', png], {
      input: out, encoding: 'utf8', maxBuffer: 1 << 28,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).eval;
    console.log(`${png}  valid ${j.valid}  tailM ${j.scatter?.canopyTailM}`
      + `  canopyProps ${j.scatter?.canopyProps}  box ${j.box?.luma}`);
  }
}
