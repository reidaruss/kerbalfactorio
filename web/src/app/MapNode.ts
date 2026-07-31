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
import type { FlightMode } from './FlightMode.js';

interface Handles { atS: number; pro: number; nrm: number; rad: number }

export class MapNode {
  private node: Handles | null = null;
  private holding = false;
  plan: NodePlan | null = null;

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
    return true;
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
    if (this.holding && this.plan !== null) {
      f.session.commandDirection(this.plan.burnDirection);
    }
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
  report(): { node: unknown; plan: unknown; holding: boolean } {
    const p = this.plan;
    return {
      node: this.node === null ? null
        : { ...this.node, tFromNowS: this.aheadS(), nowS: this.nowS() },
      plan: p === null ? null : { ...p },
      holding: this.holding,
    };
  }
}
