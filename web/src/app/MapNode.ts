// =============================================================================
// MapNode.ts - the maneuver node's state and its plan, lifted out of MapMode.
//
// Lifted VERBATIM (GP-206): MapMode sat one line under the 400 cap and the 3D
// view had to live somewhere, so the node moved as a unit rather than the file
// being shaved. Nothing about the node changed in the move; the comments came
// with the code because they are the record of how each line got its shape.
//
// A NODE IS A PLAN AND NOT AN AUTOPILOT (PH-37). Nothing in this file sets a
// throttle, starts a burn, warps to a node or cuts an engine. It computes what
// a burn would cost, which way to point, when to light it and how long for, and
// then a human does all four. DW-29 gates autopilot behind a research unlock.
//
// A node is anchored to an ABSOLUTE mission time, never to "seconds from now".
// That was the fatal defect the driven probe found: `tFromNowS` stored and
// handed to /core unchanged every frame slid the node along the orbit WITH the
// vessel, the countdown bit-identical forever, every number internally
// consistent, and the burn unflyable. `atS` is the fix and the reason.
// =============================================================================
import { nodePlan, orbitMeta } from '../sim/ManeuverAbi.js';
import type { NodePlan, OrbitMeta, Vec3 } from '../sim/ManeuverAbi.js';
import type { MapNodeReadout } from '../ui/MapTypes.js';
import type { OfVesselModule } from '../sim/wasm/vesselabi.js';
import type { NodeBurn } from './FlightNav.js';
import type { FlightMode } from './FlightMode.js';

interface Handles { atS: number; pro: number; nrm: number; rad: number }

const DEG = 180 / Math.PI;

export class MapNode {
  private node: Handles | null = null;
  private holding = false;
  plan: NodePlan | null = null;
  /**
   * PH-350. THE DELTA-V ALREADY SPENT AGAINST THIS NODE, as an INERTIAL VECTOR.
   *
   * The node's own `deltaVMS` is `|handles|` and is therefore constant: it read
   * 200.00 m/s at both ends of a 42-sample burn that moved apoapsis from
   * 108,562 m to 402,766 m, and a hand-flying player had no cut-off cue at all.
   * What counts down is `|planned - spent|`, and this is `spent`.
   *
   * IT IS ACCUMULATED FROM /core's OWN LEDGER, not integrated here: each frame
   * takes the DROP in `of_fl_remaining_dv_vacuum` and lays it along the nose.
   * That is the same currency the autopilot executor terminates its own burns
   * on, so the node's countdown and the executor's cannot disagree about what a
   * metre per second is.
   *
   * A STAGING IS NOT A SPEND, and the guard is the staging COUNTER rather than
   * a threshold on the drop: jettisoning a stage removes its whole delta-v from
   * the remaining figure in one frame, and a magnitude test would have to guess
   * where a real burn ends and a separation begins.
   */
  private spent: Vec3 = [0, 0, 0];
  private prevRemainingMS = NaN;
  private prevStagings = -1;
  /**
   * PH-350. THE BURN THIS NODE ASKS FOR, LATCHED AS AN INERTIAL VECTOR the
   * first frame the plan is valid, and it is latched rather than re-read for a
   * measured reason.
   *
   * `plan.burnDirection` is prograde AT THE NODE, and the node sits minutes
   * ahead on an orbit the burn is in the act of reshaping, so the direction
   * ROTATES while the engine is lit. Counting down against the live direction
   * therefore chases a moving vector: measured, a well-flown 200 m/s burn
   * bottomed out at 126.9 m/s and turned around, having spent only 159.6 m/s
   * with the nose within 16 degrees the whole way. The countdown was subtracting
   * from a target that was walking away from it.
   *
   * This is the same statement `toggleHold` already makes out loud: the
   * direction is fixed in inertial space the moment the node is placed. Holding
   * the vector fixed makes the countdown mean "how much of the burn I INTENDED
   * is still unflown", which is the only reading a cut-off cue can have.
   */
  private wanted: Vec3 | null = null;

  constructor(private readonly M: OfVesselModule,
              private readonly flight: FlightMode,
              private readonly say: (msg: string) => void) {}

  get placed(): boolean { return this.node !== null; }

  /** Put a node on the path. The default is APOAPSIS when there is one, because
   *  that is where the overwhelming majority of first burns belong (raise the
   *  periapsis, circularise), and a node you must drag from zero before it says
   *  anything useful is a worse first impression than one already somewhere
   *  sensible. Returns true when a node was placed, so the caller can refit. */
  place(): boolean {
    // A node is a burn and there is nothing to burn on foot. It SAYS so: a
    // silently inert control teaches the player the feature does not exist.
    const f = this.flight;
    if (!f.aboard || !f.session.live) {
      this.say('a maneuver node needs a vessel: board one first (G)');
      return false;
    }
    const t = this.currentMeta();
    const ahead = t.bound && t.timeToApoapsisS >= 0 ? t.timeToApoapsisS : 60;
    this.node = { atS: this.nowS() + ahead, pro: 0, nrm: 0, rad: 0 };
    this.resetSpend();
    return true;
  }

  /** A new plan is a new burn. Called on place, on clear and on every handle
   *  move, because delta-v spent against the burn you USED to intend is not
   *  progress against the one you intend now. */
  private resetSpend(): void {
    this.spent = [0, 0, 0];
    this.prevRemainingMS = NaN;
    this.prevStagings = -1;
    this.wanted = null;
  }

  /** The vessel's own mission clock, which is the clock a node is pinned to. */
  private nowS(): number { return this.flight.session.state.timeS; }

  /** Seconds until the node. Goes NEGATIVE once it is behind you, which is the
   *  honest readout for "you missed it" and is what the panel colours red. */
  private aheadS(): number {
    return this.node === null ? 0 : this.node.atS - this.nowS();
  }

  private currentMeta(): OrbitMeta {
    const st = this.flight.session.state;
    return orbitMeta(this.M, this.flight.session.handle,
                     st.pos as Vec3, st.vel as Vec3);
  }

  clear(): void {
    this.node = null;
    this.holding = false;
    this.plan = null;
    this.flight.nodeDir = null;
    this.flight.nodeBurn = null;
    this.resetSpend();
  }

  /** Hold-node: SAS Command pointed at the node's published burn direction.
   *  There is no /core Maneuver mode and there does not need to be, because the
   *  direction is fixed in inertial space the moment the node is placed. */
  toggleHold(): void {
    const f = this.flight;
    if (!f.aboard || !f.session.live) return;
    // NOT a silent return. There is no node to hold and saying so is the whole
    // difference between "this key does nothing" and "this key needs a node".
    if (this.node === null) {
      f.session.flash('no maneuver node to hold: open the map (M) and place one');
      return;
    }
    this.holding = !this.holding;
    const s = f.session;
    if (this.holding && this.plan !== null) {
      s.commandDirection(this.plan.burnDirection);
      s.flash('SAS holding the node');
    } else {
      s.flash('SAS released the node');
    }
  }

  adjust(axis: 'prograde' | 'normal' | 'radial' | 'time', delta: number): void {
    const n = this.node;
    if (n === null) return;
    if (axis === 'prograde') n.pro += delta;
    else if (axis === 'normal') n.nrm += delta;
    else if (axis === 'radial') n.rad += delta;
    // Moving the node cannot schedule it in the PAST. It may still drift there
    // on its own, which is a different thing and is allowed to show.
    else n.atS = Math.max(this.nowS(), n.atS + delta);
    // PH-350. MOVING A HANDLE RESTARTS THE COUNTDOWN, and it has to: the spend
    // so far was against a different burn vector, so carrying it over would
    // credit the new plan with delta-v that was never flown toward it.
    this.resetSpend();
  }

  /**
   * Recompute the plan. Every frame, MAP OPEN OR NOT: the navball's node marker
   * and hold-node both depend on it and neither is a map feature. One plan
   * feeding three consumers rather than three derivations of the same burn.
   */
  frame(flying: boolean): void {
    const f = this.flight;
    if (!flying) {
      // The NODE belongs to a flight and goes with it. The MAP does not:
      // closing it here is what made this the flight map (DW-36).
      if (this.node !== null) this.clear();
      return;
    }
    const h = f.session.handle;
    this.plan = this.node === null ? null
      : nodePlan(this.M, h, this.aheadS(), this.node.pro,
                 this.node.nrm, this.node.rad);
    // The ball's marker. Written even while the map is closed, which is the
    // point: a node you placed stays visible on the ball you fly by.
    f.nodeDir = this.plan === null ? null : this.plan.burnDirection;
    // PH-350. And the ball's BURN TIMER, for the same reason and on the same
    // line: the countdown to lighting the engine is not a map feature.
    this.latchWanted();
    this.accumulateSpend();
    f.nodeBurn = this.burn();
    if (this.holding && this.plan !== null) {
      f.session.commandDirection(this.plan.burnDirection);
    }
  }

  /** Take the burn vector once, the first frame there is a real one to take.
   *  Cleared by every handle move, so a node the player is still shaping
   *  re-latches and a node they have stopped shaping does not. */
  private latchWanted(): void {
    const p = this.plan;
    if (this.wanted !== null || p === null || !p.valid || !(p.deltaVMS > 0)) {
      return;
    }
    const d = p.burnDirection;
    this.wanted = [d[0] * p.deltaVMS, d[1] * p.deltaVMS, d[2] * p.deltaVMS];
  }

  /** Lay this frame's drop in the vehicle's remaining delta-v along the nose.
   *  See `spent` for why the currency is /core's ledger and why the guard is
   *  the staging counter. */
  private accumulateSpend(): void {
    const s = this.flight.session;
    if (this.node === null || !s.live) { this.resetSpend(); return; }
    const now = s.remainingDvMS();
    const st = s.stagings;
    if (Number.isFinite(this.prevRemainingMS) && st === this.prevStagings) {
      const d = this.prevRemainingMS - now;
      if (d > 0) {
        const n = s.state.forward;
        this.spent = [this.spent[0] + n[0] * d, this.spent[1] + n[1] * d,
                      this.spent[2] + n[2] * d];
      }
    }
    this.prevRemainingMS = now;
    this.prevStagings = st;
  }

  /** The node as a clock and a countdown, for the navball. Null with no node. */
  private burn(): NodeBurn | null {
    const p = this.plan;
    if (p === null) return null;
    const d = p.burnDirection;
    // The latched vector, or the live one on the single frame before the latch
    // is taken, so this never publishes a countdown against nothing.
    const w = this.wanted
      ?? [d[0] * p.deltaVMS, d[1] * p.deltaVMS, d[2] * p.deltaVMS];
    const wx = w[0] - this.spent[0];
    const wy = w[1] - this.spent[1];
    const wz = w[2] - this.spent[2];
    const nose = this.flight.session.state.forward;
    // Both are unit vectors from /core, so the dot IS the cosine; it is clamped
    // because a rounding excursion past 1 makes `acos` NaN and a NaN pointing
    // error draws as a blank, which reads as "no error" (INSTRUMENTS.md).
    const c = Math.max(-1, Math.min(1,
      d[0] * nose[0] + d[1] * nose[1] + d[2] * nose[2]));
    return {
      nodeS: p.timeToNodeS, startS: p.timeToBurnStartS,
      durationS: p.burnDurationS, plannedDvMS: p.deltaVMS,
      remainingDvMS: Math.sqrt(wx * wx + wy * wy + wz * wz),
      pointingErrorDeg: Math.acos(c) * DEG,
      feasible: p.feasible,
    };
  }

  readout(flying: boolean): MapNodeReadout | null {
    const p = this.plan;
    if (p === null || !flying) return null;
    return {
      progradeMS: this.node?.pro ?? 0, normalMS: this.node?.nrm ?? 0,
      radialMS: this.node?.rad ?? 0,
      deltaVMS: p.deltaVMS, timeToNodeS: p.timeToNodeS,
      timeToBurnStartS: p.timeToBurnStartS, burnDurationS: p.burnDurationS,
      deltaVAvailableMS: p.deltaVAvailableMS, shortfallMS: p.shortfallMS,
      feasible: p.feasible, stagesUsed: p.stagesUsed,
      burnFractionOfPeriod: p.burnFractionOfPeriod,
      apoapsisAltM: p.apoapsisAltM, periapsisAltM: p.periapsisAltM,
      eccentricity: p.eccentricity, periodS: p.periodS,
      boundAfter: p.boundAfter, holding: this.holding,
    };
  }

  /** The handles AND the derived countdown, because "when is the node" is the
   *  question and `atS` alone does not answer it without the clock. The WHOLE
   *  plan beside it: publishing half of it made a probe read the other half off
   *  the panel's own DOM, which is a second reader of one answer. */
  report(): { node: unknown; plan: unknown; holding: boolean;
              burn: NodeBurn | null; spentMS: number[];
              wantedMS: number[] | null } {
    const p = this.plan;
    return {
      node: this.node === null ? null
        : { ...this.node, tFromNowS: this.aheadS(), nowS: this.nowS() },
      plan: p === null ? null : { ...p },
      holding: this.holding,
      // PH-350. The countdown and the vector it is derived from, so a probe
      // asserts the decrement against the spend rather than against itself.
      burn: this.burn(),
      spentMS: [this.spent[0], this.spent[1], this.spent[2]],
      wantedMS: this.wanted === null ? null
        : [this.wanted[0], this.wanted[1], this.wanted[2]],
    };
  }
}
