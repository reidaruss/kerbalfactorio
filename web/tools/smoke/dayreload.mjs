// dayreload.mjs: A SAVE MADE AT NOON LOADS AT NOON. (PH-86, the reload half.)
//
//   node tools/smoke/dayreload.mjs --url=http://127.0.0.1:4287/
//
// WHY THIS IS A RUNNER AND NOT A PROBE: the same reason vesselreload.mjs gives,
// verbatim. ONE browser context and `page.reload()`. A fresh context would hand
// the second half an empty IndexedDB and the run would "pass" while describing
// nothing. Only a real reload rebuilds the world from the slot in boot order,
// and the day phase is adopted on the FIRST FIXED TICK of that boot
// (sim/DayCycle.ts), so only a runner shaped like this can ask the question.
//
// THREE CLAIMS, the third being the one about Reid's existing base:
//   1. The phase SURVIVES: save at a distinctive pinned phase (0.42 turns, which
//      no boot solve produces at the spawn: the solve gives ~0.2486), reload,
//      and the sun is within a few sim seconds of where it was cut.
//   2. It is the SLOT carrying it, not residue: the restored phase differs from
//      the boot solve by a margin no solver noise could produce.
//   3. AN OLD SLOT STILL LOADS AS IT ALWAYS DID: strip `dayT` from the very
//      slot on disk (which is exactly what every save written before PH-86
//      looks like, including Reid's base), reload again, and the world boots at
//      the solved phase: lit at the spawn, exactly the pre-cycle behaviour.

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const base = args.get('url') ?? 'http://127.0.0.1:5473/';
const url = `${base}?sandbox=1&debug=1`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) { console.error('dayreload: no Chrome or Edge found'); process.exit(2); }

const fails = [];
const check = (name, ok, detail) => {
  if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  return ok === true;
};
const errors = new Map();
const note = (m) => errors.set(m.slice(0, 160), (errors.get(m.slice(0, 160)) ?? 0) + 1);

const WAIT_BOOT = `(async () => {
  const t0 = Date.now();
  while (!window.__of && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 250));
  if (!window.__of) throw new Error('no __of after 60 s');
  await window.__of.ready;
  await window.__of.run(1);
  const s = window.__of.stats();
  return { sunT: s.sky.sunT, day: s.sky.day };
})()`;

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
         '--disable-frame-rate-limit', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') note(`console.error: ${m.text()}`); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const boot1 = await page.evaluate(WAIT_BOOT);

// --- the cut: pin a phase no solve produces, run a little, save ------------
const cut = await page.evaluate(`(async () => {
  const of = window.__of;
  of.setTime(0.42);
  await of.run(2);
  const pending = of.save();
  const s = of.stats();
  const saved = await pending;
  const g = of.game();
  return { sunT: s.sky.sunT, day: s.sky.day, saved,
           saves: g.persist ? g.persist.saves : -1 };
})()`);

check('the save at the cut landed', cut.saved !== null && cut.saved !== false,
  JSON.stringify(cut.saved));

// --- reload: the phase must come back ---------------------------------------
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
const boot2 = await page.evaluate(WAIT_BOOT);

const drift = Math.abs(boot2.sunT - cut.sunT);
check('RELOADED AT THE PHASE IT WAS CUT AT: within 5 sim seconds of the slot',
  drift < 5 / 3600, `cut ${cut.sunT}, back ${boot2.sunT}, drift ${drift * 3600} s`);
check('and that phase is the SLOT talking, not the boot solve',
  Math.abs(boot2.sunT - boot1.sunT) > 0.05,
  `boot solve ${boot1.sunT}, restored ${boot2.sunT}`);

// --- the old-slot control: strip dayT, which IS every pre-PH-86 save --------
const stripped = await page.evaluate(`(async () => {
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
  const slot = await get('auto-sandbox');
  if (!slot) return { had: false };
  const hadDayT = typeof slot.dayT === 'number';
  const dayT = slot.dayT;
  delete slot.dayT;
  await put('auto-sandbox', slot);
  db.close();
  return { had: true, hadDayT, dayT };
})()`);

check('the slot on disk existed and CARRIED dayT before the strip',
  stripped.had === true && stripped.hadDayT === true, JSON.stringify(stripped));
check('and carried the phase it was cut at', Math.abs((stripped.dayT ?? 0) - cut.sunT) < 5 / 3600,
  `slot ${stripped.dayT}, cut ${cut.sunT}`);

await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
const boot3 = await page.evaluate(WAIT_BOOT);
check('A SLOT WITH NO dayT (every save written before PH-86, Reid\'s base '
  + 'included) BOOTS AT THE SOLVED PHASE, the exact old behaviour',
  Math.abs(boot3.sunT - boot1.sunT) < 5 / 3600,
  `boot solve ${boot1.sunT}, old-slot boot ${boot3.sunT}`);

await browser.close();

const errList = [...errors.entries()].map(([m, n]) => `${n}x ${m}`);
const pass = fails.length === 0 && errList.length === 0;
console.log(JSON.stringify({
  pass, fails, pageErrors: errList,
  bootSolve: boot1.sunT, cut: cut.sunT, restored: boot2.sunT,
  strippedSlot: stripped, oldSlotBoot: boot3.sunT,
}, null, 2));
process.exit(pass ? 0 : 1);
