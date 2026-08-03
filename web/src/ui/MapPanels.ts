// =============================================================================
// MapPanels.ts - the readout column's HTML, lifted verbatim out of MapView
// (GP-206: the 3D view had to fit somewhere and the cap is the cap), plus the
// VESSELS block (GP-210). Pure string builders over plain data; the DOM, the
// events and the diffing stay in MapView.
//
// The vessels block is the selection half of the control handoff: one row per
// registry record, live numbers off the record (see MapVesselRow's own header
// for why the flying vessel's fuel says "live"), a row click to select, and
// TAKE CONTROL as a button whose refusals arrive as sentences through the
// message line, never as a silently dead control.
// =============================================================================
import type { MapPlannerReadout, MapReadout, MapVesselRow } from './MapTypes.js';

const HANDLES: readonly (readonly ['prograde' | 'normal' | 'radial' | 'time',
  string, number])[] = [
    ['prograde', 'prograde', 10],
    ['normal', 'normal', 10],
    ['radial', 'radial out', 10],
    ['time', 'node time', 60],
  ];

/** MM:SS, or H:MM:SS past an hour. A negative time reads as a countdown gone
 *  past, which is exactly what "you are late to start the burn" means. */
export function clock(s: number): string {
  if (!Number.isFinite(s)) return '--:--';
  const neg = s < 0;
  const t = Math.floor(Math.abs(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  const body = h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
  return neg ? `-${body}` : body;
}

export function km(m: number): string {
  if (!Number.isFinite(m) || Math.abs(m) > 1e12) return '---';
  return `${(m / 1000).toFixed(1)} km`;
}

function row(label: string, value: string, cls = ''): string {
  return `<div class="row ${cls}"><em>${label}</em><b>${value}</b></div>`;
}

/** A fraction of a whole world is a very small number early on, and "0.00%"
 *  after a first survey pass reads as "the map is broken". */
function pct(f: number): string {
  if (!Number.isFinite(f)) return '---';
  const v = f * 100;
  return `${v > 0 && v < 0.01 ? '&lt;0.01' : v.toFixed(v < 10 ? 2 : 1)}%`;
}

/** Names come from the sim (a vessel's, a body's) and land in markup and in a
 *  data attribute. getAttribute decodes, so the focus round trip is exact. */
export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;'
    : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

export function panelBody(r: MapReadout): string {
  const c = r.scene.current;
  const out: string[] = [];
  // ON FOOT there is no vessel and so no trajectory. The panel says where you
  // are standing rather than blanking: a column of '---' where the orbit used
  // to be reads as a broken map, which is the one thing it must not do.
  if (c === null) {
    out.push('<h4>Position</h4>');
    out.push(row('state', esc(r.status)));
    out.push(row('ALT', km(r.altitudeM)));
    out.push(row('SPD', `${r.speedMS.toFixed(0)} m/s`));
    out.push('<div class="note">No vessel: the map is centred on you. '
      + 'Keep zooming out and it becomes the orbital view.</div>');
  } else {
    out.push('<h4>Orbit</h4>');
    out.push(row('AP', c.bound ? km(c.apoapsisAltM) : '---'));
    out.push(row('to AP', c.timeToApoapsisS >= 0 ? clock(c.timeToApoapsisS) : '---'));
    out.push(row('PE', km(c.periapsisAltM),
      c.periapsisAltM < r.scene.atmosphereCeilingM ? 'warn' : ''));
    out.push(row('to PE', c.timeToPeriapsisS >= 0 ? clock(c.timeToPeriapsisS) : '---'));
    out.push(row('period', c.bound ? clock(c.periodS) : '---'));
    out.push(row('ecc', c.eccentricity.toFixed(4)));
    out.push(row('ALT', km(r.altitudeM)));
    out.push(row('SPD', `${r.speedMS.toFixed(0)} m/s`));
    out.push(row('dV left', `${r.deltaVRemainingMS.toFixed(0)} m/s`));
    out.push(row('SAS', r.sas));
    // The conic is exact only in vacuum with the engine shut. Saying so is not
    // a nicety: in the air the drawn path is where the vessel would go if the
    // air and the thrust stopped now, which is a different claim.
    if (!r.onRails) {
      out.push(row('trajectory', 'PREDICTED (air or thrust)', 'warn'));
    }
  }
  out.push(focusBlock(r));
  // GP-271. THE PLANNER SITS ABOVE THE VESSEL LIST. When you are flying, the
  // autopilot is what the map is open FOR; the vessel list is the handoff tool
  // and is secondary. Decided by measurement, not taste: the first screenshot
  // put it last and the chart and the verdict were both below the rail fold,
  // which is exactly the mistake GP-118 already corrected one panel over.
  out.push(plannerBlock(r.planner));
  out.push(vesselsBlock(r.vessels));
  out.push(discoveryBlock(r));
  if (c !== null) out.push(nodeBlock(r));
  return out.join('');
}

/** Focus switching IS re-centring: each button writes a different `centreM`
 *  and nothing else about the map changes. */
function focusBlock(r: MapReadout): string {
  const out: string[] = ['<h4>Focus</h4>'];
  out.push(row('centred on', esc(r.focusName)));
  out.push('<div class="nodectl">');
  // The view controls live here rather than in the node block, because on
  // foot there is no node block and the zoom is the one control the map
  // always has. The wheel does the same thing, continuously.
  out.push('<button class="wide" data-act="zoomout">zoom out</button>');
  out.push('<button class="wide" data-act="zoomin">zoom in</button>');
  for (const name of r.focusOptions) {
    const on = name === r.focusName ? ' on' : '';
    out.push(`<button class="wide${on}" data-focus="${esc(name)}">`
      + `${esc(name)}</button>`);
  }
  out.push('</div>');
  return out.join('');
}

/** One row per registry vessel. The row selects; the button takes control. */
function vesselsBlock(vessels: readonly MapVesselRow[]): string {
  const out: string[] = ['<h4>Vessels</h4>'];
  if (vessels.length === 0) {
    out.push('<div class="note">Nothing in the registry: roll a rocket out '
      + 'and it appears here, and stays here when you leave it in orbit.</div>');
    return out.join('');
  }
  for (const v of vessels) {
    const sel = v.selected ? ' sel' : '';
    out.push(`<div class="vrow${sel}" data-sel="${v.id}">`);
    out.push(`<div class="vname">${esc(v.name)}`
      + `<span class="vmode">${esc(v.mode)}</span></div>`);
    const fuel = Number.isFinite(v.fuelKg) ? `${Math.round(v.fuelKg)} kg` : 'live';
    out.push(row('AP / PE', `${km(v.apoapsisAltM)} / ${km(v.periapsisAltM)}`));
    out.push(row('fuel', fuel));
    if (v.mode === 'flying') {
      out.push('<button class="wide" disabled>you are flying it</button>');
    } else {
      out.push(`<button class="wide" data-ctl="${v.id}">take control</button>`);
    }
    out.push('</div>');
  }
  return out.join('');
}

/** What the map is allowed to show, and why. Two layers, because height buys
 *  EXTENT and costs RESOLUTION: orbit fills in the shape of the world and
 *  walking fills in its detail. */
function discoveryBlock(r: MapReadout): string {
  const d = r.discovery;
  const out: string[] = ['<h4>Discovery</h4>'];
  if (d === null) {
    out.push(row('seen', 'nothing yet'));
    out.push('<div class="note">Nothing has been observed. Fly or walk and '
      + 'the world fills in.</div>');
    return out.join('');
  }
  // DW-31's stated failure mode is a player who forgot which mode they are
  // in, so the badge is first and it is plain.
  if (d.revealAll) out.push(row('mode', 'SANDBOX: everything visible', 'warn'));
  out.push(row('survey', `${d.surveyCells} · ${pct(d.surveyFraction)}`));
  out.push(row('last sweep', km(d.lastSurveyRadiusM)));
  out.push(row('explore', `${d.exploreCells} · ${pct(d.exploreFraction)}`));
  out.push(row('last sweep', km(d.lastExploreRadiusM)));
  out.push(row('cell', km(d.cellSizeM)));
  return out.join('');
}

function nodeBlock(r: MapReadout): string {
  const n = r.node;
  if (n === null) {
    return '<h4>Maneuver</h4>'
      + '<div class="nodectl">'
      + '<button class="wide" data-act="place">place node</button></div>'
      + '<div class="note">A node tells you the burn. It does not fly it.</div>';
  }
  const out: string[] = ['<h4>Maneuver</h4>'];
  out.push(row('dV', `${n.deltaVMS.toFixed(1)} m/s`,
    n.feasible ? 'good' : 'warn'));
  if (!n.feasible) {
    out.push(row('SHORT BY', `${n.shortfallMS.toFixed(0)} m/s`, 'warn'));
  }
  out.push(row('have', `${n.deltaVAvailableMS.toFixed(0)} m/s`));
  out.push(row('burn', `${n.burnDurationS.toFixed(1)} s`));
  // The number that matters most and is easiest to miss: START EARLY.
  out.push(row('light it in', clock(n.timeToBurnStartS),
    n.timeToBurnStartS < 0 ? 'warn' : n.timeToBurnStartS < 10 ? 'good' : ''));
  out.push(row('node in', clock(n.timeToNodeS)));
  if (n.stagesUsed > 1) out.push(row('stagings', `${n.stagesUsed - 1}`, 'warn'));
  if (n.burnFractionOfPeriod > 0.02) {
    out.push(row('long burn', `${(n.burnFractionOfPeriod * 100).toFixed(0)}% of an orbit`, 'warn'));
  }
  out.push(row('result AP', n.boundAfter ? km(n.apoapsisAltM) : 'ESCAPE'));
  out.push(row('result PE', km(n.periapsisAltM),
    n.periapsisAltM < r.scene.atmosphereCeilingM ? 'warn' : ''));
  out.push('<div class="nodectl">');
  for (const [axis, label, step] of HANDLES) {
    const v = axis === 'prograde' ? n.progradeMS
      : axis === 'normal' ? n.normalMS
        : axis === 'radial' ? n.radialMS : n.timeToNodeS;
    const shown = axis === 'time' ? clock(v) : v.toFixed(1);
    out.push(`<em>${label}</em>`
      + `<button data-axis="${axis}" data-delta="${-step}">-</button>`
      + `<em class="val">${shown}</em>`
      + `<button data-axis="${axis}" data-delta="${step}">+</button>`);
  }
  out.push(`<button class="wide${n.holding ? ' on' : ''}" data-act="hold">`
    + `${n.holding ? 'holding the node (8)' : 'hold node (8)'}</button>`);
  out.push('<button class="wide" data-act="clear">clear node</button>');
  out.push('</div>');
  out.push('<div class="note">Point at the node marker, then light the '
    + 'engine when "light it in" reaches zero. Half the burn goes before the '
    + 'node and half after.</div>');
  return out.join('');
}

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

export function plannerBlock(p: MapPlannerReadout | null): string {
  if (p === null) return '';
  const out: string[] = ['<h4>Autopilot</h4>'];
  if (p.waitingOn !== '') {
    out.push('<div class="note">The transfer solver is not on this bridge: '
      + `waiting for ${esc(p.waitingOn)}.</div>`);
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
  out.push(`<button class="wide${p.chosenFeasible ? '' : ' off'}" `
    + `data-plan-act="arm"${p.chosenFeasible ? '' : ' disabled'}>`
    + `${p.armed ? 'autopilot ARMED' : 'set autopilot for this departure'}`
    + '</button>');
  out.push('</div>');
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
