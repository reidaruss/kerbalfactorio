// =============================================================================
// MapMode.ts - THE map, on M, and the maneuver node that lives on it.
//
// DW-36 widened it and the widening is a DELTA: the mode, the modal
// registration, the allow list, the readout column and the node UI all survive.
// What did not is the assumption that the projection is centred on the BODY and
// that this is the FLIGHT map. `centreM` of [0,0,0] with a vessel's orbit normal
// reproduces the old picture exactly.
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
import { MapView } from '../ui/MapView.js';
// The painter's own framing. Imported rather than re-derived, because "how big
// is this picture" has exactly one answer and it belongs where the pixels are.
import { fitSpanM } from '../ui/MapDraw.js';
import type { MapConic, MapReadout, V3 } from '../ui/MapTypes.js';
import { nodePlan, orbitMeta, orbitPath } from '../sim/ManeuverAbi.js';
import type { NodePlan, OrbitMeta, Vec3 } from '../sim/ManeuverAbi.js';
import { MapFocus } from './MapFocus.js';
// The ports live in MapBoot, beside where they are built. Type-only, so there
// is no runtime cycle even though MapBoot imports this file for its value.
import type { MapDeps } from './MapBoot.js';
import type { MapWorld } from './MapWorld.js';

const SAMPLES = 192;
/** What the map frames when it opens on foot, metres across the short axis. A
 *  base is tens of metres and a walk is hundreds, so this shows the place you
 *  are standing. A starting point and not a mode: the wheel runs continuously
 *  from here to the whole orbit and back with nothing switching on the way. */
const FOOT_SPAN_M = 600;

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
  /** What the projection is centred on and which way it looks. */
  readonly focus: MapFocus;
  /** The sim clock the last frame ran at, so `frame` can difference it. */
  private lastFrameS = 0;

  /** Exposed so `__of.map` reads the rows the painter is handed, in `/core`'s
   *  own numbers, rather than parsing them back off the panel's text: the way
   *  the power panel was proven, and the only way an ore count can be checked
   *  field for field against the integers it came from. */
  get world(): MapWorld | null { return this.d.world; }

  constructor(private readonly d: MapDeps) {
    this.focus = new MapFocus({
      player: () => d.player(),
      vessel: () => {
        const f = d.flight;
        if (!f.aboard || !f.session.live) return null;
        const st = f.session.state;
        const m = orbitMeta(d.M, f.session.handle, st.pos as Vec3,
                            st.vel as Vec3);
        return { pos: st.pos as V3, normal: m.normal as V3, name: 'vessel' };
      },
      bodyName: 'Forge',
    });
    this.view = new MapView(d.host, d.modals, {
      adjust: (axis, delta) => this.adjust(axis, delta),
      place: () => this.place(),
      clear: () => this.clearNode(),
      holdNode: () => this.toggleHold(),
      zoom: (mult) => { this.spanM = this.spanM * mult; },
      // Focus switching and re-centring are ONE mechanism (R17): a different
      // origin in the same field, and NOTHING else changes. It deliberately
      // does not touch the zoom - one map, one camera, one zoom parameter -
      // which a first draft got wrong by resetting the span and yanking the
      // player out to the planet whenever they looked at something else.
      focus: (name) => { this.focus.set(name); },
    });
    this.view.closer = () => this.leave();
  }

  /** M, edge-detected by the caller. It no longer refuses on foot: DW-36 makes
   *  this THE map rather than the flight map, and "centered around the player"
   *  is the first thing it asks for. */
  toggle(): void {
    if (this.open) { this.leave(); return; }
    this.enter();
  }

  private enter(): void {
    this.open = true;
    this.opens += 1;
    // 0 asks for an auto-fit; `readout` decides what that means for the regime
    // you are in. One number, not two modes.
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
    // A node is a burn and there is nothing to burn on foot. It SAYS so, for
    // `toggleHold`'s reason: a silently inert control teaches the player the
    // feature does not exist. The refusal MOVED here; it did not vanish.
    const f = this.d.flight;
    if (!f.aboard || !f.session.live) {
      this.d.say('a maneuver node needs a vessel: board one first (G)');
      return;
    }
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
  /**
   * Every frame, MAP OPEN OR NOT, which is why discovery is fed from here: this
   * method already ran regardless (the navball's node marker and hold-node need
   * the plan, and neither is a map feature). Discovery has the same shape - it
   * accumulates walking and flying and must not depend on whether a panel is up.
   *
   * `nowS` IS A CLOCK, NOT A DELTA, and it is named for it because a first draft
   * called it `dtS` and that ambiguity WAS the bug. `loop.simSecs` is
   * cumulative, because `flight.frame` on the line above wants a clock, so
   * accumulating it opened the 1 Hz gate every frame: measured at 144 passes per
   * sim second, an orbital pass costing 2.2 ms per FRAME rather than per second.
   * Worse, it made `gapRatio` measure frame-to-frame motion, ~8 cm against a
   * 2 km sweep, which rounds to exactly 0 - so the check that makes the interval
   * derived rather than hoped could never fire, and the defect it exists to
   * catch hid behind it. Differencing here keeps it right whatever is passed.
   */
  frame(nowS = 0): void {
    const f = this.d.flight;
    const flying = f.aboard && f.session.live;
    const disc = this.d.disc;
    // A clock that went backwards (a new world, a reload) restarts the interval
    // rather than banking a negative or an enormous delta.
    let dtS = nowS - this.lastFrameS;
    if (!(dtS >= 0) || dtS > 60) dtS = 0;
    this.lastFrameS = nowS;
    if (disc !== null && dtS > 0) {
      if (flying) {
        const st = f.session.state;
        disc.step(dtS, { x: st.pos[0], y: st.pos[1], z: st.pos[2] },
                  f.session.telemetry.altitudeM);
      } else {
        const p = this.d.player();
        if (p !== null) disc.step(dtS, p, p.altM);
      }
    }
    if (!flying) {
      // The NODE belongs to a flight and goes with it. The MAP does not: closing
      // it here is what made this the flight map (DW-36).
      if (this.node !== null) this.clearNode();
    } else {
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
    }
    if (!this.open) return;
    this.view.render(this.readout(flying));
  }

  private readout(flying: boolean): MapReadout {
    const f = this.d.flight;
    const s = f.session;
    const foc = this.focus.current();
    const b = this.focus.basis(foc.pole);

    let current: MapConic | null = null;
    let planned: MapConic | null = null;
    let nodePos: V3 | null = null;
    let shipPos: V3 | null = null;
    const p = this.plan;
    if (flying) {
      const h = s.handle;
      const st = s.state;
      shipPos = st.pos as V3;
      current = conicFrom(
        orbitPath(this.d.M, h, st.pos as Vec3, st.vel as Vec3, SAMPLES),
        orbitMeta(this.d.M, h, st.pos as Vec3, st.vel as Vec3));
      if (p !== null && p.valid) {
        nodePos = p.position;
        planned = conicFrom(
          orbitPath(this.d.M, h, p.position, p.postBurnVel, SAMPLES),
          orbitMeta(this.d.M, h, p.position, p.postBurnVel));
      }
    }

    const pl = this.d.player();
    const playerPos: V3 | null = pl === null ? null : [pl.x, pl.y, pl.z];
    const w = this.d.world;
    const ore = w === null ? [] : w.ore();
    // ONE FRAMING AUTHORITY, and it is the painter's, because the painter knows
    // how big things end up. This file carried its own copy measuring from the
    // body centre; centring made the two disagree the moment a player looked at
    // their base, which is the second-authority failure in miniature.
    const draft = {
      bodyRadiusM: this.d.bodyRadiusM,
      atmosphereCeilingM: this.d.atmosphereCeilingM,
      planeU: b.u, planeV: b.v,
      centreM: foc.centreM, focusName: foc.name, axisName: foc.axisName,
      shipPos, playerPos, current, planned, nodePos, spanM: 0,
      discovered: null, ore,
      revealAll: w !== null && w.readout().revealAll,
    };
    // AN AUTO-FIT FRAMES BY REGIME, not by distance. In flight it frames the
    // trajectory. On foot the same call correctly returns the distance to the
    // atmosphere shell, ~206 km of air column overhead, which answers a question
    // nobody asked. So the branch is on `flying`, a named state, and NOT on
    // "is the centre near the surface", which would be a threshold.
    const spanM = this.spanM > 0 ? this.spanM
      : (flying ? fitSpanM(draft) : FOOT_SPAN_M);
    if (this.spanM <= 0) this.spanM = spanM;

    const scene = {
      ...draft, spanM,
      discovered: w === null ? null : w.terrain(foc.centreM, b.u, b.v, spanM, this.view.size()),
    };

    return {
      scene,
      node: p === null || !flying ? null : {
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
      status: flying ? s.status : 'ON FOOT',
      sas: flying ? s.sasName : '---',
      metS: flying ? s.metS : -1,
      altitudeM: flying ? s.telemetry.altitudeM : 0,
      speedMS: flying ? s.telemetry.speedMS : 0,
      deltaVRemainingMS: flying ? s.remainingDvMS() : 0,
      discovery: w === null ? null : w.readout(),
      focusName: foc.name,
      focusOptions: this.focus.options(),
      // /core's own predicate, never a threshold guessed again here.
      onRails: flying && this.d.M._of_fl_on_rails_eligible(s.handle) === 1,
      message: flying && s.message !== '' ? s.message : f.message,
    };
  }

  /** Frame whatever is drawn, MEASURED FROM THE CENTRE rather than from the
   *  body: framing off the body centre is exactly the assumption R17 named, and
   *  left in place it would zoom out to the whole planet the moment a player
   *  asked to look at their base. Measured off the POINTS rather than off (a,e),
   *  because the points are what is actually painted. */
  report(): unknown {
    const p = this.plan;
    return {
      open: this.open, opens: this.opens, holding: this.holding,
      spanM: Math.round(this.spanM),
      focus: this.focus.report(),
      world: this.d.world === null ? null : this.d.world.report(),
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
