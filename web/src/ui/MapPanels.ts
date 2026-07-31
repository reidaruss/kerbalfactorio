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
import type { MapReadout, MapVesselRow } from './MapTypes.js';

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
