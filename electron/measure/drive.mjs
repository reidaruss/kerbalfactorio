// Run a probe inside the SHELL, using the same machinery web/tools/smoke/run.mjs
// uses in the browser: playwright over CDP, one --evalfile, __of.stats() and
// __of.world() dumped as JSON, console.error fatal.
//
// This exists so shell-versus-browser is a comparison of ONE probe against TWO
// clients, rather than two probes that might differ. Electron exposes the same
// DevTools protocol Chrome does, so `connectOverCDP` reaches the renderer
// unchanged and no game code has to know it is in a shell.
//
//   node measure/drive.mjs --evalfile=probes/scale.js --url=http://127.0.0.1:5199/
//   node measure/drive.mjs --evalfile=probes/scale.js            (packaged of:// bundle)
//
// --out is written under docs/screenshots/ at the REPO ROOT and refuses to
// escape it, same rule as run.mjs.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { assertHardwareGpu } from './gpuguard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shellDir = resolve(here, '..');
const repoRoot = resolve(shellDir, '..');
const electronBin = resolve(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const PORT = Number(args.get('port') ?? 9333);
const evalFile = args.get('evalfile');
const evalArgs = args.get('evalargs') ?? '{}';
const out = args.get('out');
const settleFrames = Number(args.get('settle') ?? 20);
const timeoutMs = Number(args.get('timeout') ?? 900000);

// The parentheses are load-bearing for exactly the reason run.mjs says they are
// (DW-20: `return` on its own line is `return;` under ASI, and the probe then
// silently resolves to undefined).
const script = evalFile
  ? `((OF_ARGS) => (\n${readFileSync(resolve(process.cwd(), evalFile), 'utf8')}\n))(${evalArgs})`
  : args.get('eval');

const shellArgs = ['.', `--remote-debugging-port=${PORT}`, '--offscreen', '--width=1600', '--height=900',
  `--user-data-dir=${resolve(tmpdir(), `of-drive-${Date.now()}`)}`];
if (args.has('url')) shellArgs.push(`--url=${args.get('url')}`);
else shellArgs.push('--origin=protocol');
if (args.has('isolate')) shellArgs.push('--isolate');

const child = spawn(electronBin, shellArgs, { cwd: shellDir, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stderr.write(`[shell] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[shell:err] ${d}`));

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

let exitCode = 0;
let browser;
try {
  // Poll the CDP endpoint rather than sleeping a fixed amount: app-ready is
  // between 300 and 1200 ms depending on how cold the profile is.
  let ep = null;
  for (let i = 0; i < 200 && ep === null; ++i) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) ep = await r.json();
    } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (ep === null) throw new Error(`no CDP endpoint on ${PORT} after 20 s`);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  for (let i = 0; i < 100 && page === undefined; ++i) {
    await new Promise((r) => setTimeout(r, 100));
    page = ctx.pages()[0];
  }
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') note(`console.error: ${m.text()}`);
    else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) {
      if (!/warning X4122/.test(m.text())) note(`console.warn: ${m.text()}`);
    } else if (t === 'info' || t === 'log') process.stderr.write(`[page] ${m.text()}\n`);
  });
  page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => note(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 120000 });
  await page.evaluate(() => window.__of.ready);

  let evalResult;
  if (script) evalResult = await page.evaluate(script, undefined, { timeout: timeoutMs });
  await page.evaluate((n) => window.__of.settle(n), settleFrames);

  const report = await page.evaluate(() => ({
    client: 'electron-shell',
    href: location.href,
    stats: window.__of.stats(),
    world: window.__of.world(),
    scene: window.__of.scene(),
  }));
  if (evalResult !== undefined) report.eval = evalResult;
  // No number leaves this script without proof a GPU produced it.
  assertHardwareGpu('shell drive', report.stats?.gpu);

  if (out) {
    const p = isAbsolute(out) ? out : resolve(repoRoot, out);
    const rel = relative(repoRoot, p);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`--out must stay inside the repo: ${out}`);
    mkdirSync(dirname(p), { recursive: true });
    await page.screenshot({ path: p });
    process.stderr.write(`drive: wrote ${p}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  note(`runner: ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  try { await browser?.close(); } catch (_) {}
  try { child.stdin.write('quit\n'); } catch (_) {}
  setTimeout(() => { try { child.kill(); } catch (_) {} }, 500);
}

if (errors.size) {
  process.stderr.write(`drive: FAILURES (${errors.size} distinct)\n`);
  for (const [m, n] of errors) process.stderr.write(`  ${m}${n > 1 ? ` (x${n})` : ''}\n`);
  exitCode = 1;
} else {
  process.stderr.write('drive: PASS (no console errors, no failed requests)\n');
}
process.exit(exitCode);
