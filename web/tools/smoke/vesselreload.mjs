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
// The three STATE phases name where the record is at the cut. `handoff` is a
// fourth phase and is a different kind of question (PH-76): it flies the same
// ascent to orbit, then LEAVES the vessel there deliberately, reloads, and takes
// control of it again. The three above ask whether the world comes back; this
// one asks whether you can come back TO it.
const ORDER = ['pad', 'ascent', 'orbit'];
const ALL = [...ORDER, 'handoff'];
if (want !== 'all' && !ALL.includes(want)) {
  console.error(`vesselreload: --phase must be one of ${ALL.join(' | ')} | all`);
  process.exit(2);
}
const phases = want === 'all' ? ALL : [want];
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

// PH-76. THE HANDOFF, OUT. Run at the cut, while the player is still strapped in
// and the vessel is in the orbit flyto.js flew it to.
//
// THE NEGATIVE CONTROL COMES FIRST, and it has to: it needs a promoted vessel to
// refuse, and after the successful leave there is deliberately no live session
// left. Lighting the engine is what makes the record FROZEN, which is one of the
// two states `on_rails_eligible` says no arithmetic can advance, so `mayLeave`
// must turn the handoff away. A guard nobody has seen refuse is a guard nobody
// should trust.
const LEAVE_IN_ORBIT = `(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const F = () => of.flight('report');
  const V = () => of.flight('vessels');
  const row = (v) => ((v || V()).list || [])[0] || null;

  of.input.act(['throttleFull'], 4);
  await sleep(1.2);
  const frozen = row(of.flight('sync'));
  const guard = { aboard: F().aboard, live: F().flight.live,
                  records: V().records, promotedId: V().promotedId,
                  demotions: V().demotions, throttle: F().flight.throttle,
                  altitudeDatumM: F().flight.altitudeDatumM,
                  onRails: F().flight.onRails };
  const refused = of.flight('leave');
  const afterRefusal = {
    ok: refused.ok, message: refused.report.message,
    aboard: refused.report.aboard, live: refused.report.flight.live,
    records: refused.vessels.records, promotedId: refused.vessels.promotedId,
    demotions: refused.vessels.demotions,
  };

  of.input.act(['throttleCut'], 4);
  await sleep(2);
  const thawed = row(of.flight('sync'));
  const left = of.flight('leave');
  const rec = (left.vessels.list || []).find((r) => r.id === (thawed || {}).id) || null;
  return {
    frozenMode: frozen === null ? null : frozen.mode,
    frozenMayLeave: frozen === null ? null : frozen.mayLeave,
    frozenWhyNot: frozen === null ? null : frozen.whyNot,
    thrustN: F().flight.thrustN,
    guard, afterRefusal,
    thawedMode: thawed === null ? null : thawed.mode,
    thawedThrottle: F().flight.throttle,
    thawedAltitudeDatumM: F().flight.altitudeDatumM,
    id: thawed === null ? 0 : thawed.id,
    leftOk: left.ok, leftAboard: left.report.aboard,
    leftLive: left.report.flight.live, leftMessage: left.report.message,
    records: left.vessels.records, promotedId: left.vessels.promotedId,
    handBacks: left.vessels.handBacks, refusals: left.report.refusals,
    disembarks: left.report.disembarks, rec,
  };
})()`;

// PH-76. THE HANDOFF, BACK IN, on the far side of a real browser reload. The
// vessel is a few hundred kilometres away, so this cannot go through the board
// key (BOARD_RANGE_M is 18 m and past ABANDON_RANGE_M that key rolls out a
// SECOND rocket): `distanceToVesselM` is returned so that is a measurement.
//
// The `sync` is what makes the fuel comparison real, because it re-reads the
// propellant out of /core rather than reporting back the number that was written
// in. Everything compared is read IMMEDIATELY after it, in the same synchronous
// turn, so no autosave can re-sync the record underneath the reading.
const RESUME_AFTER_RELOAD = `(() => {
  const of = window.__of;
  const first = ((of.flight('vessels').list || [])[0] || null);
  if (first === null) return { error: 'no record to resume' };
  const resumed = of.flight('resume', first.id);
  const v = of.flight('sync');
  const rec = (v.list || []).find((r) => r.id === first.id) || null;
  return {
    id: first.id, ok: resumed.ok,
    aboard: resumed.report.aboard, live: resumed.report.flight.live,
    promotedId: v.promotedId, promotions: v.promotions,
    distanceToVesselM: resumed.report.distanceToVesselM,
    boardRangeM: resumed.report.boardRangeM,
    steps: resumed.report.flight.steps, massKg: resumed.report.flight.massKg,
    speedMS: resumed.report.flight.speedMS,
    altitudeDatumM: resumed.report.flight.altitudeDatumM,
    propellantKg: resumed.report.flight.propellantKg,
    rec,
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
  let handoff = null; let resumed = null;
  // `handoff` flies the ORBIT cut and then does something more to it. Everything
  // up to the cut is identical, which is deliberate: the handoff is proved on the
  // same hand-flown ascent the orbit phase already trusts.
  const flyPhase = phase === 'handoff' ? 'orbit' : phase;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
    await page.evaluate(() => window.__of.ready);

    // PHASE 1: fly to the cut this run is named after.
    flew = await page.evaluate(wrap(SETUP, JSON.stringify({ phase: flyPhase })));
    if (flew === null || flew.valid !== true) {
      throw new Error(`setup failed: ${JSON.stringify(flew)}`);
    }
    // `reached` is flyto's own word for the cut it MEASURED, never the one it
    // was asked for, so this is not a tautology (DW-20).
    check('phase 1 reached the cut it was asked for', flew.reached === flyPhase,
          `wanted ${flyPhase}, got ${flew.reached}`);
    check('phase 1 wrote at least one AUTOSAVE while flying', flew.saves > 0,
          `${flew.saves}`);

    // PH-76. LEAVE IT IN ORBIT, BEFORE the save is forced. The order is the
    // point: the slot has to be written with the player OUT of the vessel and
    // the vessel on rails, because that is the world Reid described walking away
    // from. Forcing the save first and leaving afterwards would have saved a
    // different world from the one the reload is asked about.
    if (phase === 'handoff') {
      handoff = await page.evaluate(LEAVE_IN_ORBIT);
      // THE THROTTLE IS THE INSTRUMENT HERE, NOT `thrustN`, and the difference is
      // worth writing down because it cost a red row. `onRailsEligible`
      // deliberately RE-EVALUATES propulsion from the COMMANDED throttle rather
      // than reading the telemetry, which it says in its own comment is one step
      // stale. flyto.js circularises until `remainingDvMS <= 1`, so the stage it
      // arrives on is dry and the telemetry reports thrustN 0 with the throttle
      // wide open: a commanded engine on an empty tank. /core still calls that
      // not-rails-eligible, which is the correct answer (the player has asked for
      // thrust), and it is H4 that proves the THROTTLE was the variable and not
      // the altitude, because cutting it thaws the same vessel in the same place.
      check('H1 with the THROTTLE OPEN the record is FROZEN and MAY NOT be left',
            handoff.frozenMode === 'frozen' && handoff.frozenMayLeave === false
            && handoff.guard.throttle > 0,
            `mode ${handoff.frozenMode}, mayLeave ${handoff.frozenMayLeave}, `
            + `throttle ${handoff.guard.throttle}, thrustN ${handoff.thrustN}`);
      check('H2 THE HANDOFF IS REFUSED there, in whyNotLeave\'s published words',
            handoff.afterRefusal.ok === false
            && handoff.afterRefusal.message === handoff.frozenWhyNot
            && /cannot leave a vessel under power/.test(handoff.afterRefusal.message ?? ''),
            `ok ${handoff.afterRefusal.ok}, message "${handoff.afterRefusal.message}"`);
      check('H3 and the refusal CHANGED NOTHING',
            handoff.afterRefusal.aboard === true
            && handoff.afterRefusal.live === true
            && handoff.afterRefusal.records === handoff.guard.records
            && handoff.afterRefusal.promotedId === handoff.guard.promotedId
            && handoff.afterRefusal.demotions === handoff.guard.demotions,
            `${JSON.stringify(handoff.guard)} -> ${JSON.stringify(handoff.afterRefusal)}`);
      // THE DISCRIMINATOR. Same vessel, same altitude, seconds apart: only the
      // throttle changed, and the answer changed with it. Without this row H2
      // would be equally satisfied by a `leave` that refuses everything.
      check('H4 cutting the engine THAWS it at the SAME altitude, so the refusal '
            + 'was about the STATE and not about the wiring',
            handoff.thawedMode === 'rails' && handoff.thawedThrottle === 0,
            `mode ${handoff.frozenMode} -> ${handoff.thawedMode}, throttle `
            + `${handoff.guard.throttle} -> ${handoff.thawedThrottle}, altitude `
            + `${handoff.guard.altitudeDatumM} m -> `
            + `${handoff.thawedAltitudeDatumM} m`);
      check('H5 IN ORBIT THE SAME CALL SUCCEEDS', handoff.leftOk === true
            && handoff.leftAboard === false && handoff.leftLive === false,
            `ok ${handoff.leftOk}, aboard ${handoff.leftAboard}, `
            + `live ${handoff.leftLive}`);
      check('H6 and it was a HANDOFF, not a refused climb-out',
            handoff.handBacks >= 1 && handoff.disembarks === 0
            && !/cannot get out in flight/.test(handoff.leftMessage ?? ''),
            `handBacks ${handoff.handBacks}, disembarks ${handoff.disembarks}, `
            + `refusals ${handoff.refusals}, message "${handoff.leftMessage}"`);
      check('H7 THE VESSEL IS STILL IN THE REGISTRY, on rails, unpromoted',
            handoff.records === 1 && handoff.promotedId === 0
            && handoff.rec !== null && handoff.rec.mode === 'rails',
            `${handoff.records} records, promotedId ${handoff.promotedId}, `
            + `mode ${handoff.rec?.mode}`);
      if (fails.length > 0) {
        throw new Error('the vessel could not be left in orbit, so there is '
          + 'nothing to come back to');
      }
    }

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
    const WANT_MODE = { pad: 'parked', ascent: 'frozen', orbit: 'rails',
                        handoff: 'rails' }[phase];
    // `after` is captured BEFORE the resume on purpose, so every row below is
    // asking the same question of the handoff phase it asks of the orbit phase:
    // what did the reload alone bring back. The resume is measured afterwards.
    const ORBITAL = phase === 'orbit' || phase === 'handoff';

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
    if (ORBITAL) {
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
    // TRUE IN EVERY PHASE, INCLUDING handoff, and that is the design rather than
    // a gap. A reload restores the body on foot at its anchor and the vessel at
    // its record; RE-ENTERING one is a VERB THE PLAYER PERFORMS, not something a
    // boot does on their behalf. The handoff phase performs it below.
    check('7 the player is NOT restored into the vessel by the boot itself',
          after.aboard === false, `aboard ${after.aboard}`);

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

    // --- 10. COME BACK TO IT. THE VERB THIS PHASE EXISTS FOR (PH-76) ---------
    //
    // Everything above proved the world came back. This proves the PLAYER can
    // come back INTO it: a rocket left in orbit before the reload, re-entered
    // after it, with the fuel, the orbit and the attitude it actually had.
    //
    // The comparison is against `before.rec`, which is the record as it stood at
    // the cut, on the far side of a real page reload and a real IndexedDB
    // round-trip. `resumed.rec` is read immediately after a `sync`, so it is
    // /core's own answer and not the number that was written into it.
    if (phase === 'handoff') {
      resumed = await page.evaluate(RESUME_AFTER_RELOAD);
      check('10 RESUME PUT THE PLAYER BACK IN IT, across the reload',
            resumed.error === undefined && resumed.ok === true
            && resumed.aboard === true && resumed.live === true
            && resumed.promotedId === b?.id,
            JSON.stringify({ error: resumed.error, ok: resumed.ok,
                             aboard: resumed.aboard, live: resumed.live,
                             promotedId: resumed.promotedId, wanted: b?.id }));
      // The measurement behind "this could never have gone through the board
      // key": 18 m of range against a vessel a few hundred kilometres up.
      check('10b and it really WAS out of boarding range, so the range gate could '
            + 'only ever have refused', resumed.distanceToVesselM > 100000,
            `${(resumed.distanceToVesselM / 1000).toFixed(1)} km against a board `
            + `range of ${resumed.boardRangeM} m`);
      const rr = resumed.rec ?? null;
      const hFuel = rr === null || b === null ? Infinity
        : Math.abs(rr.fuelKg - b.fuelKg);
      // EXACT, not a tolerance. `promoteVessel` writes the record's propellant in
      // with ABI 18's setter and `sync` reads it straight back out with the
      // throttle shut, so any difference at all is a real defect.
      check('10c IT CAME BACK WITH THE FUEL IT ACTUALLY HAD, EXACTLY',
            hFuel === 0,
            `${b?.fuelKg} kg -> ${rr?.fuelKg} kg, difference ${hFuel} kg`);
      check('10d and that is still strictly less than a full load',
            rr !== null && rr.fuelKg < before.designFullKg - 1,
            `${rr?.fuelKg} kg of ${before.designFullKg} kg`);
      const hA = rr?.conic && b?.conic ? Math.abs(rr.conic.a - b.conic.a) : Infinity;
      const hE = rr?.conic && b?.conic ? Math.abs(rr.conic.e - b.conic.e) : Infinity;
      check('10e IT IS IN THE SAME ORBIT: the semi-major axis', hA < 1.0,
            `${b?.conic?.a} -> ${rr?.conic?.a}, ${hA} m`);
      check('10f and the eccentricity', hE < 1e-6,
            `${b?.conic?.e} -> ${rr?.conic?.e}, ${hE}`);
      const d3 = (x, y) => (Array.isArray(x) && Array.isArray(y)
        ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : Infinity);
      const hFwd = d3(rr?.pose?.fwd, b?.pose?.fwd);
      const hRgt = d3(rr?.pose?.right, b?.pose?.right);
      check('10g AND IT IS POINTING THE SAME WAY: the nose', hFwd < 1e-6,
            `${JSON.stringify(b?.pose?.fwd)} -> ${JSON.stringify(rr?.pose?.fwd)}, `
            + `${hFwd}`);
      check('10h and the roll', hRgt < 1e-6,
            `${JSON.stringify(b?.pose?.right)} -> `
            + `${JSON.stringify(rr?.pose?.right)}, ${hRgt}`);
      // A SEAT THAT DOES NOT INTEGRATE IS A SCREENSHOT. FlightSession.step is
      // reached only through VesselObserver.step, which ViewRouter drives only
      // while somebody is aboard, so this row is what says the resume put the
      // player back in CONTROL and not merely back in the picture.
      const flying = await page.evaluate(`(async () => {
        const of = window.__of;
        const s0 = of.flight('report').flight.steps;
        await of.run(2);
        const f = of.flight('report');
        return { steps0: s0, steps1: f.flight.steps, aboard: f.aboard,
                 massKg: f.flight.massKg, status: f.flight.status };
      })()`);
      check('10i and the resumed vessel is being STEPPED again',
            flying.steps1 > flying.steps0 && flying.aboard === true
            && flying.massKg > 0, JSON.stringify(flying));
      resumed.deltas = { fuelKg: hFuel, aM: hA, e: hE, fwd: hFwd, right: hRgt };
      resumed.flying = flying;
    }
  } catch (e) {
    note(`runner: ${e?.message ?? e}`);
  } finally {
    await browser.close();
  }

  const ok = fails.length === 0 && errors.size === 0;
  if (!ok) exitCode = 1;
  results.push({
    phase, pass: ok, fails, handoff, resumed,
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
