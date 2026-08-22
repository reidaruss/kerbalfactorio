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
//
// Split (line-cap batch 2, BT-285) into NavballTypes.ts (the readout shapes)
// and NavballFormat.ts (the skeleton string and the text formatters); this
// file stays the barrel and the class, re-exporting the type shapes so no
// import site outside this file changes.

import './styles/navball.css';
import { esc } from './GameHud.js';
import {
  viewOf, frontMarks, drawBall, drawMarks, type Mark,
} from './NavballDraw.js';
import {
  SIZE, SKELETON, add, cells, at, impact, clock, dockChip, approachChip, sasErr,
  warpChip, nm, fix, clamp01, round, alt, conic, spd, signed, deg, mass, met,
} from './NavballFormat.js';

import type { NavballFullReadout, NavballReadout } from './NavballTypes.js';
export type { BallMarker, StageReadout, NavballFullReadout, NavballReadout }
  from './NavballTypes.js';

// BT-320 (R-DEV-1). SIZE now lives in NavballFormat.ts and is re-imported
// here rather than declared here and imported there: see that file's header
// for why the old direction was a circular-import TDZ under the unbundled
// dev server. Re-exported so any external importer of `SIZE` from this
// module (none found by grep at the time of the fix, but this is the public
// barrel) keeps working unchanged.
export { SIZE };

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
      + `|${sasErr(r)}|${warpChip(r)}|${dockChip(r)}|${approachChip(r)}`;
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
      + approachChip(r)
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
