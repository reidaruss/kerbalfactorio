// =============================================================================
// MapPlannerPanel.ts - the autopilot block of the map's readout column: the
// target list, Reid's departure chart, the scheduling verdict, and (GP-273) the
// programme actually in flight.
//
// LIFTED VERBATIM OUT OF MapPanels.ts (GP-283), which is GP-206's move a second
// time and for the same reason: binding the executor took that file from 384
// lines to 525 against a 400-line cap, and the cap is the cap. Nothing here
// changed in the lift; the split is along the seam the code already had, since
// every function below takes `MapPlannerReadout` and none of the ones left
// behind do.
//
// Pure string builders over plain data (DW-2). The DOM, the events and the
// diffing stay in MapView, which is what lets a probe read the DRAWN chart out
// of `data-pts` and the DRAWN burn bar out of its own element width rather than
// asserting a model against a second copy of its own arithmetic.
// =============================================================================
import type { MapPlannerReadout } from './MapTypes.js';
import { clock, esc, km, row } from './MapPanels.js';

// =============================================================================
// GP-271: THE AUTOPILOT PLANNER BLOCK, and the chart Reid asked for by name.
//
// "A chart should also show up showing how optimal the current time would be to
// launch vs waiting later in terms of fuel burn."
//
// It is an inline SVG polyline and not a canvas, for the same reason everything
// else under src/ui is plain DOM (DW-2): a probe can read the points back out
// of the markup and assert the DRAWN shape rather than the model that produced
// it. The chart is the thing that makes the scheduling rule legible, so it is
// not decoration and it gets asserted like a readout.
//
// NaN IS DRAWN AS A GAP, NEVER AS ZERO. Physics publishes NaN for a departure
// with no solution precisely because zero would render as the cheapest point on
// the curve, which is the exact opposite of the truth. A gap is honest: that is
// a departure that cannot be flown at any price.
// =============================================================================

const CH_W = 260;
const CH_H = 72;

/** MM:SS from now, for a departure offset. */
function fromNow(s: number): string {
  return Number.isFinite(s) ? clock(s) : '--:--';
}

/**
 * GP-273. THE PROGRAM IN FLIGHT, drawn above everything else.
 *
 * It comes FIRST and it returns early, because while the autopilot has the
 * controls the question "where shall I go next" is the wrong question: the
 * player is watching a burn. The chart and the target list come back the moment
 * the program is cancelled or finished.
 *
 * EVERY NUMBER HERE IS THE EXECUTOR'S. Nothing is re-derived from the plan the
 * chart quoted, because the plan is what was intended and this block exists to
 * say what is HAPPENING, and the difference between those two is exactly what a
 * player watching an autopilot wants to know.
 */
function runBlock(p: MapPlannerReadout): string {
  const out: string[] = [];
  const late = p.runTimeToIgnitionS < 0;
  out.push(`<div class="pverdict ${p.runRunning ? 'ok' : 'bad'}">`
    + `${esc(p.runPhaseWord)}</div>`);
  // PHYSICS' OWN SENTENCE, VERBATIM. Not paraphrased and not mapped through a
  // table here: one failure with two vocabularies is how a player is told two
  // different things about one event (GP-270's family).
  if (p.runNote !== '') out.push(`<div class="note">${esc(p.runNote)}</div>`);
  if (p.runBurnCount > 0) {
    out.push(row('burn', `${p.runBurnIndex + 1} of ${p.runBurnCount}`));
  }
  // THE COUNTDOWN BELONGS TO THE PHASES BEFORE THE BURN, AND FOUND BY LOOKING.
  // The first screenshot of a burn in progress read `BURN OVERDUE BY 00:00`,
  // because the current burn's ignition time is in the past the whole time it
  // is burning, so the negative branch was correct and the row was nonsense.
  // Overdue means "the engine should be lit and is not", which is a Coast or
  // Orient statement; once it IS lit, the bar and the spend carry everything.
  // A number can be right and still be the wrong thing to draw (DW-7, and this
  // one no metric would have caught).
  if (p.runRunning && p.runPhase !== 3) {
    // A NEGATIVE COUNTDOWN IS INFORMATION, NOT AN ERROR TO HIDE. The executor
    // will not light an engine it is not pointed at, so a burn goes LATE rather
    // than sideways, and "overdue by 4 s" is the honest reading of a vehicle
    // that is still slewing. Clamping it to zero would draw a stuck 00:00.
    out.push(row(late ? 'burn OVERDUE by' : 'light it in',
                 clock(Math.abs(p.runTimeToIgnitionS)), late ? 'warn' : ''));
  }
  if (p.runRunning && Number.isFinite(p.runPointingErrorDeg)) {
    out.push(row('pointing', `${p.runPointingErrorDeg.toFixed(1)} deg off`));
  }
  // GP-281. THE HANG, NAMED. A burn is cut on MEASURED delta-v, so a burn that
  // is producing none never ends: the executor sits in Burn at full throttle
  // for ever and every field it publishes reads healthy. The cause is always
  // the same and it is one the player can fix in one keypress.
  if (p.runStalled) {
    out.push('<div class="pverdict bad">BURNING, BUT NOTHING IS HAPPENING</div>');
    out.push('<div class="note">Full throttle and no thrust: the next engine '
      + 'has not been staged, or the stage under you is spent. Stage it and '
      + 'the burn continues from where it is; otherwise cancel. The autopilot '
      + 'cannot stage for you, and it will wait here for ever because it '
      + 'stops a burn by measuring what the engine delivered.</div>');
  }
  if (p.runCurrentBurnDvMS > 0) {
    const pct = Math.round(p.runBurnProgress01 * 100);
    // ASSERTED AT THE PIXEL, GP-64's rule: the bar's own width is what a probe
    // reads, so the assertion is the DRAWN bar against the executor rather than
    // the client against a second copy of its own arithmetic.
    out.push(`<div class="pbar" data-pct="${pct}">`
      + `<i style="width:${pct}%"></i></div>`);
    // THIS BURN'S OWN SPEND, not the programme's. They are equal on burn 1 and
    // diverge from burn 2 onward, so the wrong one was drawn correctly for the
    // only burn anybody had looked at. Caught by reading a screenshot's figures
    // back against the executor rather than by any assertion.
    out.push(row('this burn', `${p.runDvThisBurnMS.toFixed(1)} of `
      + `${p.runCurrentBurnDvMS.toFixed(1)} m/s`));
  }
  out.push(row('programme', `${p.runDvSpentMS.toFixed(0)} of `
    + `${p.runProgramDvMS.toFixed(0)} m/s spent`));
  // GP-280. BOTH NUMBERS, NEVER ONE. The chart quoted a MISSION (the burns plus
  // the 5% policy reserve); the executor holds a PROGRAMME (the burns). They
  // are different quantities and both are true, so the panel shows the pair and
  // lets the player see them agree, rather than reconciling them behind a
  // constant this client would then own a copy of.
  if (Number.isFinite(p.runQuotedAtArmMS)) {
    out.push(row('the chart quoted', `${p.runQuotedAtArmMS.toFixed(0)} m/s`
      + ' incl. reserve'));
  }
  // THE THROTTLE THE EXECUTOR IS COMMANDING, not the player's own mirror.
  // `FlightSession.throttle` is written only when the player moves it, so
  // during an autopilot burn the world HUD reads their last setting while the
  // engine does something else.
  out.push(row('throttle', `${Math.round(p.runThrottle * 100)}%`,
                p.runThrottle > 0 ? 'good' : ''));
  if (Number.isFinite(p.runRangeM)) {
    // METRES CLOSE IN, NOT KILOMETRES. A rendezvous ends about a hundred metres
    // out, and `km()` would draw that as "0.1 km", which is the one range band
    // where the number actually matters reduced to one significant figure.
    out.push(row('range', p.runRangeM < 10000
      ? `${p.runRangeM.toFixed(1)} m` : km(p.runRangeM)));
    // THE SIGN IS THE INFORMATION. Closing and opening at the same speed look
    // identical as a magnitude and mean opposite things about whether the
    // rendezvous worked.
    out.push(row(p.runClosingMS >= 0 ? 'closing at' : 'OPENING at',
                 `${Math.abs(p.runClosingMS).toFixed(2)} m/s`,
                 p.runClosingMS >= 0 ? '' : 'warn'));
  }
  out.push('<div class="nodectl">');
  out.push('<button class="wide" data-plan-act="cancel">'
    + `${p.runRunning ? 'CANCEL the autopilot' : 'clear this programme'}`
    + '</button></div>');
  if (p.runRunning) {
    out.push('<div class="note">Cancelling cuts the throttle. If it is '
      + 'mid-burn your orbit ends up part way between the one you had and the '
      + 'one you planned, and the message will say how much it spent.</div>');
  }
  return out.join('');
}

export function plannerBlock(p: MapPlannerReadout | null): string {
  if (p === null) return '';
  const out: string[] = ['<h4>Autopilot</h4>'];
  // A LIVE PROGRAM OWNS THIS PANEL. Checked before the planner's own seam,
  // because a program can be flying on a build whose PLANNING exports are
  // missing and the reverse, and neither should hide the other.
  if (p.aboard && p.runArmed) {
    out.push(runBlock(p));
    return out.join('');
  }
  if (p.waitingOn !== '') {
    // BOTH SEAMS, when both are open. GP-139's "one thing at a time" is a rule
    // about instructing a PLAYER; the audience for a missing-export sentence is
    // whoever has to add the export, and telling them about the planner and
    // then making them fix it to discover the executor is also missing wastes
    // an hour. A build from HEAD's committed binary is exactly that build: it
    // carries neither set.
    out.push('<div class="note">The transfer solver is not on this bridge: '
      + `waiting for ${esc(p.waitingOn)}.`
      + (p.runWaitingOn !== ''
        ? ` The autopilot EXECUTOR is missing too: ${esc(p.runWaitingOn)}.`
        : '')
      + '</div>');
    return out.join('');
  }
  if (!p.aboard) {
    out.push('<div class="note">Autopilot plans from the vessel you are '
      + 'flying. Take control of one and the destinations appear here.</div>');
    return out.join('');
  }
  // The list. Same rows, same ids and same order as the assembly bay's, so a
  // destination chosen before launch is the destination shown in flight.
  for (const r of p.rows) {
    const sel = r.id === p.selectedId ? ' sel' : '';
    const bad = r.blocked !== '' ? ' blocked' : '';
    out.push(`<div class="prow${sel}${bad}" data-plan="${esc(r.id)}">`
      + `<div class="pname">${esc(r.name)}<span class="pkind">`
      + `${esc(r.kind)}</span></div>`
      + `<div class="pdet">${esc(r.blocked !== '' ? r.blocked : r.detail)}</div>`
      + '</div>');
  }
  // GP-277. THE REQUESTED ORBIT WAS UNCHOOSABLE FROM THE MAP. `altKm` and
  // `incDeg` have existed on the planner since GP-271 and nothing on this
  // screen could move them, so Reid's fifth ask ("set an automatic take it to
  // this orbit") offered exactly one orbit: 100 km, 0 degrees, for ever. The
  // bay has two boxes for the same two numbers; this has four buttons.
  //
  // BUTTONS AND NOT TEXT BOXES, and that is a decision rather than a shortcut.
  // `MapView` rebuilds this whole column whenever its key changes, and in orbit
  // the altitude term ticks nearly every frame, so a focused <input> would be
  // destroyed under the player's fingers: that is GP-136's defect exactly, and
  // GP-265 only escaped it in the bay by building the boxes ONCE outside the
  // render. Here the same class of bug is made unreachable instead of fixed,
  // because a button has no state to lose.
  if (p.selectedId === 'orbit') {
    out.push('<div class="nodectl">');
    out.push(`<em>altitude</em><button data-plan-act="alt-">-</button>`
      + `<em class="val">${p.orbitAltKm.toFixed(0)} km</em>`
      + `<button data-plan-act="alt+">+</button>`);
    out.push(`<em>inclination</em><button data-plan-act="inc-">-</button>`
      + `<em class="val">${p.orbitIncDeg.toFixed(0)} deg</em>`
      + `<button data-plan-act="inc+">+</button>`);
    out.push('</div>');
  }
  if (p.selectedId === '') {
    out.push('<div class="note">Pick a destination, or click one on the map.</div>');
    return out.join('');
  }
  if (p.blockedWhy !== '') {
    out.push('<div class="pverdict bad">CANNOT PLAN</div>');
    out.push(`<div class="note">${esc(p.blockedWhy)}</div>`);
    return out.join('');
  }
  out.push(chart(p));
  out.push(row('leave in', fromNow(p.chosenTS)));
  out.push(row('costs', Number.isFinite(p.chosenDvMS)
    ? `${p.chosenDvMS.toFixed(0)} m/s` : 'no solution',
  p.chosenFeasible ? 'good' : 'warn'));
  out.push(row('you have', `${p.dvAvailableMS.toFixed(0)} m/s`));
  if (p.planDeltaVMS > 0) {
    out.push(row('burn', `${p.planBurnS.toFixed(1)} s`));
    out.push(row('arrive AP/PE', `${km(p.planApoapsisAltM)} / `
      + `${km(p.planPeriapsisAltM)}`));
  }
  // THE VERDICT, and it is Reid's rule in three states rather than two.
  const cls = p.verdict === 'go' ? 'ok' : p.verdict === 'wait' ? 'pend' : 'bad';
  const word = p.verdict === 'go' ? 'CAN FLY THIS DEPARTURE'
    : p.verdict === 'wait' ? 'NOT NOW, BUT LATER' : 'NOT WITH THIS VEHICLE';
  out.push(`<div class="pverdict ${cls}">${word}</div>`);
  out.push(`<div class="note">${esc(p.why)}</div>`);
  out.push('<div class="nodectl">');
  out.push('<button data-plan-act="earlier">earlier</button>');
  out.push('<button data-plan-act="later">later</button>');
  out.push('<button class="wide" data-plan-act="cheapest">jump to the cheapest '
    + 'departure</button>');
  if (p.earliest >= 0 && !p.chosenFeasible) {
    out.push('<button class="wide" data-plan-act="earliest">jump to the '
      + 'earliest one I can fly</button>');
  }
  // ARMED ONLY WHEN THE CHOSEN DEPARTURE IS AFFORDABLE. This is the gate, and
  // it is per departure time rather than global, which is the whole of Reid's
  // rule: a destination you cannot reach now is not refused outright, it is
  // refused AT THIS DEPARTURE, and the chart shows where it stops being so.
  const canArm = p.chosenFeasible && p.runWaitingOn === '';
  out.push(`<button class="wide${canArm ? '' : ' off'}" `
    + `data-plan-act="arm"${canArm ? '' : ' disabled'}>`
    + `${p.runWaitingToDepart ? 'autopilot ARMED'
      : 'set autopilot for this departure'}`
    + '</button>');
  out.push('</div>');
  // GP-273. THE EXECUTOR'S OWN SEAM, and it is not the planner's. A build can
  // price this trip perfectly and be unable to fly it, which is what every
  // build before tonight was, and the button must name what it needs rather
  // than looking armed and doing nothing (GP-62).
  if (p.runWaitingOn !== '') {
    out.push('<div class="note">The plan above is real and is /core\'s. The '
      + 'autopilot EXECUTOR is not on this bridge yet: waiting for '
      + `${esc(p.runWaitingOn)}. Nothing will be flown.</div>`);
  }
  // The sentence about unattended vessels, which is a rule players will
  // otherwise discover by losing a ship.
  out.push('<div class="note">Autopilot flies a vessel you are aboard, or one '
    + 'you are following. It does not fly ships you have left behind. A parked '
    + 'vessel is nine numbers and a clock, not a simulation, so a scheduled '
    + 'departure fires when you are there to see it. The plan is computed once '
    + 'and kept, not re-derived, so it does not drift while you are away.</div>');
  return out.join('');
}

/**
 * THE CHART: cost against departure time, with the chosen sample marked.
 *
 * Points are emitted into a `data-pts` attribute as well as into the polyline,
 * so a probe reads the DRAWN series rather than re-deriving it. An unsolved
 * sample breaks the line: a `polyline` cannot express a gap, so the series is
 * emitted as one `polyline` per solved run.
 */
function chart(p: MapPlannerReadout): string {
  const s = p.curve;
  const solved = s.filter((x) => Number.isFinite(x.dvMS));
  if (solved.length === 0) {
    return '<div class="note">No departure in this window has a solution.</div>';
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
  let cur: string[] = [];
  for (let i = 0; i < n; ++i) {
    const v = s[i]?.dvMS ?? NaN;
    if (!Number.isFinite(v)) {
      if (cur.length > 1) runs.push(cur.join(' '));
      cur = [];
      continue;
    }
    cur.push(`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
  }
  if (cur.length > 1) runs.push(cur.join(' '));
  const marks: string[] = [];
  const mark = (i: number, cls: string): void => {
    const v = s[i]?.dvMS ?? NaN;
    if (i < 0 || !Number.isFinite(v)) return;
    marks.push(`<circle class="${cls}" cx="${xOf(i).toFixed(1)}" `
      + `cy="${yOf(v).toFixed(1)}" r="3"/>`);
  };
  mark(p.cheapest, 'best');
  mark(p.chosen, 'chosen');
  const affordable = p.dvAvailableMS;
  const yAff = affordable >= lo && affordable <= hi
    ? `<line class="afford" x1="0" y1="${yOf(affordable).toFixed(1)}" `
      + `x2="${CH_W}" y2="${yOf(affordable).toFixed(1)}"/>` : '';
  return `<div class="pchart"><svg viewBox="0 0 ${CH_W} ${CH_H}" `
    + `preserveAspectRatio="none" data-pts="${esc(runs.join(';'))}" `
    + `data-lo="${lo.toFixed(3)}" data-hi="${hi.toFixed(3)}">`
    + yAff
    + runs.map((r) => `<polyline points="${r}"/>`).join('')
    + marks.join('')
    + '</svg>'
    + `<div class="pcaption"><em>${lo.toFixed(0)} m/s</em>`
    + `<em>cost vs departure, next ${Math.round(p.windowS / 60)} min</em>`
    + `<em>${hi.toFixed(0)}</em></div></div>`;
}
