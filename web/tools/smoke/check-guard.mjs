// check-guard.mjs (BT-330 to BT-339). WIRES rn2550guard.mjs, THE PROJECT'S
// ONLY LOOK-REGRESSION ASSERTION, INTO SOMETHING THAT ACTUALLY RUNS.
//
// Before this, rn2550guard.mjs existed and asserted a real band on the
// wood/clearing ratio, but nothing invoked it: not `npm run check` (a fast
// static gate; a full pass here is 24 real browser runs), not CI (there is
// none in this repo), not habit. A guard nobody runs is prose.
//
// This script (a) refuses to trust a stale `dist`, (b) starts its own
// `vite preview --strictPort` on a free, Chrome-safe port and proves that
// port answers with ITS OWN bytes rather than trusting a 200 status (the
// SPA-fallback trap: `vite preview` answers 200 for any missing path, see
// NUMBERS.md), (c) runs rn2550guard.mjs against that server and propagates
// its exit code, and (d) always kills the server it started, by PID, on
// every path: pass, fail, or thrown error.
//
// Deliberately kept OUT of `npm run check` (ALL_CHECKS in check-all.mjs, the
// fast static gate) and out of the section 7.4 concurrency budget by never
// running unattended in a fan-out. Run it by hand or from `check:full`.
//
//   npm run check:guard                             the full guard, 4 poses
//   npm run check:guard -- --shots=forestairnoon     the per-lane TRIPWIRE:
//     one pose (6 browser runs, against the full default's 24). The full
//     four-pose set is for lanes that move shading directly; every other
//     lane should run the tripwire before landing.
//   npm run check:guard -- --shots=forestairnoon --extra=crownshadefloor=0.30
//     the guard's own documented negative control: this must FAIL.
//
// Any argument given here is forwarded verbatim to rn2550guard.mjs, EXCEPT
// --url, which this script supplies itself and refuses to have overridden
// (rn2550guard's own argv parser keeps the LAST --url it sees, so a
// forwarded one would silently replace the sentinel-verified server with an
// unverified one). `check:full` in package.json calls this file directly
// (`node tools/smoke/check-guard.mjs`, not `npm run check:guard`) precisely
// so `npm run check:full -- --shots=...` forwards correctly: npm appends
// extra args to the END of the whole script it resolves, and a nested
// `npm run check:guard` there would have needed a SECOND round of npm's own
// arg handling to pass them on, which does not happen automatically. Proven
// both ways: the old double-hop definition silently dropped forwarded args
// (a full sweep ran instead of the tripwire), the direct-call definition
// does not.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync, readdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenEphemeral } from './boot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const webRoot = join(HERE, '..', '..');
const DIST = join(webRoot, 'dist');
const GUARD = join(HERE, 'rn2550guard.mjs');
const VITE_BIN = join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');

// Every argument is forwarded to rn2550guard.mjs except --url, which is ours
// alone to supply: refuse fast, before anything is built or started.
const forwarded = process.argv.slice(2);
if (forwarded.some((a) => a === '--url' || a.startsWith('--url='))) {
  console.error('check:guard: FAIL refused: this wrapper supplies --url itself '
    + '(the sentinel-verified server it just started). A forwarded --url would '
    + 'silently replace it, since rn2550guard.mjs keeps the LAST --url it sees. '
    + 'Remove it.');
  process.exit(1);
}

// (a) `dist` must exist and be newer than everything under `src`, or every
// number rn2550guard prints describes a PREVIOUS build, not this one. Staled
// against `dist/index.html` specifically, never "the newest file anywhere in
// dist": this script itself writes a sentinel file into `dist` below, and an
// earlier version compared against the newest file in the WHOLE directory,
// which a leftover sentinel (from this run or, if cleanup ever failed, a
// prior one) would always win, making a stale dist look fresh forever.
function newestMtime(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return t;
}
const DIST_ENTRY = join(DIST, 'index.html');
if (!existsSync(DIST_ENTRY)) {
  console.error('check:guard: FAIL web/dist has no built index.html. Fix: cd web && npm run build');
  process.exit(1);
}
{
  const srcT = newestMtime(join(webRoot, 'src'));
  const distT = statSync(DIST_ENTRY).mtimeMs;
  if (srcT > distT) {
    console.error(`check:guard: FAIL web/dist is STALE: web/src changed `
      + `(${new Date(srcT).toISOString()}) after dist/index.html was built `
      + `(${new Date(distT).toISOString()}). Fix: cd web && npm run build`);
    process.exit(1);
  }
}

// (b) a free, Chrome-safe port (rn2550guard drives a real browser through it,
// via run.mjs/playwright-core), released immediately so vite can bind it.
const probe = createServer();
const { port } = await listenEphemeral(probe, '127.0.0.1');
await new Promise((r) => probe.close(r));
const url = `http://127.0.0.1:${port}/`;

// The sentinel: written BEFORE the server starts. `vite preview` (sirv)
// serves every ordinary static file off disk per request rather than
// snapshotting at startup (NUMBERS.md's BT-330 row, TRAP 2), so writing it
// now and having the not-yet-started server pick it up later is safe, and
// removes any window in which a race could matter. Deleted in the `finally`
// below on every path, so it can never accumulate across runs or be mistaken
// by a future run's own staleness check for part of the real build.
const token = randomBytes(16).toString('hex');
const sentinelName = `of-check-guard-${token.slice(0, 8)}.txt`;
const sentinelPath = join(DIST, sentinelName);
writeFileSync(sentinelPath, token, 'utf8');

const server = spawn(process.execPath,
  [VITE_BIN, 'preview', '--outDir', 'dist', '--host', '127.0.0.1',
    '--port', String(port), '--strictPort'],
  { cwd: webRoot, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
let spawnErr = null;
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
server.on('error', (e) => { spawnErr = e; });

// (d) killed by PID on every path. taskkill /T so a child vite spawns (it
// normally does not, but nothing here should rely on that) dies too.
function killServer() {
  if (server.pid == null || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(server.pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}
function cleanupSentinel() {
  try { unlinkSync(sentinelPath); } catch { /* never written, or already gone */ }
}

let exitCode = 1;
try {
  // Never trust a 200: only bytes prove this server is serving THIS dist.
  // Wait for an answer, but never past a hard budget: a server that dies or
  // never comes up must FAIL, not hang.
  const READY_MS = 15000;
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < READY_MS) {
    if (spawnErr) throw new Error(`could not start vite preview: ${spawnErr.message}`);
    if (server.exitCode !== null) {
      throw new Error(`vite preview exited (code ${server.exitCode}) before it ever `
        + `answered on port ${port}:\n${serverLog}`);
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      ready = true; break;
    } catch { /* still booting, or nobody home yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw new Error(`vite preview never answered on ${url} within ${READY_MS} ms:\n${serverLog}`);
  console.log(`check:guard: vite preview up on ${url} (pid ${server.pid})`);

  const got = (await (await fetch(new URL(sentinelName, url))).text()).trim();
  if (got !== token) {
    throw new Error(`the sentinel came back wrong: wrote ${token}, the server on port `
      + `${port} answered ${JSON.stringify(got.slice(0, 80))}. This is not this build's `
      + `server (or it is the SPA fallback wearing a 200), so nothing rn2550guard `
      + `measures against it would mean anything.`);
  }

  // (c) the real guard. A 20-minute safety cap: the guard's own per-arm runs
  // are already individually bounded, this just guarantees THIS wrapper never
  // hangs even if a future change to the guard breaks that.
  const r = spawnSync(process.execPath, [GUARD, `--url=${url}`, ...forwarded],
    { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60 * 1000 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw new Error(`could not run rn2550guard.mjs: ${r.error.message}`);
  // Surface the pose-count line rn2550guard already prints (it names how many
  // of its poses were judged), so a narrowed tripwire run can never be read
  // off THIS wrapper's own output as a complete one. PASS prints to stdout,
  // FAIL's own summary prints to stderr, so both streams are searched.
  const line = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n')
    .find((l) => /rn2550guard: (PASS|FAIL \(\d)/.test(l));
  console.log(`check:guard: ${line ?? `rn2550guard exited ${r.status} with no summary line`}`);
  exitCode = r.status ?? 1;

  // On a PASS, a pose can still print "OUT OF BAND" in the table: rn2550guard
  // only FAILS a standing violation if it got WORSE, so any "OUT OF BAND" row
  // that survives to a PASS is, by construction, one already recorded in the
  // guard's own BASE table (see rendering.md 2.35), not a new regression. A
  // PASS with no echo of this reads as a clean band, worst in the tripwire
  // where that one pose is the whole output, so it is spelled out here rather
  // than left implicit in a table row.
  if (exitCode === 0) {
    const standingPoses = (r.stdout ?? '').split('\n')
      .filter((l) => l.includes('OUT OF BAND'))
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
    if (standingPoses.length > 0) {
      console.log(`check:guard: ${standingPoses.length} pose(s) already OUT OF BAND on `
        + `this PASS (${standingPoses.join(', ')}): a pre-existing recorded standing `
        + `violation in rn2550guard.mjs's own BASE table (rendering.md 2.35), not a new `
        + `regression from this run. PASS means no NEW regression, not a clean band.`);
    }
  }
} catch (e) {
  console.error(`check:guard: FAIL ${e.message}`);
  exitCode = 1;
} finally {
  killServer();
  cleanupSentinel();
}
process.exit(exitCode);
