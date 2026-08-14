// The flight HUD: the navball, the readouts that flank it, and the stage
// delta-v table. Bottom centre, always on while flying, never a modal.
//
// DW-2 holds as everywhere under src/ui: plain data in, no three.js, no
// callbacks out (this panel is read-only, it flies nothing). The ONE exception
// to "HTML, not canvas" is the ball itself, which is a sphere seen edge on and
// cannot be expressed in boxes; every number beside it is still real text, so a
// screenshot carries its own evidence and a probe can read the DOM.
//
// DW-30 item 4: per-stage delta-v is not optional. The stage table is part of
// the flight HUD, not a VAB-only luxury, because the question "can this stage
// still circularise" is asked in flight and answered nowhere else.
//
// render() is called every frame, so it diffs: a rounded attitude key gates the
// canvas repaint and four string keys gate the four regions of text.

import './styles/navball.css';
import { esc } from './GameHud.js';
import type { NavPublication } from '../app/FlightNav.js';
import { labelOf } from '../player/Bindings.js';
import {
  dirOf, viewOf, frontMarks, drawBall, drawMarks, type Mark,
} from './NavballDraw.js';

export interface BallMarker { headingDeg: number; pitchDeg: number }

export interface StageReadout {
  index: number; dvVacMS: number; twr: number; burnS: number; active: boolean;
}

/**
 * GP-610. The hand pilot's numbers, and this instrument does NOT redeclare them.
 *
 * `NavPublication` is physics' published contract (`app/FlightNav.ts`), and
 * `FlightReadout` already spreads it onto the object this file is handed. So
 * the drawing side asks for the intersection and gets thirteen fields it cannot
 * disagree with about shape. Restating them here would have been a second copy
 * of somebody else's interface, which is the thing this project has paid for
 * five times over; and `Partial` is deliberately NOT used, because a field that
 * silently goes missing is exactly the class `mustNum` exists to make loud.
 */
export type NavballFullReadout = NavballReadout & NavPublication;

export interface NavballReadout {
  /** Vessel nose attitude in the LOCAL horizon frame. heading 0 = north,
   *  90 = east. pitch +90 = straight up. */
  headingDeg: number; pitchDeg: number; rollDeg: number;
  /** Markers in the same local horizon frame. null when undefined (e.g. zero
   *  velocity). */
  prograde: BallMarker | null;
  retrograde: BallMarker | null;
  /** The SAS commanded attitude. */
  command: BallMarker | null;
  /** DW-30 item 6: the gravity-turn guidance ribbon. Shown, never flown. */
  guidance: BallMarker | null;
  /** The maneuver node's burn direction. Reid asked for this by name ("then it
   *  should show up on the ball"), and it is the SAME machinery the other four
   *  markers use with a different direction: the node publishes an inertial
   *  unit vector and `FlightMode.marker` turns it into horizon angles through
   *  the one frame everything else uses. */
  node: BallMarker | null;
  /** Metres above the terrain under the vessel. */
  altitudeM: number;
  /** Metres above the 600 km datum, which is what apoapsis and periapsis are
   *  relative to. */
  altitudeDatumM: number;
  surfaceSpeedMS: number;
  orbitalSpeedMS: number;
  verticalSpeedMS: number;
  /** Metres above the datum. Not finite when the trajectory is unbound. */
  apoapsisM: number; periapsisM: number;
  /** True when the conic is closed. */
  bound: boolean;
  throttle: number;
  stages: StageReadout[];
  totalDvMS: number; remainingDvMS: number;
  sas: string;
  status: string;
  qPa: number; maxQPa: number; twr: number; massKg: number; gForce: number;
  metS: number;
  /** A STANDING condition the player is owed, drawn until it goes away. Not the
   *  same thing as `message`, which is a transient flash: a warning that scrolls
   *  past in four seconds is a warning nobody read. '' when there is none. */
  warning: string;
  /** GP-139: WHAT TO DO NEXT, standing, derived from state every frame. A third
   *  kind of thing and not a synonym for either of the other two: `warning` says
   *  something is wrong, `message` is a transient flash, and this says which key
   *  to press. All three can be true at once and each is drawn in its own chip,
   *  because a player who is told the vessel cannot be saved still needs to know
   *  how to light the engine. '' when nothing is owed. */
  nextStep: string;
  message: string;
  /**
   * PH-301. THE RCS, and it is on the ball because the storyline's first
   * docking is hand-flown and a translation key that does nothing has to say
   * WHY. `monopropKg` alone would not: a vehicle with fuel and no blocks and a
   * vehicle with blocks and no fuel are the same dead key and different fixes.
   *
   * Null when the vehicle has no RCS at all, so the row is absent rather than
   * reading 0 N on a rocket that was never going to have any.
   */
  rcs: { deliveredN: number; availableN: number; monopropKg: number } | null;
}

/** CSS pixels. The canvas backing store is this times the device ratio. */
const SIZE = 220;

export class Navball {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly chipsEl: HTMLElement;
  private readonly leftEl: HTMLElement;
  private readonly rightEl: HTMLElement;
  private readonly stagesEl: HTMLElement;
  private readonly footEl: HTMLElement;
  private readonly attEl: HTMLElement;
  private readonly thrEl: HTMLElement;
  private readonly dpr: number;
  private visible = true;
  private readonly burnEl: HTMLElement;
  private renders = 0;
  private marks: string[] = [];
  private snap: NavballReadout | null = null;
  /** [ball, left, right, stages, chips, throttle]. */
  // GP-610: slot 6 is the burn/target block. The array is sized by hand, so a
  // new region that forgot to widen it would silently share a neighbour's key
  // and stop redrawing; adding the slot in the same edit as the region is the
  // only thing that keeps them together.
  private last = ['', '', '', '', '', '', ''];

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-navball';
    this.root.className = 'of-ui';
    this.root.innerHTML = SKELETON;
    host.appendChild(this.root);
    this.chipsEl = this.pick('.of-nchips');
    this.leftEl = this.pick('.of-nread.left');
    this.rightEl = this.pick('.of-nread.right');
    this.stagesEl = this.pick('.of-nstage-rows');
    this.burnEl = this.root.querySelector('.of-nburn') as HTMLElement;
    this.footEl = this.pick('.of-nstage-foot');
    this.attEl = this.pick('.of-natt');
    this.thrEl = this.pick('.of-nthr');
    this.canvas = this.pick('canvas') as HTMLCanvasElement;
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(SIZE * this.dpr);
    this.canvas.height = Math.round(SIZE * this.dpr);
    this.ctx = this.canvas.getContext('2d');
  }

  private pick(sel: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(sel) as HTMLElement;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.style.display = on ? '' : 'none';
    if (!on) this.marks = [];
  }

  /** Force the next render to rebuild, ignoring the diff keys. */
  invalidate(): void { this.last = ['', '', '', '', '', '', '']; }

  render(r: NavballFullReadout): void {
    this.renders++;
    this.snap = r;
    if (!this.visible) { this.marks = []; return; }
    this.paint(r);
    this.chips(r);
    this.numbers(r);
    this.burn(r);
    this.table(r);
  }

  /**
   * The ball. Markers are filtered to the near hemisphere BEFORE drawing and
   * the surviving list is what report() publishes, so what a probe reads is
   * literally the set that was painted, not a second opinion about it.
   */
  private paint(r: NavballReadout): void {
    const w = viewOf(nm(r.headingDeg), nm(r.pitchDeg), nm(r.rollDeg));
    const all: Mark[] = [];
    add(all, 'prograde', r.prograde);
    add(all, 'retrograde', r.retrograde);
    add(all, 'command', r.command);
    add(all, 'guidance', r.guidance);
    add(all, 'node', r.node);
    const front = frontMarks(w, all);
    this.marks = front.map((m) => m.kind);
    const key = `${round(r.headingDeg)}/${round(r.pitchDeg)}/${round(r.rollDeg)}|`
      + all.map((m) => `${m.kind}:${round(m.dir.e)}:${round(m.dir.n)}:${round(m.dir.u)}`)
        .join(',');
    if (key === this.last[0]) return;
    this.last[0] = key;
    this.attEl.textContent = `HDG ${deg(r.headingDeg)}  PIT ${signed(r.pitchDeg, 0)}`
      + `  ROL ${signed(r.rollDeg, 0)}`;
    const c = this.ctx;
    if (c === null) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawBall(c, SIZE, w);
    drawMarks(c, SIZE, w, front);
  }

  private chips(r: NavballFullReadout): void {
    const warn = r.warning ?? '';
    const step = r.nextStep ?? '';
    // The warp and SAS terms join the diff key, or the chip row would keep
    // drawing a stale warp factor until the status happened to change.
    const key = `${r.status}|${r.sas}|${r.message}|${warn}|${step}`
      + `|${sasErr(r)}|${warpChip(r)}|${dockChip(r)}`;
    if (key === this.last[4]) return;
    this.last[4] = key;
    this.chipsEl.innerHTML = `<span class="chip st">${esc(r.status)}</span>`
      // GP-610. THE SAS CHIP SAYS WHETHER THE MODE IS WINNING, not just which
      // mode is on. `SAS HOLD` was drawn while the heading walked HDG 285 to
      // HDG 000 and nothing on the instrument distinguished a HELD nose from a
      // CHASING one. `sasErrDeg` existed in the flight report the whole time
      // (measured at 0.221 while the ball said HOLD) and never reached the ball.
      // `SAT` is drawn beside it because a saturated vehicle is being asked for
      // more torque than it has, which is the state in which a held mode never
      // arrives at all, and that is a different problem from a large error.
      + `<span class="chip sas${r.sas === 'OFF' ? ' off' : ''}">SAS `
      + `${esc(r.sas)}${sasErr(r)}</span>`
      + warpChip(r)
      // GP-139. THE INSTRUCTION COMES FIRST of the three, ahead of the standing
      // warning and the transient flash, because it is the only one of them the
      // player can act on and a narrow window truncates from the right. Reid sat
      // looking at `CLAMPED` with nothing to do; whatever else is on this row,
      // the thing to press has to survive.
      + (step === '' ? '' : `<span class="chip step">${esc(step)}</span>`)
      // The standing warning comes BEFORE the transient message, so a flash
      // cannot push it off the end of the row on a narrow window.
      + (warn === '' ? '' : `<span class="chip warn">${esc(warn)}</span>`)
      + dockChip(r)
      + (r.message === '' ? '' : `<span class="chip msg">${esc(r.message)}</span>`);
  }

  /** PH-301. The RCS cell, or nothing at all. `DRY` rather than `0 kg` because
   *  the number a player needs is not the quantity, it is that the keys have
   *  stopped working and why. */
  private rcsCellRows(r: NavballReadout): [string, string][] {
    if (r.rcs === null) return [];
    if (r.rcs.availableN <= 0) return [['RCS', 'DRY']];
    const on = r.rcs.deliveredN > 0 ? '  ON' : '';
    return [['RCS', `${fix(r.rcs.monopropKg, 0)} kg${on}`]];
  }

  private numbers(r: NavballFullReadout): void {
    const left = cells([
      ['ALT AGL', alt(r.altitudeM)],
      ['ALT MSL', alt(r.altitudeDatumM)],
      ['SRF', `${spd(r.surfaceSpeedMS)} m/s`],
      ['ORB', `${spd(r.orbitalSpeedMS)} m/s`],
      ['V/S', `${signed(r.verticalSpeedMS, 1)} m/s`],
      ['MET', met(r.metS)],
      // PH-301. Present only when the vehicle HAS thrusters (see the field's
      // own note): an absent row and a row reading zero are different claims.
      ...this.rcsCellRows(r),
    ]);
    // GP-610. THE FOUR KSP NUMBERS THAT EXISTED AND WERE DRAWN ONLY IN THE MAP.
    // A pilot flying an ascent watches the ball, not the map, and the sweep
    // called this the biggest expectation gap it found.
    //
    // `PE` NOW DRAWS ON `periapsisMeaningful` AND NOT ON `bound`, which is the
    // fix for `PE -600.00 km` on ascent. The old guard listed the two statuses
    // that produce it on the pad and could not exclude a near-vertical climb,
    // which produces the same figure with the vehicle flying. Physics published
    // the physical fact as its own boolean precisely so this cell does not need
    // a list of states to keep up to date, or a threshold of my own invention.
    // Same rule as GP-600: the number is information and the FLAG is the
    // verdict, so I draw their flag rather than deriving a second opinion.
    const right = cells([
      ['AP', conic(r.apoapsisM, r.bound) + at(r.timeToApoapsisS)],
      // A periapsis below the datum is not a place you pass through, it is the
      // ground. Saying so, with its time, is worth more than `---`: physics'
      // own note beside the field suggests exactly this.
      ['PE', r.periapsisMeaningful
        ? conic(r.periapsisM, true) + at(r.timeToPeriapsisS)
        : impact(r.timeToPeriapsisS, r.bound)],
      ...(nm(r.periodS) > 0 ? [['PER', clock(r.periodS)] as [string, string]] : []),
      ['TWR', fix(r.twr, 2)],
      ['MASS', mass(r.massKg)],
      ['Q', `${fix(nm(r.qPa) / 1000, 2)} kPa`],
      ['G', `${fix(r.gForce, 2)} g`],
    ]);
    if (left !== this.last[1]) { this.last[1] = left; this.leftEl.innerHTML = left; }
    if (right !== this.last[2]) { this.last[2] = right; this.rightEl.innerHTML = right; }
    const pct = Math.round(clamp01(r.throttle) * 100);
    const kThr = `${pct}|${fix(nm(r.maxQPa) / 1000, 1)}`;
    if (kThr === this.last[5]) return;
    this.last[5] = kThr;
    this.thrEl.innerHTML = '<em>THR</em>'
      + `<span class="bar"><i style="width:${pct}%"></i></span><b>${pct}%</b>`
      + `<span class="maxq">max Q ${fix(nm(r.maxQPa) / 1000, 1)} kPa</span>`;
  }

  /**
   * GP-610. THE BURN COUNTDOWN AND THE TARGET, and both are ABSENT when they do
   * not apply rather than drawn as zeroes. Same rule the RCS row already keeps:
   * an absent row and a row reading zero are different claims.
   *
   * THE TWO DELTA-V FIGURES ARE BOTH DRAWN AND THAT IS THE POINT. `plannedDvMS`
   * is the size of the plan and does not shrink because you flew some of it;
   * `remainingDvMS` is what is left. Before physics separated them, one field
   * read 200.00 m/s at BOTH ENDS of a burn that moved apoapsis by 294 km, so a
   * hand-flying player had no cut-off cue at all. Drawing only the remainder
   * would lose the size of the job; drawing only the plan is the old defect.
   *
   * AND THE POINTING ERROR IS DRAWN BESIDE THEM, because "80 m/s left" means
   * nothing on its own: a nose 90 degrees off is spending delta-v and taking
   * the remainder DOWN slower than the tank empties, and one pointing backwards
   * takes it UP. The two numbers are one instrument.
   */
  private burn(r: NavballFullReadout): void {
    const b = r.burn;
    const t = r.target;
    const key = b === null ? '-' : `${fix(b.startS, 0)}|${fix(b.remainingDvMS, 1)}`
      + `|${fix(b.pointingErrorDeg, 0)}|${b.feasible ? 1 : 0}|${fix(b.durationS, 0)}`;
    const tkey = t === null ? '-' : `${t.name}|${fix(t.rangeM, 0)}`
      + `|${fix(t.closingMS, 2)}|${t.frozen ? 1 : 0}`;
    if (`${key}#${tkey}` === this.last[6]) return;
    this.last[6] = `${key}#${tkey}`;
    let html = '';
    if (b !== null) {
      // NEGATIVE IS LATE, and it is drawn as such rather than clamped to zero.
      // "T-0:00" held for thirty seconds while the window closes is the same
      // lie as a warp label that says 1000x: it reports the number the pilot
      // wishes were true. `signed` keeps the minus sign visible.
      const late = nm(b.startS) < 0;
      html += '<div class="of-burnrow' + (late ? ' late' : '') + '">'
        + `<em>BURN IN</em><b>${late ? '-' : ''}${clock(Math.abs(nm(b.startS)))}</b>`
        + `<em>FOR</em><b>${clock(b.durationS)}</b>`
        + `<em>&#916;v LEFT</em><b>${fix(b.remainingDvMS, 1)}`
        + `<span class="of-of">of ${fix(b.plannedDvMS, 1)}</span></b>`
        + `<em>POINT</em><b class="${nm(b.pointingErrorDeg) > 10 ? 'warn' : ''}">`
        + `${fix(b.pointingErrorDeg, 1)}&deg;</b>`
        // FEASIBLE IS DRAWN ONLY WHEN IT IS FALSE. A chip reading "feasible" on
        // every node the player ever plans is noise they learn to stop reading,
        // and the one time it matters it looks the same as all the others.
        + (b.feasible ? ''
          : '<b class="warn">not enough &#916;v in the vehicle</b>')
        + '</div>';
    }
    if (t !== null) {
      // POSITIVE IS CLOSING, per physics' own note, so the sign carries the
      // whole information: 100 m out at +0.2 is arriving and 100 m out at -0.2
      // is drifting away. `signed` never hides it.
      html += '<div class="of-burnrow tgt">'
        + `<em>TGT</em><b>${esc(t.name)}</b>`
        + `<em>RANGE</em><b>${alt(t.rangeM)}</b>`
        + `<em>CLOSING</em><b>${signed(t.closingMS, 2)} m/s</b>`
        // GP-610 / Admin's steer, and it is the sandbox ruling again: a number
        // is information and the flag is the verdict. The station's record is
        // not always stamped, and while it is not, the range above is a
        // SNAPSHOT rather than a measurement. Hiding the row would throw away a
        // true number; drawing it silently would be the `PE -600 km` mistake in
        // a new place. So the number stays and the flag says what it is worth.
        + (t.frozen
          ? '<b class="warn" title="the target\'s clock is not running, so this '
            + 'range is where it was, not where it is">SNAPSHOT</b>' : '')
        + '</div>';
    }
    this.burnEl.innerHTML = html;
  }

  /** DW-30 item 4. A stage with no delta-v reads as a fault, not as a blank. */
  private table(r: NavballReadout): void {
    const st = r.stages;
    const key = st.map((s) => `${s.index}:${fix(s.dvVacMS, 0)}:${fix(s.twr, 2)}:`
      + `${fix(s.burnS, 0)}:${s.active ? 1 : 0}`).join(',')
      + `|${fix(r.totalDvMS, 0)}|${fix(r.remainingDvMS, 0)}`;
    if (key === this.last[3]) return;
    this.last[3] = key;
    this.stagesEl.innerHTML = st.length === 0
      ? '<div class="none">no stages</div>'
      : st.map((s) => `<div class="r${s.active ? ' on' : ''}">`
        + `<span>${Math.round(nm(s.index))}</span>`
        + `<b${nm(s.dvVacMS) > 0 ? '' : ' class="warn"'}>${fix(s.dvVacMS, 0)}</b>`
        + `<span>${fix(s.twr, 2)}</span>`
        + `<span>${fix(s.burnS, 0)}s</span></div>`).join('');
    this.footEl.innerHTML = `<div class="f"><em>&#916;v left</em>`
      + `<b>${fix(r.remainingDvMS, 0)}</b></div>`
      + `<div class="f"><em>total</em><b>${fix(r.totalDvMS, 0)}</b></div>`;
  }

  /**
   * What a headless probe reads. `renders` is the whole point of it: a navball
   * that is mounted but never fed and one that is live look identical in a
   * screenshot, and they must not look identical here.
   */
  report(): unknown {
    const r = this.snap;
    return {
      visible: this.visible,
      headingDeg: r === null ? 0 : nm(r.headingDeg),
      pitchDeg: r === null ? 0 : nm(r.pitchDeg),
      rollDeg: r === null ? 0 : nm(r.rollDeg),
      altitudeM: r === null ? 0 : nm(r.altitudeM),
      altitudeDatumM: r === null ? 0 : nm(r.altitudeDatumM),
      apoapsisM: r === null ? 0 : r.apoapsisM,
      periapsisM: r === null ? 0 : r.periapsisM,
      bound: r !== null && r.bound,
      surfaceSpeedMS: r === null ? 0 : nm(r.surfaceSpeedMS),
      orbitalSpeedMS: r === null ? 0 : nm(r.orbitalSpeedMS),
      verticalSpeedMS: r === null ? 0 : nm(r.verticalSpeedMS),
      throttle: r === null ? 0 : clamp01(r.throttle),
      stages: r === null ? 0 : r.stages.length,
      totalDvMS: r === null ? 0 : nm(r.totalDvMS),
      remainingDvMS: r === null ? 0 : nm(r.remainingDvMS),
      status: r === null ? '' : r.status,
      // GP-139: read off the ELEMENT, not off the readout, so the assertion is
      // the painted chip against the derivation rather than the derivation
      // against itself.
      step: this.chipsEl.querySelector('.chip.step')?.textContent ?? '',
      sas: r === null ? '' : r.sas,
      // Read off the DOM, not off the readout: a probe asking "is the player
      // being told" must be answered by the pixels, not by the intention.
      warning: this.chipsEl.querySelector('.chip.warn')?.textContent ?? '',
      markersDrawn: [...this.marks],
      renders: this.renders,
    };
  }

  dispose(): void {
    this.root.remove();
    this.marks = [];
    this.snap = null;
  }
}

/** The static frame. Built once; render() only refills the marked regions. */
const SKELETON =
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

function add(out: Mark[], kind: Mark['kind'], m: BallMarker | null): void {
  if (m === null || m === undefined) return;
  if (!Number.isFinite(m.headingDeg) || !Number.isFinite(m.pitchDeg)) return;
  out.push({ kind, dir: dirOf(m.headingDeg, m.pitchDeg) });
}

function cells(rows: readonly (readonly [string, string])[]): string {
  return rows.map(([k, v]) => `<div class="c"><em>${k}</em><b>${v}</b></div>`).join('');
}

/**
 * GP-610. " in 1:23" for a time that exists, and NOTHING for one that does not.
 * -1 is physics' "there is no such time" (an unbound trajectory has no
 * apoapsis), and it must never reach the eye as a number: `AP 120 km in -1`
 * would be the same class of defect as `PE -600.00 km`, which is a true number
 * printed where it cannot mean anything.
 */
function at(secs: number): string {
  return Number.isFinite(secs) && secs >= 0 ? `  in ${clock(secs)}` : '';
}

/**
 * What to draw where the periapsis would go when the periapsis is underground.
 *
 * `---` is honest and useless. If the conic is closed and its low point is
 * below the datum, the vehicle is on a trajectory that meets the ground, and
 * WHEN is the single most useful number on the instrument at that moment.
 */
function impact(secs: number, bound: boolean): string {
  return bound && Number.isFinite(secs) && secs >= 0
    ? `impact in ${clock(secs)}` : '---';
}

/** h:mm:ss past an hour, m:ss below it. An orbital period is often both. */
function clock(secs: number): string {
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
function dockChip(r: NavballFullReadout): string {
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

function sasErr(r: NavballFullReadout): string {
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
function warpChip(r: NavballFullReadout): string {
  const asked = nm(r.warpFactor);
  const got = nm(r.warpEffectiveX);
  if (asked <= 1 && got <= 1) return '';
  const why = r.warpLimitedBy === '' ? '' : `  (${esc(r.warpLimitedBy)} limit)`;
  const differ = Math.abs(asked - got) > 0.01;
  return `<span class="chip warp${differ ? ' held' : ''}">warp ${trim(got)}x`
    + (differ ? `  asked ${trim(asked)}x${why}` : '') + '</span>';
}

/** 10 rather than 10.0, but 2.5 rather than 3. */
function trim(v: number): string {
  const a = nm(v);
  return Number.isInteger(a) ? a.toFixed(0) : a.toFixed(1);
}

/** A missing number reads as zero, never as NaN and never as a blank cell. */
function nm(v: number): number { return Number.isFinite(v) ? v : 0; }

function fix(v: number, d: number): string { return nm(v).toFixed(d); }

function clamp01(v: number): number { return Math.max(0, Math.min(1, nm(v))); }

function round(v: number): number { return Math.round(nm(v) * 4) / 4; }

/** Metres up to 10 km, kilometres past it, megametres once in deep space.
 *  `+ 0` is not decoration: without it a rocket standing on the pad reads
 *  "-0 m", because IEEE negative zero survives `toFixed`. */
function alt(v: number): string {
  const a = nm(v) + 0;
  const m = Math.abs(a);
  if (m < 5e-4) return '0 m';
  if (m >= 1e6) return `${(a / 1e6).toFixed(3)} Mm`;
  if (m >= 1e4) return `${(a / 1e3).toFixed(2)} km`;
  return `${a.toFixed(0)} m`;
}

/** An unbound conic has no apoapsis to print and no honest way to fake one. */
function conic(v: number, bound: boolean): string {
  return bound && Number.isFinite(v) ? alt(v) : '---';
}

function spd(v: number): string {
  const a = nm(v);
  return Math.abs(a) >= 1000 ? a.toFixed(0) : a.toFixed(1);
}

function signed(v: number, d: number): string {
  const a = nm(v);
  return `${a >= 0 ? '+' : ''}${a.toFixed(d)}`;
}

/** Three digits, so 090 and 009 are the same width on the eye. */
function deg(v: number): string {
  const a = ((Math.round(nm(v)) % 360) + 360) % 360;
  return `00${a}`.slice(-3);
}

function mass(kg: number): string {
  const v = nm(kg);
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} t` : `${v.toFixed(0)} kg`;
}

/** mm:ss, and the minutes are allowed past 59 rather than wrapping silently. */
function met(s: number): string {
  const t = Math.max(0, Math.floor(nm(s)));
  const m = Math.floor(t / 60);
  return `${m < 10 ? '0' : ''}${m}:${`0${t % 60}`.slice(-2)}`;
}
