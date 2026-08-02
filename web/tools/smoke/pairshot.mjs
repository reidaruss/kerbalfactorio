// Two frames side by side in ONE file, with the labels and the question burned
// into the image.
//
//   node tools/smoke/pairshot.mjs out.png "LEFT LABEL" left.png \
//     "RIGHT LABEL" right.png "what to look for"
//
// WHY THIS EXISTS. A matched pair is two files, and two files is two looks: the
// viewer flicks between them, loses the fixation point, and ends up comparing
// their memory of one against their view of the other. That is the worst way to
// judge a small difference and it is exactly the judgement these pairs are for.
// Side by side at the same scale with a shared caption is one look.
//
// THE CAPTION IS PART OF THE INSTRUMENT, not decoration. A pair handed over
// without a stated question gets answered with "they look the same to me",
// which is not the same finding as "the contact seam is unchanged". Naming what
// to look at is what makes a null result mean something.
//
// Same decode-in-Chrome trick as pngdiff.mjs and boxdiff.mjs: this repo has no
// node PNG codec and playwright-core is already a dependency. Run it FROM web/.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const [out, labelA, fileA, labelB, fileB, caption = ''] = process.argv.slice(2);
if (!fileB) {
  console.error('usage: pairshot out.png "LEFT" a.png "RIGHT" b.png ["caption"]');
  process.exit(2);
}
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CANDIDATES.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const du = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const b64 = await page.evaluate(async ({ ua, ub, la, lb, cap }) => {
  const load = (u) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
  });
  const [ia, ib] = await Promise.all([load(ua), load(ub)]);
  // Half scale, so a 1600 x 900 pair fits a laptop screen without the viewer
  // panning. A difference that survives a 2x downsample is a difference that
  // survives being looked at; one that does not was never going to be seen.
  const w = Math.round(ia.width / 2), h = Math.round(ia.height / 2);
  const BAR = 34, CAP = cap ? 64 : 0, GAP = 8;
  const c = document.createElement('canvas');
  c.width = w * 2 + GAP;
  c.height = BAR + h + CAP;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(ia, 0, BAR, w, h);
  g.drawImage(ib, w + GAP, BAR, w, h);
  g.font = '600 19px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillStyle = '#f0f0f0';
  g.fillText(la, 10, BAR / 2);
  g.fillText(lb, w + GAP + 10, BAR / 2);
  if (cap) {
    g.font = '15px system-ui, sans-serif';
    g.fillStyle = '#cfcfcf';
    // Wrap by hand: canvas has no text box, and a caption that runs off the
    // right edge is a caption nobody reads.
    const words = cap.split(' ');
    let line = '', y = BAR + h + 20;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > c.width - 24) {
        g.fillText(line, 12, y); y += 20; line = word;
      } else line = next;
    }
    if (line) g.fillText(line, 12, y);
  }
  return c.toDataURL('image/png').split(',')[1];
}, { ua: du(fileA), ub: du(fileB), la: labelA, lb: labelB, cap: caption });

writeFileSync(out, Buffer.from(b64, 'base64'));
await browser.close();
console.log(`${out}  (${labelA} | ${labelB})`);
