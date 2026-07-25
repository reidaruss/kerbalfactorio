// The agent dev loop (ARCHITECTURE.md section 11.2). Drives the running client
// with a real browser, waits for a SETTLED frame, captures a screenshot and
// prints __of.stats() + __of.world() as JSON. Any console.error or pageerror
// fails the run, so a silent shader fallback is a hard failure, not a visual
// one someone has to notice.
//
//   node tools/smoke/run.mjs --scenario=space --out=../docs/screenshots/W1.png
//
// Uses the locally installed Chrome via playwright-core (no browser download).
// The dev server must already be listening; start it with `npm run dev`.

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const base = args.get('url') ?? 'http://127.0.0.1:5173/';
const out = args.get('out');
const width = Number(args.get('width') ?? 1600);
const height = Number(args.get('height') ?? 900);
const settleFrames = Number(args.get('settle') ?? 20);
const waitMs = Number(args.get('wait') ?? 0);
const evalScript = args.get('eval');

const params = new URLSearchParams();
for (const k of ['seed', 'scenario', 'lat', 'lon', 'alt', 'quality', 'depth', 'pool', 'maxdepth', 't', 'gnomon', 'side', 'proxy', 'skirts', 'skirtfrac']) {
  if (args.has(k)) params.set(k, args.get(k));
}
params.set('debug', args.get('debug') ?? '1');
const url = `${base}?${params.toString()}`;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) { console.error('smoke: no Chrome or Edge found'); process.exit(2); }

// Deduped: one bad shader emits hundreds of identical useProgram warnings, and
// a wall of them buries the single line that says what actually broke.
const seen = new Map();
const errors = {
  push(msg) {
    const key = msg.slice(0, 160);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  },
  get length() { return seen.size; },
  list() {
    return [...seen.entries()].map(([m, n]) => (n > 1 ? `${m}   (x${n})` : m));
  },
};
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
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') errors.push(`console.error: ${m.text()}`);
  else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) errors.push(`console.warn: ${m.text()}`);
  else if (t === 'info' || t === 'log') console.error(`[page] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

let exitCode = 0;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  // --eval runs against the live page and its return value lands in the report,
  // so a probe can drive the world (teleport, tapes) and hand back its own
  // measurements without the runner knowing anything about the scenario.
  let evalResult;
  if (evalScript) evalResult = await page.evaluate(evalScript);
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  await page.evaluate((n) => window.__of.settle(n), settleFrames);

  const report = await page.evaluate(() => ({
    stats: window.__of.stats(),
    world: window.__of.world(),
    scene: window.__of.scene(),
  }));
  if (evalResult !== undefined) report.eval = evalResult;

  if (out) {
    const p = isAbsolute(out) ? out : resolve(repoRoot, out);
    mkdirSync(dirname(p), { recursive: true });
    await page.screenshot({ path: p });
    console.error(`smoke: wrote ${p}`);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  errors.push(`runner: ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`smoke: FAILURES (${errors.length} distinct)`);
  for (const e of errors.list()) console.error('  ' + e);
  exitCode = 1;
} else {
  console.error('smoke: PASS (no console errors, no failed requests)');
}
process.exit(exitCode);
