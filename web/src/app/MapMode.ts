// =============================================================================
// MapMode.ts - THE map, on M, and everything the player does from it.
//
// DW-36 widened it and DW-37 made it a real scene: the mode, the modal
// registration, the allow list, the readout column and the node UI all
// survive, and the PICTURE is now the 3D orbital scene (`Map3D`) that Frame
// renders in place of the four world passes while the map is up. FlightMode's
// "there is no third render mode" argument was about FLIGHT, which must live
// in the same near scene as the walker; the map is the VAB's case, an
// instrument that shares no depth range with the world, and it takes the VAB's
// mechanism (GP-208). The flat canvas painter still runs, hidden, because
// `of.map('grid')`'s luma contract is world-gen's instrument (GP-209), and
// `of.map('flat', {on:true})` brings it back as the whole picture.
//
// The maneuver node lives in MapNode.ts (lifted verbatim, GP-206). A node is a
// plan and not an autopilot (PH-37); nothing here flies anything either. The
// one exception is deliberate and guarded: TAKE CONTROL routes through the
// published handoff seam (`leaveVessel` guard, then `resumeControl`, PH-76),
// which is the door the physics lane built for exactly this feature.
// =============================================================================
import { MapView } from '../ui/MapView.js';
// The painter's own framing. Imported rather than re-derived, because "how big
// is this picture" has exactly one answer and it belongs where the pixels are.
import { fitSpanM } from '../ui/MapDraw.js';
import type {
  MapConic, MapPlannerReadout, MapReadout, MapVesselRow, V3,
} from '../ui/MapTypes.js';
import { orbitMeta, orbitPath } from '../sim/ManeuverAbi.js';
import type { OrbitMeta, Vec3 } from '../sim/ManeuverAbi.js';
import { MapFocus } from './MapFocus.js';
import { MapNode } from './MapNode.js';
import { CURVE_WINDOW_S, MapPlanner } from './MapPlanner.js';
import { registry } from '../sim/VesselRegistry.js';
import { currentVesselTick, leaveVessel, resumeControl } from './FlightVessels.js';
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
  private readonly nodeCtl: MapNode;
  /** GP-271. The autopilot planner: the target list, the departure curve,
   *  the schedule and the transfer arc. It computes nothing itself. */
  readonly planner: MapPlanner;
  /** Metres across the short screen axis. 0 asks for an auto-fit next frame. */
  private spanM = 0;
  /** What the projection is centred on and which way it looks. */
  readonly focus: MapFocus;
  /** The vessel the panel and the 3D markers highlight. 0 is none. */
  selectedId = 0;
  /** True shows the flat canvas as the picture (the pre-GP-208 map, exactly);
   *  the default is the 3D scene. Flipped by `of.map('flat', ...)`. */
  private flat = false;
  /** The sim clock the last frame ran at, so `frame` can difference it. */
  private lastFrameS = 0;

  /** Exposed so `__of.map` reads the rows the painter is handed, in `/core`'s
   *  own numbers, rather than parsing them back off the panel's text. */
  get world(): MapWorld | null { return this.d.world; }

  constructor(private readonly d: MapDeps) {
    this.nodeCtl = new MapNode(d.M, d.flight, (m) => d.say(m));
    this.planner = new MapPlanner({
      M: d.M,
      flightHandle: () => (d.flight.aboard && d.flight.session.live
        ? d.flight.session.handle : 0),
      home: () => ({ name: 'home', radiusM: d.bodyRadiusM,
                     muM3S2: d.muM3S2 }),
      flyingId: () => registry.promotedId,
      nowS: () => this.lastFrameS,
    });
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
      adjust: (axis, delta) => {
        if (this.nodeCtl.placed) { this.nodeCtl.adjust(axis, delta); this.spanM = 0; }
      },
      place: () => { if (this.nodeCtl.place()) this.spanM = 0; },
      clear: () => { this.nodeCtl.clear(); this.spanM = 0; },
      holdNode: () => this.nodeCtl.toggleHold(),
      zoom: (mult) => { this.spanM = this.spanM * mult; },
      // Focus switching and re-centring are ONE mechanism (R17): a different
      // origin in the same field, and NOTHING else changes, the zoom included.
      focus: (name) => { this.focus.set(name); },
      look: (dx, dy) => { this.d.three?.look(dx, dy); },
      pick: (x, y) => {
        const id = this.d.three?.pick(x, y) ?? 0;
        if (id > 0) this.select(id);
      },
      select: (id) => this.select(id),
      takeControl: (id) => this.takeControl(id),
      planSelect: (id) => { this.planner.select(id); this.spanM = 0; },
      planAct: (a) => this.planAct(a),
    });
    this.view.closer = () => this.leave();
  }

  /** M, edge-detected by the caller. DW-36 makes this THE map rather than the
   *  flight map: it opens on foot, centred around the player. */
  toggle(): void {
    if (this.open) { this.leave(); return; }
    this.enter();
  }

  toggleHold(): void { this.nodeCtl.toggleHold(); }

  private enter(): void {
    this.open = true;
    this.opens += 1;
    // 0 asks for an auto-fit; `readout` decides what that means for the regime
    // you are in. One number, not two modes.
    this.spanM = 0;
    this.view.setOpen(true);
    this.d.modals.touch(this.view);
    this.d.setUiCapture(true);
    this.syncScene();
  }

  private leave(): void {
    if (!this.open) return;
    this.open = false;
    this.view.setOpen(false);
    this.d.setUiCapture(false);
    this.syncScene();
  }

  /** True while the map hides the world HUD, so the restore is owed exactly
   *  once and never fights FlightMode's own setWorldUi. */
  private hidUi = false;

  /** The picture in force: the 3D scene, or null (the world) in flat mode.
   *  The world HUD hides while the 3D picture owns the screen and restores to
   *  what the flight state expects (hidden aboard, visible on foot). */
  private syncScene(): void {
    const threeOn = this.open && !this.flat && this.d.three !== null;
    this.d.frame.mapScene = threeOn && this.d.three !== null
      ? this.d.three.scene : null;
    if (threeOn && !this.hidUi) {
      this.d.setWorldUi(false);
      this.hidUi = true;
    } else if (!threeOn && this.hidUi) {
      this.d.setWorldUi(!this.d.flight.aboard);
      this.hidUi = false;
    }
  }

  setFlat(on: boolean): void {
    this.flat = on;
    this.syncScene();
  }

  private select(id: number): void {
    this.selectedId = this.selectedId === id ? 0 : id;
    if (this.d.three !== null) this.d.three.selectedId = this.selectedId;
    // GP-271. CLICKING A MARKER IS CHOOSING A DESTINATION. Reid asked for
    // both a list and click-to-select, and they must be the SAME act or a
    // player who clicks the station and then reads the panel sees two
    // different selections. Deselecting a marker leaves the destination
    // alone, deliberately: the planner's list has rows the map has no
    // marker for (a requested orbit, a body), so clearing it from here
    // would make those rows unselectable by accident.
    if (this.selectedId > 0) this.planner.selectVesselId(this.selectedId);
  }

  /** GP-271. The planner's five buttons, in one place. */
  private planAct(act: string): void {
    const pl = this.planner;
    if (act === 'earlier') { pl.nudge(-1); return; }
    if (act === 'later') { pl.nudge(1); return; }
    if (act === 'cheapest') { pl.pickCheapest(); return; }
    if (act === 'earliest') { pl.pickEarliestFlyable(); return; }
    if (act === 'arm') {
      // THE GATE. Refused per DEPARTURE TIME and never globally, which is
      // Reid's rule: a destination you cannot reach now is not refused
      // outright, it is refused AT THIS DEPARTURE. The button is disabled
      // in that state AND the verb refuses, because a disabled button is a
      // hint and a refusal is a rule.
      const sch = pl.schedule();
      if (!sch.chosenFeasible) { this.d.say(sch.why); return; }
      // EXECUTION IS THE FLIGHT LANE'S AND IS NOT BUILT. Arming records the
      // intent and says so plainly rather than pretending to fly it: a
      // button that looks armed and does nothing is worse than one that
      // says what it is waiting for (GP-62).
      this.armed = true;
      this.d.say('departure set. Execution is the flight lane and is not '
        + 'wired yet: the plan is held, nothing is flown.');
    }
  }

  /** GP-271. Set by the arm button. Cleared whenever the plan changes. */
  armed = false;

  /**
   * TAKE CONTROL (GP-210): the map's focus-switch gesture wired to the handoff
   * seam, exactly as ResumeBoot §5 published it. Leaving the current seat goes
   * through `leaveVessel`, whose `mayLeave` refusal surfaces as its sentence
   * and changes NOTHING; seating goes through `resumeControl`, which is
   * promote-then-`takeControlRemote` and cannot half-seat. On success the map
   * closes: the point of taking a seat is to see out of it.
   */
  private takeControl(id: number): void {
    const f = this.d.flight;
    const t = currentVesselTick();
    const rec = registry.find(id);
    if (rec === null) { this.d.say('no such vessel to take control of'); return; }
    if (f.aboard && registry.promotedId === id) {
      this.d.say(`you are already flying ${rec.name}`);
      return;
    }
    if (f.aboard && f.session.live && !leaveVessel(f, t)) return;
    if (!resumeControl(f, id, t)) {
      this.d.say(`could not take control of ${rec.name}`);
      return;
    }
    this.selectedId = id;
    if (this.d.three !== null) this.d.three.selectedId = id;
    this.d.say(`control taken: ${rec.name}`);
    this.leave();
  }

  // --- per frame -------------------------------------------------------------

  /**
   * Every frame, MAP OPEN OR NOT, which is why discovery is fed from here: the
   * navball's node marker and hold-node need the plan, and neither is a map
   * feature. Discovery has the same shape: it accumulates walking and flying
   * and must not depend on whether a panel is up.
   *
   * `nowS` IS A CLOCK, NOT A DELTA, named for it because a first draft called
   * it `dtS` and that ambiguity WAS the bug (144 recompute passes per sim
   * second, and a gapRatio check that could never fire). Differencing here
   * keeps it right whatever is passed.
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
    // Landing or leaving takes the node with it; the auto-refit came with the
    // old clearNode and is kept.
    if (!flying && this.nodeCtl.placed) this.spanM = 0;
    this.nodeCtl.frame(flying);
    if (!this.open) return;
    this.planner.frame();
    const r = this.readout(flying);
    this.view.render(r);
    if (!this.flat) this.d.three?.frame(r);
  }

  private vesselRows(flying: boolean): MapVesselRow[] {
    const rows: MapVesselRow[] = [];
    const R = this.d.bodyRadiusM;
    for (const rec of registry.list()) {
      const el = rec.where.kind === 'conic' ? rec.where.el : null;
      const isFlying = flying && rec.id === registry.promotedId;
      // A rails record's fuel table IS the live truth: unattended, nothing
      // burns. The FLYING vessel's copy is synced only at save points, so the
      // row says NaN and the flight block above it carries the live numbers
      // (the R44b frozen-table lesson: never show the stale copy of a live
      // thing).
      let fuel = 0;
      for (const [, kg] of rec.fuel) fuel += kg;
      rows.push({
        id: rec.id, name: rec.name,
        mode: isFlying ? 'flying' : rec.mode,
        fuelKg: isFlying ? NaN : fuel,
        apoapsisAltM: el === null ? NaN : el.a * (1 + el.e) - R,
        periapsisAltM: el === null ? NaN : el.a * (1 - el.e) - R,
        selected: rec.id === this.selectedId,
        promoted: rec.id === registry.promotedId,
      });
    }
    return rows;
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
    const p = this.nodeCtl.plan;
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
      // GP-271. THE TRANSFER ARC, drawn by the SAME propagator and into the
      // same amber slot as a manual node's. `of_ap_plan` publishes its
      // post-burn state precisely so this needs no second propagator, and
      // using one slot means the two arcs cannot disagree about what a
      // planned orbit looks like. A hand-placed node WINS if both exist,
      // because the player put it there on purpose.
      const tp = this.planner.currentPlan;
      if (planned === null && tp !== null && tp.valid) {
        nodePos = tp.nodePosM;
        planned = conicFrom(
          orbitPath(this.d.M, h, tp.postBurnPosM as Vec3,
                    tp.postBurnVelMS as Vec3, SAMPLES),
          orbitMeta(this.d.M, h, tp.postBurnPosM as Vec3,
                    tp.postBurnVelMS as Vec3));
      }
    }

    const pl = this.d.player();
    const playerPos: V3 | null = pl === null ? null : [pl.x, pl.y, pl.z];
    const w = this.d.world;
    const ore = w === null ? [] : w.ore();
    // ONE FRAMING AUTHORITY, and it is the painter's, because the painter knows
    // how big things end up. A second copy here disagreed the moment a player
    // looked at their base: the second-authority failure in miniature.
    const draft = {
      bodyRadiusM: this.d.bodyRadiusM,
      atmosphereCeilingM: this.d.atmosphereCeilingM,
      planeU: b.u, planeV: b.v,
      centreM: foc.centreM, focusName: foc.name, axisName: foc.axisName,
      shipPos, playerPos, current, planned, nodePos, spanM: 0,
      discovered: null, ore,
      revealAll: w !== null && w.readout().revealAll,
    };
    // AN AUTO-FIT FRAMES BY REGIME, not by distance: on foot the trajectory
    // fit would answer with the air column overhead. A named state, never a
    // threshold.
    const spanM = this.spanM > 0 ? this.spanM
      : (flying ? fitSpanM(draft) : FOOT_SPAN_M);
    if (this.spanM <= 0) this.spanM = spanM;

    const scene = {
      ...draft, spanM,
      discovered: w === null ? null : w.terrain(foc.centreM, b.u, b.v, spanM, this.view.size()),
    };

    return {
      scene,
      node: this.nodeCtl.readout(flying),
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
      vessels: this.vesselRows(flying),
      planner: this.plannerReadout(flying),
      three: !this.flat && this.d.three !== null,
    };
  }

  /** GP-271. One frame of the planner, as plain data (DW-2). */
  private plannerReadout(flying: boolean): MapPlannerReadout {
    const pl = this.planner;
    const t = pl.target();
    const sch = pl.schedule();
    const c = pl.currentCurve;
    const tp = pl.currentPlan;
    const s = c.samples[pl.chosen];
    return {
      waitingOn: c.waitingOn,
      aboard: flying,
      rows: pl.rows().map((r) => ({ id: r.id, kind: r.kind, name: r.name,
                                    detail: r.detail, blocked: r.blocked })),
      selectedId: pl.selectedId,
      blockedWhy: t === null ? '' : t.blocked,
      curve: c.samples.map((x) => ({ tS: x.tS, dvMS: x.dvRequiredMS,
                                     feasible: x.feasible })),
      windowS: CURVE_WINDOW_S,
      chosen: pl.chosen, cheapest: sch.cheapest, earliest: sch.earliest,
      chosenTS: s?.tS ?? NaN, chosenDvMS: s?.dvRequiredMS ?? NaN,
      chosenFeasible: sch.chosenFeasible,
      dvAvailableMS: flying ? this.d.flight.session.remainingDvMS() : 0,
      verdict: sch.verdict, why: sch.why, armed: this.armed,
      planDeltaVMS: tp === null ? 0 : tp.deltaVMS,
      planBurnS: tp === null ? 0 : tp.burnDurationS,
      planApoapsisAltM: tp === null ? 0 : tp.apoapsisAltM,
      planPeriapsisAltM: tp === null ? 0 : tp.periapsisAltM,
    };
  }

  report(): unknown {
    const n = this.nodeCtl.report();
    return {
      open: this.open, opens: this.opens, holding: n.holding,
      spanM: Math.round(this.spanM),
      focus: this.focus.report(),
      world: this.d.world === null ? null : this.d.world.report(),
      node: n.node,
      plan: n.plan,
      selectedId: this.selectedId,
      flat: this.flat,
      three: this.d.three === null ? null : this.d.three.report(),
      view: this.view.report(),
      planner: this.planner.report(),
    };
  }
}
