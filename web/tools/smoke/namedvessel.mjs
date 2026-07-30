// namedvessel.mjs: A NAMED SAVE CARRIES THE WHOLE WORLD. (PS-13, closing R46.)
//
//   node tools/smoke/namedvessel.mjs --url=http://127.0.0.1:5461/
//
// R46, found by the physics lane while stamping `dayT`: `SaveSlots.save` wrote
// a named slot through `writeKey` directly, bypassing the `writeSlot` choke
// point where `vessels` (PH-67), `player` (PH-68) and `dayT` (PH-86) are
// stamped. So a named save recorded the factory and the base and silently lost
// the rocket in orbit, the player's position and the time of day, and LOOKED
// complete until it was loaded. This runner is the reproduction and the proof
// in one file: against the pre-fix build its side-by-side rows go red by name,
// against the fixed build everything is green.
//
// WHY THIS IS A RUNNER AND NOT A PROBE: vesselreload.mjs's reason, verbatim.
// ONE browser context and real `page.reload()` calls, because a named load is a
// copy onto the autosave key PLUS a boot, and only a real reload boots.
//
// THREE PHASES:
//   A. THE SIDE-BY-SIDE. One scene: a vessel left on rails in orbit, the day
//      phase pinned. Force the autosave, then make a NAMED save through the
//      real panel (the box, the button). Read BOTH slots raw out of IndexedDB
//      and compare field by field. The named slot must carry the same vessel
//      (fuel bit-identical), a player anchor, and a dayT near the pin.
//   B. THE ROUND TRIP. Drive Load on the named save, reload the page, and the
//      vessel is back on rails with its exact fuel and conic, the anchor is
//      applied, and the sun is where the slot says rather than at the solve.
//   C. THE OLD-SLOT CONTROL. Strip vessels/player/dayT from the named slot on
//      disk, which IS every named save written before the fix (Reid's
//      included), and load it the same way. It must boot without a crash, come
//      back honestly empty (0 records, spawn anchor, solved sun), and the save
//      list must have SAID so before the load (`partial` on the row, and the
//      sentence on the drawn row itself).

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
const url = `${base}?sandbox=1&debug=1`;
const NAME = 'r46 proof';
const KEY = `save:sandbox:${NAME}`;
const AUTO = 'auto-sandbox';
const PIN = 0.42; // dayreload.mjs's pin: no boot solve at the spawn produces it.

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('namedvessel: no Chrome or Edge found'); process.exit(2); }

const fails = [];
const check = (name, ok, detail) => {
  if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  return ok === true;
};
const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const wrap = (file, argsJson) =>
  `((OF_ARGS) => (\n${readFileSync(resolve(here, file), 'utf8')}\n))(${argsJson})`;

const WAIT_BOOT = `(async () => {
  const t0 = Date.now();
  while (!window.__of && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 250));
  if (!window.__of) throw new Error('no __of after 60 s');
  await window.__of.ready;
  await window.__of.run(2);
  const of = window.__of;
  const s = of.stats();
  const v = of.flight('vessels');
  const w = of.world();
  const feet = w.player === null ? null : w.player.feet;
  const rr = feet === null ? 0 : Math.hypot(feet[0], feet[1], feet[2]);
  return {
    sunT: s.sky.sunT,
    records: v.records, resume: v.resume, anchor: v.anchor,
    rec: (v.list || [])[0] || null,
    aboard: of.flight('report').aboard,
    lat: rr === 0 ? null : (Math.asin(feet[1] / rr) * 180) / Math.PI,
    lon: rr === 0 ? null : (Math.atan2(feet[2], feet[0]) * 180) / Math.PI,
  };
})()`;

// Both slots, raw off the store, reduced to the comparable fields. The
// reduction is shared so the two sides cannot be reduced differently.
const READ_SLOTS = `(async () => {
  const open = () => new Promise((res, rej) => {
    const q = indexedDB.open('orbital-foundry', 1);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const db = await open();
  const get = (k) => new Promise((res, rej) => {
    const t = db.transaction('saves', 'readonly').objectStore('saves').get(k);
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
  const reduce = (s) => (s === undefined || s === null) ? null : {
    hasVessels: Array.isArray(s.vessels),
    vesselCount: Array.isArray(s.vessels) ? s.vessels.length : 0,
    vesselId: Array.isArray(s.vessels) && s.vessels[0] ? s.vessels[0].id : 0,
    fuelJson: Array.isArray(s.vessels) && s.vessels[0]
      ? JSON.stringify(s.vessels[0].fuel) : null,
    whereJson: Array.isArray(s.vessels) && s.vessels[0]
      ? JSON.stringify(s.vessels[0].where) : null,
    player: s.player === undefined ? null
      : { lat: s.player.lat, lon: s.player.lon, aboard: s.player.aboard },
    dayT: s.dayT === undefined ? null : s.dayT,
    buildings: s.buildings.length, savedAt: s.savedAt,
  };
  const auto = reduce(await get(${JSON.stringify(AUTO)}));
  const named = reduce(await get(${JSON.stringify(KEY)}));
  db.close();
  return { auto, named };
})()`;

// The strip: turn the named slot into exactly what every named save written
// before the fix is. `delete`, not `= undefined`, so the fields are ABSENT the
// way an old structured-clone record has them absent.
const STRIP_NAMED = `(async () => {
  const open = () => new Promise((res, rej) => {
    const q = indexedDB.open('orbital-foundry', 1);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const db = await open();
  const get = (k) => new Promise((res, rej) => {
    const t = db.transaction('saves', 'readonly').objectStore('saves').get(k);
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
  const put = (k, v) => new Promise((res, rej) => {
    const t = db.transaction('saves', 'readwrite').objectStore('saves').put(v, k);
    t.onsuccess = () => res(true); t.onerror = () => rej(t.error);
  });
  const slot = await get(${JSON.stringify(KEY)});
  if (!slot) return { had: false };
  const had = { vessels: Array.isArray(slot.vessels),
                player: slot.player !== undefined,
                dayT: typeof slot.dayT === 'number' };
  delete slot.vessels; delete slot.player; delete slot.dayT;
  await put(${JSON.stringify(KEY)}, slot);
  db.close();
  return { had: true, ...had };
})()`;

// The named save, through the REAL panel: savenamed.js's press helper with
// GP-156's re-query and no stale fallback.
const PANEL_SAVE = `(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const press = async (id) => {
    const sel = '#of-pause button[data-cheat="' + id + '"]';
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    const el = document.querySelector(sel);
    if (el === null) return false;
    el.click();
    await sleep(0.45);
    return true;
  };
  of.pause(true);
  await sleep(0.4);
  const opened = await press('page:save');
  const box = document.querySelector('#of-pause input[data-save="name"]');
  if (box === null) return { opened, boxed: false };
  box.value = ${JSON.stringify(NAME)};
  await sleep(0.2);
  const pressed = await press('save:new');
  await sleep(0.8);
  const view = of.pause().view.saves;
  const row = view.rows.find((r) => r.name === ${JSON.stringify(NAME)}) ?? null;
  // GP-64: read the drawn row too, so "the notice reaches the screen" is a
  // claim about pixels-adjacent DOM and not about a field nobody renders.
  const btn = document.querySelector(
    '#of-pause button[data-cheat="save:load:' + ${JSON.stringify(NAME)} + '"]');
  const rowText = btn === null ? null : (btn.closest('.ctlr')?.textContent ?? null);
  of.pause(false);
  await sleep(0.2);
  return { opened, boxed: true, pressed, saved: of.saves().saved, row, rowText };
})()`;

// Re-open the list (the rising edge re-reads the store), read the named row,
// then drive Load with the restart suppressed; the runner reloads from outside.
const PANEL_LOAD = `(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const press = async (id) => {
    const sel = '#of-pause button[data-cheat="' + id + '"]';
    const down = document.querySelector(sel);
    if (down === null) return false;
    down.dispatchEvent(new PointerEvent('pointerdown', opts));
    await sleep(0.11);
    const el = document.querySelector(sel);
    if (el === null) return false;
    el.click();
    await sleep(0.45);
    return true;
  };
  of.pause(true);
  await sleep(0.4);
  const opened = await press('page:save');
  await sleep(0.6);
  const view = of.pause().view.saves;
  const row = view.rows.find((r) => r.name === ${JSON.stringify(NAME)}) ?? null;
  const btn = document.querySelector(
    '#of-pause button[data-cheat="save:load:' + ${JSON.stringify(NAME)} + '"]');
  const rowText = btn === null ? null : (btn.closest('.ctlr')?.textContent ?? null);
  of.cheat('norestart');
  const pressed = await press('save:load:' + ${JSON.stringify(NAME)});
  await sleep(0.8);
  return { opened, row, rowText, pressed, slots: of.saves() };
})()`;

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // PRE-EXISTING on the pristine freeze of 4a44edb, measured BEFORE any change
  // of this lane's: the surfaces role-table diagnostic is the art pipeline's
  // (client role table vs generated surfaces.json) and says nothing about
  // saves. Named exactly, never wildcarded; any other error still fails.
  if (m.text().startsWith('[of] surfaces:')) return;
  note(`console.error: ${m.text()}`);
});

let sideBySide = null; let cut = null; let back = null;
let stripped = null; let oldRow = null; let oldBoot = null; let bootSolve = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const boot1 = await page.evaluate(WAIT_BOOT);
  bootSolve = boot1.sunT;

  // --- the scene: a vessel flown to orbit and LEFT there, on rails ----------
  const flew = await page.evaluate(wrap('probes/flyto.js',
    JSON.stringify({ phase: 'orbit' })));
  if (flew === null || flew.valid !== true || flew.reached !== 'orbit') {
    throw new Error(`flyto failed: ${JSON.stringify({ valid: flew?.valid, reached: flew?.reached })}`);
  }
  const left = await page.evaluate(`(async () => {
    const of = window.__of;
    of.input.act(['throttleCut'], 4);
    await of.run(2);
    const l = of.flight('leave');
    return { ok: l.ok, records: l.vessels.records,
             mode: ((l.vessels.list || [])[0] || {}).mode ?? null };
  })()`);
  check('the vessel was LEFT in orbit, on rails',
    left.ok === true && left.records === 1 && left.mode === 'rails',
    JSON.stringify(left));
  if (left.ok !== true) throw new Error('no vessel on rails, nothing to lose');

  // --- pin the day so dayT is distinctive, then write BOTH saves ------------
  await page.evaluate(`(async () => { window.__of.setTime(${PIN}); await window.__of.run(2); })()`);
  const auto = await page.evaluate(`window.__of.save()`);
  check('the forced AUTOSAVE landed', auto !== null && auto !== false
    && auto.refused === undefined, JSON.stringify(auto));
  const panelSave = await page.evaluate(PANEL_SAVE);
  check('the NAMED save went through the real panel',
    panelSave.opened === true && panelSave.boxed === true
    && panelSave.pressed === true && panelSave.saved >= 1
    && panelSave.row !== null, JSON.stringify(panelSave));
  check('and its list row does NOT claim to be partial',
    panelSave.row !== null && panelSave.row.partial === false,
    JSON.stringify(panelSave.row));

  cut = await page.evaluate(WAIT_BOOT);

  // --- A. THE SIDE-BY-SIDE: both slots raw off the store --------------------
  sideBySide = await page.evaluate(READ_SLOTS);
  const A = sideBySide.auto; const N = sideBySide.named;
  check('S1 the AUTOSAVE carries the vessel (the scene control)',
    A !== null && A.vesselCount === 1, JSON.stringify(A));
  check('S2 THE NAMED SLOT CARRIES VESSELS AT ALL',
    N !== null && N.hasVessels === true && N.vesselCount === 1,
    `named slot vessels: ${JSON.stringify({ hasVessels: N?.hasVessels, count: N?.vesselCount })}`);
  check('S3 the SAME vessel, fuel BIT-IDENTICAL to the autosave',
    N !== null && A !== null && N.vesselId === A.vesselId
    && N.fuelJson !== null && N.fuelJson === A.fuelJson,
    `auto id ${A?.vesselId} fuel ${A?.fuelJson}, named id ${N?.vesselId} fuel ${N?.fuelJson}`);
  check('S4 and the same conic, byte for byte',
    N !== null && A !== null && N.whereJson !== null && N.whereJson === A.whereJson,
    `auto ${A?.whereJson}, named ${N?.whereJson}`);
  check('S5 THE NAMED SLOT CARRIES THE PLAYER ANCHOR',
    N !== null && N.player !== null && A !== null && A.player !== null
    && Math.abs(N.player.lat - A.player.lat) < 1e-6
    && Math.abs(N.player.lon - A.player.lon) < 1e-6,
    `auto ${JSON.stringify(A?.player)}, named ${JSON.stringify(N?.player)}`);
  check('S6 THE NAMED SLOT CARRIES dayT, near the pin',
    N !== null && N.dayT !== null && Math.abs(N.dayT - PIN) < 120 / 3600,
    `named dayT ${N?.dayT}, pin ${PIN}`);

  // --- B. THE ROUND TRIP: load the named save, real reload ------------------
  const loaded = await page.evaluate(PANEL_LOAD);
  check('Load was pressed and counted', loaded.pressed === true
    && loaded.slots.loads === 1, JSON.stringify(loaded.slots));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  back = await page.evaluate(WAIT_BOOT);
  const b = cut.rec; const r = back.rec;
  check('R1 exactly ONE vessel came back from the NAMED save',
    back.records === 1 && back.resume.adopted === 1 && r !== null
    && b !== null && r.id === b.id,
    `records ${back.records}, adopted ${back.resume?.adopted}, id ${b?.id} -> ${r?.id}`);
  check('R2 with the fuel it ACTUALLY had',
    r !== null && b !== null && Math.abs(r.fuelKg - b.fuelKg) < 1e-9,
    `${b?.fuelKg} kg -> ${r?.fuelKg} kg`);
  const relA = r?.conic && b?.conic
    ? Math.abs(r.conic.a - b.conic.a) / Math.abs(b.conic.a) : Infinity;
  check('R3 in the same orbit', relA < 1e-9,
    `a ${b?.conic?.a} -> ${r?.conic?.a}, relative ${relA}`);
  check('R4 still on RAILS, not promoted', r !== null && r.mode === 'rails'
    && back.resume.promoted === 0 && back.aboard === false,
    `mode ${r?.mode}, promoted ${back.resume?.promoted}, aboard ${back.aboard}`);
  // `applied` is true on the defaulted path too (the anchor step RAN); the
  // discriminator for "from the slot" is `restored !== null`, which is
  // vesselreload.mjs's own 6b. Measured on the pristine build: the defaulted
  // boot reports applied true, restored null, lon at the spawn's exact 144.
  check('R5 the player came back where they were STANDING',
    back.anchor.restored !== null && cut.lat !== null && back.lat !== null
    && Math.abs(back.lat - cut.lat) < 1e-4 && Math.abs(back.lon - cut.lon) < 1e-4,
    `restored ${JSON.stringify(back.anchor?.restored)}, lat ${cut.lat} -> ${back.lat}, `
    + `lon ${cut.lon} -> ${back.lon}`);
  check('R6 and the sun is where the SLOT says, not at the solve',
    sideBySide.named?.dayT !== null
    && Math.abs(back.sunT - (sideBySide.named?.dayT ?? 0)) < 20 / 3600
    && Math.abs(back.sunT - bootSolve) > 0.05,
    `slot ${sideBySide.named?.dayT}, back ${back.sunT}, solve ${bootSolve}`);

  // --- C. THE OLD-SLOT CONTROL: Reid's existing named saves -----------------
  stripped = await page.evaluate(STRIP_NAMED);
  check('the strip found the three fields to remove (else this control tests nothing)',
    stripped.had === true && stripped.vessels === true
    && stripped.player === true && stripped.dayT === true,
    JSON.stringify(stripped));
  oldRow = await page.evaluate(PANEL_LOAD);
  check('O1 the list SAYS the old slot is partial, before the player loads it',
    oldRow.row !== null && oldRow.row.partial === true,
    JSON.stringify(oldRow.row));
  check('O2 and the sentence reaches the DRAWN row, not just the view',
    oldRow.row !== null && oldRow.rowText !== null
    && oldRow.rowText.includes(oldRow.row.summary),
    `row text: ${JSON.stringify(oldRow.rowText)}, summary: ${JSON.stringify(oldRow.row?.summary)}`);
  check('O3 loading it is not refused', oldRow.pressed === true
    && oldRow.slots.loads === 1, JSON.stringify(oldRow.slots));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  oldBoot = await page.evaluate(WAIT_BOOT);
  check('O4 an old partial named save BOOTS, honestly empty: no vessels',
    oldBoot.records === 0, `records ${oldBoot.records}`);
  check('O5 the anchor is defaulted, not invented (restored null: the spawn)',
    oldBoot.anchor.restored === null, JSON.stringify(oldBoot.anchor));
  check('O6 and the sun is at the boot solve, the pre-cycle behaviour',
    Math.abs(oldBoot.sunT - bootSolve) < 5 / 3600,
    `solve ${bootSolve}, old-slot boot ${oldBoot.sunT}`);
} catch (e) {
  note(`runner: ${e?.message ?? e}`);
} finally {
  await browser.close();
}

const errList = [...errors.entries()].map(([m, n]) => `${n}x ${m}`);
const pass = fails.length === 0 && errList.length === 0;
console.log(JSON.stringify({
  pass, fails, pageErrors: errList,
  bootSolve,
  sideBySide,
  cutRec: cut?.rec ? { id: cut.rec.id, mode: cut.rec.mode, fuelKg: cut.rec.fuelKg,
    conic: cut.rec.conic } : null,
  backRec: back?.rec ? { id: back.rec.id, mode: back.rec.mode, fuelKg: back.rec.fuelKg,
    conic: back.rec.conic } : null,
  backAnchor: back?.anchor ?? null, backSunT: back?.sunT ?? null,
  oldRow: oldRow?.row ?? null, oldRowText: oldRow?.rowText ?? null,
  oldBoot: oldBoot === null ? null : { records: oldBoot.records,
    anchor: oldBoot.anchor, sunT: oldBoot.sunT },
}, null, 2));
process.exit(pass ? 0 : 1);
