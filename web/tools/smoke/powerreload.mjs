// PH-108. THE STATION'S GRAVITY STAYS OFF ACROSS A REAL BROWSER RELOAD.
//
// The defect this closes is narrow and was named before it was fixed (PH-103):
// `stationGravityPowered` was MODULE STATE that ships true and that no save
// carried. Switch the generator off, float down the corridor, press F5, and you
// are standing up in gravity again with nothing anywhere saying the world undid
// the only thing you did to it. A station that is powered before a reload and
// dead after is worse than one that was never powered, because the second is a
// missing feature and the first is a world that lies about itself.
//
// A REAL `page.reload()` AND NOT AN IN-PAGE ROUND TRIP, for the reason
// `stationreload.mjs` states at length and which is worth restating in one line:
// a probe is one `page.evaluate`, and a real reload destroys the execution
// context that evaluate is running in, so no probe run through `run.mjs` can
// ever ask this question. This is the physics lane's sixth standalone runner.
//
// WHAT MAKES IT A PROOF RATHER THAN A COINCIDENCE IS THE CONTROL, and there are
// two of them, because this field has TWO ways to pass while proving nothing.
//
//   --control=wipe   clears the slot before reloading. With nothing to adopt
//                    the boot must come back POWERED, which is what shows the
//                    ON case is a default rather than something the save
//                    happens to force. Without this, a bug that ignored the
//                    field entirely would still pass the ON half.
//
//   --control=noflag strips `stationPower` out of the slot before reloading,
//                    leaving every other field intact. This is a slot written
//                    before the field existed, i.e. Reid's current world, and
//                    it must boot POWERED. `stashStationPower` takes `unknown`
//                    and only accepts a real boolean for exactly this case:
//                    collapsing a missing field to `false` with `=== true`
//                    would have switched the gravity off in every existing
//                    save on its first load.
//
// Usage:
//   node tools/smoke/powerreload.mjs --url=http://127.0.0.1:5471/
//   node tools/smoke/powerreload.mjs --url=... --control=wipe
//   node tools/smoke/powerreload.mjs --url=... --control=noflag

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
// AN UNRECOGNISED FLAG IS A HARD EXIT BEFORE THE BROWSER LAUNCHES, copied from
// `run.mjs` and from `stationreload.mjs` rather than from `reload.mjs`, which
// discards them silently and therefore passes while describing the default
// (R51). A discarded flag fails in the flattering direction.
const OWN = new Set(['url', 'control']);
const unknown = [...args.keys()].filter((k) => !OWN.has(k));
if (unknown.length > 0) {
  console.error(`powerreload: unknown flag(s): ${unknown.join(', ')}`);
  console.error(`powerreload: known flags: ${[...OWN].join(', ')}`);
  process.exit(2);
}
const url = args.get('url') ?? 'http://127.0.0.1:5471/';
const control = args.get('control') ?? '';
if (control !== '' && control !== 'wipe' && control !== 'noflag') {
  console.error(`powerreload: --control must be wipe or noflag, got "${control}"`);
  process.exit(2);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('powerreload: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
    '--disable-frame-rate-limit', '--hide-scrollbars'],
});
// ONE context for the whole run: the reload has to KEEP IndexedDB, which is the
// entire point. A fresh context would hand the second half an empty store and
// the run would pass by describing nothing.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') note(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
};
const r6 = (x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : null);

/**
 * Stand on the station's own spawn socket and report what the player weighs.
 *
 * ON THE SPAWN AND NOT ON THE STATION'S POSITION, which is the correction
 * PH-105 had to make: `col_HallCore` is a solid column from local y 0 to 5.400
 * and the station's origin is inside it, so the raw position is not a place a
 * body can be. `install.standPos` is derived from the asset's own `socket_hall`
 * empty.
 */
const READ = `(async () => {
  const of = window.__of;
  const st = of.station();
  if (st === null || st.install === null) return { ok: false, why: 'no station' };
  const p = st.install.standPos;
  of.input.tape([{ hold: 120, keys: [] }]);
  of.standAt(p[0], p[1], p[2]);
  await of.run(1.0, 60);
  const w = of.weight();
  return {
    ok: true,
    powered: of.stationGravity().powered,
    apparentG: w.apparentG,
    trueG: w.trueG,
    restoredExactly: w.restoredExactly,
    floating: w.floating,
    weightless: w.weightless,
    grounded: w.grounded,
    onDeck: w.onDeck,
    deckBoxes: w.station === null ? null : w.station.deckBoxes,
    airlockX: w.station === null ? null : w.station.airlockX,
    feet: of.world().player.feet.slice(),
  };
})()`;

let exitCode = 0;
let before = null; let after = null; let slotFlag = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  // --- PHASE 1: switch it off, and prove the world noticed ------------------
  // The OFF state has to be established by measurement and not by the flag, or
  // this runner would be asserting that a boolean round-trips rather than that
  // a station did.
  await page.evaluate(() => window.__of.stationGravity(false));
  before = await page.evaluate(READ);
  if (before?.ok !== true) throw new Error(`phase 1: ${JSON.stringify(before)}`);
  check('phase 1 the generator is off', before.powered === false, `powered=${before.powered}`);
  check('phase 1 the deck has no weight', Math.abs(before.apparentG) < 0.15,
    `apparentG=${r6(before.apparentG)}`);
  check('phase 1 the player floats', before.floating === true);

  // THE SAVE, through `of.save()` -> `Persist.saveSlot` -> `SaveGame.writeSlot`,
  // the ONE choke point (PS-13 to PS-15). This runner adds no writer of its own,
  // which is the constraint that mattered most about where the field went.
  await page.evaluate(async () => { await window.__of.save(); });

  if (control === 'wipe') {
    await page.evaluate(() => window.__of.wipe());
  } else if (control === 'noflag') {
    // Reach into the store and delete ONE field, leaving the rest of the slot
    // exactly as written. This is the only way to manufacture a pre-field save
    // without keeping an old build around, and it is the case Reid's own world
    // is in right now.
    slotFlag = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const name = dbs.map((d) => d.name).find((n) => n && /of|orbital|save/i.test(n));
      if (!name) return { stripped: false, why: 'no database found' };
      const db = await new Promise((res, rej) => {
        const rq = indexedDB.open(name);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      const store = db.objectStoreNames[0];
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const keys = await new Promise((res) => {
        const rq = os.getAllKeys(); rq.onsuccess = () => res(rq.result);
      });
      let had = null; let n = 0;
      for (const k of keys) {
        const v = await new Promise((res) => {
          const rq = os.get(k); rq.onsuccess = () => res(rq.result);
        });
        if (v && typeof v === 'object' && 'stationPower' in v) {
          had = v.stationPower;
          delete v.stationPower;
          os.put(v, k); n++;
        }
      }
      return { stripped: n > 0, slots: n, had, store, db: name };
    });
    check('control noflag stripped the field', slotFlag.stripped === true,
      JSON.stringify(slotFlag));
  }

  // --- THE RELOAD. Same context, so IndexedDB is the store a player has. -----
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  after = await page.evaluate(READ);
  if (after?.ok !== true) throw new Error(`phase 2: ${JSON.stringify(after)}`);

  if (control === '') {
    // THE CLAIM. Off before, off after, and the deck measured rather than the
    // flag believed.
    check('the generator is still off', after.powered === false, `powered=${after.powered}`);
    check('the deck still has no weight', Math.abs(after.apparentG) < 0.15,
      `apparentG=${r6(after.apparentG)}`);
    check('the player still floats', after.floating === true);
    // The geometry has to come back too, or "no weight" could just be "no
    // station". This is what stops the pass being vacuous.
    check('the interior came back', after.deckBoxes === 9, `deckBoxes=${after.deckBoxes}`);
    check('the airlock came back', after.airlockX === -20, `airlockX=${after.airlockX}`);
  } else {
    // BOTH CONTROLS EXPECT POWERED. `wipe` because there is no slot to adopt;
    // `noflag` because a slot with no field must leave the default standing.
    check(`control ${control}: boots POWERED`, after.powered === true,
      `powered=${after.powered}`);
    check(`control ${control}: the deck has weight`, after.apparentG > 1.0,
      `apparentG=${r6(after.apparentG)}`);
    check(`control ${control}: gravity is restored bit-exactly`,
      after.restoredExactly === true,
      `apparent=${after.apparentG} true=${after.trueG}`);
    check(`control ${control}: the player stands`, after.grounded === true);
  }
} catch (e) {
  fails.push(`threw: ${e.message}`);
} finally {
  await browser.close();
}

for (const [m, n] of errors) fails.push(`page error x${n}: ${m}`);

const report = {
  runner: 'powerreload',
  url,
  control: control === '' ? 'none (the claim)' : control,
  before: before === null ? null : {
    powered: before.powered, apparentG: r6(before.apparentG),
    floating: before.floating, onDeck: before.onDeck,
  },
  after: after === null ? null : {
    powered: after.powered, apparentG: r6(after.apparentG), trueG: r6(after.trueG),
    restoredExactly: after.restoredExactly, floating: after.floating,
    grounded: after.grounded, onDeck: after.onDeck,
    deckBoxes: after.deckBoxes, airlockX: after.airlockX,
  },
  slotFlag,
  fails,
  result: fails.length === 0 ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
if (fails.length > 0) exitCode = 1;
process.exit(exitCode);
