// vesselreload.mjs: DOES THE VESSEL COME BACK, IN ALL THREE OF ITS STATES?
// (PH-64 to PH-69, the reload half.)
//
//   node tools/smoke/vesselreload.mjs --url=http://127.0.0.1:5473/ --phase=orbit
//   node tools/smoke/vesselreload.mjs --url=http://127.0.0.1:5473/ --phase=all
//
// --phase is pad | ascent | orbit | all, and it names the STATE the record is in
// at the cut, which is the whole variable: parked, frozen and rails are three
// different answers to "where is it" (VesselRegistry.ts) and only running all
// three says the save carries the ANSWER rather than one of the three shapes.
// `all` runs them in sequence, each in its own fresh browser context.
//
// WHY THIS IS A RUNNER AND NOT A PROBE, and it is the same reason reload.mjs
// gives: ONE browser context and `page.reload()`. A second `newPage` on a fresh
// context would hand the second half an empty IndexedDB, and the run would
// "pass" while describing nothing at all. Only a real reload rebuilds the world
// from the slot in boot order, so only a runner shaped like this one can ask
// whether a rocket left in orbit is still there afterwards.
//
// THE ASSERTION THAT IS THE POINT is number 3: the vessel comes back with THE
// FUEL IT ACTUALLY HAD. Restoring a craft by rebuilding it from its design and
// replaying its stagings is the easy 90 per cent and it comes back with FULL
// TANKS, which is free delta-v (FlightCheats.refillTanks had to ship exactly
// that and said so). ABI 18's propellant setter is what makes the last 10 per
// cent possible, and a reload proof that does not weigh the tanks proves nothing
// about it. For `ascent` and `orbit` the fuel is also asserted to be STRICTLY
// LESS than the design's full load, taken from `of.vab('report').stats
// .propellantKg` in the same page that built the rocket, so "it came back with
// the right fuel" cannot be satisfied by a rocket that never burned any.
//
// THE SAVE IS FORCED AT THE CUT, and that is a correctness requirement rather
// than a convenience. The autosave fires every 20 seconds, so the slot on disk
// can be up to 20 seconds stale, and an orbiting vessel covers 46 km in that
// time: comparing a position captured now against a slot written then would
// measure the autosave cadence and call it a restore error. `of.save()` goes
// through the same `writeSlot` choke point the autosave does, and its stamp
// (`saveVessels` -> the sync hook) runs SYNCHRONOUSLY before the IndexedDB
// write, so the capture below is deliberately taken WITHOUT awaiting: no fixed
// tick can run between the stamp and the read, and the two are the same instant.
// `before.saves > 0` is still asserted, so the autosave path is still proved to
// have run on its own during the flight.

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
const base = args.get('url') ?? 'http://127.0.0.1:5473/';
const want = args.get('phase') ?? 'orbit';
const ORDER = ['pad', 'ascent', 'orbit'];
if (want !== 'all' && !ORDER.includes(want)) {
  console.error(`vesselreload: --phase must be one of ${ORDER.join(' | ')} | all`);
  process.exit(2);
}
const phases = want === 'all' ? ORDER : [want];
const url = `${base}?sandbox=1&debug=1`;
const SETUP = 'probes/flyto.js';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('vesselreload: no Chrome or Edge found'); process.exit(2); }

const wrap = (file, argsJson) =>
  `((OF_ARGS) => (\n${readFileSync(resolve(here, file), 'utf8')}\n))(${argsJson})`;

// WHAT IS READ ON BOTH SIDES OF THE RELOAD, as one expression so the two
// captures cannot drift apart. `before` additionally forces the save; `after`
// passes 0 and only reads.
const CAPTURE = (save) => `(async () => {
  const of = window.__of;
  // The stamp inside of.save() is synchronous; the capture below deliberately
  // does NOT await, so no fixed tick separates the slot from the reading.
  const pending = ${save ? 'of.save()' : 'null'};
  const v = of.flight('vessels');
  const rec = (v.list || [])[0] || null;
  const rails = rec === null ? null
    : of.flight('railsAt', { id: rec.id, tick: v.tick });
  const f = of.flight('report');
  const w = of.world();
  const g = of.game();
  const vab = typeof of.vab === 'function' ? of.vab('report') : null;
  // THE WALKER's own latitude, never the observer's. of.world().observer is
  // whichever source is LIVE, so while the player is strapped in it reports the
  // ROCKET, and on the pad that is 26 m away and in orbit it is a different
  // hemisphere. player.feet is the body's position whatever the camera is doing,
  // which is exactly the distinction PlayerAnchor.ts is about.
  const feet = w.player === null ? null : w.player.feet;
  const rr = feet === null ? 0 : Math.hypot(feet[0], feet[1], feet[2]);
  const saved = pending === null ? null : await pending;
  // RE-READ. of.game() is a SNAPSHOT, not a thunk, and Persist.saveSlot bumps
  // the counter AFTER its await, so the object captured above still holds the
  // pre-save number and "the save landed" would be unfalsifiable.
  const g2 = of.game();
  return {
    tick: w.tick, saves: g2.persist ? g2.persist.saves : -1,
    saveInhibit: g.persist ? (g.persist.saveInhibit ?? null) : null,
    saved,
    lat: rr === 0 ? null : (Math.asin(feet[1] / rr) * 180) / Math.PI,
    lon: rr === 0 ? null : (Math.atan2(feet[2], feet[0]) * 180) / Math.PI,
    observerLat: w.observer.latDeg, observerLon: w.observer.lonDeg,
    aboard: f.aboard, live: f.flight.live, status: f.flight.status,
    liveParts: f.flight.parts,
    designFullKg: vab && vab.stats ? vab.stats.propellantKg : -1,
    vessels: v, rec, rails,
  };
})()`;

const results = [];
let exitCode = 0;

for (const phase of phases) {
  const errors = new Map();
  const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);
  const fails = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };

  // A FRESH CONTEXT PER PHASE, and one context WITHIN a phase. The first half
  // of that sentence keeps the pad run's slot out of the orbit run's world; the
  // second half is the entire reason this file exists.
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-angle=default', '--enable-unsafe-swiftshader',
           '--disable-frame-rate-limit', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') note(`console.error: ${m.text()}`);
    // reload.mjs's allowlist, verbatim, and its reasoning lives there: two named
    // ANGLE diagnostics on stock three.js source, neither a wildcard. Kept in
    // sync deliberately rather than shared, same as that file.
    else if (m.type() === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())
             && !/warning X4122/.test(m.text())
             && !/warning X4000: use of potentially uninitialized variable \(f_ApplyFXAA\)/
               .test(m.text())) note(`console.warn: ${m.text()}`);
  });
  page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => note(`requestfailed: ${r.url()}`));

  let flew = null; let before = null; let after = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
    await page.evaluate(() => window.__of.ready);

    // PHASE 1: fly to the cut this run is named after.
    flew = await page.evaluate(wrap(SETUP, JSON.stringify({ phase })));
    if (flew === null || flew.valid !== true) {
      throw new Error(`setup failed: ${JSON.stringify(flew)}`);
    }
    // `reached` is flyto's own word for the cut it MEASURED, never the one it
    // was asked for, so this is not a tautology (DW-20).
    check('phase 1 reached the cut it was asked for', flew.reached === phase,
          `wanted ${phase}, got ${flew.reached}`);
    check('phase 1 wrote at least one AUTOSAVE while flying', flew.saves > 0,
          `${flew.saves}`);

    before = await page.evaluate(CAPTURE(true));
    check('the forced save at the cut was WRITTEN, not refused',
          before.saved !== null && before.saved.refused === undefined
          && before.saves > flew.saves,
          `${JSON.stringify(before.saved)}, saves ${flew.saves} -> ${before.saves}`);
    // LOUDLY, AND EARLY. If the per-tick watcher never made a record then
    // `records` is 0 and every assertion below this line is vacuous
    // (FlightVessels.watchVessels rides FlightPad.stepPadClamps).
    check('there IS a vessel record before the reload',
          before.vessels.records === 1 && before.rec !== null,
          `${before.vessels.records} records`);
    check('and NO design snapshot was refused, so the record has a design at all',
          before.vessels.refusedSnapshots === 0,
          `refusedSnapshots ${before.vessels.refusedSnapshots}, `
          + `snapshots ${before.vessels.snapshots}`);
    check('the design full load is readable, so the fuel bar is not vacuous',
          before.designFullKg > 0, `${before.designFullKg} kg`);
    if (fails.length > 0) throw new Error('phase 1 did not produce a world worth reloading');

    // THE RELOAD. Same context, so IndexedDB is the store a person pressing F5
    // has, and nothing else about the page survives.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
    await page.evaluate(() => window.__of.ready);
    await page.evaluate(() => window.__of.run(2));
    after = await page.evaluate(CAPTURE(false));

    const b = before.rec; const a = after.rec;
    const WANT_MODE = { pad: 'parked', ascent: 'frozen', orbit: 'rails' }[phase];

    // --- 1. EXACTLY ONE VESSEL CAME BACK, and it is not a duplicate ----------
    check('1 exactly ONE vessel came back', after.vessels.records === 1,
          `${after.vessels.records} records: ${JSON.stringify(
            (after.vessels.list || []).map((r) => r.id))}`);
    check('1b and the restore adopted exactly one row from the slot',
          after.vessels.resume.adopted === 1,
          `adopted ${after.vessels.resume.adopted}`);
    check('1c refusedSnapshots is still zero after the reload',
          after.vessels.refusedSnapshots === 0,
          `${after.vessels.refusedSnapshots}`);

    // --- 2. IT IS THE SAME VESSEL -------------------------------------------
    check('2 it is the SAME vessel: same id', a !== null && b !== null
          && a.id === b.id, `${b?.id} -> ${a?.id}`);
    check('2b with the same part count', a !== null && b !== null
          && a.parts === b.parts, `${b?.parts} -> ${a?.parts}`);
    check('2c and the same number of stagings fired', a !== null && b !== null
          && a.fired === b.fired, `${b?.fired} -> ${a?.fired}`);

    // --- 3. THE FUEL IT ACTUALLY HAD. THIS IS THE POINT ---------------------
    const dFuel = a === null || b === null ? Infinity : Math.abs(a.fuelKg - b.fuelKg);
    check('3 IT HAS THE FUEL IT ACTUALLY HAD, not full tanks', dFuel < 1e-6,
          `${b?.fuelKg} kg -> ${a?.fuelKg} kg, difference ${dFuel} kg`);
    if (phase !== 'pad') {
      // The negative control for the row above: on the pad the tanks ARE full,
      // so only a phase that has burned something can tell "restored correctly"
      // apart from "refilled and happened to be right".
      check('3b and for a flown vessel that is STRICTLY LESS than a full load',
            a !== null && a.fuelKg < before.designFullKg - 1,
            `${a?.fuelKg} kg aboard, design holds ${before.designFullKg} kg`);
    } else {
      check('3b on the pad it is the FULL load, which is what makes 3b elsewhere '
            + 'a real discriminator', a !== null
            && Math.abs(a.fuelKg - before.designFullKg) < 1e-6,
            `${a?.fuelKg} kg aboard, design holds ${before.designFullKg} kg`);
    }

    // --- 4. THE MODE IS THE RIGHT ONE FOR THE STATE -------------------------
    check(`4 the mode came back as ${WANT_MODE}`, a !== null && a.mode === WANT_MODE,
          `${b?.mode} -> ${a?.mode} (status ${a?.status})`);
    if (phase === 'orbit') {
      check('4b and it is still NINE NUMBERS, not a frozen state vector',
            a !== null && a.conic !== null && Number.isFinite(a.conic.a),
            JSON.stringify(a?.conic ?? null));
      const relA = a?.conic && b?.conic
        ? Math.abs(a.conic.a - b.conic.a) / Math.abs(b.conic.a) : Infinity;
      const relE = a?.conic && b?.conic
        ? Math.abs(a.conic.e - b.conic.e) / Math.max(1e-12, Math.abs(b.conic.e))
        : Infinity;
      check('4c the semi-major axis round-tripped', relA < 1e-9,
            `${b?.conic?.a} -> ${a?.conic?.a}, relative ${relA}`);
      check('4d and so did the eccentricity', relE < 1e-9,
            `${b?.conic?.e} -> ${a?.conic?.e}, relative ${relE}`);
      check('4e and so did the vessel\'s OWN clock, which the conic is measured '
            + 'against', a !== null && b !== null
            && Math.abs(a.clockS - b.clockS) < 1e-9,
            `${b?.clockS} s -> ${a?.clockS} s`);
    }

    // --- 5. IT IS IN THE SAME PLACE ------------------------------------------
    // Both sides are `railsAt`, which DERIVES the position rather than reading a
    // stored one, so this compares the thing the design says is authoritative.
    // A restored record carries `stampedTick: -1`, which `clockAt` reads as "the
    // world was not running, so it did not move", and the world was not running:
    // the answer should be exact and the metres are reported either way.
    const movedM = before.rails === null || after.rails === null ? Infinity
      : Math.hypot(after.rails.pos[0] - before.rails.pos[0],
                   after.rails.pos[1] - before.rails.pos[1],
                   after.rails.pos[2] - before.rails.pos[2]);
    const dVel = before.rails === null || after.rails === null ? Infinity
      : Math.hypot(after.rails.vel[0] - before.rails.vel[0],
                   after.rails.vel[1] - before.rails.vel[1],
                   after.rails.vel[2] - before.rails.vel[2]);
    check('5 IT IS IN THE SAME PLACE', movedM < 1e-6, `${movedM} m`);
    check('5b and moving at the same velocity', dVel < 1e-6, `${dVel} m/s`);

    // --- 6. THE BODY CAME BACK WHERE IT WAS STANDING (R13) -------------------
    const dLat = before.lat === null || after.lat === null ? Infinity
      : Math.abs(after.lat - before.lat);
    const dLon = before.lon === null || after.lon === null ? Infinity
      : Math.abs(after.lon - before.lon);
    check('6 the player came back where they were STANDING, not at the scenario '
          + 'spawn (R13)', dLat < 1e-4 && dLon < 1e-4,
          `lat ${before.lat} -> ${after.lat} (${dLat} deg), `
          + `lon ${before.lon} -> ${after.lon} (${dLon} deg)`);
    check('6b and the anchor was applied from the slot rather than defaulted',
          after.vessels.anchor.applied === true
          && after.vessels.anchor.restored !== null,
          JSON.stringify(after.vessels.anchor));

    // --- 7. THE PLAYER IS NOT LEFT STRAPPED IN -------------------------------
    check('7 the player is NOT restored into the vessel (the control handoff is '
          + 'deliberately not built)', after.aboard === false,
          `aboard ${after.aboard}`);

    // --- 8 / 9. WHAT GOT PROMOTED, AND WHAT DID NOT --------------------------
    if (phase === 'pad') {
      check('8 the parked vessel was PROMOTED, so the rocket on the pad is drawn '
            + 'and boardable', after.vessels.resume.promoted === b?.id,
            `promoted ${after.vessels.resume.promoted}, wanted ${b?.id}`);
      check('8b and there is a live FlightSim carrying it',
            after.live === true && after.liveParts === b?.parts,
            `live ${after.live}, parts ${after.liveParts}`);
    } else {
      check(`9 the ${WANT_MODE} vessel was NOT promoted: paying for a simulation `
            + 'nobody is looking at is the cost on-rails exists to avoid',
            after.vessels.resume.promoted === 0,
            `promoted ${after.vessels.resume.promoted}`);
      check('9b and no FlightSim was built for it', after.live === false,
            `live ${after.live}, parts ${after.liveParts}`);
    }
  } catch (e) {
    note(`runner: ${e?.message ?? e}`);
  } finally {
    await browser.close();
  }

  const ok = fails.length === 0 && errors.size === 0;
  if (!ok) exitCode = 1;
  results.push({
    phase, pass: ok, fails,
    pageFailures: [...errors.entries()].map(([m, n]) => (n > 1 ? `${m} (x${n})` : m)),
    refusedSnapshots: {
      before: before?.vessels?.refusedSnapshots ?? null,
      after: after?.vessels?.refusedSnapshots ?? null,
    },
    before: before === null ? null : {
      reached: flew?.reached, saves: before.saves, tick: before.tick,
      aboard: before.aboard, live: before.live, status: before.status,
      lat: before.lat, lon: before.lon,
      designFullKg: before.designFullKg,
      records: before.vessels.records, rec: before.rec, rails: before.rails,
    },
    after: after === null ? null : {
      tick: after.tick, aboard: after.aboard, live: after.live,
      status: after.status, lat: after.lat, lon: after.lon,
      records: after.vessels.records, resume: after.vessels.resume,
      anchor: after.vessels.anchor, rec: after.rec, rails: after.rails,
    },
  });
  console.error(`vesselreload: phase ${phase} ${ok ? 'PASS' : 'FAIL'}`);
}

console.log(JSON.stringify({ url, phases, results }, null, 2));
for (const r of results) {
  if (r.pass) continue;
  console.error(`vesselreload: phase ${r.phase} FAILURES`);
  for (const f of r.fails) console.error(`  ${f}`);
  for (const p of r.pageFailures) console.error(`  page: ${p}`);
}
if (exitCode === 0) {
  console.error(`vesselreload: PASS (${phases.join(', ')})`);
}
process.exit(exitCode);
