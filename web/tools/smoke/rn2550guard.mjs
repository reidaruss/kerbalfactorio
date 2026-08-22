// RN-2550. RN-2275's SIGN TEST BECOMES A TWO-SIDED, LINEARIZED, COVERAGE-
// CORRECTED RATIO BAND, AND FOR THE FIRST TIME IT IS AN ASSERTION.
//
// THE FIRST THING TO KNOW, because it changes what this file is: BEFORE this
// script there was NO assertion of the wood-vs-clearing relation anywhere in
// the project. `rn2275sweep.mjs` PRINTS a signed difference and exits 0
// whatever it reads; `run.mjs`'s `smoke: PASS` means "no console errors, no
// failed requests" and is blind to the probe's content; none of the eight
// links in `npm run check` renders these poses; there is no CI. The guard has
// lived for its whole life as prose. That is NUMBERS.md's own "a probe that
// prints and never asserts passes forever", exactly, and it is why this file
// exits nonzero.
//
// ---------------------------------------------------------------------------
// 1. TWO RECTANGLES, TWO DIFFERENT JOBS, AND STAGE 1 GOT THIS WRONG
// ---------------------------------------------------------------------------
// The first version of this guard put the physical band on `box`. A
// fresh-context verifier showed that produced THREE WRONG HEADLINES, all of
// them artefacts of that rectangle: `artframe.js`'s own RN-2495 comment says
// `box` is "nearly blind to the cards" (at `box` the far treeline PAINT carries
// 1.86 of a 1.93-count canopy move and the CARDS carry 0.07). A band on a
// rectangle that cannot see the canopy is a band on the terrain paint.
//
//   `box`     the RATCHET only: regression protection and continuity with
//             RN-2275, which read this rectangle. No band, no physics claim.
//   `crowns`  the BAND and the CORE. This is the rectangle RN-2495 committed
//             precisely because a band rectangle cannot see crowns.
//
// ---------------------------------------------------------------------------
// 2. THE MEASUREMENT, defined so two implementations agree to the digit
// ---------------------------------------------------------------------------
// RECTANGLES. The shot's own committed rects, unchanged: `box` is
// [0.25, 0.45, 0.75, 0.75] (216,000 px at 1600x900) and `crowns` is
// [0.28125, 0.666667, 0.40625, 0.777778] (20,000 px). `?canopy=0` is the SAME
// rectangle in the SAME pose at the same range, sun, haze and lighting, so
// everything but the vegetation is common-mode by construction. Nothing is
// placed by eye. `flyover` gained `crowns` in this lane, verbatim from
// `forestair` (the two shots share every rectangle by design) and verified
// against a cards-only paint rather than assumed.
//
// PATCH MEAN. Per pixel, decode each 8-bit channel with the EXACT IEC
// 61966-2-1 inverse EOTF INCLUDING THE TOE (c/255 <= 0.04045 -> c/255/12.92,
// else ((c/255 + 0.055)/1.055)^2.4); form that pixel's linear luminance with
// the Rec.709 LINEAR-LIGHT weights 0.2126/0.7152/0.0722; then take the
// arithmetic mean over the rectangle. Implemented once, in
// `probes/artframe.js`'s `statOn`, published as `<rect>.lin.Y`.
//
// DECODE PER PIXEL, THEN AVERAGE -- NEVER AVERAGE, THEN DECODE. The decode is
// CONVEX, so by Jensen the mean of the decoded pixels is >= the decode of the
// mean, with the gap growing in the patch's own VARIANCE. The two arms do NOT
// have equal variance (`box` iqr 34.70 wood against 27.92 clearing at
// `forestairnoon`), so the Jensen gap does NOT cancel in the ratio; averaging
// first would systematically flatter the wood. Measured, averaging first costs
// up to 0.0285 while decoding the luma scalar instead of the channels costs
// under 0.0016.
//
// PER CHANNEL, NEVER ON THE LUMA SCALAR. Luminance is a linear functional of
// LINEAR radiance, so the decode belongs on R, G and B and the weights belong
// on the decoded values.
//
// WHAT THIS QUANTITY IS NOT: it is DISPLAY-LINEAR, not scene-linear. The frame
// is post-ACES and post-grade and only the display encode is undone.
//
// ---------------------------------------------------------------------------
// 3. THE THREE RATIOS, AND WHY THE BAND IS ON THE CORRECTED ONE
// ---------------------------------------------------------------------------
//   Rship  the shipped frame against `?canopy=0`.
//   Rsurf  the same with `?prophaze=0&terrainhaze=0` on BOTH arms, so the
//          additive aerial in-scatter is gone from both.
//   rho    Rsurf CORRECTED FOR CROWN COVERAGE, and this is what the optics
//          band is a band ON.
//
// WHY THE CORRECTION IS NOT OPTIONAL. A patch is a mixture: with crown coverage
// f and between-crown ground at `s` of the clearing,
//     Rsurf = f*rho + (1 - f)*s
// so raw Rsurf is bounded below by (1-f)*s no matter how dark the crowns are.
// Uncorrected, a perfectly black canopy still reads 1 - f, which is a statement
// about how many crowns are in the rectangle and not about their optics.
//
// rho IS TAKEN FROM ONE ARM, NOT FROM A SUBTRACTION, and that choice is forced
// by evidence rather than elegance. `?terrainpaint=1` renders the terrain
// EXACTLY black, so that arm's rect mean is f*Y_card with nothing else in it:
//     f   = 1 - blackFrac(cardsOnly)         a pixel count, exact
//     rho = Y(cardsOnly) / (f * Y(clearing)) one arm and the clearing
// The obvious alternative, rho = (Rsurf - G)/f with G = Y(cards black)/Y(clearing),
// needs `?proppaint=1` to actually black the cards, and IT DOES NOT (below). So
// the subtraction route is not used for rho; G is still measured and the
// mixture is CLOSED against it as a diagnostic, which is what quantifies the
// contamination instead of hiding it.
//
// Note this also DISSOLVES stage 1's "the ceiling is unreachable below f =
// 0.25" worry: that bound applies to raw Rsurf and not to rho. Small f still
// AMPLIFIES noise by 1/f, which is why f has a floor below.
//
// COVERAGE IS A PIXEL COUNT, NOT A RADIOMETRIC ESTIMATE, and the radiometric
// route provably does not work here. Stage 1 routed `f = 1 - Y(cards black) /
// Y(?canopy=0)`; run, it returns f = -0.0301 linear at `box` -- the cards-black
// arm is BRIGHTER than the no-canopy arm, violating the mixture law it assumes,
// because `?canopy=0` removes the far treeline PAINT as well as the cards.
// `?propspec=0` changes nothing. So coverage is measured instead by counting
// EXACTLY-BLACK pixels on a paint arm (the cards are alpha-tested, so there is
// no partial coverage to smear), which never touches `?canopy=0`:
//     cardsOnly   `?terrainpaint=1`  terrain exactly black  ->  f = 1 - blackFrac
//     cardsBlack  `?proppaint=1&propspec=0`  cards exactly black -> f = blackFrac
// TWO INDEPENDENT COUNTS OF THE SAME QUANTITY -- AND THEY DO NOT AGREE, WHICH
// IS A FINDING ABOUT `?proppaint=1` AND IS WHY rho DOES NOT USE IT.
//
// Run at `forestairnoon`, `?terrainpaint=1` counts f = 0.5160 and
// `?proppaint=1` counts f = 0.1948, a third of the rectangle apart, and the
// same gap appears at all four poses. Adding `?propspec=0` -- N7's 2.34.10 item
// 2 measured `totalSpecular` at 99.7 per cent of the card's own blue, and it is
// not multiplied by the albedo `?proppaint=1` zeroes -- was the obvious
// candidate and **it changed nothing** (0.2019 -> 0.1948). So `?proppaint=1`
// leaves a third radiance on the cards that neither the albedo nor the specular
// switch reaches, and the arm does not render them black.
//
// WHICH COUNT IS BELIEVED, AND WHY IT IS NOT A COIN FLIP. `?terrainpaint=1`'s
// count is corroborated by an INDEPENDENT offline decode of the same arm's PNG
// (raw chunk parse plus inflate, sharing no code with the probe or the canvas),
// which reproduces it on the same build. `?proppaint=1`'s is not corroborated
// by anything, and its error has a known DIRECTION: residual card radiance can
// only make fewer pixels exactly black, so it can only UNDER-count. That
// prediction is asserted below (fB must not exceed fA), so the diagnosis is
// itself under a live test rather than assumed.
//
// **THE COVERAGE USE OF THAT ARM IS REFUTED; ITS MEAN IS NOT.** The pixel
// count is a threshold at zero and collapses on one count of residual, so
// `?proppaint=1` cannot serve as a coverage instrument. The closure residual
// printed below came back POSITIVE and sub-count at all four poses, the
// opposite of the sign meaningful card contamination would produce, so N7's
// 2.34.4 mean-based split stands; the re-check is routed in 2.35.9.
//
// ---------------------------------------------------------------------------
// 4. THE ENDPOINTS, DERIVED (RN-345: a constant carries its reason)
// ---------------------------------------------------------------------------
// A closed canopy in the GREEN band runs 1.8x to 3.3x darker than green grass
// (conifer ~0.035 over grass ~0.12 = 0.29; deciduous ~0.07 over ~0.12 = 0.58),
// i.e. a GREEN-BAND reflectance band of 0.30 to 0.65. That is the range Admin
// named and it is CONFIRMED as a green-band REFLECTANCE band.
//
// IT IS NOT THIS GUARD'S QUANTITY, AND THE TRANSLATION IS THE DELIVERABLE.
// This guard measures linear LUMINANCE against a clearing that is the site's
// own bare SUBSTRATE, not green grass:
//  (i) A canopy is green-peaked and red/blue-suppressed, so against a
//      spectrally flat or red-RISING substrate (duff, soil) luminance shows
//      MORE darkening than the green band: 0.82x against brown soil, 0.81x
//      against dry litter. (Against GRASS it would be 1.05x and cancel, which
//      is exactly why the substrate matters.)
// (ii) The clearing is the LARGEST term in the problem. Swapping a duff/soil
//      clearing for the grass the optics reference can move the ratio 0.5x to
//      2.4x and the direction is genuinely ambiguous, which is why CLEARING_Y
//      is pinned and asserted rather than left implicit.
//
//   CORE  0.25 to 0.55  the green-band core through the 0.82x luminance shift.
//   BAND  0.18 to 0.75  the NECESSARY condition, substrate pinned to a mid-tone
//                       forest floor. Wider on purpose: a guard excludes the
//                       unphysical rather than certifying the physical.
//
// BOTH ARE JUDGED WHERE THEY WERE DERIVED. The optics are closed-canopy
// reflectances, so they belong on `rho` (the crown's own luminance against the
// clearing) and on nothing else. Applying them to `box`, or to an uncorrected
// patch ratio, is the "right number for the wrong quantity" error this lane was
// itself corrected for.
//
// ---------------------------------------------------------------------------
// 5. WHAT IT ASSERTS, and it cannot pass vacuously
// ---------------------------------------------------------------------------
//   HARD FAIL  `box` Rship or Rsurf above its recorded ceiling + TOL. The wood
//              got LIGHTER than the best this project has ever shipped. The
//              ceiling is a RATCHET: a lane that darkens the wood LOWERS the
//              constant in the same commit, and it may never be raised without
//              an Admin-logged decision.
//   HARD FAIL  `crowns` rho outside BAND at an end the pose is not already
//              recorded as violating, or an already-recorded violation getting
//              DEEPER. A standing violation may be repaid, never deepened.
//   HARD FAIL  a clearing pin moved (box or crowns). The ratio's denominator
//              changed, so the ratio changed subject.
//   HARD FAIL  the two coverage counts disagree, or f is below F_MIN.
//   HARD FAIL  the served entry chunk is not the one in `dist`, or `dist` is
//              older than anything that enters it (`src`, `wasm/dist`,
//              `index.html`). NOT a git-stamp check: see checkServedBuild.
//   HARD FAIL  any arm invalid, or an arming check failing.
//   SCORED     distance outside BAND and outside CORE, printed per pose.
//
//   node tools/smoke/rn2550guard.mjs --url=http://127.0.0.1:5550/
//   node tools/smoke/rn2550guard.mjs --url=http://127.0.0.1:5550/ --print=1
//   node tools/smoke/rn2550guard.mjs --url=http://127.0.0.1:5550/ \
//     --shots=forestairnoon --extra=crownshadefloor=0.30
//
// SIX arms per pose, a FRESH PROCESS each. Twenty-four browser runs for the
// full four-pose set, so budget roughly a quarter of an hour.
//
// TWO USAGE NITS, WRITTEN DOWN BECAUSE BOTH HAVE A SILENT FAILURE MODE.
// (1) EVERY FLAG HERE NEEDS AN `=`. The argv parser splits on the first `=`,
//     so a bare `--print` parses to the key `--prin` with the value `--print`
//     and is silently ignored: write `--print=1`. This is inherited from the
//     sibling sweep scripts and is kept identical to them on purpose.
// (2) `--shots=` NARROWS THE GUARD. A green run over one pose is not a green
//     guard; the full set is the four poses in BASE. Narrowing is for the
//     control arm and for debugging, and the summary line prints how many
//     poses were actually judged so a narrowed run cannot be quoted as a
//     complete one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

// Section 4. One definition, one place.
const BAND_LOW = 0.18;
const BAND_HIGH = 0.75;
const CORE_LOW = 0.25;
const CORE_HIGH = 0.55;
// A ratio tolerance of 0.005 is a fraction of a count of wood at these levels.
// The rects are bit-identical run to run (2.34.7 proved it across a full
// from-scratch rebuild), so the real scatter is ZERO and this is generous.
const TOL = 0.005;
// The clearing is the ratio's denominator, pinned at 1 per cent relative.
const CLEAR_TOL_REL = 0.01;
// The two independent coverage counts must agree this closely. They measure the
// same alpha-tested geometry two different ways, so a real disagreement means
// one of the paint arms is not painting what it claims.
const COV_TOL = 0.03;
// rho divides by f, so f amplifies noise by 1/f. Below this the correction is
// louder than the thing it corrects and the pose should not be judged.
const F_MIN = 0.10;

// THE BASELINE, MEASURED, NOT CHOSEN. Measured 2026-08-21 on
// `lane/n8-guardband`, one build, one session, server 127.0.0.1:5550
// --strictPort with its sentinel CONTENT verified over the wire, a fresh
// process per arm. A pose absent from this table is a FAIL, never a skip.
//
// THESE ARE POST-SHIP PINS. `lane/wg-ship` (WG-275 to WG-280, merged at
// 13029417) changed the planet height field, and it moved these poses: the
// `box` clearing went 0.163243 -> 0.189652 at `forestairnoon` (+16.2 per cent)
// and 0.317483 -> 0.288112 at `flyovernoon` (-9.3 per cent). Measured, not
// assumed -- the ship lane's own tables established `mtnslope` bit-identical
// and plains rects moved, and said nothing about forest or the spawn.
//
// FIVE OF THE EIGHT RATCHET CEILINGS ROSE ACROSS THAT MERGE AND ARE FLAGGED
// RATHER THAN QUIETLY RAISED. Against the pre-ship pins: `flyovernoon` boxShip
// 0.9248 -> 0.9343 and `flyoverlow` 0.9700 -> 0.9774 both clear the 0.005
// tolerance, and boxSurf rose at three poses (`forestairlow` 0.7968 -> 0.8928
// the largest). The cause is the ground moving under the ratio, not the canopy
// getting lighter, but the rule is that a re-pin may not raise a ceiling
// without a logged decision, so this is recorded in rendering.md 2.35.7 as a
// decision REQUEST and these values are provisional until it is answered.
//
// `rhoOut` marks a pose whose coverage-corrected crown ratio is ALREADY outside
// the band on the shipped frame. It is not an exemption: an out-of-band pose
// still fails if it moves FURTHER out, and a pose that is not marked here fails
// the moment it leaves the band at all.
const BASE = {
  forestairnoon: { boxShip: 0.9817, boxSurf: 0.9826, boxClearY: 0.189652,
    crownClearY: 0.103580, rho: 0.0992, rhoOut: 'low' },
  forestairlow: { boxShip: 0.9581, boxSurf: 0.8928, boxClearY: 0.106526,
    crownClearY: 0.058633, rho: 0.4363, rhoOut: null },
  flyovernoon: { boxShip: 0.9343, boxSurf: 0.9020, boxClearY: 0.288112,
    crownClearY: 0.148116, rho: 0.2488, rhoOut: null },
  flyoverlow: { boxShip: 0.9774, boxSurf: 0.8884, boxClearY: 0.147985,
    crownClearY: 0.078325, rho: 0.7021, rhoOut: null },
};

const OFF = ['--prophaze=0', '--terrainhaze=0'];
const ARMS = {
  clearing: ['--canopy=0'],
  wood: [],
  clearingSurf: ['--canopy=0', ...OFF],
  woodSurf: [...OFF],
  cardsOnly: ['--terrainpaint=1', ...OFF],
  // `--propspec=0` is load-bearing here, not belt and braces: see section 3.
  cardsBlack: ['--proppaint=1', '--propspec=0', ...OFF],
};

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5550/';
const shots = (argv.get('--shots') ?? Object.keys(BASE).join(',')).split(',');
const printOnly = argv.get('--print') === '1';
// THE NEGATIVE CONTROL, and it is why this flag exists rather than for tuning.
// A guard nobody has watched fail is indistinguishable from one that cannot.
// `--extra=crownshadefloor=0.30` is the setting 2.34.6 proved BREAKS the old
// sign test. Appended to ALL arms, which keeps them symmetric: on a `?canopy=0`
// arm a canopy setting is a no-op by construction, so only the wood can move.
const extra = (argv.get('--extra') ?? '').split(',').filter(Boolean)
  .map((s) => `--${s}`);
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' ? 'surface' : 'walk');

const fails = [];

// THE BUILD-STAMP FRESHNESS CHECK, made deliberate. Stage 1 discovered that the
// clearing pin had been catching stale servers by accident. This checks it on
// purpose, and it is a FRESHNESS check rather than a consistency one, which is
// NUMBERS' `abi=N` scar: the sentinel proves the server serves THIS dist, and
// this proves that dist was built from THIS working tree. `vite.config.ts`
// compiles `__OF_BUILD__` from the short sha plus `+dirty`, so recomputing it
// here and finding it in the served entry chunk closes the loop.
async function checkServedBuild() {
  const DIST = path.join(HERE, '..', '..', 'dist');
  let entry;
  try {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const m = html.match(/src="([^"]*index[^"]*\.js)"/);
    if (!m) throw new Error('no entry chunk in dist/index.html');
    entry = m[1].replace(/^\//, '');
  } catch (e) {
    fails.push(`cannot read the local dist to check the served build: ${e.message}`);
    return;
  }
  const h = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
  // 1. THE SERVER SERVES *THIS* DIST. Stronger than the sentinel, which only
  // proves some file of ours is reachable: this compares the ENTRY CHUNK the
  // browser will actually execute, byte for byte, against the one on disk.
  try {
    const local = fs.readFileSync(path.join(DIST, entry));
    const served = Buffer.from(await (await fetch(new URL(entry, url))).arrayBuffer());
    if (h(local) !== h(served)) {
      fails.push(`the SERVED entry chunk (${h(served)}) is not the one in dist`
        + ` (${h(local)}). The server is serving a different build.`);
      return;
    }
  } catch (e) {
    fails.push(`cannot fetch the served entry chunk: ${e.message}`); return;
  }
  // 2. THAT DIST IS NOT STALE AGAINST THE SOURCES THAT GO INTO IT. Only sources
  // that ENTER THE BUNDLE count. Checking the git stamp instead was the first
  // design and it was wrong in a way this project has now catalogued twice: the
  // stamp goes `+dirty` for ANY tracked edit under `web/`, so editing a probe --
  // which is read from disk at run time and never bundled -- failed the check
  // while the bundle was byte-identical. Compare mtimes against the artefact.
  const newest = (dir) => {
    let t = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
    }
    return t;
  };
  const built = fs.statSync(path.join(DIST, entry)).mtimeMs;
  for (const rel of ['src', 'wasm/dist', 'index.html']) {
    const p = path.join(HERE, '..', '..', rel);
    if (!fs.existsSync(p)) continue;
    const t = fs.statSync(p).isDirectory() ? newest(p) : fs.statSync(p).mtimeMs;
    if (t > built) {
      fails.push(`web/${rel} is NEWER than the built bundle`
        + ` (${new Date(t).toISOString()} against ${new Date(built).toISOString()}).`
        + ` Something that enters the bundle changed and was not rebuilt, so these`
        + ` numbers would describe the previous build. Re-run the build.`);
      return;
    }
  }
  console.log(`build: served entry chunk matches dist (${h(fs.readFileSync(
    path.join(DIST, entry)))}) and dist is newer than src, wasm and index.html`);
}

function once(shot, flags) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, ...flags];
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    // KEEP THE STDERR. The sibling sweeps do, and a bare "no json" on a runner
    // that died in the browser is a diagnosis nobody can start from.
    return { valid: false, why: `no json (exit ${r.status})`,
      stderr: (r.stderr ?? '').slice(-400) };
  }
}

await checkServedBuild();

const rows = [];
for (const shot of shots) {
  const e = {};
  for (const [name, flags] of Object.entries(ARMS)) e[name] = once(shot, [...flags, ...extra]);
  const rect = (v, k) => (k === 'box' ? v.box : (v.extra ?? {}).crowns);
  const bad = Object.entries(e).filter(([, v]) => !v.valid || !rect(v, 'box')
    || !rect(v, 'crowns') || !(rect(v, 'box').lin?.Y > 0));
  if (bad.length > 0) {
    fails.push(`${shot}: arm(s) ${bad.map(([k, v]) => `${k} (${v.why ?? 'no rect'}`
      + `${v.stderr ? '; ' + v.stderr.split('\n').pop() : ''})`).join(', ')}`
      + ` did not produce both rectangles with a linear patch mean`);
    continue;
  }
  const B = (k) => e[k].box.lin.Y;
  const C = (k) => e[k].extra.crowns.lin.Y;
  const tri = (k) => (e[k].render ? e[k].render.triangles : 0);

  // ARMING 1: `?canopy=0` must actually delete geometry.
  if (!(tri('wood') > tri('clearing'))) {
    fails.push(`${shot}: NOT ARMED -- ?canopy=0 did not reduce the triangle count`
      + ` (wood ${tri('wood')} vs clearing ${tri('clearing')}), so both arms are the`
      + ` same frame and every ratio is a tautology`);
    continue;
  }
  // ARMING 2: the haze arms must actually remove the aerial term.
  if (!(C('clearingSurf') < C('clearing'))) {
    fails.push(`${shot}: NOT ARMED -- the haze-off arms did not darken the crowns`
      + ` clearing (${C('clearingSurf')} vs ${C('clearing')})`);
    continue;
  }
  // ARMING 3: "black means painted" has to be true before a black-pixel count
  // is a coverage. A NORMAL frame must contain essentially no exactly-black
  // pixels; if it does, the inference is broken and every f below is noise.
  const bClear = e.clearingSurf.extra.crowns.blackFrac;
  if (bClear > 0.01) {
    fails.push(`${shot}: NOT ARMED -- the un-painted clearing arm is already`
      + ` ${(bClear * 100).toFixed(2)} per cent exactly-black pixels, so "black means`
      + ` painted" is false here and the coverage counts mean nothing.`);
    continue;
  }
  const fA = 1 - e.cardsOnly.extra.crowns.blackFrac;
  const fB = e.cardsBlack.extra.crowns.blackFrac;
  // f COMES FROM THE `?terrainpaint=1` COUNT ALONE. Section 3 states the
  // evidence: `?proppaint=1` does not black the cards, so its count is a floor
  // rather than a measurement. Its own error direction is asserted instead.
  const f = fA;
  if (fB > fA + COV_TOL) {
    fails.push(`${shot}: ?proppaint=1 counts MORE coverage (${fB.toFixed(4)}) than`
      + ` ?terrainpaint=1 (${fA.toFixed(4)}). Section 3's diagnosis says residual card`
      + ` radiance can only make it UNDER-count, so this contradicts it and the`
      + ` coverage story has to be re-derived before rho can be trusted.`);
    continue;
  }
  if (!(f >= F_MIN)) {
    fails.push(`${shot}: crown coverage f = ${f.toFixed(4)} is below F_MIN ${F_MIN}.`
      + ` rho divides by f, so the correction would amplify noise by ${(1 / f).toFixed(1)}x`
      + ` and the pose cannot be judged on this rectangle.`);
    continue;
  }

  const boxShip = B('wood') / B('clearing');
  const boxSurf = B('woodSurf') / B('clearingSurf');
  const crownShip = C('wood') / C('clearing');
  const crownSurf = C('woodSurf') / C('clearingSurf');
  const G = C('cardsBlack') / C('clearingSurf');
  // rho FROM THE ONE CLEAN ARM: `?terrainpaint=1` leaves f*Y_card and nothing
  // else, so dividing by f and the clearing gives the crown's own ratio.
  const rho = C('cardsOnly') / (f * C('clearingSurf'));
  // THE MIXTURE, CLOSED AGAINST THE OTHER ARM AS A DIAGNOSTIC. Rsurf should be
  // f*rho + G. It will not close while `?proppaint=1` leaves card radiance in
  // G, and the residual is the size of that contamination, printed rather than
  // assumed. Measured: POSITIVE and sub-count at all four poses (a NEGATIVE
  // residual, the sign card contamination would produce, did not appear).
  const closure = crownSurf - (f * rho + G);
  const a = (crownShip - crownSurf) / (1 - crownSurf);
  rows.push({ shot, boxShip, boxSurf, crownShip, crownSurf, G, f, fA, fB, rho, a,
    closure, boxClearY: B('clearing'), crownClearY: C('clearing') });

  const b = BASE[shot];
  if (!b || b.boxSurf === null) {
    fails.push(`${shot}: NO BASELINE. Paste into BASE: { boxShip: ${boxShip.toFixed(4)},`
      + ` boxSurf: ${boxSurf.toFixed(4)}, boxClearY: ${B('clearing').toFixed(6)},`
      + ` crownClearY: ${C('clearing').toFixed(6)}, rho: ${rho.toFixed(4)},`
      + ` rhoOut: ${rho < BAND_LOW ? "'low'" : (rho > BAND_HIGH ? "'high'" : 'null')} }`);
    continue;
  }
  if (boxShip > b.boxShip + TOL) {
    fails.push(`${shot}: box Rship ${boxShip.toFixed(4)} is ABOVE its ratchet ceiling`
      + ` ${b.boxShip.toFixed(4)} + ${TOL}. The wood got LIGHTER than the shipped frame.`);
  }
  if (boxSurf > b.boxSurf + TOL) {
    fails.push(`${shot}: box Rsurf ${boxSurf.toFixed(4)} is ABOVE its ratchet ceiling`
      + ` ${b.boxSurf.toFixed(4)} + ${TOL}. The wood got LIGHTER on the surface arm.`);
  }
  // THE BAND, WITH THE ONE KNOWN-OUT POSE HELD TO A RATCHET INSTEAD OF WAVED
  // THROUGH. A pose not marked `rhoOut` fails the moment it leaves the band. A
  // pose that is already out fails if it moves FURTHER out, so the standing
  // violation is pinned at its current depth and can only be repaid.
  const side = rho < BAND_LOW ? 'low' : (rho > BAND_HIGH ? 'high' : null);
  if (side && side !== b.rhoOut) {
    fails.push(`${shot}: crowns rho ${rho.toFixed(4)} is OUTSIDE the band`
      + ` ${BAND_LOW}..${BAND_HIGH} at the ${side} end, and this pose is not`
      + ` recorded as a standing violation. ${side === 'high'
        ? 'The crowns are lighter than any defensible canopy over this clearing.'
        : 'The crowns are darker than any defensible canopy over this clearing.'}`);
  } else if (side && side === b.rhoOut) {
    const worse = side === 'low' ? rho < b.rho - TOL : rho > b.rho + TOL;
    if (worse) {
      fails.push(`${shot}: crowns rho ${rho.toFixed(4)} has moved FURTHER outside the`
        + ` band than its recorded ${b.rho.toFixed(4)} (${side} end). A standing`
        + ` violation may be repaid, never deepened.`);
    }
  } else if (b.rhoOut) {
    console.log(`  note: ${shot} rho ${rho.toFixed(4)} is now INSIDE the band and is`
      + ` still marked rhoOut '${b.rhoOut}'. Clear the marking and re-pin.`);
  }
  for (const [what, got, pin] of [['box', B('clearing'), b.boxClearY],
    ['crowns', C('clearing'), b.crownClearY]]) {
    const d = Math.abs(got - pin) / pin;
    if (d > CLEAR_TOL_REL) {
      fails.push(`${shot}: the ${what} CLEARING moved, ${got.toFixed(6)} against a pin of`
        + ` ${pin.toFixed(6)} (${(d * 100).toFixed(2)} per cent). The ratio's denominator`
        + ` changed, so the ratio changed subject and its band no longer means what was`
        + ` derived for it. Re-derive or re-pin with a logged decision.`);
    }
  }
}

const f4 = (x) => x.toFixed(4).padStart(7);
console.log('\n--- RN-2550 WOOD/CLEARING RATIO BAND (linear-light Y) ---');
console.log(`BAND (fail outside) ${BAND_LOW} .. ${BAND_HIGH}`
  + `    CORE (target) ${CORE_LOW} .. ${CORE_HIGH}    both on crowns rho`);
if (extra.length > 0) {
  console.log(`NOT THE SHIPPED FRAME: every arm carries ${extra.join(' ')}.`
    + ` The baselines are the SHIPPED ones, so this is a control run.`);
}
console.log('\npose            boxShip  boxSurf | crShip  crSurf       G       f'
  + '     rho  airlt   verdict');
for (const r of rows) {
  const inBand = r.rho >= BAND_LOW && r.rho <= BAND_HIGH;
  const inCore = r.rho >= CORE_LOW && r.rho <= CORE_HIGH;
  // The CORE distance is printed whenever it is not zero, so "IN BAND" can
  // never read as "on target". Stage 1 claimed to score this and did not.
  const dCore = r.rho < CORE_LOW ? r.rho - CORE_LOW
    : (r.rho > CORE_HIGH ? r.rho - CORE_HIGH : 0);
  const where = inCore ? 'IN CORE'
    : (inBand ? `IN BAND, ${dCore > 0 ? '+' : ''}${dCore.toFixed(4)} from CORE`
      : `OUT OF BAND by ${(r.rho > BAND_HIGH ? r.rho - BAND_HIGH
        : r.rho - BAND_LOW).toFixed(4)}`);
  console.log(`${r.shot.padEnd(14)} ${f4(r.boxShip)} ${f4(r.boxSurf)} |`
    + `${f4(r.crownShip)} ${f4(r.crownSurf)} ${f4(r.G)} ${f4(r.f)} ${f4(r.rho)}`
    + ` ${f4(r.a)}   ${where}`);
}
console.log('\ncoverage, and the `?proppaint=1` arm does NOT black the cards (section 3):');
for (const r of rows) {
  console.log(`  ${r.shot.padEnd(14)} f from ?terrainpaint=1 -> ${r.fA.toFixed(4)} USED`
    + `   ?proppaint=1 floor -> ${r.fB.toFixed(4)}   under-count`
    + ` ${(r.fA - r.fB).toFixed(4)}   mixture closure ${r.closure >= 0 ? '+' : ''}`
    + `${r.closure.toFixed(4)}`);
}

if (printOnly) {
  // A reporting mode that swallows the failures it collected is the same defect
  // as a probe that never asserts; the arming and baseline messages above all
  // are what a bootstrap run needs.
  for (const m of fails) console.error(`rn2550guard: (print) would FAIL ${m}`);
  console.log(`\nrn2550guard: PRINT ONLY, nothing asserted (--print=1),`
    + ` ${fails.length} problem(s) listed above.`);
  process.exit(0);
}
if (rows.length !== shots.length) {
  fails.push(`only ${rows.length} of ${shots.length} poses produced a verdict`);
}
if (fails.length > 0) {
  for (const m of fails) console.error(`rn2550guard: FAIL ${m}`);
  console.error(`rn2550guard: FAIL (${fails.length} problem(s))`);
  process.exit(1);
}
const outCore = rows.filter((r) => r.rho < CORE_LOW || r.rho > CORE_HIGH);
console.log(`\nrn2550guard: PASS (${rows.length} of ${Object.keys(BASE).length} poses`
  + ` judged, ${outCore.length} outside CORE)`);
process.exit(0);
