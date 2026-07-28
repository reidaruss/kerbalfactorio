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
// --setup NAMES THE PHASE-1 SCRIPT, and defaults to the flyto probe this runner
// shipped with, so every invocation written before it is byte-identical. It
// exists because "what does the player get when they come back" is not a
// question only about flight: GP-66's cleared launch pad is the same question
// asked of a pad, and the alternative was a second copy of this runner.
//
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:5433/ \
//     --setup=probes/padclear.js --setupargs='{"mode":"recover"}'
//   node tools/smoke/reload.mjs --url=http://127.0.0.1:5401/ \
//     --setup=probes/damagesave.js
//
// The setup's own argument goes through --setupargs as JSON, through the same
// `wrap` the phase already used. Assertions that only make sense for one setup
// are gated on the setup's name; the ones that are true of any reload are not.
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
// `--combat=1` is passed through to `?combat=1`, which is the ONE thing that
// makes a sandbox world dangerous (GP-82 / GP-93). Without it a setup probe
// that needs an enemy to damage a building runs in a world where nothing
// spawns, and the reload proof would be about damage nobody dealt.
const combat = args.get('combat') === '1' ? '&combat=1' : '';
const url = `${base}?sandbox=1&debug=1${combat}`;
const FLYTO = 'probes/flyto.js';
const PADCLEAR = 'probes/padclear.js';
const DAMAGESAVE = 'probes/damagesave.js';
// GP-103. The setup that asks this runner's question BACKWARDS: it destroys the
// slot on purpose, so the two assertions below that are otherwise true of every
// reload ("the factory came back", "the discovered world came back") are exactly
// what must NOT hold. They are inverted for it rather than skipped, because a
// wipe that left the factory standing is the failure this proof exists to catch.
const FRESH = 'probes/startfresh.js';
const setup = args.get('setup') ?? FLYTO;
// The default keeps `--phase` meaning exactly what it meant: the phase IS the
// flyto probe's argument, so an untouched command line produces an untouched
// phase-1 call.
const setupArgs = args.get('setupargs') ?? JSON.stringify({ phase });

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
  before = await page.evaluate(wrap(setup, setupArgs));
  if (before === null || before.valid !== true) {
    throw new Error(`phase 1 setup failed: ${JSON.stringify(before)}`);
  }
  // `reached` is flyto's own word for "the cut I was asked for". A setup that
  // does not fly has no cut, so this is asked of the probe that publishes it.
  if (setup === FLYTO) {
    check('phase 1 reached its cut', before.reached === phase,
          `wanted ${phase}, got ${before.reached}`);
  }
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
    // GP-66: the pads as the RESTORED objects report themselves, re-measured
    // rather than counted. `of.pads()` is a thunk onto the live world, so after
    // a reload it is the world the save rebuilt and not a stale handle.
    const pads = typeof of.pads === 'function' ? of.pads() : null;
    return {
      tick: w.tick, regime: w.regime, altM: w.altM,
      observerMode: w.observer.mode,
      lat: w.observer.latDeg, lon: w.observer.lonDeg,
      buildings: g.factory ? g.factory.buildings : -1,
      links: g.factory && g.factory.links ? g.factory.links.length : -1,
      flightLive: f ? f.flight.live : null,
      aboard: f ? f.aboard : null,
      flightStatus: f ? f.flight.status : null,
      flightParts: f ? f.flight.parts : null,
      rollouts: f ? f.rollouts : null,
      padRollouts: f ? f.padRollouts : null,
      recoveries: f ? f.recoveries : null,
      padCount: pads ? pads.list.length : -1,
      padList: pads ? pads.list.map((p) => ({
        id: p.id, site: p.siteId, cell: [p.i, p.j, p.level],
        pos: [p.pos.x, p.pos.y, p.pos.z],
        clampT: p.clampT, releasing: p.releasing, holding: p.solid.shut,
        rollouts: p.rollouts,
      })) : [],
      // `persist` carries saves, the restore ledger and any refusal, which is
      // how "nothing came back" is told apart from "nothing was written".
      persist: g.persist ?? null,
      health: g.health ?? null,
    };
  });

  // THE ASSERTIONS THAT ARE TRUE WHATEVER THE SAVE FORMAT DOES.
  check('the client came back up and is ticking', after.tick > 0, `${after.tick}`);
  if (setup === FRESH) {
    // GP-103. THE WHOLE POINT, and it is the one question a single page cannot
    // ask: a slot is only applied at BOOT, so a live session whose slot has been
    // deleted is indistinguishable from one whose slot has not until it reloads.
    check('START FRESH: the factory the player built is GONE',
          after.buildings === 0,
          `${before.builtBuildings} buildings before the wipe, ${after.buildings} after`);
    check('START FRESH: and nothing was restored from a slot, because there is none',
          (after.persist?.restored ?? null) === null,
          JSON.stringify(after.persist?.restored ?? null));
    check('START FRESH: the fresh world is a real, playable one and not a husk',
          after.tick > 0 && Number.isFinite(after.lat) && Number.isFinite(after.lon),
          JSON.stringify([after.tick, after.lat, after.lon]));
  } else {
    check('the world restored the factory the player built',
          after.buildings >= before.buildings,
          `${before.buildings} buildings before, ${after.buildings} after`);
  }
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
  if (setup !== FRESH) {
    check('the discovered world came back',
          (after.persist?.restored?.discovery ?? -1) > 0,
          `${after.persist?.restored?.discovery}`);
  }

  // GP-66, amended by PH-74 on 2026-07-28. THE PAD HALF. Everything down to the
  // clamp is still the SAME set of assertions for both of padclear's modes: the
  // pad came back, the ledger counted it, it came back where it was, and its
  // rollout counter survived. Those are facts about the save format and both
  // modes owe them.
  //
  // What is no longer shared is what is STANDING on the pad. This block used to
  // hold both modes to "nothing came back", and the control said something
  // precisely because an uncleared pad also came back empty (PH-30: a vessel was
  // never in the slot to resurrect). Vessels now persist, so the two modes have
  // genuinely different correct answers and holding them to one bar would assert
  // a bug. They diverge below, and the recover side is unchanged.
  if (setup === PADCLEAR) {
    const p0 = before.pads ?? null;
    const p1 = (after.padList ?? [])[0] ?? null;
    check('the pad came back', after.padCount === (p0?.count ?? -1),
          `${p0?.count} before, ${after.padCount} after`);
    check('and the restore ledger counted it',
          (after.persist?.restored?.pads ?? -1) === (p0?.count ?? -1),
          `${after.persist?.restored?.pads}`);
    const moved = p0 === null || p1 === null ? Infinity
      : Math.hypot(p1.pos[0] - p0.pos[0], p1.pos[1] - p0.pos[1],
                   p1.pos[2] - p0.pos[2]);
    // RE-MEASURED, not merely counted: a pad that came back at the planet's
    // centre is still one pad. Same 1e-6 m bar probes/pad.js holds the in-page
    // round trip to.
    check('and it came back WHERE IT WAS', moved < 1e-6, `${moved} m`);
    check("the pad's rollouts counter survived the reload",
          p1 !== null && p1.rollouts === (p0?.rollouts ?? -1),
          `${p0?.rollouts} before, ${p1?.rollouts} after`);
    // PH-74, and the comment above this block is now HALF true. The rows below
    // used to be shared by both modes on the reasoning that a vessel is never in
    // the save slot to resurrect (PH-30). That stopped being a fact about the
    // save format on 2026-07-28: a vessel left on a pad now SURVIVES a reload by
    // design, so "nothing came back" is the pass condition for `recover` and the
    // FAILURE condition for `leave`.
    //
    // Split by mode rather than deleted, because the recover run still needs
    // them exactly as written: they are the only thing standing between us and a
    // pad that resurrects a recovered rocket, which is the regression PH-30 and
    // GP-66 exist to catch. Deleting them to make `leave` green would have
    // thrown away the control that gives the whole runner its meaning.
    const recovered = before.mode === 'recover';
    if (recovered) {
      check('NO vessel is standing on the reloaded pad',
            after.flightLive === false && after.aboard === false,
            `live ${after.flightLive}, aboard ${after.aboard}`);
      check('and the reloaded flight session carries ZERO parts',
            after.flightParts === 0, `${after.flightParts}`);
      check('the reloaded pad is HOLDING, never mid-swing',
            p1 !== null && p1.clampT === 0 && p1.holding === true
            && p1.releasing === false, JSON.stringify(p1));
    } else {
      // The mirror image, and it is asserted against the BEFORE measurement
      // rather than against a constant, so it states "what was standing there
      // came back" without this runner having to know how many parts a rocket
      // has. A restore that dropped the vessel leaves this at 0.
      check('the vessel left on the pad CAME BACK with all its parts',
            after.flightParts === before.flightParts && before.flightParts > 0,
            `${before.flightParts} before, ${after.flightParts} after`);
      // Restoring a vessel must never also seat the player in it. This is the
      // one that would hand Reid a rocket he did not climb into.
      check('and it came back with NOBODY aboard',
            after.aboard === false, `${after.aboard}`);
      // Deliberately NOT asserted here: `flightLive`, and `holding` on the pad.
      // Neither has been measured across a `leave` reload, and asserting an
      // unmeasured expectation in either direction is how a control ends up
      // encoding a bug as the spec. See the physics.md PH-74 note.
    }
    // Mode-independent either way: a reloaded pad is never caught mid-swing,
    // whatever is or is not standing on it. A clamp restored half-open would be
    // a real defect in both modes.
    check('the reloaded pad is never mid-swing',
          p1 !== null && p1.clampT === 0 && p1.releasing === false,
          JSON.stringify(p1));
  }

  // GP-65. THE HEALTH HALF. Health is per-entity state no other field in the
  // slot carries, and the in-page round trip cannot ask this question: `of.save`
  // then `of.load` inside one page passes even when the boot order loses the
  // field, because by then every population is already standing and the book was
  // never emptied. Only a real reload rebuilds the world from the slot in boot
  // order, so only this runner can prove a damaged building is still damaged.
// WIDENED from `setup === DAMAGESAVE` to "any setup that publishes wounds".
// The contract is the RETURN SHAPE (`damaged` plus `wounded`), not the file
// name, and gating on the name meant a second probe that damages a building
// silently skipped every assertion below while still reporting a pass. Note
// which way the widening falls: a setup that publishes nothing still skips.
  if (before.damaged !== undefined && before.wounded !== undefined) {
    const wounds = before.damaged ?? [];
    const sample = after.health?.sample ?? [];
    const found = new Map(sample.map((r) => [r.key, r.hp]));
    check('every placed thing still has a health row after the reload',
          after.health?.audit?.missing === 0 && after.health?.audit?.stale === 0,
          JSON.stringify(after.health?.audit));
    // The bar is the EXACT hp, not "less than full". A restore that clamped
    // everything to one point below its ceiling would pass a "still damaged"
    // check and be completely wrong about the number.
    for (const w of wounds) {
      check(`${w.key} came back at the health it was left at`,
            found.get(w.key) === w.hp,
            `left ${w.hp}/${w.maxHp}, came back ${found.get(w.key) ?? 'ABSENT'}`);
    }
    // THE COUNT, as well as the rows, and it catches the two failures the rows
    // cannot. A restore that brought EVERYTHING back at full health leaves this
    // at 0, and one that brought everything back damaged leaves it at `tracked`;
    // both would satisfy a per-row check that only looked at the keys it knew.
    check('exactly the things that were damaged came back damaged',
          after.health?.wounded === before.wounded,
          `${before.wounded} wounded before, ${after.health?.wounded} after, `
          + `of ${after.health?.tracked} tracked`);
    check('the restore ledger counted the wounds it applied',
          (after.persist?.restored?.health?.applied ?? -1) === wounds.length,
          `${after.persist?.restored?.health?.applied} of ${wounds.length}`);
    // AN ORPHAN IS THE FAILURE THIS EXISTS TO CATCH: a saved wound whose
    // building the restore could not find means the key scheme has stopped
    // being stable, and the building would come back at FULL HEALTH with every
    // other assertion above it still green.
    check('and no wound was orphaned by a key that stopped matching',
          (after.persist?.restored?.health?.orphans ?? -1) === 0,
          `${after.persist?.restored?.health?.orphans}`);
    check('no buildable fell back to the placeholder health ceiling',
          (after.health?.unknownKinds ?? -1) === 0,
          `${after.health?.unknownKinds}`);
  }

  console.log(JSON.stringify({ setup, setupArgs, phase, before, after, fails },
                             null, 2));
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
if (exitCode === 0) {
  console.error(setup === FLYTO ? `reload: PASS (phase ${phase})`
    : `reload: PASS (setup ${setup} ${setupArgs})`);
}
process.exit(exitCode);
