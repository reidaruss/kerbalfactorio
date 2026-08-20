// ceilingsweep.mjs (RN-2085 to RN-2099). WG-189's INTERLEAVED PAIRED METHOD,
// generalised from two arms to N, driving `probes/ceiling.js`.
//
//   node tools/smoke/ceilingsweep.mjs --url=http://127.0.0.1:5200/ --pose=forestfloor --repeats=4 base shadows=0 props=0
//   node tools/smoke/ceilingsweep.mjs --url=http://127.0.0.1:5200/ --pose=forestfloor --repeats=3 --list
//
// WHY THE ORDER IS THE POINT. WG-189 priced one `maxDepth` step twice with a
// serial sweep and got +2.10 ms and then -0.80 ms: the two runs disagreed on
// the SIGN, because a serial sweep lets thermal throttling, another lane's
// Chrome and the driver's own warm-up land entirely on whichever arm happens
// to run last. The repair is to interleave: run arm A, arm B, arm C, then A,
// B, C again, so drift is shared out across arms instead of being spent on
// one. This driver does exactly that, and reports the WITHIN-ARM SPREAD beside
// every delta, because a delta smaller than the spread of its own arm is not a
// measurement. That last rule is the one WG-189 had to add after the fact and
// it is the reason two of that sweep's three tiers were reported as NOT
// SEPARATED rather than as small effects.
//
// AN ARM IS A SET OF `run.mjs` PAGE FLAGS, written `k=v` or bare `base`.
// `base` means no extra flags, i.e. the shipped configuration. Arms are passed
// positionally so a sweep is self-documenting in the shell history that
// produced it. Multiple flags in one arm are joined with `+`, e.g.
// `shadows=0+props=0`.
//
// The poses are NAMED and their coordinates live in one table below, taken
// from `probes/artframe.js`'s own manifest, so "re-run the ruin arm" is one
// word and never a set of remembered decimals. `--pose=lat,lon,yaw,pitch,sunDot`
// also works for a site the table does not have.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths are resolved from THIS FILE and not from cwd. `lodsweep.mjs` spells
// its sibling as the relative `tools/smoke/run.mjs`, which silently requires
// the caller to be standing in `web/`; run it from the repo root and every arm
// dies with a module-not-found that the driver reports as a failed ARM rather
// than as its own bad path. One bad cwd should not read like a bad measurement.
const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(here, 'run.mjs');
const PROBE = join(here, 'probes', 'ceiling.js');

// The canonical world poses, lifted from artframe.js's SHOTS manifest so the
// ceiling is priced at the frames this project already judges its art on
// rather than at a synthetic camera nobody ever ships.
const POSES = {
  forestfloor: { lat: -19.85, lon: -72.7853, yaw: 300, pitch: -26, sunDot: 0.70 },
  midfield: { lat: -7.9675, lon: 116.53189, yaw: 150, pitch: -10, sunDot: 0.70 },
  voxelface: { lat: 12, lon: 150, yaw: 300, pitch: -38, sunDot: 0.88 },
  // A horizon-filling vista from the forest site: pitch level, so the far
  // cascade and the whole resident chunk set are on screen at once. This is
  // the pose a terrain ceiling is actually set by and no canonical shot uses
  // it, which is itself worth recording.
  vista: { lat: -19.85, lon: -72.7853, yaw: 300, pitch: 0, sunDot: 0.70 },
  // Low sun: the longest shadow cascades of the day.
  dusk: { lat: -19.85, lon: -72.7853, yaw: 300, pitch: -10, sunDot: 0.20 },
};

const args = new Map();
const arms = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1'); else arms.push(a);
}
if (args.has('list')) {
  console.log(Object.keys(POSES).join(' '));
  process.exit(0);
}
if (arms.length === 0) {
  console.error('usage: ceilingsweep.mjs --pose=<name> [--repeats=N] [--frames=N] '
    + '[--width=N --height=N] [--url=...] <arm> [<arm> ...]\n'
    + `poses: ${Object.keys(POSES).join(' ')}\n`
    + 'an arm is `base` or `flag=value` or `flag=value+flag=value`');
  process.exit(2);
}

const poseArg = args.get('pose') ?? 'forestfloor';
let pose = POSES[poseArg];
if (!pose) {
  const n = poseArg.split(',').map(Number);
  if (n.length !== 5 || n.some((v) => !Number.isFinite(v))) {
    console.error(`ceilingsweep: unknown pose ${JSON.stringify(poseArg)}. `
      + `Known: ${Object.keys(POSES).join(' ')}. Or pass lat,lon,yaw,pitch,sunDot.`);
    process.exit(2);
  }
  pose = { lat: n[0], lon: n[1], yaw: n[2], pitch: n[3], sunDot: n[4] };
}

const repeats = Number(args.get('repeats') ?? 4);
const frames = Number(args.get('frames') ?? 600);
const url = args.get('url') ?? 'http://127.0.0.1:5173/';
const width = args.get('width');
const height = args.get('height');

function runOnce(arm) {
  const flags = arm === 'base' ? [] : arm.split('+').map((f) => `--${f}`);
  const ev = JSON.stringify({
    yaw: pose.yaw, pitch: pose.pitch, sunDot: pose.sunDot, frames,
  });
  const argv = [
    RUNNER, `--url=${url}`, '--scenario=walk',
    `--lat=${pose.lat}`, `--lon=${pose.lon}`,
    ...(width ? [`--width=${width}`] : []),
    ...(height ? [`--height=${height}`] : []),
    ...flags,
    `--evalfile=${PROBE}`, `--evalargs=${ev}`,
  ];
  const raw = execFileSync('node', argv, {
    encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(raw).eval;
}

// ---- the interleave. Arm order rotates each repeat, so no arm is always
// first (first-run cost: a cold page cache, a cold shader cache on the box).
const samples = new Map(arms.map((a) => [a, []]));
for (let rep = 0; rep < repeats; rep++) {
  const order = arms.map((_, i) => arms[(i + rep) % arms.length]);
  for (const arm of order) {
    process.stderr.write(`rep ${rep + 1}/${repeats} arm ${arm} ... `);
    let r;
    try {
      r = runOnce(arm);
    } catch (e) {
      process.stderr.write(`RUN FAILED: ${e.message.slice(0, 200)}\n`);
      continue;
    }
    process.stderr.write(r.valid ? `${r.wallMsPerFrame} ms\n` : `INVALID: ${r.fail}\n`);
    samples.get(arm).push(r);
  }
}

const med = (xs) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const spread = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : NaN);
// THE TRIMMED SPREAD, and it is reported BESIDE the full range rather than
// instead of it. On this box a five-arm interleave produced, in every arm,
// three runs inside a ~0.9 ms band and exactly one outlier 4 to 6 ms high:
// the signature of a transient on a shared machine (another lane, a background
// agent, the OS), not of the arm. The full range is the conservative statistic
// and stays the one the `separated?` verdict is computed from, because a test
// that is loosened after seeing the data is a test fitted to the data. The
// trimmed range (drop the single highest and single lowest sample) is printed
// so a reader can see WHICH of the two a verdict turned on: an arm whose full
// range is wide and whose trimmed range is narrow was contended, and the fix
// is a quieter box or more repeats, not a softer threshold.
const trimmed = (xs) => {
  if (xs.length < 4) return NaN;
  const s = [...xs].sort((a, b) => a - b).slice(1, -1);
  return s[s.length - 1] - s[0];
};
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');

console.log(`\npose ${poseArg} (lat ${pose.lat}, lon ${pose.lon}, yaw ${pose.yaw}, `
  + `pitch ${pose.pitch}, sunDot ${pose.sunDot}) | ${frames} frames/run | `
  + `${repeats} interleaved repeats | ${width ?? 1600}x${height ?? 900}`);
console.log('\n| arm | n | wall ms/frame p50 | within-arm spread | vs base | separated? | '
  + 'submit p50 | calls | tris | instances | vram MB | resident |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');

let baseMed = NaN; let baseSpread = NaN;
for (const arm of arms) {
  const rs = samples.get(arm).filter((r) => r.valid);
  if (rs.length === 0) { console.log(`| ${arm} | 0 | NO VALID RUN |`); continue; }
  const wall = rs.map((r) => r.wallMsPerFrame);
  const m = med(wall); const sp = spread(wall);
  if (arm === arms[0]) { baseMed = m; baseSpread = sp; }
  const d = arm === arms[0] ? NaN : m - baseMed;
  // A delta must clear the LARGER of the two arms' own spreads to count.
  const bar = Math.max(sp, baseSpread);
  const sep = Number.isNaN(d) ? '-' : (Math.abs(d) > bar ? 'YES' : 'no');
  const last = rs[rs.length - 1];
  console.log(`| ${arm} | ${rs.length} | ${f(m)} | ${f(sp)} | ${Number.isNaN(d) ? '-' : f(d)} | `
    + `${sep} | ${f(last.submitMs.p50)} | ${last.draw.calls} | ${last.draw.triangles} | `
    + `${last.instances} | ${f(last.vramEstimateMB, 1)} | ${last.resident} |`);
}
console.log('\nruns per arm (wall ms/frame): '
  + arms.map((a) => `${a} [${samples.get(a).filter((r) => r.valid).map((r) => r.wallMsPerFrame).join(', ')}]`).join(' | '));
const anyValid = arms.flatMap((a) => samples.get(a)).find((r) => r.valid);
if (anyValid) console.log(`gpu: ${anyValid.gpu}`);
// `--dump` prints one arm's last full report. The table above is a summary and
// a summary is where a field nobody printed goes to hide: the pass breakdown,
// the terrain stream metrics and `armState` are the three that actually say
// WHERE the time went, and none of them fits in a column.
if (args.has('dump')) {
  const which = args.get('dump') === '1' ? arms[0] : args.get('dump');
  const rs = (samples.get(which) ?? []).filter((r) => r.valid);
  if (rs.length === 0) console.log(`\n(no valid run to dump for arm ${which})`);
  else console.log(`\n--- full report, arm ${which}, last run ---\n`
    + JSON.stringify(rs[rs.length - 1], null, 2));
}
console.log('\nA delta smaller than the larger of the two arms\' own within-arm spreads is '
  + 'NOT SEPARATED and must not be reported as a cost (WG-189).');
