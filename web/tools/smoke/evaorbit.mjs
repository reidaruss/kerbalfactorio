// PH-109, PH-110, R54. GET OUT OF THE ROCKET IN ORBIT.
//
// A standalone runner rather than a probe, for one reason that is not the usual
// one: this proof needs TWO probes run against ONE page in sequence. `flyto.js`
// flies a real pad-to-orbit ascent and stops at a named phase; `eva.js` then
// asks its questions of the vessel that ascent produced. `run.mjs --evalfile=`
// takes a single file and cannot compose them, and splitting the proof across
// two runs would mean the second one asserting things about a rocket the first
// one no longer has.
//
// IT FLIES A REAL ASCENT AND DOES NOT TELEPORT A VESSEL INTO ORBIT, which costs
// about eighty seconds of wall clock and buys the only thing that matters here:
// the vessel `eva.js` steps outside of is one that got there by burning
// propellant through `/core`'s own FlightSim, with a staging event and a
// circularisation in its history, and whose `mode` is `rails` because
// `onRails()` says so rather than because this file arranged it.
//
// THE PAD LEG IS THE CONTROL AND IT RUNS FIRST. Before the ascent, with the
// rocket clamped on the ground and the player strapped in, `canEva` must be
// FALSE and the eva verb must refuse. Without that leg the run would prove that
// a door opens and prove nothing at all about it being shut anywhere. It is
// also the specific mistake worth guarding: `mayLeave` permits a `parked`
// vessel, a rocket on the pad is `parked`, and turning a pad disembark into a
// spacewalk would be absurd and would read as working.
//
// Usage:
//   node tools/smoke/evaorbit.mjs --url=http://127.0.0.1:5471/

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
// An unrecognised flag is a hard exit before the browser launches (R51: a
// silently discarded flag fails in the flattering direction).
const OWN = new Set(['url', 'keep']);
const unknown = [...args.keys()].filter((k) => !OWN.has(k));
if (unknown.length > 0) {
  console.error(`evaorbit: unknown flag(s): ${unknown.join(', ')}`);
  console.error(`evaorbit: known flags: ${[...OWN].join(', ')}`);
  process.exit(2);
}
const url = args.get('url') ?? 'http://127.0.0.1:5471/';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('evaorbit: no Chrome or Edge found'); process.exit(2); }

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

const wrap = (file, argsJson) =>
  `((OF_ARGS) => (\n${readFileSync(resolve(here, file), 'utf8')}\n))(${argsJson})`;

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
};

let padLeg = null; let flew = null; let eva = null;
try {
  // Sandbox, because the ascent needs a designed vessel and a pad without
  // walking the whole progression to get one.
  await page.goto(`${url}?sandbox=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 90000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  // --- THE CONTROL: on the pad, the door is SHUT ---------------------------
  // `flyto.js --phase=pad` does the setup, and it is reused rather than
  // reimplemented for a reason the first version of this leg paid for: it
  // hand-rolled a roll-out and a board, `rollouts` came back 0 because there is
  // no design in the bay at boot, `aboard` was false, and the control then
  // measured `canEva` on a player who was not in a rocket. It PASSED while
  // proving nothing, which is the exact failure this whole runner exists to
  // avoid. flyto builds the reference vehicle, rolls it out, walks to it and
  // climbs in, and stops there.
  const padFly = await page.evaluate(wrap('probes/flyto.js', '{"phase":"pad"}'), null,
    { timeout: 240000 });
  check('pad: flyto reached the pad', padFly?.reached === 'pad',
    JSON.stringify(padFly)?.slice(0, 200));

  padLeg = await page.evaluate(async () => {
    const of = window.__of;
    const aboard = of.flight('report');
    const r = of.flight('eva');
    const after = of.flight('report');
    return {
      aboard: aboard.aboard,
      status: aboard.flight?.status ?? null,
      onRails: aboard.flight?.onRails ?? null,
      distanceM: aboard.distanceToVesselM,
      may: r.may, ok: r.ok,
      stillAboard: after.aboard,
      evas: after.evas,
      message: after.message,
    };
  });
  check('pad: the player is aboard a clamped rocket',
    padLeg.aboard === true && padLeg.status === 'CLAMPED', JSON.stringify(padLeg));
  check('pad: canEva is FALSE on the ground', padLeg.may === false, `may=${padLeg.may}`);
  check('pad: the eva verb refused', padLeg.ok === false, `ok=${padLeg.ok}`);
  // A REFUSAL THAT HALF-APPLIES IS WORSE THAN NO GUARD (PH-69's rule): nothing
  // may change on the way out of a refusal.
  check('pad: nothing changed on the refusal',
    padLeg.stillAboard === true && padLeg.evas === 0,
    `aboard=${padLeg.stillAboard} evas=${padLeg.evas}`);
  // AND IT SAID SO. A guard that refuses in silence is one the player
  // experiences as a broken key.
  check('pad: the refusal was announced', typeof padLeg.message === 'string'
    && padLeg.message.length > 0, `message="${padLeg.message}"`);

  // --- FLY IT, for real ----------------------------------------------------
  flew = await page.evaluate(wrap('probes/flyto.js', '{"phase":"orbit"}'), null,
    { timeout: 240000 });
  if (flew?.reached !== 'orbit' && flew?.pass !== true && flew?.ok !== true) {
    throw new Error(`flyto did not reach orbit: ${JSON.stringify(flew)?.slice(0, 500)}`);
  }

  // --- AND STEP OUTSIDE ----------------------------------------------------
  eva = await page.evaluate(wrap('probes/eva.js', '{}'), null, { timeout: 240000 });
  check('eva.js passed', eva?.pass === true, eva?.fail ?? 'no result');
} catch (e) {
  fails.push(`threw: ${e.message}`);
} finally {
  await browser.close();
}

for (const [m, n] of errors) fails.push(`page error x${n}: ${m}`);

const report = {
  runner: 'evaorbit',
  url,
  pad: padLeg,
  flew: flew === null ? null : {
    reached: flew.reached ?? null, apKm: flew.apKm ?? null, peKm: flew.peKm ?? null,
  },
  eva: eva === null ? null : { pass: eva.pass, fail: eva.fail ?? null,
    e1: eva.e1, e2: eva.e2, e3: eva.e3, e4: eva.e4, e5: eva.e5,
    e6: eva.e6, e7: eva.e7 },
  fails,
  result: fails.length === 0 ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
