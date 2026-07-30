// Numeric frame diff restricted to a BOX: for a subject that occupies a
// known screen region while the rest of the frame legitimately moves.
//
// RN-125 built this because three whole-frame instruments in a row failed
// on the engine plume: a burn pair moves half the frame on ground scroll,
// and pngdiff.mjs's region crop only trims edges, so a centred subject
// cannot be isolated. This is the water lane's tile-size lesson in another
// shape: the REGION is part of the instrument. Same decode-in-Chrome trick
// as pngdiff.mjs (this repo has no node PNG decoder; playwright-core is
// already a dependency), same split-is-the-property output.
//
// Run it FROM web/ so playwright-core resolves:
//   node tools/smoke/boxdiff.mjs a.png b.png x0 y0 x1 y1 [thresh]
// Box is pixel coords, origin top-left, x1/y1 exclusive. Always publish a
// CONTROL box beside the subject box (RN-125 used the vessel hull), or the
// number cannot tell subject motion from camera motion.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [a, b, x0, y0, x1, y1, thresh = '6'] = process.argv.slice(2);
if (!y1) { console.error('usage: boxdiff a b x0 y0 x1 y1 [thresh]'); process.exit(2); }
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CANDIDATES.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const du = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const out = await page.evaluate(async ({ ua, ub, box, th }) => {
  const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
  const [ia, ib] = await Promise.all([load(ua), load(ub)]);
  const c = document.createElement('canvas');
  c.width = ia.width; c.height = ia.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(ia, 0, 0);
  const da = g.getImageData(0, 0, c.width, c.height).data;
  g.drawImage(ib, 0, 0);
  const db = g.getImageData(0, 0, c.width, c.height).data;
  let moved = 0, darker = 0, lighter = 0, max = 0, total = 0, sum = 0;
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const i = (y * c.width + x) * 4;
      const la = da[i] * 0.299 + da[i + 1] * 0.587 + da[i + 2] * 0.114;
      const lb = db[i] * 0.299 + db[i + 1] * 0.587 + db[i + 2] * 0.114;
      const d = Math.abs(la - lb);
      total++;
      if (d > max) max = d;
      if (d > th) { moved++; sum += d; if (lb > la) lighter++; else darker++; }
    }
  }
  return { total, moved, pct: +(100 * moved / total).toFixed(2), darker, lighter,
    maxDelta: +max.toFixed(1), meanDelta: moved ? +(sum / moved).toFixed(2) : 0 };
}, { ua: du(a), ub: du(b), box: [+x0, +y0, +x1, +y1], th: +thresh });
console.log(JSON.stringify(out));
await browser.close();
