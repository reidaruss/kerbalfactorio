// tools/smoke/boot.mjs: THE BOOT GATE (BT-24, stocktake F1 amendment, task 114).
//
// `npm run check` proved types and file sizes and never once proved THE APP
// STARTS. This closes that: sync the wasm and assets, build the client fresh
// with vite, serve the build over plain static HTTP, boot it in a real headless
// Chrome, and require window.__of to come up with a ticking loop and a clean
// console, under the same error rules run.mjs enforces.
//
//   node tools/smoke/boot.mjs             the gate (wired into `npm run check`)
//   node tools/smoke/boot.mjs --selftest  prove the gate can FAIL (rule 11)
//
// THE NONCE IS THE POINT. Every response this server sends, including 404s,
// carries a per-run `x-of-boot-nonce` header, and the main document's header is
// asserted BEFORE anything waits on __of. A leftover preview server once served
// a stale build and produced a completely convincing ABI-mismatch failure while
// the source was fine; with the nonce, "you are talking to some OTHER server"
// is an instant, named failure instead of an hour of misdirection.
//
// This file also exports its pieces (sync, build, serve, bootOnce) so other
// smoke tools (survival.mjs) can run probes against a fresh build on an
// ephemeral port instead of trusting whatever server happens to be listening.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFile, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

export const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const NONCE_HEADER = 'x-of-boot-nonce';

/** The exact candidate list run.mjs uses. One list, or the two tools drift. */
export const CHROME_CANDIDATES = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

/** Run both sync scripts. Their output is printed only on failure. */
export function syncScripts() {
  for (const script of ['scripts/sync-wasm.mjs', 'scripts/sync-assets.mjs']) {
    const r = spawnSync(process.execPath, [script], { cwd: webDir, encoding: 'utf8' });
    if (r.status !== 0) {
      if (r.stdout) process.stderr.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      throw new Error(`boot: ${script} exited ${r.status}`);
    }
  }
}

/** vite-build the client into a fresh temp dir. Returns the dir. */
export async function buildFresh() {
  const outDir = mkdtempSync(join(tmpdir(), 'of-boot-'));
  const { build } = await import('vite');
  await build({
    root: webDir,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, sourcemap: false, reportCompressedSize: false },
  });
  return outDir;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css',
  // The one entry that is load-bearing: without it WebAssembly streaming
  // compilation falls back or fails, and the failure blames the wasm.
  '.wasm': 'application/wasm',
  '.json': 'application/json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream',
  '.txt': 'text/plain',
};

/**
 * Static server for a built dist dir on 127.0.0.1:0 (ephemeral port). EVERY
 * response carries the per-run nonce header, 404s included: a 404 from THIS
 * run's server is a missing file, a response without the nonce is a different
 * server entirely, and the two must never be confusable.
 */
export function startStaticServer(dir, nonce) {
  const server = createServer((req, res) => {
    res.setHeader(NONCE_HEADER, nonce);
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(normalize(dir) + sep) && file !== normalize(dir)) {
      res.writeHead(404); res.end('outside root'); return;
    }
    readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => {
      resolvePort({ server, port: server.address().port });
    });
  });
}

/**
 * Boot the app once in headless Chrome and judge it by run.mjs's rules:
 * console.error, pageerror, requestfailed and non-allowlisted WebGL warnings
 * all fail the run. The main document's nonce is asserted BEFORE any __of
 * wait, so a stale server fails instantly and by name.
 */
export async function bootOnce({ url, nonce, timeoutMs = 60000 }) {
  const t0 = performance.now();
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) return { ok: false, errors: ['boot: no Chrome or Edge found'], ms: 0 };

  // Deduped like run.mjs: one bad shader emits hundreds of identical warnings.
  const seen = new Map();
  const errors = {
    push(msg) { const k = msg.slice(0, 160); seen.set(k, (seen.get(k) ?? 0) + 1); },
    get length() { return seen.size; },
    list() { return [...seen.entries()].map(([m, n]) => (n > 1 ? `${m}   (x${n})` : m)); },
  };
  const pageLog = [];

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: [
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--disable-frame-rate-limit',
      '--hide-scrollbars',
    ],
  });
  let sane = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      const t = m.type();
      if (t === 'error') errors.push(`console.error: ${m.text()}`);
      else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) {
        // The allowlist is run.mjs's, entry for entry, and names one ANGLE
        // diagnostic each; see run.mjs for the attribution of both.
        if (!/warning X4122/.test(m.text())
          && !/warning X4000: use of potentially uninitialized variable \(f_ApplyFXAA\)/.test(m.text())) {
          errors.push(`console.warn: ${m.text()}`);
        }
      } else if (t === 'info' || t === 'log') pageLog.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const got = resp === null ? undefined : resp.headers()[NONCE_HEADER];
    if (got !== nonce) {
      // Fail NOW, before any __of wait. This is the stale-server tripwire.
      throw new Error(
        `STALE SERVER: the main document at ${url} answered with nonce `
        + `'${got ?? '(none)'}' where this run minted '${nonce}'. Whatever `
        + `served that page is NOT this run's server and nothing it says `
        + `about the build can be trusted.`);
    }
    await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: timeoutMs });
    await page.evaluate(() => window.__of.ready);
    await page.evaluate((n) => window.__of.settle(n), 4);
    sane = await page.evaluate(() => ({
      tick: window.__of.world().tick,
      frames: window.__of.world().frames,
      gpu: window.__of.stats().gpu ?? null,
    }));
    if (!(sane.tick > 0)) errors.push(`boot: the loop is not ticking (tick ${sane.tick})`);
  } catch (e) {
    errors.push(`boot: ${e?.message ?? e}`);
  } finally {
    await browser.close();
  }
  return {
    ok: errors.length === 0, errors: errors.list(), sane, pageLog,
    ms: Math.round(performance.now() - t0),
  };
}

// ---------------------------------------------------------------------------
// The selftest: three servers that must FAIL, one that must PASS, all
// in-memory. A gate that has never been seen to fail is a log line (rule 11).
// ---------------------------------------------------------------------------

function tinyServer(handler) {
  const server = createServer(handler);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

async function selftest() {
  const nonce = randomBytes(12).toString('hex');
  const cases = [];
  const run = async (name, handler, judge) => {
    const { server, port } = await tinyServer(handler);
    const t0 = performance.now();
    const r = await bootOnce({ url: `http://127.0.0.1:${port}/`, nonce, timeoutMs: 6000 });
    const elapsed = performance.now() - t0;
    server.close();
    const verdict = judge(r, elapsed);
    cases.push({ name, pass: verdict === true, why: verdict === true ? '' : verdict, errors: r.errors });
    console.error(`selftest: ${verdict === true ? 'PASS' : 'FAIL'}  ${name}`);
    if (verdict !== true) {
      console.error(`  expected: ${verdict}`);
      for (const e of r.errors) console.error(`  saw: ${e}`);
    }
  };

  // 1. The module THROWS. Must fail, and the pageerror must be the reason.
  await run('a throwing module fails the boot',
    (req, res) => {
      res.setHeader(NONCE_HEADER, nonce);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><script type="module">throw new Error("of-selftest module throw");</script>');
    },
    (r) => (!r.ok && r.errors.some((e) => /pageerror: .*of-selftest module throw/.test(e)))
      || 'a failure whose errors name the pageerror');

  // 2. The module 404s. Must fail, and the missing resource must be the reason,
  //    NOT the nonce (this run's server answered, with the nonce, saying 404).
  await run('a missing module fails the boot',
    (req, res) => {
      res.setHeader(NONCE_HEADER, nonce);
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><script type="module" src="/app.js"></script>');
      } else { res.writeHead(404); res.end('not found'); }
    },
    (r) => (!r.ok
      && r.errors.some((e) => /404|Failed to load|net::ERR/.test(e))
      && !r.errors.some((e) => /STALE SERVER/.test(e)))
      || 'a failure naming the 404, with no stale-server claim');

  // 3. The nonce is ABSENT. Must fail INSTANTLY and by name: the page carries
  //    no __of on purpose, so if the nonce check were gone this case would sit
  //    out the full 6 s timeout and fail the /STALE SERVER/ assertion below.
  await run('a server without this run\'s nonce is refused before any __of wait',
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><p>stale</p>');
    },
    (r, elapsed) => (!r.ok
      && r.errors.some((e) => /STALE SERVER/.test(e) && e.includes(nonce))
      && elapsed < 5000)
      || 'an instant failure naming STALE SERVER and this run\'s nonce');

  // 4. POSITIVE CONTROL: a well-behaved page passes, so the three above are
  //    failing for their own reasons and not because bootOnce fails everything.
  await run('a healthy page with the nonce passes',
    (req, res) => {
      res.setHeader(NONCE_HEADER, nonce);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><script>window.__of = { ready: Promise.resolve(),'
        + ' settle: function () {}, world: function () { return { tick: 1, frames: 1 }; },'
        + ' stats: function () { return { gpu: "selftest" }; } };</script>');
    },
    (r) => (r.ok === true) || `a pass; got errors ${JSON.stringify(r.errors)}`);

  const failed = cases.filter((c) => !c.pass);
  console.error(`selftest: ${cases.length - failed.length}/${cases.length} green`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// The gate itself.
// ---------------------------------------------------------------------------

async function gate() {
  const t0 = performance.now();
  const phase = (name, since) =>
    console.error(`boot: ${name} ${((performance.now() - since) / 1000).toFixed(1)} s`);

  let t = performance.now();
  syncScripts();
  phase('sync', t);

  t = performance.now();
  const outDir = await buildFresh();
  phase('build', t);

  const nonce = randomBytes(12).toString('hex');
  const { server, port } = await startStaticServer(outDir, nonce);
  t = performance.now();
  const r = await bootOnce({ url: `http://127.0.0.1:${port}/`, nonce });
  phase('boot', t);
  server.close();

  if (r.ok) {
    rmSync(outDir, { recursive: true, force: true });
    console.error(`boot: PASS  tick ${r.sane.tick}, ${r.sane.frames} frames, gpu ${r.sane.gpu}`
      + `  (total ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    process.exit(0);
  }
  console.error(`boot: FAIL (${r.errors.length} distinct)`);
  for (const e of r.errors) console.error('  ' + e);
  if (r.pageLog?.length) {
    console.error('boot: last page console lines:');
    for (const l of r.pageLog.slice(-8)) console.error('  [page] ' + l);
  }
  console.error(`boot: the failing build is kept at ${outDir}`);
  process.exit(1);
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  if (process.argv.includes('--selftest')) await selftest();
  else await gate();
}
