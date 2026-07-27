// =============================================================================
// MapMode.ts - the orbital MAP, on M, and the maneuver node that lives on it.
//
// It is a MODE, in the Vab's family and not the navball's: it registers a
// `Modal` (so Escape closes it through GP-25's derived list rather than a
// second handler), it takes the pointer, and it hands the pointer back on the
// way out. What it is NOT is a fifth render pass: the map is an orthographic
// plan view drawn on a 2D canvas, so `Frame.vabActive` stays a boolean and
// FlightMode's "there is no third render mode" argument is honoured rather than
// answered. A 3D orbital camera is DEFERRED and named in the report.
//
// A NODE IS A PLAN AND NOT AN AUTOPILOT (PH-37). Nothing in this file sets a
// throttle, starts a burn, warps to a node or cuts an engine. It computes what
// a burn would cost, which way to point, when to light it and how long for, and
// then a human does all four. DW-29 gates autopilot behind a research unlock
// earned by reaching orbit manually and DW-30 keeps auto-circularising on the
// far side of that gate; planning a burn and flying it are different skills and
// only the second one is the game.
//
// The only thing it COMMANDS is hold-node, and that is the same SAS the player
// already had (DW-30 item 2 ships prograde/retrograde hold on flight one) aimed
// at a direction they chose. It points the ship; it does not fly it.
// =============================================================================
import type { ModalStack } from '../ui/ModalStack.js';
import { MapView } from '../ui/MapView.js';
import type { MapConic, MapReadout, V3 } from '../ui/MapTypes.js';
import type { FlightMode } from './FlightMode.js';
import type { OfVesselModule } from '../sim/wasm/vesselabi.js';
import { nodePlan, orbitMeta, orbitPath } from '../sim/ManeuverAbi.js';
import type { NodePlan, OrbitMeta, Vec3 } from '../sim/ManeuverAbi.js';

const SAMPLES = 192;
/** How much of the shorter screen axis the drawn orbit should fill. */
const FIT_MARGIN = 1.35;

export interface MapDeps {
  M: OfVesselModule;
  host: HTMLElement;
  modals: ModalStack;
  flight: FlightMode;
  bodyRadiusM: number;
  atmosphereCeilingM: number;
  setUiCapture(on: boolean): void;
  /** Where a refusal goes when there is no navball to put it on. Supplied by
   *  the app because the on-foot HUD is not this file's to reach into. */
  say(msg: string): void;
}

/**
 * A node is anchored to an ABSOLUTE mission time, never to "seconds from now".
 *
 * This was the fatal defect the driven probe found and it is worth writing
 * down, because it looked perfect on every instrument: `tFromNowS` was stored
 * and handed to /core unchanged every frame, so the node slid along the orbit
 * WITH the vessel and stayed a fixed distance ahead for ever. Measured: 40.0 s
 * of mission time elapsed with the countdown bit-identical at 1004.2540207730244
 * and the panel's "light it in" frozen at 16:44. Every number was internally
 * consistent, the picture was right, and the burn could never be flown because
 * the countdown could not reach zero.
 */
interface Handles { atS: number; pro: number; nrm: number; rad: number }

function conicFrom(points: Float64Array, m: OrbitMeta): MapConic {
  return {
    points, bound: m.bound, periodS: m.periodS, eccentricity: m.eccentricity,
    apoapsis: m.apoapsis, periapsis: m.periapsis,
    apoapsisAltM: m.apoapsisAltM, periapsisAltM: m.periapsisAltM,
    timeToApoapsisS: m.timeToApoapsisS, timeToPeriapsisS: m.timeToPeriapsisS,
  };
}

export class MapMode {
  readonly view: MapView;
  open = false;
  opens = 0;
  private node: Handles | null = null;
  private holding = false;
  private plan: NodePlan | null = null;
  /** Metres across the short screen axis. 0 asks for an auto-fit next frame. */
  private spanM = 0;
  /** The projection's in-plane "right". Kept across frames and re-orthogonalised
   *  against /core's published orbit pole, so the picture does not spin when the
   *  orbit is near-circular (where periapsis is arbitrary) and follows smoothly
   *  when a normal burn tilts the plane. */
  private planeU: V3 = [1, 0, 0];

  constructor(private readonly d: MapDeps) {
    this.view = new MapView(d.host, d.modals, {
      adjust: (axis, delta) => this.adjust(axis, delta),
      place: () => this.place(),
      clear: () => this.clearNode(),
      holdNode: () => this.toggleHold(),
      zoom: (mult) => { this.spanM = this.spanM * mult; },
    });
    this.view.closer = () => this.leave();
  }

  /** M, edge-detected by the caller. Refused off the vessel, and it SAYS so
   *  rather than doing nothing: a key that is silently inert teaches the player
   *  the feature does not exist, which is the trap `board` fell into. */
  toggle(): void {
    if (this.open) { this.leave(); return; }
    if (!this.d.flight.aboard) {
      this.d.say('the map is the flight map: board a vessel first (G)');
      return;
    }
    this.enter();
  }

  private enter(): void {
    this.open = true;
    this.opens += 1;
    this.spanM = 0;
    this.view.setOpen(true);
    this.d.modals.touch(this.view);
    this.d.setUiCapture(true);
  }

  private leave(): void {
    if (!this.open) return;
    this.open = false;
    this.view.setOpen(false);
    this.d.setUiCapture(false);
  }

  // --- the node --------------------------------------------------------------

  /** Put a node on the path. The default is APOAPSIS when there is one, because
   *  that is where the overwhelming majority of first burns belong (raise the
   *  periapsis, circularise), and a node you must drag from zero before it says
   *  anything useful is a worse first impression than one already somewhere
   *  sensible. */
  private place(): void {
    const t = this.currentMeta();
    const ahead = t.bound && t.timeToApoapsisS >= 0 ? t.timeToApoapsisS : 60;
    this.node = { atS: this.nowS() + ahead, pro: 0, nrm: 0, rad: 0 };
    this.spanM = 0;
  }

  /** The vessel's own mission clock, which is the clock a node is pinned to. */
  private nowS(): number { return this.d.flight.session.state.timeS; }

  /** Seconds until the node. Goes NEGATIVE once it is behind you, which is the
   *  honest readout for "you missed it" and is what the panel colours red. */
  private aheadS(): number {
    return this.node === null ? 0 : this.node.atS - this.nowS();
  }

  private clearNode(): void {
    this.node = null;
    this.holding = false;
    this.plan = null;
    this.d.flight.nodeDir = null;
    this.spanM = 0;
  }

  /** Hold-node: SAS Command pointed at the node's published burn direction.
   *  There is no /core Maneuver mode and there does not need to be, because the
   *  direction is fixed in inertial space the moment the node is placed. */
  toggleHold(): void {
    const f = this.d.flight;
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

  private adjust(axis: 'prograde' | 'normal' | 'radial' | 'time',
                 delta: number): void {
    const n = this.node;
    if (n === null) return;
    if (axis === 'prograde') n.pro += delta;
    else if (axis === 'normal') n.nrm += delta;
    else if (axis === 'radial') n.rad += delta;
    // Moving the node cannot schedule it in the PAST. It may still drift there
    // on its own, which is a different thing and is allowed to show.
    else n.atS = Math.max(this.nowS(), n.atS + delta);
    this.spanM = 0;
  }

  private currentMeta(): OrbitMeta {
    const st = this.d.flight.session.state;
    return orbitMeta(this.d.M, this.d.flight.session.handle,
                     st.pos as Vec3, st.vel as Vec3);
  }

  // --- per frame -------------------------------------------------------------

  /**
   * Rebuilt every frame the map is up, and the NODE is recomputed every frame
   * whether it is up or not, because the navball's node marker and hold-node
   * both depend on it and neither is a map feature. That is one plan feeding
   * three consumers rather than three derivations of the same burn.
   */
  frame(): void {
    const f = this.d.flight;
    if (!f.aboard || !f.session.live) {
      if (this.open) this.leave();
      if (this.node !== null) this.clearNode();
      return;
    }
    const h = f.session.handle;
    this.plan = this.node === null ? null
      : nodePlan(this.d.M, h, this.aheadS(), this.node.pro,
                 this.node.nrm, this.node.rad);
    // The ball's marker. Written even while the map is closed, which is the
    // point: a node you placed stays visible on the ball you fly by.
    f.nodeDir = this.plan === null ? null : this.plan.burnDirection;
    if (this.holding && this.plan !== null) {
      f.session.commandDirection(this.plan.burnDirection);
    }
    if (!this.open) return;
    this.view.render(this.readout());
  }

  private readout(): MapReadout {
    const f = this.d.flight;
    const s = f.session;
    const h = s.handle;
    const st = s.state;
    const meta = orbitMeta(this.d.M, h, st.pos as Vec3, st.vel as Vec3);
    const current = conicFrom(
      orbitPath(this.d.M, h, st.pos as Vec3, st.vel as Vec3, SAMPLES), meta);

    let planned: MapConic | null = null;
    let nodePos: V3 | null = null;
    const p = this.plan;
    if (p !== null && p.valid) {
      nodePos = p.position;
      const pm = orbitMeta(this.d.M, h, p.position, p.postBurnVel);
      planned = conicFrom(
        orbitPath(this.d.M, h, p.position, p.postBurnVel, SAMPLES), pm);
    }

    this.reframe(meta.normal);
    const scene = {
      bodyRadiusM: this.d.bodyRadiusM,
      atmosphereCeilingM: this.d.atmosphereCeilingM,
      planeU: this.planeU, planeV: this.planeV(meta.normal),
      shipPos: st.pos as V3,
      current, planned, nodePos,
      spanM: this.spanM > 0 ? this.spanM : this.autoFit(current, planned),
    };
    if (this.spanM <= 0) this.spanM = scene.spanM;

    return {
      scene,
      node: p === null ? null : {
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
      },
      status: s.status, sas: s.sasName, metS: s.metS,
      altitudeM: s.telemetry.altitudeM, speedMS: s.telemetry.speedMS,
      deltaVRemainingMS: s.remainingDvMS(),
      // /core's own predicate, never a threshold guessed again here.
      onRails: this.d.M._of_fl_on_rails_eligible(h) === 1,
      message: s.message !== '' ? s.message : f.message,
    };
  }

  /** Keep `planeU` perpendicular to the pole, by projection rather than by
   *  rebuilding it: rebuilding from the periapsis direction makes a
   *  near-circular orbit's map SPIN, because periapsis is arbitrary there. */
  private reframe(n: V3): void {
    const u = this.planeU;
    const d = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    let x = u[0] - n[0] * d, y = u[1] - n[1] * d, z = u[2] - n[2] * d;
    let l = Math.hypot(x, y, z);
    if (l < 1e-6) {
      // Degenerate only if the stored axis has become the pole itself. Seed off
      // whichever world axis is least aligned with it.
      const seed: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      x = seed[0] - n[0] * (seed[0] * n[0] + seed[1] * n[1] + seed[2] * n[2]);
      y = seed[1] - n[1] * (seed[0] * n[0] + seed[1] * n[1] + seed[2] * n[2]);
      z = seed[2] - n[2] * (seed[0] * n[0] + seed[1] * n[1] + seed[2] * n[2]);
      l = Math.hypot(x, y, z) || 1;
    }
    this.planeU = [x / l, y / l, z / l];
  }

  private planeV(n: V3): V3 {
    const u = this.planeU;
    return [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0]];
  }

  /** Frame the body plus whatever is drawn, so the picture is never empty and
   *  never all planet. Measured off the POINTS rather than off (a, e), because
   *  the points are what is actually painted. */
  private autoFit(a: MapConic, b: MapConic | null): number {
    let r = this.d.bodyRadiusM + this.d.atmosphereCeilingM;
    for (const c of [a, b]) {
      if (c === null) continue;
      const q = c.points;
      for (let i = 0; i + 2 < q.length; i += 3) {
        const m = Math.hypot(q[i], q[i + 1], q[i + 2]);
        if (Number.isFinite(m) && m > r && m < 1e10) r = m;
      }
    }
    return r * 2 * FIT_MARGIN;
  }

  report(): unknown {
    const p = this.plan;
    return {
      open: this.open, opens: this.opens, holding: this.holding,
      spanM: Math.round(this.spanM),
      // The handles AND the derived countdown, because "when is the node" is
      // the question and `atS` alone does not answer it without the clock.
      node: this.node === null ? null
        : { ...this.node, tFromNowS: this.aheadS(), nowS: this.nowS() },
      // The WHOLE plan. Publishing half of it made a probe read the other half
      // off the panel's own DOM, which is a second reader of one answer.
      plan: p === null ? null : { ...p },
      view: this.view.report(),
    };
  }
}
