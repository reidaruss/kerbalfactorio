// RN-2550. RN-2275's SIGN TEST BECOMES A TWO-SIDED, LINEARIZED RATIO BAND,
// AND FOR THE FIRST TIME IT IS AN ASSERTION.
//
// THE FIRST THING TO KNOW, because it changes what this file is: BEFORE this
// script there was NO assertion of the wood-vs-clearing relation anywhere in
// the project. `rn2275sweep.mjs` PRINTS a signed difference and exits 0
// whatever it reads; `run.mjs`'s own `smoke: PASS` means "no console errors,
// no failed requests" and is blind to the probe's content; none of the eight
// links in `npm run check` renders these poses; there is no CI. The guard has
// lived for its whole life as prose in `CanopySelfShadow.ts`'s K table, in
// `rendering.md` 2.19.4 and in WORLD-AUDIT-R2 section 3.10. That is
// NUMBERS.md's own "a probe that prints and never asserts passes forever",
// exactly, and it is why this file exits nonzero.
//
// ---------------------------------------------------------------------------
// 1. THE MEASUREMENT, defined so two implementations agree to the digit
// ---------------------------------------------------------------------------
// RECTANGLE. The committed `box` rect of the shot's own manifest row, which for
// all four guard poses is [0.2500, 0.4500, 0.7500, 0.7500] of the frame and at
// the canonical 1600x900 is x 400..1200, y 405..675, 216,000 px. Nothing is
// placed by eye and no rect is added: `?canopy=0` is the SAME rectangle in the
// SAME pose at the SAME range, sun, haze and lighting, so everything but the
// vegetation is common-mode by construction (2.19.4).
//
// PATCH MEAN. Per pixel, decode each 8-bit channel with the EXACT IEC
// 61966-2-1 inverse EOTF INCLUDING THE TOE (c/255 <= 0.04045 -> c/255/12.92,
// else ((c/255 + 0.055)/1.055)^2.4); form that pixel's linear luminance with
// the Rec.709 LINEAR-LIGHT weights 0.2126/0.7152/0.0722; then take the
// arithmetic mean over the rectangle. Implemented once, in
// `probes/artframe.js`'s `statOn`, published as `box.lin.Y`.
//
// DECODE PER PIXEL, THEN AVERAGE -- NEVER AVERAGE, THEN DECODE, and the
// difference is not academic. The decode is CONVEX, so by Jensen the mean of
// the decoded pixels is >= the decode of the mean, with the gap growing in the
// patch's own VARIANCE. The two arms do NOT have equal variance: on this build
// `box` iqr reads 34.70 on the wood against 27.92 on the clearing at
// `forestairnoon`, and 61.83 against 51.93 at `flyovernoon`. So the Jensen gap
// is LARGER on the wood arm and does NOT cancel in the ratio; averaging first
// would systematically understate the wood and flatter the guard. Averaging
// first is also simply not the mean radiance of the patch.
//
// PER CHANNEL, NEVER ON THE LUMA SCALAR. Luminance is a linear functional of
// LINEAR radiance, so the decode belongs on R, G and B and the weights belong
// on the decoded values. Decoding the 8-bit luma scalar applies a channel EOTF
// to an already-mixed quantity and is not a radiometric number at all.
//
// THE RATIO. R = Y(wood) / Y(clearing), one pose, one rectangle, one build,
// one session, a fresh process per call site.
//
// WHAT THIS QUANTITY IS NOT, stated because 2.34.10 item 1 was corrected once
// already for sliding between two measurements: it is DISPLAY-LINEAR, not
// scene-linear. The frame is post-ACES and post-grade and only the display
// encode is undone here. 2.34.10 item 3's HalfFloat scene-RT readout remains
// the thing that would make this scene-referred, and it is still not built.
//
// ---------------------------------------------------------------------------
// 2. WHY THERE ARE TWO RATIOS AND THE BAND IS ON THE SECOND
// ---------------------------------------------------------------------------
// The rendered patch carries an ADDITIVE aerial in-scatter term common to both
// arms. With airlight share a = Lin / (T*L_clearing + Lin) and surface ratio
// rho, the rendered ratio is R = rho + a*(1 - rho): strictly monotone toward 1
// in a, and at N7's measured a = 0.83 over the crowns NOTHING passes any
// physical band, however dark the canopy. A band applied to the hazed frame
// would therefore be a test of the atmosphere, which 2.34.5 proved correct,
// rather than of the canopy, which is the thing being guarded.
//
// AND BANDING THE HAZED FRAME WITH AN AIRLIGHT-CORRECTED ENDPOINT IS THE SAME
// TEST, WHICH IS WHY THE BAND GOES ON THE UN-HAZED ARM RATHER THAN BEING
// "RELAXED" ON THE SHIPPED ONE. The tempting alternative is to keep the band on
// Rship and widen the endpoint per pose to rho_max + a*(1 - rho_max). Substitute
// the definition of `a` and it collapses: Rship = Rsurf + a*(1 - Rsurf) by
// construction, so Rship <= rho_max + a*(1 - rho_max) reduces, for a < 1, to
// Rsurf <= rho_max exactly. The two designs are algebraically identical, and
// the airlight-corrected one hides its assumption inside a per-pose constant
// while this one states it. Also, correcting Rship by an `a` that was DERIVED
// from Rship is circular, and it is the same circularity 2.34.4 was corrected
// for when it sourced a coverage `f` from the arms it was comparing.
//
// So the guard measures BOTH:
//   Rship  the shipped frame against `?canopy=0`. The thing that actually
//          ships, carried as a NON-REGRESSION ratchet and nothing else.
//   Rsurf  `?prophaze=0&terrainhaze=0` against `?canopy=0&prophaze=0&
//          terrainhaze=0`. Both aerial terms off on BOTH arms, so `a` is gone
//          and what is left is the surface relation the optics can speak to.
//          THE BAND IS ON THIS ONE.
// and derives a = (Rship - Rsurf) / (1 - Rsurf), printed per pose, which is the
// pose's own airlight share measured rather than assumed.
//
// THE HONEST LIMIT OF DOING THIS WITH AN 8-BIT DISPLAY-REFERRED FRAME, stated
// here rather than discovered later. Removing both aerial terms makes the frame
// MUCH darker, so Rsurf is read at a different place on the ACES curve than
// Rship is. The decode above undoes the sRGB ENCODE, not ACES and not the
// grade, so neither ratio is a scene-radiance ratio and `a` is an APPARENT,
// display-linear airlight share rather than a radiometric one. The direction of
// the residual bias is knowable but its size is not, from an 8-bit frame:
// a filmic toe compresses shadow contrast, which pushes a dark frame's ratio
// TOWARD 1, so Rsurf is more likely flattered than exaggerated and the true
// surface ratio is probably LOWER than what this prints. That makes the band
// conservative in the safe direction here, and it is the reason 2.34.10 item 3
// (a linear readout off the HalfFloat scene RT, which already exists as an RT)
// is now BLOCKING a correct guard rather than merely convenient.
//
// ---------------------------------------------------------------------------
// 3. THE ENDPOINTS, DERIVED (RN-345: a constant carries its reason)
// ---------------------------------------------------------------------------
// The optics, from 2.34.6 and confirmed by an independent fresh-context
// reviewer against published canopy reflectances: a closed canopy in the GREEN
// band runs 1.8x to 3.3x darker than green grass (conifer ~0.035 over grass
// ~0.12 = 0.29; deciduous ~0.07 over ~0.12 = 0.58), i.e. a GREEN-BAND
// reflectance band of 0.30 to 0.65. That is exactly the range Admin named, and
// it is confirmed -- as a GREEN-BAND REFLECTANCE band.
//
// IT IS NOT THIS GUARD'S QUANTITY, AND THE TRANSLATION IS THE DELIVERABLE.
// This guard measures linear LUMINANCE against a clearing that is the site's
// own bare SUBSTRATE, not green grass. Two corrections, both derived:
//
//  (i) LUMA vs GREEN BAND. A canopy is green-peaked and red/blue-suppressed
//      (chlorophyll, and structural trapping is strongest where leaf
//      single-scattering albedo is lowest). Against a spectrally flat or
//      red-RISING substrate -- which duff and soil are -- luminance therefore
//      shows MORE darkening than the green band: worked against brown soil the
//      shift is 0.82x, against dry litter 0.81x. (Against GRASS it would be
//      1.05x and cancel; that is why the substrate matters.) Shift: 0.82x,
//      honest uncertainty about +/-0.08.
// (ii) THE CLEARING IS THE LARGEST TERM IN THE PROBLEM, not a footnote. Swapping
//      a duff/soil clearing for the grass the optics reference can move the
//      ratio anywhere from 0.5x to 2.4x, and the direction is NOT unambiguous:
//      dark moist humus halves the denominator and drives the ratio toward and
//      past 1, while dry litter at 650 nm is five to eight times brighter than
//      green grass and drives it down. A ratio is uninterpretable without its
//      denominator, which is why CLEARING_Y below is pinned and asserted.
//
// So, for THIS guard's quantity:
//   CORE  0.25 to 0.55 = the green-band 0.30-to-0.65 core carried through the
//         0.82x luminance shift. This is the TARGET, not the fail condition.
//   BAND  0.18 to 0.75 = the NECESSARY condition with the substrate pinned to a
//         mid-tone forest floor. Wide on purpose: a violation has to be
//         unambiguous evidence of a modelling error rather than a defensible
//         disagreement about which clearing the optics referenced. Dark conifer
//         over pale litter legitimately reaches 0.18; a canopy over dark moist
//         humus legitimately reaches and exceeds 0.75 in green, and 0.75 is
//         where the pinned substrate stops that being defensible.
//
// THE DEVIATION FROM THE NAMED 0.30-to-0.65 IS FLAGGED LOUDLY AND IS A
// TRANSLATION, NOT A PREFERENCE. Admin's range was named "on green-band linear
// reflectance" and is confirmed as such. Applied unchanged to linear LUMINANCE
// against a SUBSTRATE clearing it would be the same class of error 2.34.10 was
// corrected for: the right number for the wrong quantity.
//
// FOUR TERMS ARE CONFLATED IN ONE SCALAR AND THE GUARD SAYS SO. Rsurf mixes
// canopy optics rho, crown coverage f, between-crown gap shadowing s, and pose
// phase angle. With a perfectly black canopy and no gap shadow, R = 1 - f, so
// an upper bound of 0.75 is UNREACHABLE below f = 0.25 whatever the optics do;
// and canopy backscatter makes a near-antisolar pose read 1.3x to 2.0x lighter
// in red than a cross-lit one. Neither f nor phase angle is measured here.
// That is the honest limit of a one-scalar guard and it is owed work, not a
// silent assumption.
//
// ---------------------------------------------------------------------------
// 4. WHAT IT ASSERTS, and it cannot pass vacuously
// ---------------------------------------------------------------------------
//   HARD FAIL  Rsurf or Rship above its own recorded ceiling + TOL. The wood
//              got LIGHTER than the best this project has ever shipped. This is
//              the sign test's successor and the first version of it with a
//              budget. The ceiling is a RATCHET: a lane that darkens the wood
//              LOWERS the constant in the same commit, and it can never be
//              raised without an Admin-logged decision.
//   HARD FAIL  Rsurf below BAND_LOW. Darker than any defensible pairing.
//   HARD FAIL  the clearing arm's own absolute linear Y moved off its pin. The
//              ratio's denominator changed, so the ratio changed subject.
//   HARD FAIL  any arm invalid, or the arming checks below failing.
//   SCORED     distance above BAND_HIGH and above CORE_HIGH, printed per pose.
//              THE SHIPPED FRAME IS OUT OF BAND TODAY (see the report), so this
//              is stage 2's target and the guard is deliberately introduced
//              with the current values as the baseline rather than as a wall.
//   ARMED      `?canopy=0` must actually remove geometry (wood triangles >
//              clearing triangles), and the haze-off arms must actually darken
//              the frame. A flag that silently does nothing would otherwise
//              make both arms the same frame and the ratio a tautological 1.0.
//
//   node tools/smoke/rn2550guard.mjs --url=http://127.0.0.1:5550/
//   node tools/smoke/rn2550guard.mjs --url=http://127.0.0.1:5550/ --print=1
//   node tools/smoke/rn2550guard.mjs --url=http://127.0.0.1:5550/ \
//     --shots=forestairnoon --extra=crownshadefloor=0.30
//
// Four arms per pose, a FRESH PROCESS each, one build and one session per
// table. Sixteen browser runs for the full four-pose set.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const PROBE = path.join(HERE, 'probes', 'artframe.js');

// The band and the core, derived in section 3 above. One definition, one place.
const BAND_LOW = 0.18;
const BAND_HIGH = 0.75;
const CORE_LOW = 0.25;
const CORE_HIGH = 0.55;
// A ratio tolerance of 0.005 is 0.21 to 0.36 counts of wood at these levels.
// The four `box` rects are bit-identical run to run (2.34.7 proved it across a
// full from-scratch rebuild), so the real scatter is ZERO and this is already
// generous; it exists so an unrelated change is not held to the last bit.
const TOL = 0.005;
// The clearing is the ratio's denominator and the largest term in its
// interpretation, so it is pinned too, relatively, at 1 per cent -- about half
// a count at these levels, and far above the zero scatter these rects show.
const CLEAR_TOL_REL = 0.01;

// THE BASELINE, MEASURED ON THIS BUILD, NOT CHOSEN. `shipR` / `surfR` are the
// ratchet ceilings and `clearY` is the denominator pin. A pose absent from this
// table is a FAIL, never a skip, so the table can never quietly lose a pose.
// Measured 2026-08-21 on `lane/n8-guardband` at base `origin/main` b084d08e,
// one build, one session, server 127.0.0.1:5550 --strictPort, sentinel content
// verified over the wire, a FRESH PROCESS per arm. Sixteen runs. The same
// build reproduces 2.34.7's four shipped `box` luma pairs to the digit
// (-1.76 / -1.99 / -7.31 / -1.83 against clearings 110.27 / 84.18 / 149.20 /
// 107.32), which is the identity check that these ratios are N7's frame.
const BASE = {
  forestairnoon: { shipR: 0.9894, surfR: 1.0479, clearY: 0.163243 },
  forestairlow: { shipR: 0.9542, surfR: 0.7968, clearY: 0.094518 },
  flyovernoon: { shipR: 0.9248, surfR: 0.8813, clearY: 0.317483 },
  flyoverlow: { shipR: 0.9700, surfR: 0.8636, clearY: 0.159851 },
};

// The three WRONG ways to reach the same ratio, computed beside the right one
// so the table itself carries the argument for the definition rather than a
// paragraph asserting it. `decode` here is the same inverse EOTF the probe uses.
const decode = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
// AVERAGE THE CHANNELS, THEN DECODE. Differs from the definition by exactly the
// Jensen term, which is the patch-variance effect and does not cancel in a ratio.
const yOfMeans = (st) => 0.2126 * decode(st.rgb[0]) + 0.7152 * decode(st.rgb[1])
  + 0.0722 * decode(st.rgb[2]);

const ARMS = {
  clearing: ['--canopy=0'],
  wood: [],
  clearingSurf: ['--canopy=0', '--prophaze=0', '--terrainhaze=0'],
  woodSurf: ['--prophaze=0', '--terrainhaze=0'],
};

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const url = argv.get('--url') ?? 'http://127.0.0.1:5550/';
const shots = (argv.get('--shots') ?? Object.keys(BASE).join(',')).split(',');
const printOnly = argv.get('--print') === '1';
// THE NEGATIVE CONTROL, and it is why this flag exists rather than for tuning.
// NUMBERS.md: a control that fails to go red is a finding, and a guard nobody
// has ever seen fail is indistinguishable from a guard that cannot fail.
// `--extra=crownshadefloor=0.30` re-runs every arm with the one setting 2.34.6
// proved BREAKS the old sign test (`forestairnoon` -1.76 -> +2.14), so the band
// version must go red on it too. It is appended to ALL FOUR arms, which keeps
// them symmetric: on a `?canopy=0` arm a canopy setting is a no-op by
// construction, so the clearing is untouched and only the wood can move.
const extra = (argv.get('--extra') ?? '').split(',').filter(Boolean)
  .map((s) => `--${s}`);
const shotBy = (s) => (s.startsWith('forestair') || s.startsWith('flyover')
  || s === 'limb' ? 'surface' : 'walk');

function once(shot, flags) {
  const args = [RUN, `--url=${url}`, `--scenario=${shotBy(shot)}`,
    '--width=1600', '--height=900', `--evalfile=${PROBE}`,
    `--evalargs=${JSON.stringify({ shot })}`, ...flags];
  if (shotBy(shot) === 'walk') args.push('--sandbox=1');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  try { return JSON.parse(r.stdout).eval; } catch {
    return { valid: false, why: `no json (exit ${r.status})` };
  }
}

const fails = [];
const rows = [];
for (const shot of shots) {
  const e = {};
  for (const [name, flags] of Object.entries(ARMS)) e[name] = once(shot, [...flags, ...extra]);
  const bad = Object.entries(e).filter(([, v]) => !v.valid || !v.box
    || !v.box.lin || !(v.box.lin.Y > 0));
  if (bad.length > 0) {
    fails.push(`${shot}: arm(s) ${bad.map(([k, v]) => `${k} (${v.why ?? 'no lin.Y'})`)
      .join(', ')} did not produce a linear patch mean`);
    continue;
  }
  const Y = (k) => e[k].box.lin.Y;
  const tri = (k) => (e[k].render ? e[k].render.triangles : 0);
  // ARMING 1: `?canopy=0` must actually delete geometry.
  if (!(tri('wood') > tri('clearing'))) {
    fails.push(`${shot}: NOT ARMED -- ?canopy=0 did not reduce the triangle count`
      + ` (wood ${tri('wood')} vs clearing ${tri('clearing')}), so both arms are`
      + ` the same frame and the ratio is a tautology`);
    continue;
  }
  // ARMING 2: the haze-off arms must actually remove the aerial term.
  if (!(Y('clearingSurf') < Y('clearing'))) {
    fails.push(`${shot}: NOT ARMED -- ?prophaze=0&terrainhaze=0 did not darken the`
      + ` clearing (${Y('clearingSurf')} vs ${Y('clearing')}), so the airlight was`
      + ` not removed and Rsurf is not a surface ratio`);
    continue;
  }
  const shipR = Y('wood') / Y('clearing');
  const surfR = Y('woodSurf') / Y('clearingSurf');
  const a = (shipR - surfR) / (1 - surfR);
  rows.push({ shot, shipR, surfR, a, clearY: Y('clearing'),
    codeR: e.wood.box.luma / e.clearing.box.luma,
    lumaR: decode(e.wood.box.luma) / decode(e.clearing.box.luma),
    meanR: yOfMeans(e.wood.box) / yOfMeans(e.clearing.box) });

  const b = BASE[shot];
  if (!b || b.surfR === null) {
    fails.push(`${shot}: NO BASELINE. Paste into BASE: { shipR: ${shipR.toFixed(4)},`
      + ` surfR: ${surfR.toFixed(4)}, clearY: ${Y('clearing').toFixed(6)} }`);
    continue;
  }
  if (shipR > b.shipR + TOL) {
    fails.push(`${shot}: Rship ${shipR.toFixed(4)} is ABOVE its ceiling`
      + ` ${b.shipR.toFixed(4)} + ${TOL}. The wood got LIGHTER than the shipped frame.`);
  }
  if (surfR > b.surfR + TOL) {
    fails.push(`${shot}: Rsurf ${surfR.toFixed(4)} is ABOVE its ceiling`
      + ` ${b.surfR.toFixed(4)} + ${TOL}. The wood got LIGHTER on the surface arm.`);
  }
  if (surfR < BAND_LOW) {
    fails.push(`${shot}: Rsurf ${surfR.toFixed(4)} is BELOW BAND_LOW ${BAND_LOW}.`
      + ` The wood is darker than any defensible canopy over any defensible clearing.`);
  }
  const dY = Math.abs(Y('clearing') - b.clearY) / b.clearY;
  if (dY > CLEAR_TOL_REL) {
    fails.push(`${shot}: the CLEARING moved, ${Y('clearing').toFixed(6)} against a pin`
      + ` of ${b.clearY.toFixed(6)} (${(dY * 100).toFixed(2)} per cent). The ratio's`
      + ` denominator changed, so the ratio changed subject and its band no longer`
      + ` means what section 3 derived. Re-derive or re-pin with a logged decision.`);
  }
}

const f4 = (x) => x.toFixed(4).padStart(7);
console.log('\n--- RN-2550 WOOD/CLEARING RATIO BAND (linear-light Y, `box` rect) ---');
console.log(`BAND (fail outside) ${BAND_LOW} .. ${BAND_HIGH}`
  + `    CORE (target) ${CORE_LOW} .. ${CORE_HIGH}`);
if (extra.length > 0) {
  console.log(`NOT THE SHIPPED FRAME: every arm carries ${extra.join(' ')}.`
    + ` The baselines below are the SHIPPED ones, so this is a control run.`);
}
console.log('pose            Rship    Rsurf   airlight  clearingY   verdict (band is on Rsurf)');
for (const r of rows) {
  const inBand = r.surfR >= BAND_LOW && r.surfR <= BAND_HIGH;
  const inCore = r.surfR >= CORE_LOW && r.surfR <= CORE_HIGH;
  const where = inCore ? 'IN CORE' : (inBand ? 'IN BAND'
    : `OUT OF BAND by ${(r.surfR - BAND_HIGH).toFixed(4)}`);
  console.log(`${r.shot.padEnd(14)} ${f4(r.shipR)} ${f4(r.surfR)}`
    + `  ${f4(r.a)}  ${r.clearY.toFixed(6)}   ${where}`);
}
// THE INVERSION, NAMED. RN-2275 existed to stop the wood reading LIGHTER than
// its own clearing. On the hazed 8-bit frame it does not; on the airlight-free
// linear arm it can, and the old instrument could not see that.
for (const r of rows.filter((x) => x.surfR >= 1)) {
  console.log(`  !! ${r.shot}: Rsurf ${r.surfR.toFixed(4)} >= 1. THE INVERSION IS`
    + ` PRESENT on the airlight-free arm: linearized, the wood carries MORE light`
    + ` than its own clearing. The 8-bit hazed sign test cannot see this.`);
}
// An airlight share outside [0,1] is not a share. It means the two arms are not
// related by one common-mode additive term, which the ACES-region change between
// a hazed and an un-hazed frame is enough to cause on its own.
for (const r of rows.filter((x) => !(x.a >= 0 && x.a <= 1))) {
  console.log(`  !! ${r.shot}: derived airlight share ${r.a.toFixed(4)} is outside`
    + ` [0,1], so R = rho + a(1-rho) does NOT describe this pair. Read it as a flag`
    + ` that Rship and Rsurf sit in different regions of the tone curve, not as a`
    + ` measurement of the atmosphere.`);
}
console.log('\n--- WHY THE DEFINITION HAD TO BE PINNED: four ways to the same ratio ---');
console.log('pose            8-bit  dec(luma)  meanThenDec  perPixel(THE DEFINITION)');
for (const r of rows) {
  console.log(`${r.shot.padEnd(14)} ${f4(r.codeR)}   ${f4(r.lumaR)}      ${f4(r.meanR)}`
    + `      ${f4(r.shipR)}`);
}

// `--print=1` still SHOWS everything it found. A reporting mode that swallows
// the failures it collected is the same defect as a probe that never asserts:
// it is the arming and baseline messages, above all, that a bootstrap run needs.
if (printOnly) {
  for (const m of fails) console.error(`rn2550guard: (print) would FAIL ${m}`);
  console.log(`\nrn2550guard: PRINT ONLY, nothing asserted (--print=1),`
    + ` ${fails.length} problem(s) listed above.`);
  process.exit(0);
}
if (rows.length !== shots.length) {
  fails.push(`only ${rows.length} of ${shots.length} poses produced a ratio`);
}
if (fails.length > 0) {
  for (const m of fails) console.error(`rn2550guard: FAIL ${m}`);
  console.error(`rn2550guard: FAIL (${fails.length} problem(s))`);
  process.exit(1);
}
const out = rows.filter((r) => r.surfR > BAND_HIGH);
console.log(`\nrn2550guard: PASS (${shots.length} poses, ${out.length} above the band,`
  + ` worst shortfall ${out.length === 0 ? '0'
    : Math.max(...out.map((r) => r.surfR - BAND_HIGH)).toFixed(4)})`);
process.exit(0);
