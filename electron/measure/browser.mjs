// The BROWSER half of every shell-versus-browser comparison, deliberately a twin
// of drive.mjs: same probe file, same settle, same report shape, same GPU
// assertion. The only difference is which client is launched.
//
// It is NOT web/tools/smoke/run.mjs, for one reason: run.mjs launches headless
// Chrome with --enable-unsafe-swiftshader, which is right for a correctness
// smoke run and fatally wrong for a performance comparison. A software
// rasteriser would make the browser baseline slow and the shell look good, and
// the resulting recommendation would be built on nothing. This launches a real
// GPU-composited window and parks it at -3200,-3200 so it never touches the
// user's desktop, and refuses to report a number if the renderer turns out to be
// software anyway.
//
//   node measure/browser.mjs --evalfile=probes/scale.js --url=http://127.0.0.1:5199/

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHardwareGpu, OFFSCREEN_CHROME_ARGS } from './gpuguard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const URL_ = args.get('url') ?? 'http://127.0.0.1:5199/?debug=1';
const evalFile = args.get('evalfile');
const evalArgs = args.get('evalargs') ?? '{}';
const out = args.get('out');
const settleFrames = Number(args.get('settle') ?? 20);
const timeoutMs = Number(args.get('timeout') ?? 900000);

const script = evalFile
  ? `((OF_ARGS) => (\n${readFileSync(resolve(process.cwd(), evalFile), 'utf8')}\n))(${evalArgs})`
  : args.get('eval');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (exe === undefined) { process.stderr.write('browser: no Chrome or Edge found\n'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

let exitCode = 0;
const browser = await chromium.launch({
  executablePath: exe,
  headless: false,
  args: ['--use-angle=default', '--disable-frame-rate-limit', '--hide-scrollbars',
    ...OFFSCREEN_CHROME_ARGS],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') note(`console.error: ${m.text()}`);
    else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) {
      if (!/warning X4122/.test(m.text())) note(`console.warn: ${m.text()}`);
    } else if (t === 'info' || t === 'log') process.stderr.write(`[page] ${m.text()}\n`);
  });
  page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => note(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 120000 });
  await page.evaluate(() => window.__of.ready);

  let evalResult;
  if (script) evalResult = await page.evaluate(script, undefined, { timeout: timeoutMs });
  await page.evaluate((n) => window.__of.settle(n), settleFrames);

  const report = await page.evaluate(() => ({
    client: 'chrome',
    href: location.href,
    stats: window.__of.stats(),
    world: window.__of.world(),
    scene: window.__of.scene(),
  }));
  if (evalResult !== undefined) report.eval = evalResult;
  assertHardwareGpu('browser drive', report.stats?.gpu);

  if (out) {
    const p = isAbsolute(out) ? out : resolve(repoRoot, out);
    const rel = relative(repoRoot, p);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`--out must stay inside the repo: ${out}`);
    mkdirSync(dirname(p), { recursive: true });
    await page.screenshot({ path: p });
    process.stderr.write(`browser: wrote ${p}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  note(`runner: ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  await browser.close();
}

if (errors.size) {
  process.stderr.write(`browser: FAILURES (${errors.size} distinct)\n`);
  for (const [m, n] of errors) process.stderr.write(`  ${m}${n > 1 ? ` (x${n})` : ''}\n`);
  exitCode = 1;
} else {
  process.stderr.write('browser: PASS (no console errors, no failed requests)\n');
}
process.exit(exitCode);
