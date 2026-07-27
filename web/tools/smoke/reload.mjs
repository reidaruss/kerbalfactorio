// reload.mjs: RELOAD THE PAGE MID-FLIGHT AND SEE WHAT COMES BACK (lane G, W11).
//
// `run.mjs` drives ONE page load, so it cannot ask the question that matters
// most about a save: what does the player get when they come back? This runner
// boots the client, flies, reloads the browser in place (same profile, so
// IndexedDB survives exactly as it does for a person pressing F5) and reports
// the before/after pair.
//
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:5211/ --phase=orbit
//
// --phase picks WHERE the reload happens: pad | ascent | orbit | ground.
// Every phase runs the same script up to its own cut, so the four are
// comparable. Exit 1 on any console error, page error or failed assertion,
// same rule run.mjs uses.
//
// WHAT IT IS FOR. The 20 second autosave keeps writing while a vessel is in
// flight, and the world save has no field for a vessel. So a reload in orbit
// silently returns the player to the ground with the rocket simply gone. This
// runner is how that is measured rather than argued about, and how the fix is
// held to account afterwards.

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
const base = args.get('url') ?? 'http://127.0.0.1:5211/';
const phase = args.get('phase') ?? 'orbit';
const url = `${base}?sandbox=1&debug=1`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('reload: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
// ONE context for the whole run: a reload has to keep IndexedDB, which is the
// entire point. A second `newPage` on a fresh context would silently give the
// second half an empty save and the run would "pass" by describing nothing.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') note(`console.error: ${m.text()}`);
  // The allowlist is run.mjs's, verbatim, and its reasoning lives there: two
  // named ANGLE diagnostics on stock three.js source, neither a wildcard. It
  // is duplicated rather than shared because these runners are deliberately
  // standalone, so the rule is to keep them IN SYNC: X4000 was added to
  // run.mjs by the post-stack lane and not here, and this runner then failed
  // every build the moment FXAA shipped.
  else if (m.type() === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())
           && !/warning X4122/.test(m.text())
           && !/warning X4000: use of potentially uninitialized variable \(f_ApplyFXAA\)/
             .test(m.text())) note(`console.warn: ${m.text()}`);
});
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => note(`requestfailed: ${r.url()}`));

const wrap = (file, argsJson) =>
  `((OF_ARGS) => (\n${readFileSync(resolve(here, file), 'utf8')}\n))(${argsJson})`;

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
};

let exitCode = 0;
let before = null; let after = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);

  // PHASE 1: fly to the requested cut, then report the world as it stands.
  before = await page.evaluate(wrap('probes/flyto.js', JSON.stringify({ phase })));
  if (before === null || before.valid !== true) {
    throw new Error(`phase 1 setup failed: ${JSON.stringify(before)}`);
  }
  check('phase 1 reached its cut', before.reached === phase,
        `wanted ${phase}, got ${before.reached}`);
  check('phase 1 wrote at least one autosave', before.saves > 0, `${before.saves}`);

  // THE RELOAD. Same context, so IndexedDB is the same store a player has.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  after = await page.evaluate(() => {
    const of = window.__of;
    const w = of.world();
    const g = of.game();
    const f = typeof of.flight === 'function' ? of.flight('report') : null;
    return {
      tick: w.tick, regime: w.regime, altM: w.altM,
      observerMode: w.observer.mode,
      lat: w.observer.latDeg, lon: w.observer.lonDeg,
      buildings: g.factory ? g.factory.buildings : -1,
      links: g.factory && g.factory.links ? g.factory.links.length : -1,
      flightLive: f ? f.flight.live : null,
      aboard: f ? f.aboard : null,
      flightStatus: f ? f.flight.status : null,
      // `persist` carries saves, the restore ledger and any refusal, which is
      // how "nothing came back" is told apart from "nothing was written".
      persist: g.persist ?? null,
    };
  });

  // THE ASSERTIONS THAT ARE TRUE WHATEVER THE SAVE FORMAT DOES.
  check('the client came back up and is ticking', after.tick > 0, `${after.tick}`);
  check('the world restored the factory the player built',
        after.buildings >= before.buildings,
        `${before.buildings} buildings before, ${after.buildings} after`);
  check('the player is somewhere real (not NaN)',
        Number.isFinite(after.lat) && Number.isFinite(after.lon),
        JSON.stringify([after.lat, after.lon]));
  check('the player is NOT left strapped into a vessel that does not exist',
        !(after.aboard === true && after.flightLive === false),
        `aboard ${after.aboard}, live ${after.flightLive}`);
  // DW-36/DW-17: what the player EXPLORED has to come back, and the in-page
  // round trip cannot see this. `of.save()`/`of.load()` inside one page passes
  // even when the boot order loses the field, because by then the field exists.
  // Only a real reload asks the question, so only this runner can assert it.
  // -1 is /core REFUSING the stream and 0 is a slot that carried none; both are
  // the defect, so the bar is a positive count.
  check('the discovered world came back',
        (after.persist?.restored?.discovery ?? -1) > 0,
        `${after.persist?.restored?.discovery}`);

  console.log(JSON.stringify({ phase, before, after, fails }, null, 2));
} catch (e) {
  note(`runner: ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`reload: ${fails.length} ASSERTION FAILURES`);
  for (const f of fails) console.error('  ' + f);
  exitCode = 1;
}
if (errors.size) {
  console.error(`reload: page FAILURES (${errors.size} distinct)`);
  for (const [m, n] of errors) console.error(`  ${m}${n > 1 ? `   (x${n})` : ''}`);
  exitCode = 1;
}
if (exitCode === 0) console.error(`reload: PASS (phase ${phase})`);
process.exit(exitCode);
