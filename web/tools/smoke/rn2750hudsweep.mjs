// RN-2750. ONE PAGE, ONE POSE, ONE HUD TOGGLE: shipped vs `hideHud`, for the
// HUD-overlap sweep.
//
// TWO EARLIER DESIGNS, BOTH MEASURED WRONG AND BOTH RECORDED SO A LATER LANE
// DOES NOT RETRY THEM.
//
//   1. Two `run.mjs --out` invocations piped into `rn2750rectdiff.mjs`: two
//      SEPARATE page loads. `vista.skyL` (nowhere near the debug HUD's own
//      footprint) read 55.9 per cent of its pixels moved, max delta 152 --
//      a moved cloud, not a hidden UI node. This project's own established
//      trap (`artframe.js`'s RN-1990 comment on `vmArms`: "before/after taken
//      across two page loads differs by the whole scene build, the wind
//      clock and the IBL counter") is exactly what that 55.9 per cent was.
//   2. One page, but re-running `artframe.js`'s own eval body TWICE (once
//      plain, once with `{"hideHud":true}`) for the two arms: still ONE
//      page, but each run re-teleports, re-pins the sun and runs its own
//      `settle(24)`, so the two screenshots are still SECONDS apart in the
//      SAME wall clock the sky animates on. `vista.skyL` still read 57.9 per
//      cent, materially unchanged from design 1 -- the page-load boundary
//      was never the confound, the WALL-CLOCK GAP between the two captures
//      was, and design 2 has almost as much of one as design 1 did.
//
// So the pose is set up ONCE (one call into `artframe.js`, one `settle`, one
// screenshot), and the SECOND arm hides the DOM overlay DIRECTLY -- the same
// `HUD_IDS` list `artframe.js`'s own `hideHud` branch hides, duplicated here
// deliberately rather than imported (this file has no module boundary to
// import across) -- with NO re-teleport and the smallest settle that lets the
// compositor catch up (`min(settle, 4)` frames against the shipped arm's
// full `settle` window). The gap between the two screenshots is now on the
// order of a few frames, not a full re-pose, so the only thing left that CAN
// move is what hiding those nodes removes.
//
// Usage:
//   node tools/smoke/rn2750hudsweep.mjs --url=http://127.0.0.1:PORT/ \
//     --shot=vista --scenario=walk [--sandbox=1] --width=1600 --height=900 \
//     --rect=hzBand:80,414,400,504 --rect=box:400,414,1200,540 [...] \
//     [--thresh=6] [--savepng=../docs/screenshots/RN2750_vista]
//
// Prints one JSON object with both arms' own `valid`/`why` (a `false` on
// either one refuses the whole reading rather than silently comparing a
// broken frame against a good one) and, when both are valid, per-rect
// {moved, pct, rowsHit, rowsTotal, clean, maxDelta}. `--savepng=prefix`
// additionally writes `prefix_shipped.png` and `prefix_hidehud.png` so a
// flagged pose leaves a crop-able record.
//
// `--nullcheck=1` is the REQUIRED companion run for any DIRTY verdict: same
// pose, same settle window, but the second arm hides NOTHING -- it only
// waits. A rect whose null already reads close to its hide-arm `moved` count
// is reading ANIMATION (water, wind, belts, embers), not an overlay node.
// `pondside.box` is the reason this flag exists: 83.66 per cent moved with
// the hide, 83.56 per cent moved with a null that hid nothing at all.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = new Map();
const rectArgs = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--rect=')) { rectArgs.push(a.slice(7)); continue; }
  const i = a.indexOf('=');
  argv.set(a.slice(0, i), i === -1 ? '1' : a.slice(i + 1));
}
const url = argv.get('--url');
const shot = argv.get('--shot');
const scenario = argv.get('--scenario') ?? 'walk';
const sandbox = argv.get('--sandbox') === '1';
const width = Number(argv.get('--width') ?? 1600);
const height = Number(argv.get('--height') ?? 900);
const thresh = Number(argv.get('--thresh') ?? 6);
const settleN = Number(argv.get('--settle') ?? 24);
const savePrefix = argv.get('--savepng');
if (!url || !shot || rectArgs.length === 0) {
  console.error('usage: --url= --shot= --rect=name:x0,y0,x1,y1 [--rect=... ] '
    + '[--scenario=walk] [--sandbox=1] [--width=1600] [--height=900] [--thresh=6] '
    + '[--savepng=prefix]');
  process.exit(2);
}
const boxes = rectArgs.map((s) => {
  const m = /^([^:]+):(\d+),(\d+),(\d+),(\d+)$/.exec(s);
  if (!m) { console.error(`bad --rect '${s}', want name:x0,y0,x1,y1`); process.exit(2); }
  return { name: m[1], box: [+m[2], +m[3], +m[4], +m[5]] };
});

// SAME probe file `run.mjs` uses, wrapped the SAME way (`((OF_ARGS) => (...
// ))(args)`), so a shot photographed here is the shot `artframe.js` defines
// and not a re-typed copy of it.
const probeSrc = readFileSync(path.resolve(HERE, 'probes', 'artframe.js'), 'utf8');
const evalStr = (args) => `((OF_ARGS) => (\n${probeSrc}\n))(${JSON.stringify(args)})`;

const params = new URLSearchParams();
params.set('scenario', scenario);
if (sandbox) params.set('sandbox', '1');
params.set('debug', '1');
const pageUrl = `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;

// SAME Chrome candidates and launch args as `run.mjs`, so a frame taken here
// is taken on the same renderer path (SwiftShader/ANGLE) this project already
// judges every other art frame on.
const CHROME_CANDIDATES = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];
const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) { console.error('rn2750hudsweep: no Chrome or Edge found'); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=default', '--enable-unsafe-swiftshader',
    '--disable-frame-rate-limit', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

let out;
try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);

  // ONE POSE, POSED ONCE. Re-running `artframe.js`'s own eval body a SECOND
  // time for the `hideHud` arm was this driver's actual first draft, and it is
  // WRONG, measured: `vista.skyL` (nowhere near any HUD node) still read 57.9
  // per cent moved, max delta 152 -- a moving sky, not a hidden UI node, and
  // the wall-clock gap between the two full probe runs (each its own
  // teleport + sun re-pin + `settle(24)`) is exactly what RN-1990's own
  // comment names ("the wind clock and the IBL counter"). So the pose is set
  // up ONCE, and the SECOND arm hides the DOM overlay directly (the same
  // `HUD_IDS` list `artframe.js`'s own `hideHud` branch hides, duplicated
  // here deliberately rather than imported, because this file has no module
  // boundary to import across) with no re-teleport and the smallest settle
  // that lets the compositor catch up, so the only thing that can move
  // between the two screenshots is what hiding those nodes removes.
  const HUD_IDS = ['of-hud', 'of-cross', 'of-carry', 'of-toast', 'of-gain',
    'of-banner', 'of-prompt', 'of-health', 'of-mode', 'of-goals', 'of-hotbar',
    'of-compass', 'of-navball'];

  const evalResult = await page.evaluate(evalStr({ shot }));
  await page.evaluate((n) => window.__of.settle(n), settleN);
  const shipped = { evalResult, buf: await page.screenshot() };

  // RN-2750 CORRECTION. `--nullcheck` skips the hide entirely and just waits
  // the SAME extra settle window before the second screenshot, because the
  // first full sweep published a false positive: `pondside.box` read 83.66
  // per cent moved WITH the hide and 83.56 per cent moved WITHOUT it (a
  // separately-run null, same gap) -- water ripple, not HUD, and the hide
  // measurement alone could not tell the two apart. Every DIRTY rect this
  // tool reports must be re-run with `--nullcheck` before it is trusted; a
  // rect whose null already accounts for most of its `moved` count is
  // ANIMATION, not overlay.
  const nullcheck = argv.get('--nullcheck') === '1';
  let hidehud;
  if (nullcheck) {
    await page.evaluate((n) => window.__of.settle(n), Math.min(settleN, 4));
    hidehud = { evalResult: { valid: true, why: evalResult?.why ?? null, hudHidden: 'NULLCHECK: nothing hidden' },
      buf: await page.screenshot() };
  } else {
    const hideResult = await page.evaluate((ids) => {
      const found = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el === null) continue;
        el.style.setProperty('display', 'none', 'important');
        found.push(id);
      }
      const stillVisible = found.filter((id) => (
        getComputedStyle(document.getElementById(id)).display !== 'none'));
      return { found, stillVisible };
    }, HUD_IDS);
    await page.evaluate((n) => window.__of.settle(n), Math.min(settleN, 4));
    hidehud = {
      evalResult: {
        valid: hideResult.stillVisible.length === 0,
        why: hideResult.stillVisible.length === 0
          ? evalResult?.why ?? null
          : `hideHud did not take for: ${hideResult.stillVisible.join(', ')}`,
        hudHidden: hideResult.found,
      },
      buf: await page.screenshot(),
    };
  }

  if (savePrefix) {
    writeFileSync(`${savePrefix}_shipped.png`, shipped.buf);
    writeFileSync(`${savePrefix}_hidehud.png`, hidehud.buf);
  }

  out = {
    shot,
    shippedValid: shipped.evalResult?.valid ?? null,
    shippedWhy: shipped.evalResult?.why ?? null,
    hidehudValid: hidehud.evalResult?.valid ?? null,
    hidehudWhy: hidehud.evalResult?.why ?? null,
    hudHidden: hidehud.evalResult?.hudHidden ?? null,
  };

  if (shipped.evalResult?.valid !== true || hidehud.evalResult?.valid !== true) {
    out.refused = 'one or both arms were not valid; no rect was diffed against a '
      + 'broken frame';
  } else {
    // Decode-in-page and diff, same convention as pngdiff.mjs/boxstat.mjs.
    const toDataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
    out.boxes = await page.evaluate(async ([ua, ub, bs, t]) => {
      const load = (u) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = u;
      });
      const [A, B] = await Promise.all([load(ua), load(ub)]);
      const grab = (im) => {
        const c = document.createElement('canvas');
        c.width = im.width; c.height = im.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, im.width, im.height).data;
      };
      const da = grab(A), db = grab(B);
      const rows = {};
      for (const { name, box } of bs) {
        const [x0, y0, x1, y1] = box;
        if (x0 < 0 || y0 < 0 || x1 > A.width || y1 > A.height || x1 <= x0 || y1 <= y0) {
          rows[name] = { fail: `box ${box} is outside the ${A.width}x${A.height} frame` };
          continue;
        }
        let total = 0, moved = 0, max = 0;
        const rowsHit = new Set();
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * A.width + x) * 4;
            const d0 = db[i] - da[i], d1 = db[i + 1] - da[i + 1], d2 = db[i + 2] - da[i + 2];
            const m = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
            total++;
            if (m > max) max = m;
            if (m > t) { moved++; rowsHit.add(y - y0); }
          }
        }
        rows[name] = { box, total, moved, pct: +(100 * moved / total).toFixed(3),
          maxDelta: max, rowsHit: rowsHit.size, rowsTotal: y1 - y0, clean: moved === 0 };
      }
      return rows;
    }, [toDataUrl(shipped.buf), toDataUrl(hidehud.buf), boxes, thresh]);
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
