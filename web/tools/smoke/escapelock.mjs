// GP-162: THE ESCAPE KEY, DRIVEN THE WAY REID'S FINGER DRIVES IT.
//
// Every existing menu probe drives `Cheats.press`, `__of.pause(...)` or a tape
// entry carrying the `cancel` ACTION. All of those enter the game BELOW the
// browser's own input pipeline, and Escape is the one key the browser itself
// claims: while the pointer is LOCKED, Escape is the user agent's unlock
// gesture, and the Pointer Lock spec says the UA MUST NOT deliver keyboard
// events for it. So the state a player is always in (locked, playing) is
// exactly the state no probe has ever exercised, and this runner exists to
// exercise it as closely as a headless browser can: CDP keyboard/mouse input
// (`page.keyboard`, `page.mouse`), never `dispatchEvent`, never the tape.
//
// WHAT THIS PROVES AND WHAT IT CANNOT (stated per the brief): CDP input enters
// through the renderer's input pipeline, which is the same code path a real
// key takes AFTER the browser process has decided not to consume it. Whether
// the browser process consumes a REAL physical Escape while locked is exactly
// the part CDP may bypass, so this runner MEASURES what CDP does (and says
// which case it observed) rather than assuming either way. The pointer-lock
// EXIT path itself is exercised for real: `document.exitPointerLock()` from
// page context fires the same pointerlockchange event a browser-consumed
// Escape fires, so "lock lost without the game asking" is proven end to end
// even if CDP turns out to deliver the keydown.
//
//   node tools/smoke/escapelock.mjs [--url=http://127.0.0.1:5173/] [--out=...]
//
// Exit 0 only when every check passed AND no console error was seen.

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const base = args.get('url') ?? 'http://127.0.0.1:5173/';
const url = `${base}?scenario=walk&debug=1`;
const out = args.get('out');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) { console.error('escapelock: no Chrome or Edge found'); process.exit(2); }

const errors = [];
const browser = await chromium.launch({
  executablePath: exe,
  // --headed exists because pointer lock may be refused by headless Chrome,
  // and the LOCKED play state is the whole point of this instrument. A headed
  // run flashes a window; it is the price of measuring the real lock.
  headless: !args.has('headed'),
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
    '--disable-frame-rate-limit', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  console.error(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? `  [${detail}]` : ''}`);
  return ok;
};

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);

  // The instrument: raw counts of what the BROWSER delivered, capture phase on
  // window so nothing in the page can eat one before it is counted.
  await page.evaluate(() => {
    window.__esc = { down: 0, up: 0, plc: [], menuDrawnAt: [] };
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') window.__esc.down++; }, true);
    window.addEventListener('keyup', (e) => { if (e.code === 'Escape') window.__esc.up++; }, true);
    document.addEventListener('pointerlockchange', () => {
      window.__esc.plc.push(document.pointerLockElement !== null);
    });
  });
  const state = () => page.evaluate(() => ({
    esc: window.__esc,
    locked: document.pointerLockElement !== null,
    pauseOpen: window.__of.pause().open,
    escapeOpens: window.__of.pause().escapeOpens,
    modals: window.__of.modals(),
  }));
  const run = (s) => page.evaluate((n) => window.__of.run(n), s);
  // A HUMAN PRESS, not a zero-length one: keydown, ~100 ms of driven frames,
  // keyup. `page.keyboard.press` emits down+up back to back, and the fixed
  // tick legitimately samples BETWEEN them, which made the first draft of this
  // probe flaky on its second press. A key nobody can lose is not a key.
  const pressEscape = async () => {
    await page.keyboard.down('Escape');
    await run(0.15);
    await page.keyboard.up('Escape');
    await run(0.35);
  };

  await run(1.0);

  // ======================================================================
  // 1. COLD AND UNLOCKED: a real (CDP) Escape must open the menu
  // ======================================================================
  const s0 = await state();
  check('boot state: menu shut, pointer unlocked, hook claimed',
    s0.pauseOpen === false && s0.locked === false && s0.escapeOpens === true,
    JSON.stringify({ open: s0.pauseOpen, locked: s0.locked, hook: s0.escapeOpens }));

  await pressEscape();
  const s1 = await state();
  check('unlocked: the browser delivered the keydown', s1.esc.down >= 1,
    `keydowns ${s1.esc.down}`);
  check('unlocked: one real Escape opened the game menu', s1.pauseOpen === true,
    `open ${s1.pauseOpen}, modals ${JSON.stringify(s1.modals)}`);

  // The menu must also be DRAWN (GP-151: check the pixels, not the state).
  // The panel covers a large share of a 1600x900 frame, so compare a centre
  // crop against a shot taken after closing: a big change proves paint.
  const shotOpen = await page.screenshot();
  await pressEscape();
  const s2 = await state();
  check('unlocked: a second real Escape closed it again', s2.pauseOpen === false,
    `open ${s2.pauseOpen}, keydowns ${s2.esc.down}`);
  const shotShut = await page.screenshot();
  const drawnDelta = await page.evaluate(async ([a, b]) => {
    const load = (bytes) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = 'data:image/png;base64,' + bytes;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = 400, h = 300;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(ia, 600, 300, w, h, 0, 0, w, h);
    const da = cx.getImageData(0, 0, w, h).data;
    cx.drawImage(ib, 600, 300, w, h, 0, 0, w, h);
    const db = cx.getImageData(0, 0, w, h).data;
    let moved = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > 12 || Math.abs(da[i + 1] - db[i + 1]) > 12
        || Math.abs(da[i + 2] - db[i + 2]) > 12) moved++;
    }
    return { moved, of: w * h };
  }, [shotOpen.toString('base64'), shotShut.toString('base64')]);
  check('the open menu was PAINTED (centre crop open-vs-shut moved > 20%)',
    drawnDelta.moved / drawnDelta.of > 0.20,
    `${drawnDelta.moved} of ${drawnDelta.of} px moved`);

  // ======================================================================
  // 2. LOCKED, THE STATE A PLAYER IS ALWAYS IN
  // ======================================================================
  // Buy the lock the way a player does: one real click on the canvas. The
  // rejection reason (if any) is captured so "no lock" names its cause rather
  // than reading as a silent nothing.
  await page.evaluate(() => {
    window.__lockAttempt = 'no pointerdown seen';
    const cv = document.querySelector('canvas');
    cv.addEventListener('pointerdown', () => {
      const p = cv.requestPointerLock?.();
      if (p instanceof Promise) {
        p.then(() => { window.__lockAttempt = 'granted'; },
          (e) => { window.__lockAttempt = `rejected: ${e?.message ?? e}`; });
      } else window.__lockAttempt = `returned ${String(p)}`;
    }, { once: true, capture: true });
  });
  await page.mouse.click(800, 450);
  await run(0.5);
  const s3 = await state();
  const lockAttempt = await page.evaluate(() => window.__lockAttempt);
  const gotLock = s3.locked === true;
  check('a real click on the canvas engaged the pointer lock', gotLock,
    `locked ${s3.locked}, attempt: ${lockAttempt}, plc ${JSON.stringify(s3.esc.plc)}`);

  let lockedFinding = 'lock never engaged; the locked case is UNTESTED here';
  if (gotLock) {
    const before = s3.esc.down;
    await pressEscape();
    const s4 = await state();
    const delivered = s4.esc.down - before;
    const unlockedByKey = s4.locked === false;
    lockedFinding = `CDP Escape while locked: keydown delivered=${delivered > 0}`
      + ` (count +${delivered}), lock ${unlockedByKey ? 'EXITED' : 'HELD'},`
      + ` menu ${s4.pauseOpen ? 'OPENED' : 'stayed shut'}`;
    console.error(`  measured: ${lockedFinding}`);
    // THE HEADLINE. Whichever consumption case this browser exhibits, the
    // player-visible contract is the same: pressing Escape from locked play
    // must end with the menu open.
    check('LOCKED PLAY: one Escape press ends with the game menu OPEN',
      s4.pauseOpen === true,
      `menu open ${s4.pauseOpen}, keydown delta ${delivered}, locked after ${s4.locked}`);

    // Clean up for the next section: close it again.
    if (s4.pauseOpen) await pressEscape();
  }

  // ======================================================================
  // 3. THE LOCK LOST WITHOUT THE GAME ASKING (the browser-consumed-Escape
  //    path, reproduced exactly at the pointerlockchange seam)
  // ======================================================================
  // Re-acquire, then exit the lock from PAGE CONTEXT. The game did not call
  // this (Input only exits inside setUiCapture), so from the client's view
  // this is byte-identical to the browser consuming Escape: lock drops, no
  // keydown arrives.
  await page.mouse.click(800, 450);
  await run(0.5);
  const s5 = await state();
  check('the lock re-engaged for the seam test', s5.locked === true,
    `locked ${s5.locked}`);
  if (s5.locked) {
    const downBefore = s5.esc.down;
    await page.evaluate(() => { document.exitPointerLock(); });
    await run(0.5);
    const s6 = await state();
    check('the seam fired: lock lost, and NO keydown was delivered',
      s6.locked === false && s6.esc.down === downBefore,
      `locked ${s6.locked}, keydowns ${downBefore} -> ${s6.esc.down}`);
    check('LOCK LOST WITHOUT A KEY: the game menu is OPEN',
      s6.pauseOpen === true, `open ${s6.pauseOpen}, modals ${JSON.stringify(s6.modals)}`);
  }

  if (out) {
    const p = isAbsolute(out) ? out : resolve(repoRoot, out);
    mkdirSync(dirname(p), { recursive: true });
    await page.screenshot({ path: p });
    console.error(`escapelock: wrote ${p}`);
  }
} catch (e) {
  errors.push(`runner: ${e?.message ?? e}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`escapelock: CONSOLE/RUNNER FAILURES (${errors.length})`);
  for (const e of errors) console.error('  ' + e);
}
console.error(fails.length === 0 && errors.length === 0
  ? 'escapelock: PASS' : `escapelock: FAIL (${fails.length} checks, ${errors.length} errors)`);
process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
