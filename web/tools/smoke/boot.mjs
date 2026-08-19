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

/**
 * Chromium's kRestrictedPorts (net/base/port_util.cc): ports it refuses to
 * navigate to at all, ERR_UNSAFE_PORT, no matter what answers on them. Node's
 * `server.listen(0, ...)` ephemeral-port allocator knows nothing about this
 * list. On this box (`netsh int ipv4 show dynamicport tcp`: start 1024, 64511
 * ports, i.e. 1024-65534) that range overlaps 17 of Chromium's restricted
 * ports: 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665,
 * 6666, 6667, 6668, 6669, 6697, 10080. That is how a boot run once drew 6667
 * and died with ERR_UNSAFE_PORT for a reason that had nothing to do with the
 * build: the OS handed it out honestly, port 0 does not consult Chrome's
 * list, and nothing here rejected it. (The IANA ephemeral range 49152-65535
 * some other platforms restrict binds to contains NONE of these; the bug is
 * specific to this OS's wider dynamic port range, not to the port list.)
 */
export const CHROME_UNSAFE_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6697, 10080,
]);

export const isUnsafePort = (port) => CHROME_UNSAFE_PORTS.has(port);

/**
 * Call `bind()` (which must yield a fresh port on each call) until it yields
 * one Chrome will actually accept, re-rolling on anything in
 * CHROME_UNSAFE_PORTS. Factored out from the real listener so the re-roll
 * itself can be proven with a scripted `bind` and no real socket (selftest,
 * case "a forced 6667 collision").
 */
export async function pickSafePort(bind, { maxAttempts = 50 } = {}) {
  const rejectedPorts = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = await bind();
    if (!isUnsafePort(port)) return { port, rejectedPorts };
    rejectedPorts.push(port);
  }
  throw new Error(`pickSafePort: ${maxAttempts} straight unsafe ports (${rejectedPorts.join(', ')})`);
}

/**
 * Bind `server` to an ephemeral port on `host`, closing and re-listening if
 * the OS hands back one of Chrome's unsafe ports. Safe to call once per
 * server: the first bind is a plain listen(0), every retry closes the prior
 * attempt first because a listening server cannot listen() a second time.
 */
export async function listenEphemeral(server, host) {
  let first = true;
  const bindOnce = () => new Promise((resolve, reject) => {
    const doListen = () => {
      server.once('error', reject);
      server.listen(0, host, () => {
        server.removeListener('error', reject);
        resolve(server.address().port);
      });
    };
    if (first) { first = false; doListen(); }
    else { server.close(() => doListen()); }
  });
  return pickSafePort(bindOnce);
}

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
export async function startStaticServer(dir, nonce) {
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
  const { port } = await listenEphemeral(server, '127.0.0.1');
  return { server, port };
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
  // GL CONTEXT LOSS (BT-63). Under SwiftShader on the Linux VM the context is
  // lost at ~0.9 s and restored at ~2.6 s on roughly half of runs, always
  // inside the ItemIcons bake (the app holds a SECOND WebGL context there).
  // Measured: a lost-and-restored run differs from a clean one by 0.49% of
  // pixels, against 0.31% between two clean runs, so the restore re-uploads
  // correctly and the frame is sound. A blanket allowlist would then blind the
  // harness to the losses that DO matter, so the rule is narrow instead: a
  // loss is tolerated only when a restore answers it AND the pair completes
  // before __of.ready. A loss after ready is a measurement running on a dead
  // context, and an unanswered loss never comes back at all. Both still fail.
  //
  // Counted as EPISODES, not messages. One real loss emits TWO lines, Chrome's
  // `CONTEXT_LOST_WEBGL` warning and three's `Context Lost.` log, ~10 ms apart,
  // so counting messages would score one loss as two, exceed the restore count
  // and fail every SwiftShader run for the wrong reason. `down` collapses both
  // onto the one event they describe. Chrome's warning alone is not enough to
  // key on: it is only printed when something afterwards TOUCHES the dead
  // context, so a loss followed by silence never produces it.
  let ready = false;
  let down = false;
  const ctx = { lost: 0, restored: 0, lateLoss: 0 };
  const LOST_RE = /CONTEXT_LOST_WEBGL|WebGLRenderer: Context Lost/;
  const RESTORED_RE = /WebGLRenderer: Context Restored/;

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
      // Counted, not pushed: judged together after ready. See the note above.
      if (LOST_RE.test(m.text())) {
        if (!down) { down = true; ctx.lost++; if (ready) ctx.lateLoss++; }
        pageLog.push(m.text()); return;
      }
      if (RESTORED_RE.test(m.text())) {
        if (down) { down = false; ctx.restored++; }
        pageLog.push(m.text()); return;
      }
      if (t === 'error') errors.push(`console.error: ${m.text()}`);
      else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) {
        // The allowlist is run.mjs's, entry for entry, and names one ANGLE
        // diagnostic each; see run.mjs for the attribution of all three.
        if (!/warning X4122/.test(m.text())
          && !/warning X4000: use of potentially uninitialized variable \(f_ApplyFXAA\)/.test(m.text())
          && !/GPU stall due to ReadPixels/.test(m.text())) {
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
    ready = true;
    await page.evaluate((n) => window.__of.settle(n), 4);
    sane = await page.evaluate(() => ({
      tick: window.__of.world().tick,
      frames: window.__of.world().frames,
      gpu: window.__of.stats().gpu ?? null,
    }));
    if (!(sane.tick > 0)) errors.push(`boot: the loop is not ticking (tick ${sane.tick})`);
    if (ctx.lateLoss > 0) {
      errors.push(`boot: the GL context was lost ${ctx.lateLoss}x AFTER __of.ready. `
        + `Everything measured past that point was drawn on a dead context.`);
    } else if (ctx.lost > ctx.restored) {
      errors.push(`boot: the GL context was lost ${ctx.lost}x but only ${ctx.restored} `
        + `restore(s) arrived, so it never came back.`);
    }
  } catch (e) {
    errors.push(`boot: ${e?.message ?? e}`);
  } finally {
    await browser.close();
  }
  return {
    ok: errors.length === 0, errors: errors.list(), sane, pageLog, ctx,
    ms: Math.round(performance.now() - t0),
  };
}

// ---------------------------------------------------------------------------
// The selftest: three servers that must FAIL, one that must PASS, all
// in-memory. A gate that has never been seen to fail is a log line (rule 11).
// ---------------------------------------------------------------------------

async function tinyServer(handler) {
  const server = createServer(handler);
  const { port } = await listenEphemeral(server, '127.0.0.1');
  return { server, port };
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

  // 0a. THE UNSAFE-PORT PICKER, over many REAL OS-assigned ephemeral ports
  //     (not synthetic ones): BT-240 found port 6667 drawn for real on this
  //     box, so the proof binds a fresh server 300 times and requires every
  //     single port that comes back to be outside CHROME_UNSAFE_PORTS.
  {
    const drawn = [];
    let escaped = null;
    for (let i = 0; i < 300 && escaped === null; i++) {
      const server = createServer();
      const { port } = await listenEphemeral(server, '127.0.0.1');
      drawn.push(port);
      await new Promise((r) => server.close(r));
      if (isUnsafePort(port)) escaped = port;
    }
    const pass = escaped === null;
    cases.push({
      name: '300 real ephemeral binds never return an unsafe port',
      pass, why: pass ? '' : `port ${escaped} escaped the picker`, errors: [],
    });
    console.error(`selftest: ${pass ? 'PASS' : 'FAIL'}  300 real ephemeral binds never return an`
      + ` unsafe port (drew ${Math.min(...drawn)}-${Math.max(...drawn)})`);
  }

  // 0b. FORCED COLLISION: 0a shows real binds happen to be safe; this proves
  //     the RE-ROLL ITSELF by scripting a fake bind that returns Chrome's
  //     unsafe 6667 on the first call and a safe port on the second, with no
  //     real socket involved. The picker must reject 6667 (not return it),
  //     record it as rejected, and return the safe port from the retry.
  {
    const scripted = [6667, 54321];
    let calls = 0;
    const { port, rejectedPorts } = await pickSafePort(async () => scripted[calls++]);
    const pass = port === 54321 && calls === 2
      && rejectedPorts.length === 1 && rejectedPorts[0] === 6667;
    cases.push({
      name: 'a forced 6667 collision is rejected and re-rolled',
      pass,
      why: pass ? '' : `port=${port} calls=${calls} rejected=${JSON.stringify(rejectedPorts)}`,
      errors: [],
    });
    console.error(`selftest: ${pass ? 'PASS' : 'FAIL'}  a forced 6667 collision is rejected and re-rolled`);
  }

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

  // 5-7. THE CONTEXT-LOSS RULE (BT-63). SwiftShader loses and restores the
  //    context inside the icon bake on about half of runs on the Linux VM, and
  //    the harness tolerates exactly that shape and nothing else. These three
  //    pin all three branches with a REAL WEBGL_lose_context call, so the
  //    tolerance can never quietly widen into "context loss is fine". If WebGL
  //    is unavailable altogether these fail, which is also correct.
  //    The page reports the loss the way the real client does: three installs
  //    `webglcontextlost` / `webglcontextrestored` listeners and logs those two
  //    strings from them, so keying the test on the DOM events tests the same
  //    path production takes, and does so deterministically.
  const glPage = (body) => (req, res) => {
    res.setHeader(NONCE_HEADER, nonce);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><canvas id="c"></canvas><script>'
      + 'var c=document.getElementById("c");'
      + 'var gl=c.getContext("webgl");'
      + 'var ext=gl&&gl.getExtension("WEBGL_lose_context");'
      + 'c.addEventListener("webglcontextlost",function(e){e.preventDefault();'
      + 'console.log("THREE.WebGLRenderer: Context Lost.");});'
      + 'c.addEventListener("webglcontextrestored",function(){'
      + 'console.log("THREE.WebGLRenderer: Context Restored.");});'
      + 'var of={ready:Promise.resolve(),settle:function(){},'
      + 'world:function(){return {tick:1,frames:1};},'
      + 'stats:function(){return {gpu:"selftest"};}};'
      + body + '</script>');
  };

  // 5. A loss AFTER ready. This page makes its context INSIDE settle and not at
  //    load: a context that exists while the page is still coming up can be
  //    taken by the browser first, which lands the loss before ready and tests
  //    the wrong branch. settle() then holds 600 ms so the console event cannot
  //    race the verdict.
  await run('a context lost AFTER ready fails the boot',
    (req, res) => {
      res.setHeader(NONCE_HEADER, nonce);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><script>window.__of={ready:Promise.resolve(),'
        + 'world:function(){return {tick:1,frames:1};},'
        + 'stats:function(){return {gpu:"selftest"};},'
        + 'settle:function(){'
        + 'var c=document.createElement("canvas");document.body.appendChild(c);'
        + 'c.addEventListener("webglcontextlost",function(e){e.preventDefault();'
        + 'console.log("THREE.WebGLRenderer: Context Lost.");});'
        + 'var g=c.getContext("webgl");'
        + 'g.getExtension("WEBGL_lose_context").loseContext();'
        + 'return new Promise(function(r){setTimeout(r,600);});}};</script>');
    },
    (r) => (!r.ok && r.errors.some((e) => /AFTER __of\.ready/.test(e)))
      || 'a failure naming a loss after __of.ready');

  // 6. A loss BEFORE ready that is answered by a restore: the SwiftShader shape,
  //    and the only one that passes.
  await run('a context lost before ready and restored passes',
    glPage('ext.loseContext();setTimeout(function(){ext.restoreContext();},100);'
      + 'setTimeout(function(){window.__of=of;},600);'),
    (r) => (r.ok === true) || `a pass; got errors ${JSON.stringify(r.errors)}`);

  // 7. A loss BEFORE ready that is NEVER answered. Same timing as 6, one line
  //    different, so the restore is provably the thing that makes 6 pass.
  await run('a context lost before ready and never restored fails the boot',
    glPage('ext.loseContext();setTimeout(function(){window.__of=of;},300);'),
    (r) => (!r.ok && r.errors.some((e) => /never came back/.test(e)))
      || 'a failure saying the context never came back');

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
    // A tolerated context loss is REPORTED, never silent: it is the difference
    // between "SwiftShader did its usual thing" and "this box has a new fault".
    const lostNote = r.ctx.lost > 0
      ? `, ${r.ctx.lost} pre-ready context loss(es) restored ${r.ctx.restored}x` : '';
    console.error(`boot: PASS  tick ${r.sane.tick}, ${r.sane.frames} frames, gpu ${r.sane.gpu}${lostNote}`
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
