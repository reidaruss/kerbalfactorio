// The navball's static HTML skeleton and its text-formatting helpers. Split
// out of Navball.ts (line-cap batch 2, BT-285): none of this holds instance
// state (the class's own mutable fields never leave Navball.ts), it is pure
// functions of a readout to a string plus the one-time skeleton string, so it
// moves as a unit and the class imports it back unchanged at every call site.

import { esc } from './GameHud.js';
import { labelOf } from '../player/Bindings.js';
import { dirOf, type Mark } from './NavballDraw.js';
import type { BallMarker, NavballFullReadout } from './NavballTypes.js';
import { SIZE } from './Navball.js';

/** The static frame. Built once; render() only refills the marked regions. */
export const SKELETON =
  '<div class="of-nchips"></div>'
  + '<div class="of-npanel"><div class="of-ncore">'
  + '<div class="of-nspace"></div>'
  + '<div class="of-nread left"></div>'
  + `<div class="of-nball"><canvas width="${SIZE}" height="${SIZE}" `
  + `style="width:${SIZE}px;height:${SIZE}px"></canvas>`
  + '<div class="of-natt"></div></div>'
  + '<div class="of-nread right"></div>'
  // GP-610. THE BURN AND TARGET BLOCK, between the ball and the stage table.
  // It is its own region rather than two more rows in the right-hand column
  // because it is the thing a pilot stares at during the twenty seconds that
  // decide the mission, and because it is ABSENT most of the time: there is
  // no node and no target on an ascent, and an empty region costs no pixels.
  + '<div class="of-nburn"></div>'
  + '<div class="of-nstages"><h4>Stages<span>&#916;v / TWR / burn</span></h4>'
  + '<div class="of-nstage-rows"></div><div class="of-nstage-foot"></div></div>'
  + '</div><div class="of-nthr"></div></div>';

export function add(out: Mark[], kind: Mark['kind'], m: BallMarker | null): void {
  if (m === null || m === undefined) return;
  if (!Number.isFinite(m.headingDeg) || !Number.isFinite(m.pitchDeg)) return;
  out.push({ kind, dir: dirOf(m.headingDeg, m.pitchDeg) });
}

export function cells(rows: readonly (readonly [string, string])[]): string {
  return rows.map(([k, v]) => `<div class="c"><em>${k}</em><b>${v}</b></div>`).join('');
}

/**
 * GP-610. " in 1:23" for a time that exists, and NOTHING for one that does not.
 * -1 is physics' "there is no such time" (an unbound trajectory has no
 * apoapsis), and it must never reach the eye as a number: `AP 120 km in -1`
 * would be the same class of defect as `PE -600.00 km`, which is a true number
 * printed where it cannot mean anything.
 */
export function at(secs: number): string {
  return Number.isFinite(secs) && secs >= 0 ? `  in ${clock(secs)}` : '';
}

/**
 * What to draw where the periapsis would go when the periapsis is underground.
 *
 * `---` is honest and useless. If the conic is closed and its low point is
 * below the datum, the vehicle is on a trajectory that meets the ground, and
 * WHEN is the single most useful number on the instrument at that moment.
 */
export function impact(secs: number, bound: boolean): string {
  return bound && Number.isFinite(secs) && secs >= 0
    ? `impact in ${clock(secs)}` : '---';
}

/** h:mm:ss past an hour, m:ss below it. An orbital period is often both. */
export function clock(secs: number): string {
  const t = Math.max(0, Math.round(nm(secs)));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = `0${t % 60}`.slice(-2);
  return h > 0 ? `${h}:${`0${m}`.slice(-2)}:${ss}` : `${m}:${ss}`;
}

/**
 * GP-610. The SAS error, in degrees, appended to the mode chip.
 *
 * Drawn only when SAS is actually ON: an error figure beside `SAS OFF` is a
 * measurement of nothing, and the mode chip is the one thing on this row a
 * player reads at a glance.
 */
/**
 * PH-367. THE DOCK CHIP, ON THE SAS CHIP'S OWN ARGUMENT.
 *
 * The SAS chip says which mode is on and `sasErr` says whether the mode is
 * WINNING, and R89's whole lesson is that the second half is the one a pilot
 * needs. A docking control has exactly that shape: `DOCK` alone would say a
 * verb is available and nothing about whether it can be used, which for a
 * control whose window is 0.60 m wide is no information at all.
 *
 * SO IT IS VISIBLE WHENEVER THERE IS A TARGET, AND IT ALWAYS SAYS WHY. Out of
 * range, not lined up, closing too fast: each names the gate that is shut, and
 * the numbers beside it are the measurement against /core's own limit, so a
 * player 0.9 m out reads `0.90 / 0.60 m` rather than a dark button. GP-56's
 * rule, and `PauseRootHtml`'s `blocked` row is the shipped precedent for a
 * disabled control that carries its reason as visible text rather than a
 * tooltip.
 *
 * It draws NOTHING when there is no target at all, which is the one case where
 * silence is honest: a rocket on the pad has no business being told it cannot
 * dock.
 */
export function dockChip(r: NavballFullReadout): string {
  const d = r.dock;
  if (d === undefined || !d.hasTarget) return '';
  if (d.docked) {
    return `<span class="chip dock on">DOCKED ${esc(d.targetName)}`
      + `  ${esc(labelOf('dock'))} to release</span>`;
  }
  // THE MEASUREMENT AND THE LIMIT, both, always. A separation on its own is a
  // number; a separation against the radius it is judged by is an instruction.
  const near = d.separationM < 1000;
  const range = near
    ? `${fix(d.separationM, 2)} / ${fix(d.captureRadiusM, 2)} m`
    : `${fix(d.separationM / 1000, 2)} km`;
  // The sign of the closing rate is the whole information at close range.
  const rate = near ? `  ${d.closingMS >= 0 ? '+' : ''}${fix(d.closingMS, 2)}` : '';
  if (d.available) {
    return `<span class="chip dock ready">DOCK ${esc(labelOf('dock'))}`
      + `  ${range}${rate}</span>`;
  }
  return `<span class="chip dock off">DOCK  ${esc(d.why)}`
    + `  ${range}${rate}</span>`;
}

/**
 * PH-382. THE AUTO-APPROACH CHIP, and it is drawn WHENEVER THERE IS A TARGET,
 * including while the feature is still locked.
 *
 * That last part is the decision. The dock chip's rule is that silence is
 * honest when there is nothing to dock to, and this inherits it. But a LOCKED
 * control is the opposite case: the whole point of Reid's task-39 ordering is
 * that the player flies the first station mission by hand, and a player who is
 * never told the automation exists cannot look forward to earning it. So the
 * locked state draws, dim, carrying the sentence that names what would open it,
 * which is GP-56's rule applied to a progression gate rather than to a range.
 *
 * It does not draw the range or the closing rate: the dock chip beside it
 * already carries both, from the same tick, and two copies of one measurement
 * on one row is how they come to disagree.
 */
export function approachChip(r: NavballFullReadout): string {
  const a = r.approach;
  const d = r.dock;
  if (a === undefined || d === undefined || !d.hasTarget) return '';
  if (a.running) {
    return `<span class="chip appr running">AUTO ${esc(a.legWord)}`
      + `  ${esc(a.why)}  ${esc(labelOf('autoApproach'))} to stop</span>`;
  }
  if (a.available) {
    return `<span class="chip appr ready">AUTO ${esc(labelOf('autoApproach'))}`
      + `  ${esc(a.why)}</span>`;
  }
  return `<span class="chip appr">AUTO  ${esc(a.why)}</span>`;
}

export function sasErr(r: NavballFullReadout): string {
  if (r.sas === 'OFF' || !Number.isFinite(r.sasErrDeg)) return '';
  return `  ${fix(r.sasErrDeg, 1)}\u00b0${r.sasSaturated ? '  SAT' : ''}`;
}

/**
 * GP-610. THE WARP CHIP, AND IT DRAWS THE RATE THE SIM IS ACTUALLY RUNNING AT.
 *
 * The flight sweep measured the chip flashing `warp 1000x` while the simulation
 * advanced 10 MET-seconds per second, a lie of 100x, and it was the ONLY thing
 * ever drawn about warp: the old flash expired after five seconds, so 32 s at
 * ladder 200x in orbit drew no warp indicator at all.
 *
 * So this is STANDING rather than transient, it draws `warpEffectiveX` (what
 * the sim did) rather than `warpFactor` (what was asked), and when they differ
 * it says both and names the limit. Nothing here computes a rate: all three
 * numbers are physics' own.
 */
export function warpChip(r: NavballFullReadout): string {
  const asked = nm(r.warpFactor);
  const got = nm(r.warpEffectiveX);
  if (asked <= 1 && got <= 1) return '';
  const why = r.warpLimitedBy === '' ? '' : `  (${esc(r.warpLimitedBy)} limit)`;
  const differ = Math.abs(asked - got) > 0.01;
  return `<span class="chip warp${differ ? ' held' : ''}">warp ${trim(got)}x`
    + (differ ? `  asked ${trim(asked)}x${why}` : '') + '</span>';
}

/** 10 rather than 10.0, but 2.5 rather than 3. */
export function trim(v: number): string {
  const a = nm(v);
  return Number.isInteger(a) ? a.toFixed(0) : a.toFixed(1);
}

/** A missing number reads as zero, never as NaN and never as a blank cell. */
export function nm(v: number): number { return Number.isFinite(v) ? v : 0; }

export function fix(v: number, d: number): string { return nm(v).toFixed(d); }

export function clamp01(v: number): number { return Math.max(0, Math.min(1, nm(v))); }

export function round(v: number): number { return Math.round(nm(v) * 4) / 4; }

/** Metres up to 10 km, kilometres past it, megametres once in deep space.
 *  `+ 0` is not decoration: without it a rocket standing on the pad reads
 *  "-0 m", because IEEE negative zero survives `toFixed`. */
export function alt(v: number): string {
  const a = nm(v) + 0;
  const m = Math.abs(a);
  if (m < 5e-4) return '0 m';
  if (m >= 1e6) return `${(a / 1e6).toFixed(3)} Mm`;
  if (m >= 1e4) return `${(a / 1e3).toFixed(2)} km`;
  return `${a.toFixed(0)} m`;
}

/** An unbound conic has no apoapsis to print and no honest way to fake one. */
export function conic(v: number, bound: boolean): string {
  return bound && Number.isFinite(v) ? alt(v) : '---';
}

export function spd(v: number): string {
  const a = nm(v);
  return Math.abs(a) >= 1000 ? a.toFixed(0) : a.toFixed(1);
}

export function signed(v: number, d: number): string {
  const a = nm(v);
  return `${a >= 0 ? '+' : ''}${a.toFixed(d)}`;
}

/** Three digits, so 090 and 009 are the same width on the eye. */
export function deg(v: number): string {
  const a = ((Math.round(nm(v)) % 360) + 360) % 360;
  return `00${a}`.slice(-3);
}

export function mass(kg: number): string {
  const v = nm(kg);
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} t` : `${v.toFixed(0)} kg`;
}

/** mm:ss, and the minutes are allowed past 59 rather than wrapping silently. */
export function met(s: number): string {
  const t = Math.max(0, Math.floor(nm(s)));
  const m = Math.floor(t / 60);
  return `${m < 10 ? '0' : ''}${m}:${`0${t % 60}`.slice(-2)}`;
}

