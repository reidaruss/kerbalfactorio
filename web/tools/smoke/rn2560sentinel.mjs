// RN-2560 (rendering, LANE N9, THE TREELINE TERM THAT MEASURES TO ZERO
// EVERYWHERE). THE SERVER CHECK, run before, between and after every batch.
//
// It exists because two entries in NUMBERS.md say a preview server cannot be
// trusted once and then assumed:
//
//   * `vite preview` SNAPSHOTS `dist` at startup, so a rebuild under a running
//     server keeps serving the OLD page while the sentinel FILE on disk is the
//     new one. So this tool compares the token it fetches OVER THE WIRE
//     against the token on disk, and also compares the served page's
//     `index-*.js` name against the one in `dist`.
//   * `vite preview` SPA-falls-back with HTTP 200 for any missing path, so a
//     check on the status code is worthless. Only the token CONTENT counts.
//   * a dead server frees its port for another lane's server, so the port's
//     OWNING PID is compared against the PID this lane started.
//
// Usage:
//   node tools/smoke/rn2560sentinel.mjs --port=5960 --pid=20812
//
// Exit status is 0 only when all three agree; anything else is a hard fail,
// because a batch measured against somebody else's build is worse than no
// batch at all.

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', '..', 'dist');
const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const port = Number(argv.get('--port') ?? 5960);
const pid = argv.get('--pid') ?? '';
const name = argv.get('--file') ?? 'of-sentinel-rn2560.txt';

const want = readFileSync(path.join(DIST, name), 'utf8').trim();
const got = (await (await fetch(`http://127.0.0.1:${port}/${name}`)).text()).trim();
const tokenOk = got === want && want.length > 0;

const built = readdirSync(path.join(DIST, 'assets'))
  .filter((f) => /^index-.*\.js$/.test(f)).sort();
const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
const served = [...new Set([...html.matchAll(/index-[A-Za-z0-9_-]+\.js/g)]
  .map((m) => m[0]))].sort();
const bundleOk = built.length === served.length
  && built.every((b, i) => b === served[i]);

let ownerOk = false;
let owner = '';
try {
  const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
  const line = out.split(/\r?\n/)
    .find((l) => l.includes(`:${port} `) && l.includes('LISTENING'));
  owner = (line ?? '').trim().split(/\s+/).pop() ?? '';
  ownerOk = pid !== '' && owner === pid;
} catch { /* netstat is Windows-only; ownerOk stays false and says so */ }

console.log(`token=${got} match=${tokenOk} bundle=${served.join(',')}`
  + ` builtBundle=${built.join(',')} bundleOk=${bundleOk}`
  + ` portOwner=${owner} wantPid=${pid} ownerOk=${ownerOk}`);
process.exit(tokenOk && bundleOk && ownerOk ? 0 : 1);
