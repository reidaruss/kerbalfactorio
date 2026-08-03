// worldjump.mjs: PRESS THE BUTTON AND GO TO THE MOON, AND COME BACK. (GP-500.)
//
//   node tools/smoke/worldjump.mjs --url=http://127.0.0.1:5417/
//
// WHY THIS IS A RUNNER AND NOT A PROBE. The door is a page reload, so the
// gesture under test destroys the context that would report on it. `run.mjs`
// cannot ask this question at all and `reload.mjs` cannot either: it appends
// ONE params string to both of its phases, which is what makes it a reload
// proof, and here the whole point is that phase 2's URL is DIFFERENT and is
// chosen by the client rather than by the runner. `twobody.mjs` is the nearest
// relative and this borrows its shape: one browser context for the whole run,
// because only IndexedDB carries anything between bodies.
//
// THE NAVIGATION IS NOT SUPPRESSED AND THE RUNNER NEVER TYPES A URL. The probe
// presses the real <button> with a real PointerEvent and returns the receipt
// synchronously; then the runner WAITS FOR THE PAGE TO GO and asserts where it
// landed. So the assertion covers the whole chain -- the row, the press, the
// save, `worldUrl`'s arithmetic and `window.location.assign` -- rather than the
// runner's own idea of what `?body=cinder` should be. A runner that navigated
// to a URL it wrote itself would prove that Cinder boots, which has been true
// since June, and nothing at all about the button.
//
// THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR (twobody.mjs's rule). A run that
// dug nothing on Forge would find nothing missing on Cinder and nothing missing
// is exactly what a correct trip looks like, so `bodydig.js` refuses rather
// than reporting a pass, and every body check re-asserts which body it is on
// before it asserts anything about the world.
//
// AND THE REFUSING CASE IS ON BOTH BODIES, in the same run, on the ordinary
// path: the row for the world you are STANDING ON is disabled and says so.
// That is the answer to "what does the button do when you are already on the
// moon", and it is why there are two rows rather than one button.
//
// THE NEGATIVE CONTROL IS THIS RUNNER AGAINST A NOBBLED BUILD, read by NAME,
// and it is deliberately NOT a `--expect=broken` inversion the way twobody.mjs
// does it. That pattern needs the run SHAPE to survive the nobble, and here it
// cannot: the defect under test decides which body the run is standing on, so
// the disabled row swaps, the seven site rows swap, and phase 4 would be
// pressing a button that is correctly greyed. An inversion flag would have had
// to be right about all of that and would have been asserting the harness.
//
// The control applied was `worldUrl` returning `href` unchanged -- a URL
// builder that forgot its one job. The row still draws, the button still takes
// the press, the receipt still says `done` and still carries a URL, and the
// page still reloads; it reloads into the world it was already on. Its result
// is recorded in docs/controllers/gameplay.md.
//
// Exit 1 on any console error, page error or failed assertion.

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
const base = args.get('url') ?? 'http://127.0.0.1:5417/';
// `debug=1` is what puts `__of` on the page; `scenario=walk` is the walker.
const FORGE = `${base}?sandbox=1&debug=1&scenario=walk`;
const FORGE_R = 600000;
const CINDER_R = 200000;
// /core's own declarations, cubed_sphere.h `makeForge`/`makeCinder`. THIS FILE
// CARRIES ITS OWN COPY on purpose (visitsite.js's rule): a constant mistyped
// into VisitWorlds.ts cannot certify itself, and the row is asserted against
// these AND against the live body after arriving, which are different claims.
const CINDER_G = 1.63;
const FORGE_G = 9.81;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('worldjump: no Chrome or Edge found'); process.exit(2); }

const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
// ONE context. Four boots share one IndexedDB, which is the whole question.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') note(`console.error: ${m.text()}`);
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
// `crossing` marks the checks whose subject is "the trip worked", as opposed to
// the fixture ones (did the dig land, is the menu drawn, did the button take
// the press). It does not behave differently -- it is a label, so that the FAIL
// lines a nobbled build prints can be read against the right list.
const crossing = (name, ok, detail) => check(name, ok, detail);

const boot = async (url) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 120000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));
};

// Read the two world rows off the LIVE menu: the view AND the DOM button, so a
// row that exists in the model and never reached the screen reads as absent.
const ROWS = `(async () => {
  const of = window.__of;
  of.pause(true);
  await of.run(0.5);
  const v = of.pause().view;
  // run.mjs's PRELUDE is not here (this is a standalone runner), so the same
  // rule is written out: a field the client stopped publishing must THROW, not
  // read undefined and let every assertion built on it pass for ever.
  if (!('worlds' in v)) {
    throw new Error('pause().view publishes no world rows. Published keys: '
      + Object.keys(v).join(', '));
  }
  const worlds = v.worlds;
  const btn = (id) => {
    const b = document.querySelector('#of-pause button[data-cheat="' + id + '"]');
    return b === null ? null : { present: true, disabled: b.disabled };
  };
  const row = (id) => {
    const r = worlds.find((w) => w.id === id) ?? null;
    return r === null ? null
      : { id: r.id, label: r.label, note: r.note, blocked: r.blocked ?? '',
          dom: btn(id) };
  };
  const sites = of.pause().buttons.filter((b) => b.id.startsWith('visit:')
    && b.id !== 'visit:station');
  const out = {
    count: worlds.length,
    heading: [...document.querySelectorAll('#of-pause .of-pgrp.world-jump h4')]
      .map((h) => h.textContent).join('|'),
    forge: row('world:forge'),
    cinder: row('world:cinder'),
    siteRows: sites.length,
    sitesDisabled: sites.filter((b) => b.disabled === true).length,
    siteBlocked: sites[0] ? sites[0].blocked : '',
    stationRow: of.pause().buttons.find((b) => b.id === 'visit:station') ?? null,
  };
  of.pause(false);
  await of.run(0.3);
  return out;
})()`;

// PRESS THE REAL BUTTON AND GRAB THE RECEIPT BEFORE THE PAGE GOES. `click()`
// dispatches synchronously and `Cheats.say` pushes the receipt inside it, so the
// log is readable with NO await in between; the save and the 400 ms beat happen
// after this returns and the runner watches for them from outside.
const PRESS = (id) => `(async () => {
  const of = window.__of;
  const sel = '#of-pause button[data-cheat="${id}"]';
  // STAMP THE DOCUMENT. The runner waits for this to be GONE rather than for
  // the href to change, because a build whose URL arithmetic is broken
  // navigates to the URL it is already on, which reloads the page and leaves
  // location.href identical. Waiting on the href would hang for 30 s and the
  // negative control would read as a harness timeout instead of as a defect.
  window.__wjToken = ${Date.now()};
  of.pause(true);
  await of.run(0.5);
  const down = document.querySelector(sel);
  if (down === null) return { pressed: false, why: 'no button ' + sel };
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  down.dispatchEvent(new PointerEvent('pointerdown', opts));
  await of.run(0.11);
  const el = document.querySelector(sel);
  if (el === null) return { pressed: false, why: 'button vanished mid-press' };
  const savesBefore = of.game().persist.saves;
  el.click();
  const rec = of.cheat().log.slice(-1)[0] ?? null;
  return { pressed: true, savesBefore, receipt: rec, hrefAtPress: location.href,
           token: window.__wjToken };
})()`;

// What the world looks like on arrival: which body, where the player is, and
// what the load brought back. Read off the LIVE world, never off the slot.
const ARRIVED = `(async () => {
  const of = window.__of;
  of.input.tape([{ hold: 180, keys: [] }]);
  await of.run(1.5, 60);
  const w = of.world();
  const g = of.game();
  const v = of.voxels();
  const r = g.persist ? g.persist.restored : null;
  const feet0 = w.player ? w.player.feet.slice() : null;
  await of.run(1.5, 60);
  const w2 = of.world();
  const drift = feet0 === null || w2.player === null ? -1
    : Math.hypot(...w2.player.feet.map((c, i) => c - feet0[i]));
  return {
    href: location.href,
    bodyRadiusM: w.bodyRadiusM,
    gravityAtSurface: of.gravity(w.bodyRadiusM),
    grounded: w2.player === null ? null : w2.player.grounded,
    altM: +w2.altM.toFixed(2),
    surfaceHeightM: +w2.surfaceHeightM.toFixed(2),
    driftM: +drift.toFixed(4),
    latDeg: +w.observer.latDeg.toFixed(4), lonDeg: +w.observer.lonDeg.toFixed(4),
    removedCells: v === null ? -1 : v.removedCells,
    ops: v === null ? -1 : v.ops,
    restoredBody: r ? r.body : null,
    bodyHadWorld: r ? r.bodyHadWorld : null,
    otherBodies: r ? r.otherBodies : null,
    biome: w.biome,
  };
})()`;

// The verb, off the button, on a body where the seven Forge sites are wrong.
const OFFWORLD_REFUSALS = `(async () => {
  const of = window.__of;
  const feet0 = of.world().player.feet.slice();
  const site = of.cheat('visit:beach').log.slice(-1)[0];
  const self = of.cheat('world:cinder').log.slice(-1)[0];
  const bogus = of.cheat('world:nowhere').log.slice(-1)[0];
  await of.run(0.6);
  const feet1 = of.world().player.feet;
  return {
    site, self, bogus,
    movedM: +Math.hypot(...feet1.map((c, i) => c - feet0[i])).toFixed(6),
  };
})()`;

/** Wait for the client's OWN navigation. Never `page.goto`. The signal is a
 *  NEW DOCUMENT (the stamp is gone) and not a changed href: see PRESS. */
const waitForJump = async (token) => {
  await page.waitForFunction(
    (t) => window.__wjToken !== t, token, { timeout: 30000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 120000 });
  await page.evaluate(() => window.__of.ready);
  await page.evaluate(() => window.__of.run(2));
  return page.url();
};

let exitCode = 0;
const out = {};
let stage = 0;
try {
  // =======================================================================
  // 1. FORGE. The menu, both refusing cases, and a world worth not losing.
  // =======================================================================
  stage = 1;
  await boot(FORGE);
  const rows = await page.evaluate(ROWS);
  out.forgeRows = rows;
  check('the Another-world group draws, with one row per body',
    rows.count === 2 && rows.heading.includes('Another world'),
    `${rows.count} rows, heading "${rows.heading}"`);
  check('both rows reached the DOM',
    rows.forge?.dom?.present === true && rows.cinder?.dom?.present === true,
    JSON.stringify([rows.forge?.dom, rows.cinder?.dom]));
  // THE REFUSING CASE, on the ordinary path, in the same loop as the feature.
  check('ON FORGE, the Forge row is DISABLED and says you are already there',
    rows.forge?.dom?.disabled === true
      && rows.forge.blocked.includes('already on Forge'),
    `disabled=${rows.forge?.dom?.disabled}, blocked="${rows.forge?.blocked}"`);
  check('and the Cinder row is ENABLED with nothing blocking it',
    rows.cinder?.dom?.disabled === false && rows.cinder.blocked === '',
    `disabled=${rows.cinder?.dom?.disabled}, blocked="${rows.cinder?.blocked}"`);
  // The row has to say the two things a player needs before pressing.
  check('the Cinder row warns that the trip RELOADS the page',
    /reload/i.test(rows.cinder?.note ?? ''), rows.cinder?.note);
  check('and promises the world being left is saved and kept',
    /saved first/i.test(rows.cinder?.note ?? '')
      && /Forge/.test(rows.cinder?.note ?? ''), rows.cinder?.note);
  check("and carries /core's own radius and gravity for the moon",
    (rows.cinder?.note ?? '').includes('200 km')
      && (rows.cinder?.note ?? '').includes(CINDER_G.toFixed(2)),
    rows.cinder?.note);
  // On Forge the seven surveyed sites are correct and must NOT be blocked --
  // the positive half of GP-502, without which "all seven refuse" would pass on
  // a build that blocked them everywhere.
  check('ON FORGE the seven surveyed sites are enabled',
    rows.siteRows === 7 && rows.sitesDisabled === 0,
    `${rows.sitesDisabled} of ${rows.siteRows} disabled`);

  const forge = await page.evaluate(wrap('probes/bodydig.js', '{}'));
  out.forgeDig = forge;
  if (forge === null || forge.valid !== true) {
    throw new Error(`phase 1 fixture failed: ${JSON.stringify(forge)}`);
  }
  check('the Forge fixture is on Forge', forge.bodyRadiusM === FORGE_R,
    `radius ${forge.bodyRadiusM}`);
  check('and it dug something worth not losing', forge.ops > 0,
    `${forge.removedCells} cells / ${forge.ops} ops`);

  // =======================================================================
  // 2. PRESS IT. The real button, the client's own URL, the client's own
  //    navigation.
  // =======================================================================
  stage = 2;
  const press = await page.evaluate(PRESS('world:cinder'));
  out.pressCinder = press;
  check('the real Cinder button took a real press', press.pressed === true,
    press.why);
  const rec = press.receipt;
  check('the receipt is for the row that was pressed and says it is under way',
    rec?.id === 'world:cinder' && rec.done === true
      && rec.detail?.pending === true && rec.detail.bodyId === 1
      && rec.detail.fromBodyId === 0,
    JSON.stringify(rec));
  crossing('and the URL it chose actually names the moon',
    typeof rec?.detail?.url === 'string' && /[?&]body=cinder(&|$)/.test(rec.detail.url),
    `url ${rec?.detail?.url}`);
  crossing('and it kept every other flag it was given',
    typeof rec?.detail?.url === 'string' && rec.detail.url.includes('sandbox=1')
      && rec.detail.url.includes('scenario=walk') && rec.detail.url.includes('debug=1'),
    `url ${rec?.detail?.url}`);

  const landedCinder = await waitForJump(press.token);
  out.cinderHref = landedCinder;
  crossing('the client navigated ITSELF, to the URL its own receipt named',
    landedCinder === rec?.detail?.url,
    `landed ${landedCinder}, receipt said ${rec?.detail?.url}`);

  // =======================================================================
  // 3. THE MOON. Which body, where the player is, what came with them.
  // =======================================================================
  stage = 3;
  const cin = await page.evaluate(ARRIVED);
  out.cinderArrived = cin;
  crossing('THE PLAYER IS ON THE MOON', cin.bodyRadiusM === CINDER_R,
    `radius ${cin.bodyRadiusM}, expected ${CINDER_R}`);
  crossing("and it is a DIFFERENT body from the one they left",
    cin.bodyRadiusM !== forge.bodyRadiusM,
    `Forge ${forge.bodyRadiusM}, here ${cin.bodyRadiusM}`);
  // The row's claimed gravity, against the live body it is now standing on.
  // This is what catches a digit mistyped into WORLDS.
  crossing("the moon's gravity is what the row promised",
    Math.abs(cin.gravityAtSurface - CINDER_G) < 0.01,
    `live ${cin.gravityAtSurface}, row said ${CINDER_G}`);
  // THE R-BODY-1 TRAP, and it is the one that would make this unshippable: the
  // saved player anchor is bare lat/lon/alt with NO body in it, so a Forge
  // anchor restored on a 200 km moon can put the feet underground or in the
  // air. Grounded once and still grounded are different claims (GP-53).
  crossing('and they are STANDING ON IT, not falling and not buried',
    cin.grounded === true && Math.abs(cin.altM) < 5,
    `grounded=${cin.grounded}, altM ${cin.altM}, ground ${cin.surfaceHeightM}`);
  crossing('and 1.5 s of standing still moves them less than 5 cm',
    cin.driftM >= 0 && cin.driftM < 0.05, `${cin.driftM} m`);
  // The save half, for free: PS-40 says the moon gets its OWN world and the
  // planet is carried. A trip that dragged Forge's tunnel along would be the
  // exact defect twobody.mjs exists for, arrived at through the new door.
  crossing("the Forge tunnel did NOT come to the moon",
    cin.removedCells === 0 && cin.ops === 0,
    `dug ${forge.removedCells}/${forge.ops} on Forge, arrived holding `
    + `${cin.removedCells}/${cin.ops}`);
  crossing('and the load is carrying the planet through untouched',
    cin.bodyHadWorld === false && Array.isArray(cin.otherBodies)
      && cin.otherBodies.includes(0),
    `hadWorld ${cin.bodyHadWorld}, others ${JSON.stringify(cin.otherBodies)}`);

  // THE OTHER HALF OF THE REFUSING CASE, now that the bodies have swapped.
  const moonRows = await page.evaluate(ROWS);
  out.cinderRows = moonRows;
  crossing('ON CINDER, the Cinder row is now the DISABLED one',
    moonRows.cinder?.dom?.disabled === true
      && (moonRows.cinder.blocked ?? '').includes('already on Cinder'),
    `disabled=${moonRows.cinder?.dom?.disabled}, blocked="${moonRows.cinder?.blocked}"`);
  crossing('and the Forge row is the way home, enabled',
    moonRows.forge?.dom?.disabled === false && moonRows.forge.blocked === '',
    `disabled=${moonRows.forge?.dom?.disabled}, blocked="${moonRows.forge?.blocked}"`);
  // The trip has two directions and only one of them is the fun one. The first
  // driven run read "a jump goes 0.2 times as high" here, which is right and
  // reads as a typo; a ratio is only allowed on the screen the way up.
  check('and the way home states its jump ratio as a number above 1',
    /goes 6\.0 times LOWER/.test(moonRows.forge?.note ?? ''),
    moonRows.forge?.note);
  // GP-502. A new destination did not only add a row: it made seven existing
  // rows untrue, because their sun, treeline and ground are Forge's.
  crossing("the seven Forge sites are all DISABLED here, and say why",
    moonRows.siteRows === 7 && moonRows.sitesDisabled === 7
      && moonRows.siteBlocked.includes('ON FORGE'),
    `${moonRows.sitesDisabled} of ${moonRows.siteRows} disabled, `
    + `"${moonRows.siteBlocked}"`);

  const ref = await page.evaluate(OFFWORLD_REFUSALS);
  out.refusals = ref;
  crossing('and the VERB refuses too, not only the greyed button',
    ref.site?.done === false && ref.site.message.startsWith('refused'),
    JSON.stringify(ref.site));
  crossing('pressing the world you are already on refuses by name',
    ref.self?.done === false && ref.self.message.includes('already on Cinder'),
    JSON.stringify(ref.self));
  check('a world nobody authored refuses by name rather than navigating to NaN',
    ref.bogus?.done === false && ref.bogus.message.includes('no such world'),
    JSON.stringify(ref.bogus));
  crossing('and not one of those refusals moved the walker',
    ref.movedM < 0.001, `${ref.movedM} m`);

  // =======================================================================
  // 4. DIG ON THE MOON, THEN GO HOME BY THE SAME DOOR.
  // =======================================================================
  stage = 4;
  const cinderDig = await page.evaluate(wrap('probes/bodydig.js', '{"strikes":5}'));
  out.cinderDig = cinderDig;
  if (cinderDig === null || cinderDig.valid !== true) {
    throw new Error(`phase 4 fixture failed: ${JSON.stringify(cinderDig)}`);
  }
  check('the Cinder fixture is on Cinder', cinderDig.bodyRadiusM === CINDER_R,
    `radius ${cinderDig.bodyRadiusM}`);

  const back = await page.evaluate(PRESS('world:forge'));
  out.pressForge = back;
  check('the real Forge button took a real press', back.pressed === true, back.why);
  crossing('and the way home DELETES the flag rather than writing one that means Forge',
    typeof back.receipt?.detail?.url === 'string'
      && !/[?&]body=/.test(back.receipt.detail.url)
      && back.receipt.detail.bodyId === 0,
    `url ${back.receipt?.detail?.url}`);

  const landedForge = await waitForJump(back.token);
  out.forgeHref = landedForge;
  crossing('the client took itself home', landedForge === back.receipt?.detail?.url,
    `landed ${landedForge}`);

  // =======================================================================
  // 5. HOME. The world that was left is the world that came back.
  // =======================================================================
  stage = 5;
  const home = await page.evaluate(ARRIVED);
  out.forgeReturn = home;
  crossing('the return is on Forge', home.bodyRadiusM === FORGE_R,
    `radius ${home.bodyRadiusM}`);
  crossing("Forge's gravity is what its own row promised",
    Math.abs(home.gravityAtSurface - FORGE_G) < 0.01,
    `live ${home.gravityAtSurface}, row said ${FORGE_G}`);
  // THE CHECK THE WHOLE FEATURE HANGS ON. The trip must not eat the world.
  crossing("the Forge world came back EXACTLY as it was left",
    home.removedCells === forge.removedCells && home.ops === forge.ops,
    `left ${forge.removedCells}/${forge.ops}, came back `
    + `${home.removedCells}/${home.ops} (the moon added `
    + `${cinderDig.removedCells - forge.removedCells}/${cinderDig.ops - forge.ops} `
    + 'to a shared set before PS-40)');
  crossing("and the load says it was the planet's own world",
    home.bodyHadWorld === true && home.restoredBody === 0,
    `hadWorld ${home.bodyHadWorld}, body ${home.restoredBody}`);
  crossing('and the moon is still in the save, carried through',
    Array.isArray(home.otherBodies) && home.otherBodies.includes(1),
    JSON.stringify(home.otherBodies));
  crossing('and the player is standing on Forge, not falling',
    home.grounded === true && Math.abs(home.altM) < 5,
    `grounded=${home.grounded}, altM ${home.altM}`);
  const homeRows = await page.evaluate(ROWS);
  out.forgeRowsAfter = homeRows;
  crossing('and the menu is back to the state it started in',
    homeRows.forge?.dom?.disabled === true
      && homeRows.cinder?.dom?.disabled === false
      && homeRows.sitesDisabled === 0,
    JSON.stringify([homeRows.forge?.dom?.disabled,
      homeRows.cinder?.dom?.disabled, homeRows.sitesDisabled]));
} catch (e) {
  fails.push(`threw: ${String(e)}`);
} finally {
  await browser.close();
}

// THE POSITIVE CONTROL, written the one way that can fail: `stage` advances
// INSIDE the try, once per phase, so a run that died in phase 2 reports 2 and
// this goes red naming where it stopped. A green from a harness that never
// reached its assertions is indistinguishable from one that ran them all.
check('the run reached its last phase (positive control)', stage === 5,
  `stopped after phase ${stage} of 5`);

out.stageReached = stage;
console.log(JSON.stringify(out, null, 2));
if (errors.size > 0) {
  console.error('worldjump: page errors');
  for (const [m, n] of errors) console.error(`  x${n} ${m}`);
  exitCode = 1;
}
if (fails.length > 0) {
  console.error(`worldjump: ${fails.length} FAILED`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  exitCode = 1;
} else {
  console.log('worldjump: PASS');
}
process.exit(exitCode);
