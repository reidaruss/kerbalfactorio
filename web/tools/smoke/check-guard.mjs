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
// every path -- pass, fail, or thrown error.
//
// Deliberately kept OUT of `npm run check` (ALL_CHECKS in check-all.mjs, the
// fast static gate) and out of the section 7.4 concurrency budget by never
// running unattended in a fan-out. Run it by hand or from `check:full`.
//
//   npm run check:guard                             the full guard, 4 poses
//   npm run check:guard -- --shots=forestairnoon     the per-lane TRIPWIRE:
//     one pose, cheap. The full four-pose set is for lanes that move shading
//     directly; every other lane should run the tripwire before landing.
//   npm run check:guard -- --shots=forestairnoon --extra=crownshadefloor=0.30
//     the guard's own documented negative control -- this must FAIL.
//
// Any argument given here is forwarded verbatim to rn2550guard.mjs; this
// script only ever supplies `--url` itself.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenEphemeral } from './boot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const webRoot = join(HERE, '..', '..');
const DIST = join(webRoot, 'dist');
const GUARD = join(HERE, 'rn2550guard.mjs');
const VITE_BIN = join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');

// (a) `dist` must exist and be newer than everything under `src`, or every
// number rn2550guard prints describes a PREVIOUS build, not this one.
function newestMtime(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return t;
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('check:guard: FAIL web/dist has no built index.html. Fix: cd web && npm run build');
  process.exit(1);
}
{
  const srcT = newestMtime(join(webRoot, 'src'));
  const distT = newestMtime(DIST);
  if (srcT > distT) {
    console.error(`check:guard: FAIL web/dist is STALE: web/src changed `
      + `(${new Date(srcT).toISOString()}) after dist was built `
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

let exitCode = 1;
try {
  // Never trust a 200: only bytes prove this server is serving THIS dist.
  // Wait for an answer, but never past a hard budget -- a server that dies or
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

  // The sentinel, written BEFORE the server started so there is no window in
  // which `vite preview` could have snapshotted a dist without it in.
  const token = randomBytes(16).toString('hex');
  const sentinelName = `of-check-guard-${token.slice(0, 8)}.txt`;
  writeFileSync(join(DIST, sentinelName), token, 'utf8');
  const got = (await (await fetch(new URL(sentinelName, url))).text()).trim();
  if (got !== token) {
    throw new Error(`the sentinel came back wrong: wrote ${token}, the server on port `
      + `${port} answered ${JSON.stringify(got.slice(0, 80))}. This is not this build's `
      + `server (or it is the SPA fallback wearing a 200), so nothing rn2550guard `
      + `measures against it would mean anything.`);
  }

  // (c) the real guard. Every argument given to check:guard itself is
  // forwarded verbatim (e.g. --shots=forestairnoon, --extra=...); only --url
  // is ours to supply. A 20-minute safety cap: the guard's own per-arm runs
  // are already individually bounded, this just guarantees THIS wrapper never
  // hangs even if a future change to the guard breaks that.
  const forwarded = process.argv.slice(2);
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
} catch (e) {
  console.error(`check:guard: FAIL ${e.message}`);
  exitCode = 1;
} finally {
  killServer();
}
process.exit(exitCode);
