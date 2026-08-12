// tools/smoke/survival.mjs: run the SURVIVAL FULL-LOOP probe (BT-25, stocktake
// F4) against a fresh build on an ephemeral port.
//
//   npm run probe:survival            (or: node tools/smoke/survival.mjs)
//   ... any extra --flags are passed through to run.mjs (--seed=, --out=).
//
// Why the ceremony instead of pointing run.mjs at a dev server: the probe's
// verdict is about THE GAME, so the server must be serving THIS tree's build
// and nothing else. A fresh vite build into a temp dir, an ephemeral port
// nobody else is listening on, and the boot gate's nonce tripwire remove every
// stale-server way that verdict could be about something else. The fresh
// browser profile run.mjs launches means fresh storage, so the world really is
// a first boot: no autosave slot, nothing carried in.
//
// Reid plays on port 4200, which Admin serves from a freshly archived build (as
// of 2026-07-28, stamp 8ab129d). There is no `dist-play` directory and there has
// not been one for some time; the earlier version of this line said there was,
// which mattered once: a stale bundle was the leading suspect for a sinking
// defect and the harness's own account of what Reid runs was wrong. This never
// touches 4200 either way.
//
// EXIT CODE: 0 when the probe delivered a verdict, and an economic STALL is a
// verdict (it is the probe succeeding at its job); 1 only when the run itself
// broke (console errors, no report, probe invalid).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { buildFresh, NONCE_HEADER, startStaticServer, syncScripts, webDir } from './boot.mjs';

const t0 = performance.now();
console.error('survival: sync + fresh build...');
syncScripts();
const outDir = await buildFresh();
const nonce = randomBytes(12).toString('hex');
const { server, port } = await startStaticServer(outDir, nonce);
const url = `http://127.0.0.1:${port}/`;

const probe = await fetch(url);
if (probe.headers.get(NONCE_HEADER) !== nonce) {
  console.error(`survival: STALE SERVER: ${url} did not answer with this run's nonce.`);
  server.close();
  process.exit(1);
}
console.error(`survival: serving the fresh build at ${url}`);

const args = ['tools/smoke/run.mjs', `--url=${url}`, '--scenario=walk', '--settle=6',
  '--evalfile=tools/smoke/probes/survivalrun.js', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { cwd: webDir, stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.on('data', (d) => { stdout += d; });
const code = await new Promise((r) => child.on('close', r));
server.close();
rmSync(outDir, { recursive: true, force: true });

process.stdout.write(stdout);
let report = null;
try { report = JSON.parse(stdout); } catch { /* no report; the runner says why on stderr */ }
const ev = report?.eval ?? null;
const wallS = Math.round((performance.now() - t0) / 1000);

if (ev !== null && ev.valid === true) {
  if (ev.completed === true) {
    console.error(`survival: VERDICT COMPLETABLE. A fresh survival world reached a stable `
      + `orbit in ${ev.simS} s sim / ${wallS} s wall`
      + (ev.fails?.length ? `, with ${ev.fails.length} non-fatal check failures.` : '.'));
  } else {
    console.error(`survival: VERDICT STALLS at ${ev.stalledAt}: ${ev.why}`
      + `  (sim ${ev.simS} s, wall ${wallS} s)`);
  }
}
// BT-8x blast radius (BT-41): run.mjs can now exit 3 (clean run, PROBE
// reported failure) once GATE=1/--gate is set; this tool never passes
// --gate, but a caller's environment might. Exit 3 still carries a real
// report on stdout, parsed above, so it is judged by `ev` like exit 0 is and
// is not folded into "the run itself failed".
if (code !== 0 && code !== 3) {
  console.error(`survival: BROKEN (runner exit ${code}, wall ${wallS} s): the run itself `
    + `failed, which is a defect and not a verdict.`);
  process.exit(1);
}
if (ev === null || ev.valid !== true) {
  console.error(`survival: BROKEN (runner exit ${code}, wall ${wallS} s): no valid probe `
    + `report, which is a defect and not a verdict.`);
  process.exit(1);
}
process.exit(0);
