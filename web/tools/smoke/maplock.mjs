// maplock.mjs: M FROM THE LOCKED PLAY STATE (GP-212).
//
//   cd web && node tools/smoke/maplock.mjs --url=http://127.0.0.1:PORT/ [--headed]
//     [--before=path.png] [--after=path.png]
//
// The state a player is actually in when they press M is pointer-LOCKED, and
// no tape-driven probe exercises it (escapelock.mjs's lesson: the browser
// treats a locked keydown differently, and a synthetic dispatch cannot
// reproduce the player's finger). This drives CDP input against a real lock:
//
//   1. buy the lock with a real click, exactly as a player does;
//   2. one real M: the map must OPEN, be PAINTED (pixels, a centre-crop diff
//      against the locked frame), and the pointer must be RELEASED;
//   3. one more real M: the map must CLOSE and the pointer must RE-LOCK,
//      which is the GP-162 composition this instrument exists to guard.
//
// Headless Chrome may refuse pointer lock; --headed is the price of the real
// thing, same as escapelock.mjs.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const args = new Map(process.argv.slice(2).filter((a) => a.startsWith('--'))
  .map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const base = args.get('url');
if (!base || base.includes('?')) {
  console.error('maplock: --url required, with no query string');
  process.exit(2);
}
const url = `${base}?scenario=walk&debug=1`;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) { console.error('maplock: no Chrome or Edge found'); process.exit(2); }

const errors = [];
const browser = await chromium.launch({
  executablePath: exe,
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

/** Fraction of a centre crop that moved between two screenshots. */
const cropMoved = (a, b) => page.evaluate(async ([sa, sb]) => {
  const load = (bytes) => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = 'data:image/png;base64,' + bytes;
  });
  const [ia, ib] = await Promise.all([load(sa), load(sb)]);
  const w = 500, h = 400;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(ia, 550, 250, w, h, 0, 0, w, h);
  const da = cx.getImageData(0, 0, w, h).data;
  cx.drawImage(ib, 550, 250, w, h, 0, 0, w, h);
  const db = cx.getImageData(0, 0, w, h).data;
  let moved = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) > 12 || Math.abs(da[i + 1] - db[i + 1]) > 12
      || Math.abs(da[i + 2] - db[i + 2]) > 12) moved++;
  }
  return moved / (w * h);
}, [a.toString('base64'), b.toString('base64')]);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  const run = (s) => page.evaluate((n) => window.__of.run(n), s);
  const state = () => page.evaluate(() => ({
    locked: document.pointerLockElement !== null,
    mapOpen: window.__of.map().open,
    calls: window.__of.stats().draw.calls,
  }));
  // The BINDING TABLE's code, never a literal (GP-131): Playwright accepts
  // 'KeyM'-style codes directly.
  const mapCode = await page.evaluate(() => (window.__of.input.bindings().map || [])[0]);
  if (!mapCode) { throw new Error('no map binding published'); }
  const pressM = async () => {
    await page.keyboard.down(mapCode);
    await run(0.15);
    await page.keyboard.up(mapCode);
    await run(0.6);
  };
  await run(1.5);

  // 1. Buy the lock the way a player does: one real click on the canvas.
  await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    cv.addEventListener('pointerdown', () => { cv.requestPointerLock?.(); },
      { once: true, capture: true });
  });
  await page.mouse.click(800, 450);
  await run(0.5);
  const s0 = await state();
  check('FIXTURE: pointer locked, map shut (the cold playing state)',
    s0.locked === true && s0.mapOpen === false, JSON.stringify(s0));
  if (!s0.locked) {
    console.error('maplock: no lock granted (headless refusal?); rerun --headed');
  }
  const shotBefore = await page.screenshot();

  // 2. One real M from the locked state.
  await pressM();
  const s1 = await state();
  check('M OPENED the map from locked play', s1.mapOpen === true,
    JSON.stringify(s1));
  check('the map released the pointer (a panel owns it now)',
    s1.locked === false, `locked=${s1.locked}`);
  const shotAfter = await page.screenshot();
  const frac = await cropMoved(shotBefore, shotAfter);
  check('the map was PAINTED: centre crop moved > 25% against the play frame',
    frac > 0.25, `${(frac * 100).toFixed(1)}%`);
  check('while open, the picture is the map scene (draw calls collapsed)',
    s1.calls < s0.calls, `${s0.calls} -> ${s1.calls}`);

  // 3. One more real M: closed, and the pointer comes BACK (GP-162's seam).
  await pressM();
  await run(1.0);
  const s2 = await state();
  check('M CLOSED the map again', s2.mapOpen === false, JSON.stringify(s2));
  check('and the pointer RE-LOCKED on the way out', s2.locked === true,
    `locked=${s2.locked}`);
  check('the world render came back (draw calls restored)',
    s2.calls === s0.calls, `${s0.calls} -> ${s2.calls}`);

  const beforePath = args.get('before');
  const afterPath = args.get('after');
  if (beforePath) await (await import('node:fs/promises')).writeFile(beforePath, shotBefore);
  if (afterPath) await (await import('node:fs/promises')).writeFile(afterPath, shotAfter);

  check('no console errors across the whole run', errors.length === 0,
    JSON.stringify(errors.slice(0, 3)));
} finally {
  await browser.close();
}

if (fails.length > 0) {
  console.error(`maplock: FAIL\n${fails.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.error('maplock: PASS');
