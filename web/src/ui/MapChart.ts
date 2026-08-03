// =============================================================================
// MapChart.ts - the departure-cost chart, and the one place this client says
// what a refusal looks like.
//
// LIFTED OUT OF MapPlannerPanel.ts (GP-352), which is GP-206's move again: the
// chart's own rewrite took that file well past the 400-line cap, and the chart
// is one concern with one input. Pure string building over plain data (DW-2):
// a probe reads the DRAWN series, the DRAWN gaps and the DRAWN counts back out
// of the markup rather than asserting a model against a second copy of its own
// arithmetic.
// =============================================================================
import type { MapPlannerReadout } from './MapTypes.js';
import { esc } from './MapPanels.js';

const CH_W = 260;
const CH_H = 72;

// =============================================================================
// GP-352. THE TWO CHARTS SAID "NO" IN TWO DIFFERENT WAYS AND LOOKED IDENTICAL
// WHILE DOING IT.
//
// Measured on one vehicle in one session, from the same rocket in the same
// orbit: the STATION's curve solved 64 of 64 samples, so the line is unbroken
// and every refusal it expresses is "the price is above what you carry"; the
// MOON's curve solved 39 of 64, so 25 departures are gaps and the refusal they
// express is "the autopilot will decline this departure outright". Both are
// correct. Both are deliberate. Physics' own correction says a NaN here means
// the arm WILL refuse and nothing may interpolate across it (GP-295), and a
// solved-but-unaffordable sample genuinely HAS a price that the chart exists to
// show rising.
//
// So the two behaviours cannot be merged, and I did not try: **the choice made
// here is to make them LOOK different.** Making them behave the same would mean
// either drawing a gap where a real price exists (destroying the whole point of
// a cost curve, and lying about a departure a bigger vehicle could fly) or
// interpolating across a refusal (the exact thing physics measured going
// wrong: 22 of 121 confident prices for departures the arm then refused). One
// of those two "no"s is about the CLOCK and one is about the VEHICLE, and a
// player reading the wrong one waits for a window that will never come, or
// builds a bigger rocket for a departure that has no solution at any size.
//
// THREE THINGS MAKE THE DIFFERENCE VISIBLE, and all three are drawn on BOTH
// charts in one vocabulary, so the two screens differ in their NUMBERS rather
// than in their layout:
//
//  1. A REFUSAL IS DRAWN, NOT MERELY ABSENT. Refused departures get a hatched
//     column. "There is no line here" and "the line is off the top of the
//     window" were previously the same picture.
//  2. THE AFFORDABILITY RULE IS ALWAYS ON THE CHART. It used to be drawn only
//     when it happened to fall between lo and hi, so the case it matters most
//     in - every departure priced and NONE of them affordable - drew a
//     perfectly ordinary-looking curve with nothing on it saying so. It is now
//     clamped to the edge and SAYS it is clamped.
//  3. THE COUNTS ARE STATED. `64 of 64 priced, 0 refused` and
//     `39 of 64 priced, 25 refused` are the same sentence with different
//     numbers, which is the whole claim.
// =============================================================================

/** Where the vehicle's own delta-v sits against the drawn band. `none` when
 *  there is no figure to place, which is not the same as it being off-scale. */
type AffordWhere = 'in' | 'above' | 'below' | 'none';

/**
 * THE CHART: cost against departure time, with the chosen sample marked.
 *
 * Points are emitted into a `data-pts` attribute as well as into the polyline,
 * so a probe reads the DRAWN series rather than re-deriving it. An unsolved
 * sample breaks the line: a `polyline` cannot express a gap, so the series is
 * emitted as one `polyline` per solved run.
 */
export function chart(p: MapPlannerReadout): string {
  const s = p.curve;
  const solved = s.filter((x) => Number.isFinite(x.dvMS));
  const refused = s.length - solved.length;
  if (solved.length === 0) {
    // EVERY sample refused is a different statement from a window with no
    // cheap moment in it, and it is the extreme of the same axis the legend
    // below counts along, so it is worded out of the same vocabulary.
    return `<div class="note">All ${s.length} departures in this window are `
      + 'REFUSED: the autopilot declines every one of them, so there is no '
      + 'price to draw. That is not "expensive", it is "no solution".</div>';
  }
  const lo = Math.min(...solved.map((x) => x.dvMS));
  const hi = Math.max(...solved.map((x) => x.dvMS));
  // A FLAT curve is the right answer for a ring (no phase, so no window), and
  // a zero span must not divide. It is drawn as a level line, which is the
  // truthful picture: waiting buys nothing.
  const span = hi - lo < 1e-9 ? 1 : hi - lo;
  const n = s.length;
  const xOf = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * CH_W);
  const yOf = (v: number): number => CH_H - ((v - lo) / span) * (CH_H - 8) - 4;
  const runs: string[] = [];
  // GAP RUNS, in the same shape as the point runs and for the same reason: a
  // probe reads `data-gaps` and asserts the DRAWN refusals rather than
  // re-deriving them from the model that produced them.
  const gaps: string[] = [];
  const gapRects: string[] = [];
  let cur: string[] = [];
  let gapFrom = -1;
  const closeGap = (to: number): void => {
    if (gapFrom < 0) return;
    // Half a cell either side, so a single refused sample is still a visible
    // column rather than a zero-width rect.
    const half = n <= 1 ? CH_W / 2 : CH_W / (n - 1) / 2;
    const x0 = Math.max(0, xOf(gapFrom) - half);
    const x1 = Math.min(CH_W, xOf(to) + half);
    gaps.push(`${gapFrom}-${to}`);
    gapRects.push(`<rect class="gap" x="${x0.toFixed(1)}" y="0" `
      + `width="${(x1 - x0).toFixed(1)}" height="${CH_H}"/>`);
    gapFrom = -1;
  };
  for (let i = 0; i < n; ++i) {
    const v = s[i]?.dvMS ?? NaN;
    if (!Number.isFinite(v)) {
      if (cur.length > 1) runs.push(cur.join(' '));
      cur = [];
      if (gapFrom < 0) gapFrom = i;
      continue;
    }
    closeGap(i - 1);
    cur.push(`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
  }
  if (cur.length > 1) runs.push(cur.join(' '));
  closeGap(n - 1);
  const marks: string[] = [];
  const mark = (i: number, cls: string): void => {
    const v = s[i]?.dvMS ?? NaN;
    if (i < 0 || !Number.isFinite(v)) return;
    marks.push(`<circle class="${cls}" cx="${xOf(i).toFixed(1)}" `
      + `cy="${yOf(v).toFixed(1)}" r="3"/>`);
  };
  mark(p.cheapest, 'best');
  mark(p.chosen, 'chosen');
  // THE RULE IS ALWAYS DRAWN. Off-scale it is pinned to the edge and marked as
  // pinned, because the state it is most needed in is the one where it used to
  // vanish: every departure priced, none affordable, and a chart that looked
  // exactly like a chart of departures you can fly.
  const avail = p.dvAvailableMS;
  const where: AffordWhere = !Number.isFinite(avail) ? 'none'
    : avail > hi ? 'above' : avail < lo ? 'below' : 'in';
  const yAff = where === 'none' ? CH_H / 2
    : where === 'above' ? 1 : where === 'below' ? CH_H - 1 : yOf(avail);
  const affLine = where === 'none' ? ''
    : `<line class="afford${where === 'in' ? '' : ' pinned'}" x1="0" `
      + `y1="${yAff.toFixed(1)}" x2="${CH_W}" y2="${yAff.toFixed(1)}"/>`;
  const out: string[] = [];
  out.push(`<div class="pchart"><svg viewBox="0 0 ${CH_W} ${CH_H}" `
    + `preserveAspectRatio="none" data-pts="${esc(runs.join(';'))}" `
    + `data-gaps="${esc(gaps.join(';'))}" data-samples="${n}" `
    + `data-solved="${solved.length}" data-refused="${refused}" `
    + `data-aff="${where}" `
    + `data-lo="${lo.toFixed(3)}" data-hi="${hi.toFixed(3)}">`
    + gapRects.join('')
    + affLine
    + runs.map((r) => `<polyline points="${r}"/>`).join('')
    + marks.join('')
    + '</svg>');
  out.push(`<div class="pcaption"><em>${lo.toFixed(0)} m/s</em>`
    + `<em>cost vs departure, next ${Math.round(p.windowS / 60)} min</em>`
    + `<em>${hi.toFixed(0)}</em></div>`);
  // THE COUNTS, ALWAYS BOTH, on every chart. `0 refused` is information: it is
  // what tells a player that this destination's line being unbroken is a fact
  // about the destination and not about the picture.
  out.push('<div class="plegend">'
    + `<em>${solved.length} of ${n} priced</em>`
    + `<em class="${refused > 0 ? 'bad' : 'dim'}">${refused} refused</em>`
    + '</div>');
  if (refused > 0) {
    out.push(`<div class="note">The ${refused} shaded columns are departures `
      + 'the autopilot will REFUSE: there is no solution at any price, so the '
      + 'line stops rather than passing over them. That is a different "no" '
      + 'from a price you cannot afford, which is drawn as line ABOVE the '
      + 'dashed rule.</div>');
  }
  if (where === 'below') {
    out.push(`<div class="note">Your ${avail.toFixed(0)} m/s is BELOW this `
      + 'whole curve (the dashed rule is pinned to the floor). Every departure '
      + 'here has a price and this vehicle cannot pay any of them: that is '
      + 'about the rocket, not the clock, and waiting will not fix it.</div>');
  }
  if (where === 'above') {
    out.push(`<div class="note">Your ${avail.toFixed(0)} m/s is ABOVE this `
      + 'whole curve (the dashed rule is pinned to the ceiling), so every '
      + 'departure drawn here is affordable and the only question left is '
      + 'which is cheapest.</div>');
  }
  out.push('</div>');
  return out.join('');
}
