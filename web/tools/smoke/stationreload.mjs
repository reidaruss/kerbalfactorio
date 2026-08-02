// PH-97. THE STATION SURVIVES A REAL BROWSER RELOAD, and the interior is not
// what survives it.
//
// A REAL `page.reload()` AND NOT AN IN-PAGE ROUND TRIP, and this runner exists
// because that distinction turned out to be load-bearing. `probes/decksink.js`
// has a leg it calls "reload" which is `await of.save(); await of.load()`: the
// document is never torn down, so it proves that a serialise/deserialise
// re-adopts into the live collision set and proves NOTHING about boot order,
// fresh world generation, or the player anchor. Worse, no probe run through
// `run.mjs --evalfile=` can ever do better: a probe is one `page.evaluate`, and
// a real reload destroys the execution context that evaluate is running in, so
// the promise rejects before the probe can return. Every real-reload proof in
// this repo is therefore a standalone `.mjs` runner, and this is the physics
// lane's fifth (`vesselreload.mjs` is the fourth).
//
// `reload.mjs` was considered and refused for one specific reason: its phase 2
// is a FIXED inline evaluate with no way to run a probe after the reload, and
// this proof has to re-bisect the walker's own collision predicate and re-drive
// the stand trace on the far side. Adding a `--verify=` flag to it is the right
// fix and is raised rather than taken, because that file is build-tooling's.
//
// WHAT IS ACTUALLY BEING PROVED, and it is narrower and better than "the
// station came back": the interior is DERIVED from the record on every boot and
// is never itself saved. So what crosses the reload is nine numbers and a
// clock, and the box list is rebuilt from them. The negative control is what
// makes that a claim rather than a hope: with the slot cleared, the second boot
// MINTS a new station instead of adopting one, and the run says so.
//
// Usage:
//   node tools/smoke/stationreload.mjs --url=http://127.0.0.1:5188/
//   node tools/smoke/stationreload.mjs --control=1     (wipe the slot: expect a mint)

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
// AN UNRECOGNISED FLAG IS A HARD EXIT BEFORE THE BROWSER LAUNCHES. `run.mjs`
// does this and `reload.mjs` does NOT, which the decksink audit turned up: a
// typo'd flag there is silently discarded and the run passes while describing
// the default. Copying the guard rather than the omission.
const OWN = new Set(['url', 'control', 'seed']);
const unknown = [...args.keys()].filter((k) => !OWN.has(k));
if (unknown.length > 0) {
  console.error(`stationreload: unknown flag(s): ${unknown.join(', ')}. `
    + `Known: ${[...OWN].map((k) => `--${k}=`).join(' ')}`);
  process.exit(2);
}
const base = args.get('url') ?? 'http://127.0.0.1:5188/';
const control = args.get('control') === '1';
const seed = args.get('seed');
const url = `${base}?sandbox=1&debug=1&scenario=walk${seed ? `&seed=${seed}` : ''}`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('stationreload: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
// ONE context for the whole run: the reload has to keep IndexedDB, which is the
// entire point. A fresh context would hand the second half an empty save and
// the run would "pass" by describing nothing (reload.mjs's warning, verbatim).
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
const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);

let exitCode = 0;
let before = null; let after = null; let walkBefore = null; let walkAfter = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  // --- PHASE 1: the station exists and is walkable -------------------------
  walkBefore = await page.evaluate(wrap('probes/stationwalk.js', '{}'));
  if (walkBefore?.ok !== true) {
    throw new Error(`phase 1 stationwalk failed: ${JSON.stringify(walkBefore)?.slice(0, 400)}`);
  }
  before = await page.evaluate(() => window.__of.station());

  // THE SAVE. Through `of.save()`, which is `Gameplay.save` -> `Persist.saveSlot`
  // -> `SaveGame.writeSlot`, the one choke point (PS-13 to PS-15). The vessel
  // rows are stamped INSIDE writeSlot by `saveVessels()`, so the station record
  // is carried by the same mechanism a rocket is and this runner does not
  // introduce a second writer.
  const saved = await page.evaluate(async () => {
    await window.__of.save();
    return window.__of.game()?.persist?.saves ?? null;
  });
  check('phase 1 wrote a save', saved !== null && saved > 0, `saves=${saved}`);

  // THE CONTROL. Clearing the slot means the second boot has nothing to adopt,
  // so it must MINT. That is what distinguishes "the record came back" from
  // "a station is always there because one is made at boot", which is the way
  // this proof would otherwise pass without proving anything.
  if (control) {
    await page.evaluate(() => window.__of.wipe());
  }

  // --- THE RELOAD. Same context, so IndexedDB is the same store a player has.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  // --- PHASE 2: it is still there, in the same place, and still walkable ---
  after = await page.evaluate(() => window.__of.station());
  walkAfter = await page.evaluate(wrap('probes/stationwalk.js', '{}'));

  check('a station exists after the reload', after !== null);
  if (after !== null && before !== null) {
    if (control) {
      // The slot was cleared, so this must be a NEW record.
      check('control: the second boot MINTED rather than adopted',
        after.install?.minted === true, `minted=${after.install?.minted}`);
    } else {
      check('the station was ADOPTED, not minted again',
        after.install?.minted === false, `minted=${after.install?.minted}`);
      check('the record kept its id', after.id === before.id,
        `${before.id} -> ${after.id}`);
      check('exactly one station record', after.records >= 1
        && after.records === before.records, `${before.records} -> ${after.records}`);
      // THE NINE NUMBERS. Bit-exact, because they are the only thing on disk
      // and nothing recomputes them: `adoptSaved` copies the row verbatim.
      for (const k of ['a', 'e', 'i', 'lan', 'argp', 'nu', 'm0', 'epoch', 'mu']) {
        check(`element ${k} is bit-identical across the reload`,
          before.el?.[k] === after.el?.[k], `${before.el?.[k]} -> ${after.el?.[k]}`);
      }
      const dPos = Math.hypot(after.pos[0] - before.pos[0],
        after.pos[1] - before.pos[1], after.pos[2] - before.pos[2]);
      check('the derived position is unmoved', dPos === 0, `${dPos} m`);
      check('the deck radius is unmoved', after.deckR === before.deckR,
        `${before.deckR} -> ${after.deckR}`);
      check('the clock did not advance', after.clockS === before.clockS,
        `${before.clockS} -> ${after.clockS}`);
      check('the record is still unstamped, so it never drifts along its conic',
        after.stampedTick === -1, `stampedTick=${after.stampedTick}`);
    }
    check('the interior was rebuilt from the record',
      after.proxies === before.proxies, `${before.proxies} -> ${after.proxies}`);
  }
  check('the station is still walkable after the reload', walkAfter?.ok === true,
    walkAfter?.ok === true ? '' : JSON.stringify(walkAfter)?.slice(0, 300));
  if (walkAfter?.ok === true && walkBefore?.ok === true && !control) {
    check('the player stands at the same radius after the reload',
      walkAfter.P1.feetR.min === walkBefore.P1.feetR.min,
      `${walkBefore.P1.feetR.min} -> ${walkAfter.P1.feetR.min}`);
    check('the walkable floor still agrees with the orbit after the reload',
      walkAfter.P2.deltaM === 0 && walkAfter.P2.standMinusConicM === 0,
      JSON.stringify(walkAfter.P2));
  }
} catch (e) {
  fails.push(`threw: ${e.message}`);
} finally {
  await browser.close();
}

for (const [m, n] of errors) fails.push(`${m}${n > 1 ? ` (x${n})` : ''}`);

const out = {
  mode: control ? 'CONTROL (slot cleared: a mint is expected)' : 'reload',
  before: before === null ? null : {
    id: before.id, deckR: r6(before.deckR), minted: before.install?.minted,
    proxies: before.proxies, records: before.records, e: before.el?.e,
  },
  after: after === null ? null : {
    id: after.id, deckR: r6(after.deckR), minted: after.install?.minted,
    proxies: after.proxies, records: after.records, e: after.el?.e,
  },
  walkableBefore: walkBefore?.ok === true,
  walkableAfter: walkAfter?.ok === true,
  standBeforeR: walkBefore?.P1?.feetR?.min ?? null,
  standAfterR: walkAfter?.P1?.feetR?.min ?? null,
  fails,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length > 0) { console.error(`stationreload: FAIL (${fails.length})`); exitCode = 1; }
else console.log('stationreload: PASS');
process.exit(exitCode);
