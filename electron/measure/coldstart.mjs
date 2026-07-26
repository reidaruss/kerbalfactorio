// Cold start to a RENDERED FIRST FRAME, shell versus browser (DW-27 spike, Q1).
//
// Electron's startup reputation is the most common complaint about the
// technology, so this measures it rather than arguing about it. Both sides are
// measured the same way and from the same instant: the wall clock immediately
// before the browser process is spawned, to the wall clock at which the
// client's own frame counter first reads >= 1. No load event, no
// DOMContentLoaded, no paint heuristic. The client boots wasm, loads 46 GLBs
// and streams terrain after the load event, so anything earlier than "frames
// >= 1" would be measuring the wrong thing on both sides.
//
//   node measure/coldstart.mjs [--runs=5] [--url=http://127.0.0.1:4173/]
//
// Chrome is spawned through playwright-core, which is how every other
// measurement in this project reaches a browser. Its CDP handshake is inside
// the Chrome number and is called out in the report; it is worth roughly 100 ms
// and it makes the browser side look SLOWER than it is, which is the safe
// direction for a comparison Electron is on trial in.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertHardwareGpu, OFFSCREEN_CHROME_ARGS } from './gpuguard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shellDir = resolve(here, '..');
const electronBin = resolve(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const RUNS = Number(args.get('runs') ?? 5);
const BROWSER_URL = args.get('url') ?? 'http://127.0.0.1:4173/?debug=1';
const SKIP_BROWSER = args.has('shell-only');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chromeExe = CHROME_CANDIDATES.find((p) => existsSync(p));

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: s[0], median: q(0.5), max: s[s.length - 1],
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
  };
};

// THE COMPARISON HAS TO BE COLD ON BOTH SIDES OR IT IS PROPAGANDA.
// playwright-core launches Chrome into a FRESH temporary profile every run, so
// the browser gets no HTTP cache, no V8 code cache and no GPU shader cache. A
// shell reusing its default userData directory gets all three, and measures
// about 900 ms faster for that reason alone. So `fresh` hands Electron a brand
// new --user-data-dir per run, and both numbers are reported: `fresh` is the
// like-for-like answer and `warm` is what a returning player actually sees.
function shellRun(fresh) {
  return new Promise((res) => {
    const profile = resolve(tmpdir(), `of-shell-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const extra = fresh ? [`--user-data-dir=${profile}`] : [];
    const t0 = Date.now();
    const child = spawn(electronBin, ['.', '--origin=protocol', '--offscreen', '--width=1600', '--height=900', ...extra],
      { cwd: shellDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const marks = { spawn: t0 };
    let buf = '';
    let done = false;
    const finish = (extra) => {
      if (done) return; done = true;
      try { child.stdin.write('quit\n'); } catch (_) {}
      setTimeout(() => { try { child.kill(); } catch (_) {} }, 300);
      res({ ...marks, ...extra });
    };
    child.stdout.on('data', (d) => {
      buf += d; const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.indexOf('OF_MAIN ');
        if (m >= 0) { try { const j = JSON.parse(line.slice(m + 8)); marks[j.ev] = j.t ?? Date.now(); } catch (_) {} }
        const f = line.indexOf('OF_FIRSTFRAME ');
        if (f >= 0) {
          try {
            const j = JSON.parse(line.slice(f + 14));
            finish({ firstFrame: j.t, page: j });
          } catch (e) { finish({ error: String(e) }); }
        }
      }
    });
    child.stderr.on('data', () => {});
    child.on('exit', () => finish({ error: 'exited before first frame' }));
    setTimeout(() => finish({ error: 'timeout 90 s' }), 90000);
  });
}

async function browserRun() {
  const t0 = Date.now();
  const browser = await chromium.launch({
    executablePath: chromeExe,
    // headless stays FALSE on purpose: headless Chromium falls back to
    // SwiftShader and every number below would become a CPU rasteriser number.
    // The window is real and GPU-composited, it is just parked off the desktop.
    headless: false,
    args: ['--use-angle=default', '--disable-frame-rate-limit', '--hide-scrollbars',
      ...OFFSCREEN_CHROME_ARGS],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const tLaunched = Date.now();
  await page.goto(BROWSER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.waitForFunction(() => window.__of.world().frames >= 1, null, { timeout: 60000 });
  const firstFrame = Date.now();
  const page1 = await page.evaluate(() => ({
    frames: window.__of.world().frames, tick: window.__of.world().tick,
    origin: location.origin, boot: window.__of.boot, gpu: window.__of.stats().gpu,
  }));
  await browser.close();
  assertHardwareGpu('browser cold start', page1.gpu);
  return { spawn: t0, browserLaunched: tLaunched, firstFrame, page: page1 };
}

const out = { shell: [], shellWarm: [], browser: [] };
for (let i = 0; i < RUNS; ++i) out.shell.push(await shellRun(true));
for (let i = 0; i < RUNS; ++i) out.shellWarm.push(await shellRun(false));
if (!SKIP_BROWSER && chromeExe !== undefined) {
  for (let i = 0; i < RUNS; ++i) out.browser.push(await browserRun());
}

// Fail the whole run if any client reached a software rasteriser.
for (const r of [...out.shell, ...out.shellWarm]) {
  if (r.page?.gpu !== undefined) assertHardwareGpu('shell cold start', r.page.gpu);
}

const spanOf = (rs, k) => rs.filter((r) => r[k]).map((r) => r[k] - r.spawn);
const shellMs = spanOf(out.shell, 'firstFrame');
const shellWarmMs = spanOf(out.shellWarm, 'firstFrame');
const shellToReady = out.shell.filter((r) => r['app-ready']).map((r) => r['app-ready'] - r.spawn);
const shellToLoad = out.shell.filter((r) => r['did-finish-load']).map((r) => r['did-finish-load'] - r.spawn);
const browserMs = out.browser.filter((r) => r.firstFrame).map((r) => r.firstFrame - r.spawn);
const browserPostLaunch = out.browser.filter((r) => r.firstFrame).map((r) => r.firstFrame - r.browserLaunched);

const bootOf = (rs) => stat(rs.filter((r) => r.page?.boot?.bootMs).map((r) => r.page.boot.bootMs));

console.log(JSON.stringify({
  runs: RUNS,
  shell: {
    profile: 'FRESH --user-data-dir per run, like-for-like with playwright Chrome',
    spawnToFirstFrameMs: stat(shellMs),
    spawnToAppReadyMs: shellToReady.length ? stat(shellToReady) : null,
    spawnToDidFinishLoadMs: shellToLoad.length ? stat(shellToLoad) : null,
    inPageBootMs: bootOf(out.shell),
    gpu: out.shell.find((r) => r.page)?.page?.gpu ?? null,
    origin: out.shell.find((r) => r.page)?.page?.origin ?? null,
    firstFrameTick: out.shell.map((r) => r.page?.tick ?? null),
    errors: out.shell.filter((r) => r.error).map((r) => r.error),
  },
  shellWarm: {
    profile: 'default userData dir, warm HTTP + V8 code + GPU shader cache (a returning player)',
    spawnToFirstFrameMs: shellWarmMs.length ? stat(shellWarmMs) : null,
    spawnToAppReadyMs: stat(spanOf(out.shellWarm, 'app-ready')),
    spawnToDidFinishLoadMs: stat(spanOf(out.shellWarm, 'did-finish-load')),
    inPageBootMs: bootOf(out.shellWarm),
  },
  browser: {
    url: BROWSER_URL,
    spawnToFirstFrameMs: browserMs.length ? stat(browserMs) : null,
    chromeLaunchedToFirstFrameMs: browserPostLaunch.length ? stat(browserPostLaunch) : null,
    inPageBootMs: bootOf(out.browser),
    gpu: out.browser.find((r) => r.page)?.page?.gpu ?? null,
    note: 'includes playwright launch + CDP handshake, which the shell number does not have',
  },
}, null, 2));
