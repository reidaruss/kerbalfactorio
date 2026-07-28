// mtnreload.mjs: BORE A TUNNEL THROUGH A MOUNTAIN, RELOAD THE BROWSER, WALK
// BACK IN AND STAND STILL (physics lane).
//
//   node tools/smoke/mtnreload.mjs --url=http://127.0.0.1:5457/
//
// WHY. Reid's report is that standing still in a tunnel he dug through a
// mountain, he sinks and is snapped back up every few seconds, and that it
// still happens after RELOADING onto a build carrying the WG-31 fix. Every
// probe in this repo drives one page load, so no test has ever stood in a
// tunnel that came out of IndexedDB rather than out of the dig that cut it.
// A reload re-applies the edit ops through `Gameplay.create` and re-derives the
// heightfield lowering from them, which is a different code path from the live
// dig, and a disagreement between the two would be a DW-26 violation that no
// single-load probe can see.
//
// Structure is reload.mjs's, deliberately: ONE browser context for both halves,
// because a second context would silently give phase 2 an empty save and the
// run would pass by describing nothing.
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const base = args.get('url') ?? 'http://127.0.0.1:5457/';
const url = `${base}?scenario=walk&debug=1`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('mtnreload: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') note(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));

const wrap = (rel, argsJson) => {
  const body = readFileSync(resolve(here, rel), 'utf8');
  return `(async()=>{const OF_ARGS=${argsJson};return await (${body});})()`;
};

let exitCode = 0;
try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__of && window.__of.ready', null, { timeout: 60000 });
  await page.evaluate('window.__of.ready');

  const before = await page.evaluate(wrap('probes/mtnbore.js', JSON.stringify({})));
  if (!before.valid) throw new Error(`phase 1 failed: ${JSON.stringify(before)}`);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__of && window.__of.ready', null, { timeout: 60000 });
  await page.evaluate('window.__of.ready');

  const after = await page.evaluate(wrap('probes/mtnstand.js',
    JSON.stringify({ ...before.site })));
  console.log(JSON.stringify({ before, after }, null, 2));
  if (!after.valid) exitCode = 1;
} catch (e) {
  console.error(`mtnreload: ${e.message}`);
  exitCode = 1;
} finally {
  await browser.close();
}
if (errors.size > 0) {
  console.error(`mtnreload: ${errors.size} distinct console/page errors`);
  for (const [m, n] of errors) console.error(`  ${m} (x${n})`);
}
process.exit(exitCode);
