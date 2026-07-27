// The agent dev loop (ARCHITECTURE.md section 11.2). Drives the running client
// with a real browser, waits for a SETTLED frame, captures a screenshot and
// prints __of.stats() + __of.world() as JSON. Any console.error or pageerror
// fails the run, so a silent shader fallback is a hard failure, not a visual
// one someone has to notice.
//
//   node tools/smoke/run.mjs --scenario=space --out=docs/screenshots/W1.png
//
// --out is relative to the REPO ROOT, not to cwd. A leading '../' escapes the
// project and is refused.
//
// Uses the locally installed Chrome via playwright-core (no browser download).
// The dev server must already be listening; start it with `npm run dev`.

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute, relative } from 'node:path';
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
// --evalfile is --eval for probes that are too long to live on a command line.
// --evalargs is JSON, exposed to the probe as the global OF_ARGS.
const evalFile = args.get('evalfile');
const evalArgs = args.get('evalargs') ?? '{}';
// The parentheses around the file body are load-bearing: probes start with a
// comment block, and `return` followed by a newline is `return;` under ASI, so
// without them every probe silently resolves to undefined.
const evalScript = evalFile
  ? `((OF_ARGS) => (\n${readFileSync(resolve(process.cwd(), evalFile), 'utf8')}\n))(${evalArgs})`
  : args.get('eval');

const params = new URLSearchParams();
for (const k of ['seed', 'scenario', 'lat', 'lon', 'alt', 'quality', 'depth', 'pool', 'maxdepth',
  'split',
  't', 'gnomon', 'side', 'proxy', 'skirts', 'skirtfrac',
  'mode', 'view', 'stitch', 'rebase', 'walkspeed', 'interp', 'clear', 'zsep',
  'sundot', 'shell', 'fade', 'shadows', 'atmos', 'stars', 'cutoff', 'gameplay',
  'props', 'lamp', 'voxelskin', 'voxelnear', 'aimshell', 'levelring', 'density',
  'vab', 'flight',
  // DW-31. Unlike every other entry here this is not an isolation switch: it
  // selects a game MODE, and the world it makes saves to its own slot.
  'sandbox']) {
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
  else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) {
    // ANGLE's HLSL backend emits X4122 for three's own PMREM shader: a literal
    // sum it cannot fold exactly in double precision. It is a compiler note on
    // stock three.js source, not our shader and not a fallback, and it is the
    // ONLY warning on this allowlist. Everything else still fails the run,
    // which is the rule that caught the silent no-op terrain material at W1.
    if (!/warning X4122/.test(m.text())) errors.push(`console.warn: ${m.text()}`);
  }
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
    // --out is resolved against the REPO ROOT, so a leading '../' escapes the
    // project and silently scatters screenshots into the parent directory. That
    // is not hypothetical: it created a stray Nextcloud/docs folder that a later
    // agent then tried to rm -rf. mkdirSync would happily create the escape
    // path, so the guard has to come first. Refuse, and say what to pass.
    const rel = relative(repoRoot, p);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(
        `--out must stay inside the repo. '${out}' resolves to ${p}, which is outside `
        + `${repoRoot}. Paths are relative to the repo root, so pass `
        + `docs/screenshots/NAME.png (no leading '../').`);
    }
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
