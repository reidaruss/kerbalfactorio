// Pure HTML for the assembly panel: strings in, strings out, no state and no
// DOM. Split out of `VabPanel.ts` at the 400-line cap, and it is the right seam
// anyway, because everything here is a function of its arguments and can be read
// without knowing what the panel is doing.
import { esc } from './GameHud.js';
import type { VabPartRow, VabStageRow, VabStats, VabVerdict } from './VabPanelTypes.js';

/** Catalogue order. Anything not listed sorts after, in first-seen order. */
const GROUPS = ['Command', 'Fuel', 'Engines', 'Coupling', 'Aero', 'Structural',
  'Control', 'Power', 'Utility'];

/** GP-120. Short tab labels. A tab strip is only worth having if the labels fit
 *  on one line at 330 px, which "Structural" and "Coupling" do not both do. */
export const TAB_LABEL: Record<string, string> = {
  Command: 'Pod', Fuel: 'Fuel', Engines: 'Engine', Coupling: 'Couple',
  Aero: 'Aero', Structural: 'Struct', Control: 'Ctrl', Power: 'Power',
  Utility: 'Util',
};

/** The groups present, in GROUPS order, unknown ones last in first-seen order. */
export function groupsOf(parts: readonly VabPartRow[]): string[] {
  const seen: string[] = [];
  for (const p of parts) if (!seen.includes(p.group)) seen.push(p.group);
  return seen.sort((a, b) => rank(a) - rank(b));
}

/** The static frame. Built once; render() only fills the marked regions. */
export const SKELETON =
  '<div class="rail left"><h3>Parts</h3><div class="of-vtabs"></div>'
  + '<div class="of-vparts"></div></div>'
  + '<div class="rail right"><h3>Vehicle</h3><div class="of-vread"></div>'
  + '<h3 class="mid">Stages</h3><div class="of-vstages"></div></div>'
  + '<div class="foot"><div class="of-vmsg"></div><div class="of-vbar">'
  + '<span class="grp sym"></span>'
  + '<span class="grp"><input id="of-vab-name" data-vab="name" type="text" '
  + 'maxlength="40" placeholder="design name" autocomplete="off" '
  + 'spellcheck="false"><button type="button" class="go" data-vab="save">'
  + 'Save</button></span>'
  + '<span class="grp designs"></span>'
  + '<span class="grp acts"><button type="button" data-vab="autostage">'
  + 'Autostage</button><button type="button" data-vab="clear">Clear</button>'
  + '<button type="button" class="go" data-vab="exit">Exit VAB</button>'
  // GP-54. The way OUT of the bay and into the sky, named on screen. The key
  // works too and the label says which one, because a player who learns the key
  // here never needs the button again, and a player who never finds the key has
  // to ask, which is exactly what happened.
  + '<button type="button" class="go launch" data-vab="rollout" '
  + 'title="Leave the bay and set the rocket down in front of you">'
  + 'Roll out &nbsp;<kbd>G</kbd></button>'
  // GP-121 / R11. `recover` shipped complete at GP-74 with a key, a label, an
  // argued no-refund rule and every message it needs, and no button anywhere.
  // A player whose pad is occupied has to already know a key to clear it.
  + '<button type="button" data-vab="recover" '
  + 'title="Take the vessel off the pad and keep the design">'
  + 'Clear pad &nbsp;<kbd>Del</kbd></button></span>'
  + '</div></div>';

/**
 * GP-118. THE VERDICT BAND: the loudest thing on the right rail when it is bad,
 * and one quiet line when it is not.
 *
 * It sits ABOVE the readouts rather than below the stage list because the two
 * facts it exists to catch (a stage that will not lift, a stage that does
 * nothing) were BOTH already on this screen as numbers, and a number nobody
 * reads is exactly what cost two build cycles. A verdict is a number that
 * argues with you.
 */
export function verdictBand(v: VabVerdict): string {
  // On a fault the summary IS the join of the fault lines, so printing both
  // would say the same sentence twice, which is what the first version did.
  const head = v.ok ? `<span>${esc(v.summary)}</span>` : '';
  const lines = (v.ok ? v.warnings : v.faults).map((x) => `<i>${esc(x.text)}</i>`);
  return `<div class="of-vverdict ${v.ok ? 'ok' : 'bad'}">`
    + `<b>${v.ok ? 'FLIGHT READY' : 'WILL NOT FLY'}</b>`
    + head + lines.join('') + '</div>';
}

function rank(g: string): number {
  const i = GROUPS.indexOf(g);
  return i < 0 ? GROUPS.length : i;
}

export function partRow(p: VabPartRow): string {
  // No `disabled` on an unaffordable row, deliberately: the player still gets
  // to press it, and the caller answers with a message that names what is
  // missing. A dead button teaches nothing.
  return `<button type="button" class="of-vpart${p.selected ? ' on' : ''}`
    + `${p.affordable ? '' : ' poor'}" data-vab="part" data-index="${p.index}" `
    + `aria-pressed="${p.selected ? 'true' : 'false'}">`
    + `<span class="top"><span class="nm">${esc(p.name)}</span>`
    + `<span class="cls">${esc(p.cls)}</span></span>`
    + `<span class="det">${esc(p.detail)}</span>`
    + `<span class="cost">${esc(p.cost)}</span></button>`;
}

export function readouts(s: VabStats, v: VabVerdict): string {
  // GP-118. `Lift TWR`, not `Pad TWR`. `stats.padTwr` is stage 0's TWR, and on
  // any staged rocket whose burn 0 is a decoupler group that is 0.00, which
  // reads as a dead rocket and is not one (GP-73). The number a player needs is
  // the TWR of the burn that actually lifts, and the label says which burn.
  const twrLow = v.liftTwr < 1 && s.parts > 0;
  const twrLabel = v.liftBurn >= 0 ? `Lift TWR (s${v.liftBurn})` : 'Lift TWR';
  return '<div class="big"><em>Total &#916;v</em>'
    + `<b>${fix(s.totalDeltaV, 0)}</b><i>m/s</i></div>`
    + '<div class="cells">'
    + cell('Launch mass', grp(s.massKg), 'kg', '')
    + cell(twrLabel, fix(v.liftTwr, 2), '', twrLow ? 'warn' : '')
    + cell('Parts', `${Math.max(0, Math.round(num(s.parts)))}`, '', '')
    + cell('Length', fix(s.lengthM, 2), 'm', '')
    + cell('Dry', grp(s.dryKg), 'kg', '')
    + cell('Propellant', grp(s.propellantKg), 'kg', '')
    + cell('Crew', `${Math.max(0, Math.round(num(s.crew)))}`, '', '')
    + cell('Static margin', fix(s.staticMarginM, 2), 'm', s.stable ? '' : 'warn')
    + '</div>'
    + `<div class="stab ${s.stable ? 'ok' : 'bad'}">Stability `
    + `<b>${s.stable ? 'stable' : 'UNSTABLE'}</b></div>`;
}

function cell(label: string, value: string, unit: string, cls: string): string {
  return `<div class="cell"><em>${label}</em>`
    + `<b${cls === '' ? '' : ` class="${cls}"`}>${value}</b>`
    + (unit === '' ? '' : `<i>${unit}</i>`) + '</div>';
}

export function stageRow(s: VabStageRow, first: boolean, last: boolean): string {
  // The stage NUMBER shown is the same integer the callbacks take, so what a
  // probe reads on screen is what it passes back. No off-by-one to translate.
  //
  // GP-118: TWR is drawn against the rule that matters for THIS stage rather
  // than as a bare figure. On the burn that lifts the vehicle, below 1.00 is a
  // fault and is coloured as one; on every later burn a TWR under 1 is normal
  // and colouring it would train the player to ignore the colour.
  const twrBad = s.lifts && num(s.twr) < 1;
  return `<div class="of-vstage${s.fault ? ' fault' : ''}${s.lifts ? ' lifts' : ''}">`
    + '<div class="hd">'
    + `<b>Stage ${Math.round(num(s.index))}</b>`
    + (s.lifts ? '<span class="tag">lifts</span>' : '')
    + `<span>${Math.max(0, Math.round(num(s.partCount)))} parts</span>`
    + mv('stage-up', s.index, first, '&#9650;', 'Move this stage earlier')
    + mv('stage-down', s.index, last, '&#9660;', 'Move this stage later')
    + '</div><div class="figs">'
    // A dead stage is a fault, not a blank: 0 m/s in the warning colour.
    + fig('&#916;v', `${fix(s.deltaV, 0)} m/s`, num(s.deltaV) > 0 ? '' : 'warn')
    + fig('TWR', fix(s.twr, 2), twrBad ? 'bad' : '')
    + fig('burn', `${fix(s.burnS, 1)} s`, '')
    + fig('thrust', `${fix(s.thrustKN, 1)} kN`, '')
    + fig('engines', `${Math.max(0, Math.round(num(s.engines)))}`,
      num(s.engines) > 0 ? '' : 'warn')
    + fig('drops', `${Math.max(0, Math.round(num(s.decouplers)))}`, '')
    + '</div></div>';
}

function fig(label: string, value: string, cls: string): string {
  return `<div class="f"><em>${label}</em>`
    + `<b${cls === '' ? '' : ` class="${cls}"`}>${value}</b></div>`;
}

function mv(kind: string, index: number, off: boolean, glyph: string,
            title: string): string {
  return `<button type="button" class="mv" data-vab="${kind}" `
    + `data-index="${Math.round(num(index))}"${off ? ' disabled' : ''} `
    + `title="${title}">${glyph}</button>`;
}

export function chip(name: string): string {
  const n = esc(name);
  return `<span class="of-vchip"><button type="button" data-vab="design" `
    + `data-name="${n}" title="Load this design">${n}</button>`
    + `<button type="button" class="del" data-vab="design-del" data-name="${n}" `
    + 'title="Delete this design">&#215;</button></span>';
}

/** An empty design reads as zeros, never as NaN and never as a blank cell. */
function num(v: number): number { return Number.isFinite(v) ? v : 0; }

export function fix(v: number, d: number): string { return num(v).toFixed(d); }

/** Thousands separators, because a launch mass is a five-digit number and
 *  "12500" and "125000" are the same shape at a glance. */
function grp(v: number): string {
  const n = Math.round(num(v));
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s;
}
