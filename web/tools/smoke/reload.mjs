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
// WG-119. `--params=lat=..&lon=..&mode=walk` is appended to BOTH phases' URL.
// It exists because a reload proof about STREAMED world content cannot be run
// at the default spawn: that spawn is Mountains at 4,668 m, which is above the
// treeline, so a tree probe there would have nothing to chop and would report a
// fixture failure rather than a persistence result. Appending to the one `url`
// constant is what keeps phase 1 and phase 2 the same world, which is the
// property this whole runner exists to hold.
const extra = args.get('params') ? `&${args.get('params')}` : '';
const url = `${base}?sandbox=1&debug=1${combat}${extra}`;
const FLYTO = 'probes/flyto.js';
const PADCLEAR = 'probes/padclear.js';
const DAMAGESAVE = 'probes/damagesave.js';
// GP-103. The setup that asks this runner's question BACKWARDS: it destroys the
// slot on purpose, so the two assertions below that are otherwise true of every
// reload ("the factory came back", "the discovered world came back") are exactly
// what must NOT hold. They are inverted for it rather than skipped, because a
// wipe that left the factory standing is the failure this proof exists to catch.
const FRESH = 'probes/startfresh.js';
// GP-137. The setup that proves a NAMED save, and it is run twice: once
// pressing Load and once deliberately not. Both build a world, save it under a
// name and then wreck it, so the autosave and the named slot diverge; the
// assertions below expect the SAVED world back when Load was pressed and the
// WRECKED one when it was not. Without the second run, "the world came back" is
// satisfied by a load that did nothing at all.
const SAVED = 'probes/savenamed.js';
// FS-70. The setup that asks the question about the one buildable whose whole
// value is the state it holds. Its extra assertions are below, gated on this
// name exactly as PADCLEAR's are, because a world with no chest in it has
// nothing to say about chests.
const CHESTSAVE = 'probes/chestsave.js';
// WG-70. The setup that harvests a WORLD ROCK: a streamed node whose save key
// is its lattice cell rather than its array index, which only a real reload
// can prove, because the in-page round trip replays onto the same indices and
// cannot see an index-keyed diff drain somebody else's node.
const ROCKSAVE = 'probes/rockreload.js';
// WG-119. The same question for the world TREES, which since WG-116 are the
// majority of the node array at any forested site and are keyed by lattice cell
// for the same reason the rocks are.
const TREESAVE = 'probes/treereload.js';
// WG-200 to WG-212. The POI/site bridge's two bits (known, visited), keyed by
// SiteId rather than by index or lattice cell (a site does not move, so there
// is no ROCKSAVE/TREESAVE-style regrowth question here) -- what only a real
// reload can prove is that the bits actually crossed `Persist.snapshot`'s u8
// arena and came back through boot order, which an in-page save/load cannot
// ask for the same reason it cannot ask it of `discovery`.
const POISITES = 'probes/poisites.js';
const setup = args.get('setup') ?? FLYTO;
// The default keeps `--phase` meaning exactly what it meant: the phase IS the
// flyto probe's argument, so an untouched command line produces an untouched
// phase-1 call.
const setupArgs = args.get('setupargs') ?? JSON.stringify({ phase });

// CHROME_PATH overrides the search entirely; the Linux entries mirror
// run.mjs's fix (BT-30-series, 2026-08-10) -- this runner had Windows paths
// only, so it could not launch at all on the Proxmox VM this project now
// develops on. Duplicated rather than shared because these runners are
// deliberately standalone (see the console-warning allowlist comment below).
const CHROME = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
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

  after = await page.evaluate(async () => {
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
      // FS-70: every chest in the RESTORED plan, with what the restored /core
      // container says is in it. `row.store` reads `containerItem` and
      // `containerCount` off the live entity when there is one, so this is the
      // rebuilt world's own answer and not the save file read back.
      chests: g.factory && g.factory.list
        ? g.factory.list.filter((b) => b.kind === 'chest')
          .map((b) => ({ id: b.id, cell: b.cell, build: b.build,
            item: Array.isArray(b.store) ? b.store[0] : -1,
            count: Array.isArray(b.store) ? b.store[1] : -1 }))
        : [],
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
      // WG-70: the world-rock stream's own counters, plus the kind-1 rows in
      // the ring, re-measured off the LIVE world so a rock that came back full
      // is caught by position rather than trusted by count.
      rocks: g.rocks ?? null,
      rockRows: typeof of.nodes === 'function'
        ? of.nodes().filter((n) => n.kind === 1 && n.distanceM < 175)
          .map((n) => ({ x: n.x, y: n.y, z: n.z,
            remaining: n.remaining, initial: n.initial }))
        : [],
      // WG-119: the same for the world TREES, over their own (much larger)
      // ring, re-measured off the LIVE world so a tree that came back full is
      // caught by position rather than trusted by a count.
      trees: g.trees ?? null,
      treeRows: typeof of.nodes === 'function'
        ? of.nodes().filter((n) => n.kind === 0 && n.distanceM < 720)
          .map((n) => ({ x: n.x, y: n.y, z: n.z,
            remaining: n.remaining, initial: n.initial }))
        : [],
      // WG-200 to WG-212: the POI/site table, re-read off the LIVE reloaded
      // world exactly as the rock/tree rows above are, so a bit that came back
      // is caught by the bridge's own query rather than trusted by count.
      sites: typeof of.sites === 'function' ? of.sites() : null,
      // GP-137: the named-slot list AFTER the reload, read from the store the
      // reloaded page opened, so a slot that vanished with the session shows up
      // as missing rather than as remembered.
      // AWAITED, and it re-reads the store: the in-memory list is only built
      // when the save page is opened, which is right for a menu and useless to
      // a phase-2 read that never opens one (GP-137).
      slots: typeof of.saves === 'function' ? await of.saves('refresh') : null,
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
  } else if (setup === SAVED) {
    if (before.wantLoad) {
      check('LOAD: the SAVED world came back, not the wrecked one',
            after.buildings === before.builtBuildings,
            `saved ${before.builtBuildings}, wrecked to ${before.wreckedTo}, `
            + `came back ${after.buildings}`);
      check('LOAD: and the named slot is still there to load again',
            (after.slots?.rows ?? []).some((r) => r.name === before.savedName),
            JSON.stringify((after.slots?.rows ?? []).map((r) => r.name)));
    } else {
      // THE CONTROL. Same world, same save, same wreck, one button not pressed.
      check('NO LOAD: the WRECKED world came back, which is what makes the '
            + 'other run mean something',
            after.buildings === before.wreckedTo,
            `wrecked to ${before.wreckedTo}, came back ${after.buildings}`);
      check('NO LOAD: and the named save is still on the shelf, unused',
            (after.slots?.rows ?? []).some((r) => r.name === before.savedName),
            JSON.stringify((after.slots?.rows ?? []).map((r) => r.name)));
    }
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
  if (setup !== FRESH && setup !== SAVED) {
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
      // MEASURED 2026-07-28 against HEAD and then asserted (PH-75, R28 closed).
      // These two were left out of the first version of this split because they
      // had never been driven across a `leave` reload, and PH-73's lesson is
      // that an assertion written from an assumption tests the assumption.
      // Driven, the session comes back LIVE and holding the restored vessel.
      check('and the reloaded flight session is LIVE, holding it',
            after.flightLive === true, `${after.flightLive}`);
    }
    // Mode-independent, and MEASURED to be so rather than assumed: a reloaded
    // pad is HOLDING and never caught mid-swing, whatever is or is not standing
    // on it. `holding` was in the recover-only set when this block was first
    // split, on the guess that a pad with a vessel back on it might report
    // differently. It does not: both modes come back `holding true, clampT 0,
    // releasing false`, so the row belongs to both and is stronger here than it
    // was as two copies. A clamp restored half-open is a real defect either way.
    check('the reloaded pad is HOLDING, never mid-swing',
          p1 !== null && p1.clampT === 0 && p1.holding === true
          && p1.releasing === false, JSON.stringify(p1));
  }

  // FS-70. THE CHEST HALF, and it is the whole reason chestsave.js exists.
  //
  // A chest is the first buildable whose value IS its contents, so a reload that
  // brings the box back empty has destroyed inventory the player deliberately
  // put away. The contents cross `commitPlan`'s carry, `Persist`'s `store` row
  // and `FactoryRestore`'s `r.store?.[0] ?? 0` on the way here, and only a real
  // reload crosses all three in boot order: an in-page `of.save()`/`of.load()`
  // passes even when the restore reads nothing, because the container already
  // exists and the commit that follows carries it.
  //
  // BOTH NUMBERS, and the ITEM is not the lesser half. A container claims its
  // type from whatever arrives first and releases it when emptied (FS-66), so a
  // chest that came back holding the right COUNT of the wrong item is a chest
  // whose stored goods have been silently swapped, and a count-only assertion
  // would be green for it.
  if (setup === CHESTSAVE) {
    const c0 = before.chest ?? null;
    const c1 = (after.chests ?? [])[0] ?? null;
    check('the chest came back at all', after.chests.length === 1,
          `${after.chests.length} chests in the restored plan`);
    check('and it came back as a real /core container',
          c1 !== null && c1.build >= 0, JSON.stringify(c1));
    check('THE CHEST CAME BACK HOLDING WHAT WAS PUT IN IT',
          c1 !== null && c0 !== null
          && c1.item === c0.item && c1.count === c0.count,
          `left ${c0?.count} of item ${c0?.item}, `
          + `came back ${c1?.count} of item ${c1?.item}`);
    // Asserted separately as well as jointly, so a red run says WHICH half went:
    // a lost count and a lost type are two different defects with two different
    // fixes, and the joint row above cannot tell them apart.
    check("the chest's COUNT survived the reload",
          c1 !== null && c0 !== null && c1.count === c0.count,
          `${c0?.count} before, ${c1?.count} after`);
    check("the chest's ITEM TYPE survived the reload",
          c1 !== null && c0 !== null && c1.item === c0.item,
          `${c0?.item} before, ${c1?.item} after`);
    // The control on the pair: a restore that put everything back at zero would
    // satisfy "before equals after" if the probe had also measured zero. It did
    // not, and chestsave.js asserts that for itself, but the runner is where a
    // reader looks and it must not depend on the setup's own honesty.
    check('and the numbers being compared are not two zeroes agreeing',
          (c0?.count ?? 0) > 0 && (c0?.item ?? 0) > 0,
          JSON.stringify(c0));
  }

  // WG-70. THE ROCK HALF. A world rock's depletion is saved under its lattice
  // cell and re-applied at the moment the rock MATERIALISES after boot, so
  // this is the one assertion that exercises the whole chain: cell key written,
  // slot read, diff parked pending, rock regrown from seed, drain applied
  // through of_gp_node_drain. The rock is found by BIT-EXACT position, because
  // its index after the reload is whatever visit order handed it.
  if (setup === ROCKSAVE) {
    const r0 = before.rock ?? null;
    const hit = (after.rockRows ?? []).find((r) => r0 !== null
      && r.x === r0.x && r.y === r0.y && r.z === r0.z) ?? null;
    check('the harvested rock grew back in the same place, to the bit',
          hit !== null,
          `looked for ${JSON.stringify(r0)} in ${after.rockRows?.length} rows`);
    // EXACT AT FLOAT32, which is the strongest claim the channel supports:
    // /core stores RemainingAmount through of_gp_node_drain's
    // `static_cast<float>` on the restore path, so a full-precision f64
    // equality would assert something the contract does not promise (measured:
    // 26.94265651702881 came back 26.942657470703125, the f32 quantum). A
    // weaker "less than full" bar is refused for the usual reason: a restore
    // clamped to one unit under full would pass it and be wrong.
    check('THE ROCK CAME BACK AT THE REMAINING IT WAS LEFT AT (f32-exact)',
          hit !== null && r0 !== null
          && Math.fround(hit.remaining) === Math.fround(r0.remaining),
          `left ${r0?.remaining}/${r0?.initial}, `
          + `came back ${hit?.remaining ?? 'ABSENT'}`);
    check('and the numbers compared are not a full rock agreeing with itself',
          r0 !== null && r0.remaining < r0.initial,
          JSON.stringify(r0));
    check('the restore ledger counted the rock diff (applied now or pending)',
          ((after.persist?.restored?.rocks ?? 0)
           + (after.persist?.restored?.rocksPending ?? 0)) >= 1,
          JSON.stringify({ rocks: after.persist?.restored?.rocks,
            pending: after.persist?.restored?.rocksPending }));
    check('and the drain was actually applied by the time this read ran',
          (after.rocks?.drainedOnRestore ?? 0) >= 1,
          `${after.rocks?.drainedOnRestore}`);
  }

  // WG-119. THE TREE HALF, and it is the harder half: at the Forest site the
  // ring holds over two thousand streamed trees, so an index-keyed diff would
  // not merely drain the wrong node, it would drain a stranger every time. The
  // tree is found by BIT-EXACT position for that exact reason.
  if (setup === TREESAVE) {
    const t0r = before.tree ?? null;
    const hit = (after.treeRows ?? []).find((r) => t0r !== null
      && r.x === t0r.x && r.y === t0r.y && r.z === t0r.z) ?? null;
    check('the chopped tree grew back in the same place, to the bit',
          hit !== null,
          `looked for ${JSON.stringify(t0r)} in ${after.treeRows?.length} rows`);
    // EXACT AT FLOAT32, for the reason the rock block states: /core stores
    // RemainingAmount through of_gp_node_drain's `static_cast<float>`, so an f64
    // equality would assert something the channel does not promise.
    check('THE TREE CAME BACK AT THE REMAINING IT WAS LEFT AT (f32-exact)',
          hit !== null && t0r !== null
          && Math.fround(hit.remaining) === Math.fround(t0r.remaining),
          `left ${t0r?.remaining}/${t0r?.initial}, `
          + `came back ${hit?.remaining ?? 'ABSENT'}`);
    check('and the numbers compared are not a full tree agreeing with itself',
          t0r !== null && t0r.remaining < t0r.initial,
          JSON.stringify(t0r));
    check('the fixture was a STREAMED tree, not one of the clearing spiral',
          (t0r?.distanceM ?? 0) > 70, `${t0r?.distanceM} m from spawn`);
    check('the restore ledger counted the tree diff (applied now or pending)',
          ((after.persist?.restored?.trees ?? 0)
           + (after.persist?.restored?.treesPending ?? 0)) >= 1,
          JSON.stringify({ trees: after.persist?.restored?.trees,
            pending: after.persist?.restored?.treesPending }));
    check('and the drain was actually applied by the time this read ran',
          (after.trees?.drainedOnRestore ?? 0) >= 1,
          `${after.trees?.drainedOnRestore}`);
    check('the reloaded world regrew a real forest, not an empty ring',
          (after.trees?.live ?? 0) > 100, `${after.trees?.live}`);
  }

  // WG-200 to WG-212. THE POI/SITE HALF. Unlike the rock/tree diffs, a site
  // does not move and is not keyed by a cell it might stream back into, so the
  // fixture is named by SiteId (idLo/idHi) rather than by position, and there
  // is no "grew back in the same place" question -- only "did the two bits
  // survive boot order". The site is found by id, not by index, because
  // `Sites.refresh()` rebuilds the row array fresh on every construction and
  // nothing here promises row order is stable across it (poi.h never promises
  // it either: only `siteIdFor`'s ordinal keying is a contract).
  if (setup === POISITES) {
    const before0 = before.ruin ?? null;
    const rows = after.sites?.rows ?? [];
    const hit = rows.find((r) => before0 !== null
      && r.idLo === before0.idLo && r.idHi === before0.idHi) ?? null;
    check('the shipped ruin is still in the reloaded table, by id',
          hit !== null,
          `looked for ${JSON.stringify(before0)} in ${rows.length} rows`);
    check('THE KNOWN BIT SURVIVED THE RELOAD', hit !== null && hit.known === true,
          `known ${hit?.known} after reload`);
    check('THE VISITED BIT SURVIVED THE RELOAD', hit !== null && hit.visited === true,
          `visited ${hit?.visited} after reload`);
    // THE CONTROL: both bits were false before this probe touched them, so a
    // restore that left everything at its regenerated default would trip the
    // two checks above rather than pass them by accident.
    check('and the bits were not already true before the probe set them '
          + '(the checks above are not two defaults agreeing)',
          before.knownBefore === false && before.visitedBefore === false,
          JSON.stringify({ knownBefore: before.knownBefore,
            visitedBefore: before.visitedBefore }));
    // NEGATIVE CONTROL 1: exactly one site is known/visited after the reload,
    // not the whole table -- an id-keyed bit that leaked onto every row would
    // still pass the two checks above.
    check('NO OTHER SITE CAME BACK KNOWN OR VISITED (id-keyed, not table-wide)',
          (after.sites?.stats?.known ?? -1) === 1
          && (after.sites?.stats?.visited ?? -1) === 1,
          JSON.stringify(after.sites?.stats));
    // NEGATIVE CONTROL 2: a corrupt/out-of-range row index is REFUSED by the
    // bridge (null) rather than silently marking row 0 or throwing. Asserted
    // on the PHASE-1 measurement, because that is where the probe drove it;
    // the reload assertions above are the ones that matter for persistence.
    check('a corrupt row index was refused, not silently mapped to a real site',
          before.badIndexResult === null,
          `siteMarkKnown(a bad index) returned ${JSON.stringify(before.badIndexResult)}`);
    check('and the refused call had NO side effect on the real table',
          before.statsAfterBadIndex?.known === 0
          && before.statsAfterBadIndex?.visited === 0,
          JSON.stringify(before.statsAfterBadIndex));
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
