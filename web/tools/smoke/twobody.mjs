// twobody.mjs: DIG ON TWO BODIES AND COME BACK TO BOTH. (PS-42.)
//
//   node tools/smoke/twobody.mjs --url=http://127.0.0.1:5482/
//   node tools/smoke/twobody.mjs --url=<a HEAD build> --expect=broken
//
// WHY THIS RUNNER EXISTS AND `reload.mjs` COULD NOT BE MADE TO DO IT.
// `reload.mjs` appends one `--params` string to BOTH of its phases, which is
// precisely what makes it a reload proof: phase 1 and phase 2 are the same
// world. The question here is the opposite one. It needs FOUR boots on THREE
// different URLs in ONE browser context, because the defect only exists between
// two bodies and only IndexedDB carries anything between them.
//
// WHAT IT MEASURES. `SaveSlot` had no body field, and the boot reads the mode's
// one slot guarded only on `seed`. So the same world booted with `?body=cinder`
// loaded the FORGE world onto the moon and autosaved the moon back over it.
// Driven on the shipped client before the fix: 10 strikes on Forge gave 92
// removed cells and 10 ops; the Cinder boot restored all 92 and all 10; five
// more strikes there gave 146 and 15; and the next Forge boot brought back 146
// and 15, so the Forge world's own save permanently carried the moon's digging.
//
// THE FIXTURE HAS TO DIG ON BOTH BODIES AND HAS TO SAVE, QUIT AND RETURN, and
// that is the whole reason this file is 200 lines rather than 20. A save test
// that saves and loads once, on one body, cannot exhibit this defect at all: it
// passes forever while the complaint stands. Every existing save probe in this
// directory is that test.
//
// AND THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR. A run that dug nothing
// produces an empty edit set, and an empty edit set restores as an empty edit
// set on the other body, which is EXACTLY what the fix looks like. `bodydig.js`
// refuses rather than reporting a pass, and the checks below re-assert the two
// bodies are different bodies before they assert anything about the save.
//
// `--expect=broken` INVERTS THE THREE CROSSING CHECKS, so the same runner is
// the negative control: pointed at a build without the fix it must go red on
// every one of them, and `--expect=broken` turns that into a green. A gate whose
// refusing case has never been seen is not a gate (INSTRUMENTS.md).
//
// Exit 1 on any console error, page error or failed assertion, same rule
// `run.mjs` and `reload.mjs` use.

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
const base = args.get('url') ?? 'http://127.0.0.1:5482/';
// `broken` means "this build is expected NOT to have the fix", which inverts the
// three checks that are about the defect and leaves the fixture checks alone: a
// build without the fix still has to dig, and a run that could not dig is a
// harness failure in both directions.
const expectBroken = args.get('expect') === 'broken';
const FORGE = `${base}?sandbox=1&debug=1`;
const CINDER = `${base}?sandbox=1&debug=1&body=cinder`;
const FORGE_R = 600000;
const CINDER_R = 200000;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('twobody: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
// ONE context for the whole run. Four boots share one IndexedDB, which is the
// entire question: a second context would give each body an empty store and the
// run would pass by describing nothing.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') note(`console.error: ${m.text()}`);
  // run.mjs's allowlist, verbatim: two named ANGLE diagnostics on stock three.js
  // source, neither a wildcard.
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
// THE CHECKS THAT ARE ABOUT THE DEFECT, inverted by `--expect=broken`, so the
// negative control runs THESE assertions rather than a second copy of them that
// could drift. The split is a rule and not a judgement: a check whose subject is
// "the fix is present" is a `crossing`; a check whose subject is the FIXTURE (is
// this really two different bodies, did the strike land, is the run on the body
// it thinks it is) stays a plain `check`, because a build without the fix still
// has to dig, and a run that could not dig is a harness failure in both
// directions.
const crossing = (name, ok, detail) =>
  check(expectBroken ? `[expected broken] ${name}` : name,
        expectBroken ? !ok : ok, detail);

const boot = async (url) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 90000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));
};

// What a body looks like the moment it comes up, BEFORE anything is dug into it.
// Everything here is read off the LIVE world rather than off the slot, because
// the slot is the thing under test and a probe that reads its own subject cannot
// see it lie (PS-15).
const ARRIVED = `(async () => {
  const of = window.__of;
  of.input.tape([{ hold: 180, keys: [] }]);
  await of.run(1.5, 60);
  const w = of.world();
  const g = of.game();
  const v = of.voxels();
  const r = g.persist ? g.persist.restored : null;
  return {
    bodyRadiusM: w.bodyRadiusM,
    lat: +w.observer.latDeg.toFixed(4), lon: +w.observer.lonDeg.toFixed(4),
    surfaceHeightM: +w.surfaceHeightM.toFixed(2),
    removedCells: v === null ? -1 : v.removedCells,
    addedCells: v === null ? -1 : v.addedCells,
    ops: v === null ? -1 : v.ops,
    restoredCells: r ? r.voxels.cells : null,
    restoredOps: r ? r.voxels.ops : null,
    restoredBody: r ? r.body : null,
    bodyHadWorld: r ? r.bodyHadWorld : null,
    otherBodies: r ? r.otherBodies : null,
    discovery: r ? r.discovery : null,
  };
})()`;

// THE STORE, RAW. Every view above the store reported the pre-fix slot as
// complete, which is why R46 survived, and it is why this reads the record
// itself rather than the list, the summary or the counters.
const RAW = `(async () => {
  const slot = await new Promise((res, rej) => {
    const q = indexedDB.open('orbital-foundry', 1);
    q.onerror = () => rej(q.error);
    q.onsuccess = () => {
      const db = q.result;
      const g = db.transaction('saves', 'readonly').objectStore('saves').get('auto-sandbox');
      g.onsuccess = () => { res(g.result ?? null); db.close(); };
      g.onerror = () => { rej(g.error); db.close(); };
    };
  });
  if (slot === null) return null;
  // ONE reducer for every world in the slot, so the top-level world and the
  // carried ones cannot be reduced differently and then compared.
  const reduce = (w) => ({
    body: w.body,
    voxelBytes: (w.voxels && w.voxels.cells ? w.voxels.cells.length : -1),
    voxelOps: (w.voxels && w.voxels.ops ? w.voxels.ops.length : -1),
    buildings: (w.buildings ?? []).length,
    patches: (w.patches ?? []).length,
    depletion: (w.depletion ?? []).length,
    discoveryBytes: (w.discovery ?? []).length,
  });
  return {
    version: slot.version, seed: slot.seed, savedAt: slot.savedAt,
    top: reduce({ ...slot, body: slot.body ?? 0 }),
    others: (slot.others ?? []).map(reduce),
    hasBodyField: slot.body !== undefined,
    hasOthersField: slot.others !== undefined,
  };
})()`;

// THE STRIP CONTROL. Force a save so the top-level world is the PLANET's (phase
// 4 left the page on Forge, and phase 5 read a store whose top world was still
// the moon's, because the moon wrote last), then delete the two new fields from
// the record in place. What is left is byte-for-byte the shape of every slot
// written before this commit, which is the shape of every slot Reid owns.
const STRIP = `(async () => {
  await window.__of.save();
  const put = (slot) => new Promise((res, rej) => {
    const q = indexedDB.open('orbital-foundry', 1);
    q.onerror = () => rej(q.error);
    q.onsuccess = () => {
      const db = q.result;
      const r = db.transaction('saves', 'readwrite').objectStore('saves')
        .put(slot, 'auto-sandbox');
      r.onsuccess = () => { res(true); db.close(); };
      r.onerror = () => { rej(r.error); db.close(); };
    };
  });
  const get = () => new Promise((res, rej) => {
    const q = indexedDB.open('orbital-foundry', 1);
    q.onerror = () => rej(q.error);
    q.onsuccess = () => {
      const db = q.result;
      const g = db.transaction('saves', 'readonly').objectStore('saves').get('auto-sandbox');
      g.onsuccess = () => { res(g.result ?? null); db.close(); };
      g.onerror = () => { rej(g.error); db.close(); };
    };
  });
  const slot = await get();
  if (slot === null) return null;
  const hadBody = slot.body !== undefined;
  const hadOthers = slot.others !== undefined;
  const topBody = slot.body ?? 0;
  const topOps = slot.voxels && slot.voxels.ops ? slot.voxels.ops.length : -1;
  delete slot.body;
  delete slot.others;
  await put(slot);
  const back = await get();
  return { hadBody, hadOthers, topBody, topOps,
           nowHasBody: back.body !== undefined,
           nowHasOthers: back.others !== undefined };
})()`;

let exitCode = 0;
const out = {};
// How far the run actually got. Advanced once per phase, INSIDE the try, so an
// exception leaves it where it stopped and the positive control at the bottom
// can name the phase.
let stage = 0;
try {
  // 1. FORGE: dig and save.
  stage = 1;
  await boot(FORGE);
  const forge = await page.evaluate(wrap('probes/bodydig.js', '{}'));
  out.forgeDig = forge;
  if (forge === null || forge.valid !== true) {
    throw new Error(`phase 1 (Forge) fixture failed: ${JSON.stringify(forge)}`);
  }
  check('the Forge fixture is on Forge', forge.bodyRadiusM === FORGE_R,
        `radius ${forge.bodyRadiusM}, expected ${FORGE_R}`);

  // 2. CINDER: arrive, and see whether Forge's tunnel came with us.
  stage = 2;
  await boot(CINDER);
  const arrived = await page.evaluate(ARRIVED);
  out.cinderArrived = arrived;
  check('the moon is a different body from the planet',
        arrived.bodyRadiusM === CINDER_R && forge.bodyRadiusM !== arrived.bodyRadiusM,
        `Forge ${forge.bodyRadiusM}, Cinder ${arrived.bodyRadiusM}`);
  crossing("the Forge tunnel did NOT follow the player to the moon",
           arrived.removedCells === 0 && arrived.ops === 0,
           `dug ${forge.removedCells} cells / ${forge.ops} ops on Forge, `
           + `arrived on Cinder holding ${arrived.removedCells} / ${arrived.ops}`);
  crossing('and the load restored no Forge edits onto the moon',
           arrived.restoredCells === 0 && arrived.restoredOps === 0,
           `restored ${arrived.restoredCells} cells / ${arrived.restoredOps} ops`);
  crossing('the load says the moon had no world in this save yet',
        arrived.bodyHadWorld === false, `${arrived.bodyHadWorld}`);
  crossing('and says it is carrying the planet through untouched',
        Array.isArray(arrived.otherBodies) && arrived.otherBodies.includes(0),
        JSON.stringify(arrived.otherBodies));

  // 3. CINDER: dig and save, so the slot has to hold two worlds at once.
  stage = 3;
  const cinder = await page.evaluate(wrap('probes/bodydig.js', '{"strikes":5}'));
  out.cinderDig = cinder;
  if (cinder === null || cinder.valid !== true) {
    throw new Error(`phase 3 (Cinder) fixture failed: ${JSON.stringify(cinder)}`);
  }
  check('the Cinder fixture is on Cinder', cinder.bodyRadiusM === CINDER_R,
        `radius ${cinder.bodyRadiusM}`);

  // 4. HOME: the planet's own tunnel, exactly, and none of the moon's.
  stage = 4;
  await boot(FORGE);
  const home = await page.evaluate(ARRIVED);
  out.forgeReturn = home;
  check('the return boot is on Forge', home.bodyRadiusM === FORGE_R,
        `radius ${home.bodyRadiusM}`);
  crossing("the planet's own tunnel came back, exactly as it was dug",
           home.removedCells === forge.removedCells && home.ops === forge.ops,
           `dug ${forge.removedCells}/${forge.ops}, came back `
           + `${home.removedCells}/${home.ops} (the moon added `
           + `${cinder.removedCells - forge.removedCells}/`
           + `${cinder.ops - forge.ops} to the shared set before the fix)`);
  crossing("and the load says it was the planet's own world",
        home.bodyHadWorld === true && home.restoredBody === 0,
        `hadWorld ${home.bodyHadWorld}, body ${home.restoredBody}`);
  crossing('and the moon is still in the save, carried through',
        Array.isArray(home.otherBodies) && home.otherBodies.includes(1),
        JSON.stringify(home.otherBodies));

  // 5. THE STORE ITSELF.
  stage = 5;
  const raw = await page.evaluate(RAW);
  out.raw = raw;
  check('the autosave slot exists to be read', raw !== null);
  // WHICH WORLD IS THE TOP-LEVEL ONE IS NOT ASSERTED, and the first draft of
  // this file asserted it and went red on a correct build. The top-level world
  // is whichever body wrote LAST, and phase 4's boot has not autosaved yet
  // (20 s), so the store still holds the moon on top with the planet carried.
  // That is right, and it is exactly why the row summary has to name the body it
  // is describing: "3 built" is a claim about an unnamed planet otherwise. The
  // checks below are therefore addressed BY BODY and not by position.
  const worldFor = (b) => raw === null ? null
    : raw.top.body === b ? raw.top : (raw.others.find((w) => w.body === b) ?? null);
  const bodies = raw === null ? []
    : [raw.top.body, ...raw.others.map((w) => w.body)].sort((a, b) => a - b);
  crossing('the slot names the body each of its worlds describes',
           raw !== null && raw.hasBodyField === true && raw.hasOthersField === true,
           raw === null ? 'no slot' : `body ${raw.hasBodyField}, others ${raw.hasOthersField}`);
  crossing('the slot holds one world per body, and exactly one each',
           bodies.length === 2 && bodies[0] === 0 && bodies[1] === 1,
           JSON.stringify(bodies));
  const w0 = worldFor(0);
  const w1 = worldFor(1);
  crossing("each world holds its OWN body's digging and none of the other's",
           w0 !== null && w1 !== null
             && w0.voxelOps === forge.ops && w1.voxelOps === cinder.ops,
           `Forge dug ${forge.ops} ops, its world holds ${w0 === null ? 'no world' : w0.voxelOps}; `
           + `Cinder dug ${cinder.ops} ops, its world holds ${w1 === null ? 'no world' : w1.voxelOps}`);
  // DISCOVERY IS THE OTHER CROSSING, and it is the one that lost data outright
  // rather than adding it. /core keeps ONE `g_disc` whose grid resolution is a
  // function of body radius, and `WorldDiscovery::deserialize` ADOPTS the
  // stream's radius; so a Forge lattice restored on Cinder was then wiped by the
  // next `of_disc_ensure`, and the 20 s autosave persisted the empty set. Two
  // separate non-empty streams, one per world, is what says that cannot happen.
  crossing('each body remembers its own exploring, in its own world',
           w0 !== null && w1 !== null
             && w0.discoveryBytes > 0 && w1.discoveryBytes > 0,
           `Forge ${w0 === null ? 'no world' : w0.discoveryBytes} bytes, `
           + `Cinder ${w1 === null ? 'no world' : w1.discoveryBytes} bytes`);
  // 6. THE CASE NOBODY WRITES: A SAVE THAT PREDATES ALL OF THIS.
  //
  // Every slot Reid already has was written without `body` and without `others`.
  // The whole run above writes slots that HAVE them, so it proves the new world
  // and says nothing about the old one, and "an older save must degrade to
  // something correct and named, not to zeros" is exactly the R39 shape a schema
  // change fails in. It is also the identity case: one body, no others, no body
  // field, which is what a differential fixture is built to avoid because there
  // is nothing to measure against.
  //
  // So this STRIPS the two new fields off the stored slot, in the store, and
  // boots again. `worldIn` reads an absent `body` as 0 and hands back the
  // top-level fields, so a pre-PS-40 Forge save must restore EXACTLY what it
  // restored before this commit existed: the same cells, the same ops, and a
  // ledger that says the body had a world rather than that it did not.
  stage = 6;
  const stripped = await page.evaluate(STRIP);
  out.stripped = stripped;
  check('the strip control actually removed both fields',
        stripped !== null && stripped.hadBody === true && stripped.hadOthers === true
          && stripped.nowHasBody === false && stripped.nowHasOthers === false,
        JSON.stringify(stripped));
  await boot(FORGE);
  const old = await page.evaluate(ARRIVED);
  out.oldSaveBoot = old;
  check("a save written before the body dimension loads as the planet, whole",
        old.removedCells === forge.removedCells && old.ops === forge.ops
          && old.restoredBody === 0 && old.bodyHadWorld === true,
        `dug ${forge.removedCells}/${forge.ops}, an unstamped slot gave `
        + `${old.removedCells}/${old.ops}, body ${old.restoredBody}, `
        + `hadWorld ${old.bodyHadWorld}`);
  check('and it is carrying nothing it does not have',
        Array.isArray(old.otherBodies) && old.otherBodies.length === 0,
        JSON.stringify(old.otherBodies));
  check('and what the player explored is still there',
        old.discovery > 0, `${old.discovery}`);
} catch (e) {
  fails.push(`threw: ${String(e)}`);
} finally {
  await browser.close();
}

// THE POSITIVE CONTROL, and it is written the one way that can actually fail. A
// flag set unconditionally after the try block proves nothing: it is true on
// every path, including the one where phase 1 threw. `stage` is advanced INSIDE
// the try, once per phase, so a run that died in phase 2 reports 2 and this goes
// red naming the phase it stopped at. A green from a harness that never reached
// its assertions is indistinguishable from one that ran them all, which is what
// this line exists to tell apart.
check('the run reached its last phase (positive control)', stage === 6,
      `stopped after phase ${stage} of 6`);

out.stageReached = stage;
console.log(JSON.stringify(out, null, 2));
if (errors.size > 0) {
  console.error('twobody: page errors');
  for (const [m, n] of errors) console.error(`  x${n} ${m}`);
  exitCode = 1;
}
if (fails.length > 0) {
  console.error(`twobody: ${fails.length} FAILED`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  exitCode = 1;
} else {
  console.log('twobody: PASS');
}
process.exit(exitCode);
