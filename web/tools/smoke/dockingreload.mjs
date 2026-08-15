// dockingreload.mjs: R100. THE DOCKING SAVE, PROVEN ACROSS A REAL BROWSER
// RELOAD, not a same-session `of.save()`/`of.load()` round trip.
//
// `probes/docking.js` (PH-360 to PH-369) already proves the whole latch chain
// end to end -- candidate, four refusals, capture, join, release, toggle --
// and its own Section 6 header names exactly this gap and refuses to close
// it: "NOT a real page reload: `reload.mjs` crosses seams this cannot
// (chestsave.js's header is the authority on the difference), and a
// real-reload pair is the follow-up this probe names rather than pretends to
// be." This runner is that follow-up, built the same way
// `stationreload.mjs` (physics's fifth real-reload runner) and
// `vesselreload.mjs` (its fourth) were: a standalone `.mjs`, because a real
// `page.reload()` destroys the execution context a `page.evaluate` promise is
// running in, so no probe driven through `run.mjs --evalfile=` can ever ask
// this question.
//
// SETUP REUSES `probes/docking.js` WHOLESALE rather than duplicating its
// fixture. Section 6 of that file already redocks and calls `of.save()`
// before its own (same-session) restore check, so by the time it returns
// `valid: true` the live world IS docked and the slot IS written; this
// runner's real reload is exactly the follow-up question docking.js's own
// header asks for. Writing a second fixture-building probe next to it would
// be the collision NUMBERS.md's registry note warns about ("A probe file has
// no registry, so creating one can silently destroy another").
//
// WHAT SURVIVING MEANS, THREE THINGS, EACH WITH ITS OWN NUMBERS:
//   1. THE DOCKED RELATION. `of.flight('vessels')` publishes `docked` per
//      record precisely because "is this vessel docked" has to be answerable
//      about a record NOBODY IS FLYING (DebugFlight.ts's own comment) --
//      which is exactly the state a reload leaves it in, and therefore the
//      only state in which the save shape can be measured at all. Checked
//      WITHOUT resuming control, because vesselreload.mjs's row 7 already
//      established the invariant this runner must not contradict: the player
//      is NEVER restored into a vessel by the boot itself.
//   2. THE ENVELOPE. `captureRadiusM` / `coneLimitDeg` / `maxClosingMS` are
//      read off the PORT PART through `docking::Limits`, never typed by this
//      side (docking.js's own comment), but `dockPublication` can only
//      compute them for a LIVE, PROMOTED session (`m.dockTarget`,
//      `m.session.handle`). So this runner does what `vesselreload.mjs`'s
//      `handoff` phase already established is the real verb for "come back
//      to it": `of.flight('resume', id)`. That is a genuine measurement --
//      if the reload had corrupted the part's docking data, the resumed
//      session would read different numbers, not merely absent ones.
//   3. THE VESSEL CENSUS. Record count unmoved, exactly one record docked,
//      `orphanLatches === 0` -- the same three counters docking.js's own
//      Section 4 asserts, re-measured on the far side of a real reload.
//
//   node tools/smoke/dockingreload.mjs --url=http://127.0.0.1:4292/

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
// stationreload.mjs's guard, verbatim: an unrecognised flag is a hard exit
// before the browser launches rather than a silently discarded typo.
const OWN = new Set(['url']);
const unknown = [...args.keys()].filter((k) => !OWN.has(k));
if (unknown.length > 0) {
  console.error(`dockingreload: unknown flag(s): ${unknown.join(', ')}. `
    + `Known: ${[...OWN].map((k) => `--${k}=`).join(' ')}`);
  process.exit(2);
}
const base = args.get('url') ?? 'http://127.0.0.1:4292/';
const url = `${base}?sandbox=1&debug=1`;
const SETUP = 'probes/docking.js';

// CHROME_PATH override + the Windows/Linux candidate list, mirroring
// reload.mjs and run.mjs (BT-33 invariant): kept in sync deliberately.
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
if (!CHROME) { console.error('dockingreload: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
// ONE context for the whole run: the reload has to keep IndexedDB, which is
// the entire point (reload.mjs's warning, verbatim).
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') note(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => note(`requestfailed: ${r.url()}`));

const wrap = (file, argsJson) =>
  `((OF_ARGS) => (\n${readFileSync(resolve(here, file), 'utf8')}\n))(${argsJson})`;

const fails = [];
const check = (name, ok, detail) => {
  if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  return ok === true;
};

// THE CENSUS SNAPSHOT, as one expression so before/after cannot drift apart.
// No `resume`, no promotion: this is exactly what a reload alone restores.
const CENSUS = `(() => {
  const of = window.__of;
  const v = of.flight('vessels');
  const station = v.list.find((r) => r.status === 'station:anchorage') ?? null;
  const dockedRows = v.list.filter((r) => r.docked !== null);
  const f = of.flight('report');
  return {
    tick: of.world().tick,
    records: v.records, orphanLatches: v.orphanLatches,
    stationId: station === null ? null : station.id,
    dockedCount: dockedRows.length,
    docked: dockedRows.length === 1 ? dockedRows[0].docked : null,
    dockedVesselId: dockedRows.length === 1 ? dockedRows[0].id : null,
    aboard: f.aboard,
  };
})()`;

let exitCode = 0;
let before = null; let censusBefore = null; let censusAfter = null;
let resumed = null; let envelopeAfter = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  // docking.js's own documented invocation settles 25 frames before running.
  await page.evaluate(() => window.__of.settle(25));

  // --- PHASE 1: dock for real, through docking.js's own fixture -----------
  before = await page.evaluate(wrap(SETUP, '{}'));
  if (before === null || before.valid !== true) {
    throw new Error(`setup (docking.js) did not reach a docked, saved state: `
      + `${JSON.stringify(before)?.slice(0, 800)}`);
  }
  check('phase 1: docking.js reached a docked, saved state with zero failures',
        before.failCount === 0, `fails: ${JSON.stringify(before.fails)}`);
  check('phase 1: the slot was written with exactly one docked vessel',
        before.summary?.dockedInSlot === 1,
        `dockedInSlot ${before.summary?.dockedInSlot}`);
  check('phase 1: SAVE_VERSION did not move (an additive field must not '
        + 'destroy every existing world)', before.summary?.saveVersion === 5,
        `version ${before.summary?.saveVersion}`);

  censusBefore = await page.evaluate(CENSUS);
  check('phase 1: exactly one record is docked, before the reload',
        censusBefore.dockedCount === 1, `${censusBefore.dockedCount}`);
  check('phase 1: it is docked to the station docking.js flew to',
        censusBefore.docked?.hostId === censusBefore.stationId,
        `hostId ${censusBefore.docked?.hostId} vs station ${censusBefore.stationId}`);
  check('phase 1: no orphan latch exists before the reload either',
        censusBefore.orphanLatches === 0, `${censusBefore.orphanLatches}`);
  if (fails.length > 0) {
    throw new Error('phase 1 did not produce a docked world worth reloading');
  }

  // --- THE RELOAD. Same context, so IndexedDB is the store a person -------
  // pressing F5 has, and nothing else about the page survives.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));

  // ==========================================================================
  // 1. THE DOCKED RELATION, unresumed -- exactly what a reload alone restores.
  // ==========================================================================
  censusAfter = await page.evaluate(CENSUS);
  check('1a the player is NOT restored into the vessel by the boot itself '
        + '(vesselreload.mjs row 7\'s invariant, which this reload must not '
        + 'contradict)', censusAfter.aboard === false, `aboard ${censusAfter.aboard}`);
  check('1b exactly ONE record came back docked', censusAfter.dockedCount === 1,
        `${censusAfter.dockedCount}`);
  check('1c THE DOCKED RELATION SURVIVED THE RESTORE PATH: same host id',
        censusAfter.docked?.hostId === censusBefore.docked?.hostId,
        `${censusBefore.docked?.hostId} -> ${censusAfter.docked?.hostId}`);
  check('1d and the same named port', censusAfter.docked?.hostPort === censusBefore.docked?.hostPort
        && censusAfter.docked?.hostPort === 'socket_dock',
        `"${censusBefore.docked?.hostPort}" -> "${censusAfter.docked?.hostPort}"`);
  check('1e and a local pose that is three finite numbers, not a hole',
        Array.isArray(censusAfter.docked?.localPos)
        && censusAfter.docked.localPos.length === 3
        && censusAfter.docked.localPos.every((v) => Number.isFinite(v)),
        JSON.stringify(censusAfter.docked?.localPos ?? null));
  check('1f and it is BIT-EXACT across the reload, not merely finite',
        JSON.stringify(censusAfter.docked?.localPos) === JSON.stringify(censusBefore.docked?.localPos),
        `${JSON.stringify(censusBefore.docked?.localPos)} -> `
        + `${JSON.stringify(censusAfter.docked?.localPos)}`);

  // ==========================================================================
  // 2. THE VESSEL CENSUS.
  // ==========================================================================
  check('2a the record count is unmoved by the reload',
        censusAfter.records === censusBefore.records,
        `${censusBefore.records} -> ${censusAfter.records}`);
  check('2b the same station id is still in the census (adopted, not a fresh '
        + 'mint under a new id)', censusAfter.stationId === censusBefore.stationId,
        `${censusBefore.stationId} -> ${censusAfter.stationId}`);
  check('2c and the docked vessel kept its own id too',
        censusAfter.dockedVesselId === censusBefore.dockedVesselId,
        `${censusBefore.dockedVesselId} -> ${censusAfter.dockedVesselId}`);
  check('2d NO ORPHAN LATCH: the host came back under the same id, so the '
        + 'relation did not dangle', censusAfter.orphanLatches === 0,
        `${censusAfter.orphanLatches}`);
  const stationDockedAfter = await page.evaluate(
    (id) => window.__of.flight('vessels').list
      .find((r) => r.id === id)?.docked ?? null,
    censusAfter.stationId,
  );
  check('2e and the station itself is not marked docked to anything',
        stationDockedAfter === null, JSON.stringify(stationDockedAfter));

  // ==========================================================================
  // 3. THE ENVELOPE, which needs a LIVE session to compute at all
  // (`dockPublication` requires `m.dockTarget` and `m.session.handle > 0`),
  // so this resumes control exactly as vesselreload.mjs's `handoff` phase
  // does -- a real player verb, not a second copy of the arithmetic.
  // ==========================================================================
  resumed = await page.evaluate(
    (id) => window.__of.flight('resume', id), censusAfter.dockedVesselId,
  );
  check('3a resume put the player back aboard the docked vessel',
        resumed.ok === true && resumed.report?.aboard === true,
        `ok ${resumed.ok}, aboard ${resumed.report?.aboard}`);
  // `dockTarget` is re-aimed once per RENDERED FRAME (`FlightMode`'s own
  // comment: "THE DOCK RIG IS RE-AIMED EVERY FRAME"), off the resumed
  // session's live tick. `resume` alone promotes the record but runs no
  // frame, so a read taken before any frame renders would be reading
  // whatever `dockTarget` held before this session existed -- a harness gap,
  // not a save defect. One short run gives it a frame to recompute against
  // the resumed vessel's actual position before the envelope is read.
  await page.evaluate(() => window.__of.run(0.5));

  envelopeAfter = await page.evaluate(() => {
    const of = window.__of;
    const d = of.flight('report').dock;
    return {
      docked: d.docked, hostId: d.hostId, hostPort: d.hostPort,
      limits: [d.captureRadiusM, d.coneLimitDeg, d.maxClosingMS],
      originToPortM: d.originToPortM, separationM: d.separationM,
    };
  });
  check('3b once resumed, the LIVE dock report still says docked',
        envelopeAfter.docked === true, `docked ${envelopeAfter.docked}`);
  check('3c and still names the same host and port',
        envelopeAfter.hostId === censusBefore.stationId
        && envelopeAfter.hostPort === 'socket_dock',
        `hostId ${envelopeAfter.hostId}, hostPort "${envelopeAfter.hostPort}"`);
  check('3d THE ENVELOPE SURVIVED: the PART\'s own shipped numbers, bit-exact '
        + 'across the reload (captureRadiusM / coneLimitDeg / maxClosingMS)',
        JSON.stringify(envelopeAfter.limits) === JSON.stringify(before.summary?.limits),
        `${JSON.stringify(before.summary?.limits)} -> ${JSON.stringify(envelopeAfter.limits)}`);
  // NOT a `check`, deliberately: `dockPublication` HARDCODES `separationM: 0`
  // whenever `latched` is true (`FlightDock.ts` line 313), so this can never
  // read anything else while docked and asserting it would be exactly the
  // "assertion that has never been seen to fail" INSTRUMENTS.md's standing
  // rule 11 warns about. Reported for context beside the row that DOES
  // measure the position independently.
  console.error(`dockingreload: separationM after resume = `
    + `${envelopeAfter.separationM} (hardcoded 0 while docked; not asserted)`);

  // 3f. THE FINDING. `originToPortM` is NOT gated on `latched` (`FlightDock.ts`
  // `dockReport`, line 411): it is `len(session.state.pos - dockTarget.posM)`,
  // an INDEPENDENT measurement of where the resumed hull actually is versus
  // where the port actually is right now. It reads tens of kilometres, not
  // the ~30.4 m docking.js's own header measures immediately after a capture.
  //
  // ROOT CAUSE, TRACED RATHER THAN GUESSED: `VesselRegistry.ts`'s own
  // `VesselDock` doc names the failure mode in advance -- "a docked vessel's
  // own conic and its host's are two conics... left to propagate
  // independently they walk apart, slowly and invisibly" -- and says the
  // fix is that the latch "carries the vessel's pose IN THE HOST'S LOCAL
  // FRAME, and the host is the only authority on where the pair is." But
  // `stateOf` (`VesselRegistry.ts`) NEVER reads `rec.docked`: for a docked
  // guest it still Kepler-propagates the GUEST'S OWN frozen conic
  // (`rec.where`), captured once at the moment of mating. `promoteVessel`
  // (`FlightVessels.ts`, the function `flight('resume', id)` calls) takes
  // that position uncritically (`const st = stateOf(...); V._of_fl_set_pos_vel
  // (h, st.pos...)`) and never re-derives it from the host + `rec.docked
  // .localPos` the way `VesselSave.ts`'s own `dropOrphanLatches` comment says
  // a docked vessel's position is supposed to work ("comes back floating
  // exactly where it was docked" -- true only at the INSTANT of capture, not
  // afterwards). A repo-wide grep of `rec.docked`/`.docked !==` found it
  // consulted in exactly four places (`FlightDock.ts` dock/undock/report,
  // `DebugFlight.ts`'s publish, `PersistSlot.ts`/`VesselSave.ts`'s save/count)
  // and NONE of them is a position derivation.
  //
  // THIS IS NOT A SAVE DEFECT: sections 1 and 2 above show the `docked`
  // RELATION (host id, port name, local pose) is bit-exact across the real
  // reload. It is a PRE-EXISTING PHYSICS/GAMEPLAY defect this reload pair
  // surfaced because it is the first proof in the repo that resumes a docked
  // vessel after real elapsed time: docking.js's own same-session checks read
  // `originToPortM` within a fraction of a second of the capture, before the
  // two conics have had time to diverge.
  check('3f and the hull sits a sensible distance off the port rather than at '
        + 'the station centre (30.4 m off, per docking.js\'s own header) '
        + '-- HONEST RED, root-caused above: stateOf()/promoteVessel() never '
        + 'consult rec.docked, so a resumed docked vessel is placed by its '
        + 'own stale frozen conic instead of the host + local pose',
        envelopeAfter.originToPortM > 0.2 && envelopeAfter.originToPortM < 30,
        `${envelopeAfter.originToPortM} m (docking.js's own header: the `
        + `station's port is 30.4 m off centre, so a reading near 30 m is `
        + `the pass bound; tens of km is the guest's own frozen conic having `
        + `drifted from the host's live position over the elapsed run)`);
} catch (e) {
  note(`runner: ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  await browser.close();
}

for (const [m, n] of errors) fails.push(`page: ${m}${n > 1 ? ` (x${n})` : ''}`);

const out = {
  url, before: before === null ? null : {
    valid: before.valid, failCount: before.failCount, summary: before.summary,
  },
  censusBefore, censusAfter, resumed: resumed === null ? null : {
    ok: resumed.ok, aboard: resumed.report?.aboard,
  },
  envelopeAfter, fails,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length > 0) { console.error(`dockingreload: FAIL (${fails.length})`); exitCode = 1; }
else console.error('dockingreload: PASS');
process.exit(exitCode);
