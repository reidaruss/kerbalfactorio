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
  MapConic, MapReadout, MapVesselRow, V3,
} from '../ui/MapTypes.js';
import { orbitMeta, orbitPath } from '../sim/ManeuverAbi.js';
import type { OrbitMeta, Vec3 } from '../sim/ManeuverAbi.js';
import { MapFocus } from './MapFocus.js';
import { MapNode } from './MapNode.js';
import { MapPlanner } from './MapPlanner.js';
import {
  holdWarpForBurn, newWarpHold, planAct, plannerReadout,
} from './MapPlannerCtl.js';
import { registry } from '../sim/VesselRegistry.js';
// GP-650. The one answer to "which body is this record at, and what is that
// body". Read here rather than re-derived: three call sites needed it and three
// copies of `a(1 +/- e) - R` is three chances to pick the wrong R.
import { recordOrbit } from '../world/VesselBody.js';
import { markerRegistry } from '../game/MarkerRegistry.js';
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
  /** GP-275. The warp the player had before the autopilot took over. */
  private readonly warpHold = newWarpHold();

  /** Exposed so `__of.map` reads the rows the painter is handed, in `/core`'s
   *  own numbers, rather than parsing them back off the panel's text. */
  get world(): MapWorld | null { return this.d.world; }

  constructor(private readonly d: MapDeps) {
    this.nodeCtl = new MapNode(d.M, d.flight, (m) => d.say(m));
    this.planner = new MapPlanner({
      M: d.M,
      flightHandle: () => (d.flight.aboard && d.flight.session.live
        ? d.flight.session.handle : 0),
      // GP-650. THE LIVE body, read per call. It was already a thunk; what it
      // read was a boot-time copy, so a planner opened on the moon sized every
      // departure curve off Forge.
      home: () => ({ name: d.body().name, radiusM: d.body().radiusM,
                     muM3S2: d.body().muM3S2, bodyId: d.body().bodyId }),
      flyingId: () => registry.promotedId,
      nowS: () => this.lastFrameS,
      // GP-273. /core's own state for the flown vessel, so the range to the
      // target is a subtraction of two positions /core produced.
      shipState: () => {
        const f = d.flight;
        if (!f.aboard || !f.session.live) return null;
        return { pos: f.session.state.pos, vel: f.session.state.vel };
      },
      // The registry's own clock, the same one `takeControl` reads.
      tick: () => currentVesselTick(),
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
      // GP-650. THE WORLD IN FRONT OF YOU, NAMED BY /core. This was the string
      // literal `'Forge'`, so the map on Cinder offered a focus option called
      // Forge that centred on Cinder. `PlanetBody.name` is the fourth of the
      // four bodyId-to-word tables SaveSlots.ts counted, and it is the one that
      // is /core's own, so this reads it rather than adding a fifth.
      bodyName: () => d.body().name,
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
      planAct: (a) => planAct(this.planner, (m) => this.d.say(m), a),
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
    // GP-273/GP-275. THE EXECUTOR IS READ EVERY FRAME, MAP OPEN OR NOT, and
    // the warp rule is applied here for the same reason. A program keeps
    // flying while the panel is shut, and a player waiting out a long coast
    // has the map shut and the warp up: that is precisely when the burn
    // arrives, so a rule that only ran with the panel open would only ever
    // fire for a player who was already watching.
    this.planner.frameRun();
    // PH-350 / R90. THE TARGET'S RANGE AND CLOSING RATE ONTO THE BALL, every
    // frame, map open or shut, on exactly the precedent `nodeDir` set above.
    // Both numbers already existed and both were drawn only inside the
    // autopilot's ARMED block, which the storyline gates behind the mission
    // that needs them. One computation, two instruments.
    f.navTarget = flying ? this.planner.closing() : null;
    holdWarpForBurn(this.warpHold, this.planner, this.d.flight.session,
                    flying, (m) => this.d.say(m));
    if (!this.open) return;
    this.planner.frame();
    const r = this.readout(flying);
    this.view.render(r);
    if (!this.flat) this.d.three?.frame(r);
  }


  /**
   * GP-650. ONE ROW PER REGISTRY RECORD, EACH AGAINST ITS OWN BODY.
   *
   * This function used to subtract `this.d.bodyRadiusM` -- the OBSERVER's radius
   * -- from every record's apoapsis, which is why Anchorage read 400 km on Forge
   * and 800 km on the moon off one unchanged 1,000,000 m conic. `recordOrbit` is
   * the one authority now: it resolves the record's own `bodyId` and subtracts
   * THAT body's radius, so the number does not depend on where the player is
   * standing, which is the whole of D-014 applied to an altitude.
   *
   * A row for a vessel at another body is KEPT and NAMES ITS BODY rather than
   * being dropped. "My station is not in the list" is a bug report; "Anchorage,
   * 400 km / 400 km, at Forge" is an answer, and it is the answer that tells a
   * player on the moon where their station actually is.
   */
  private vesselRows(flying: boolean): MapVesselRow[] {
    const rows: MapVesselRow[] = [];
    const here = this.d.body();
    for (const rec of registry.list()) {
      const orb = recordOrbit(this.d.core, rec, here.bodyId);
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
        apoapsisAltM: orb.apoapsisAltM,
        periapsisAltM: orb.periapsisAltM,
        bodyId: orb.body === null ? -1 : orb.body.id,
        // The name is only WORTH saying when it is not the world in front of
        // you: a panel that repeats "at Forge" on every row while you are on
        // Forge is noise, and noise is what a player learns to skip past.
        bodyName: orb.body === null ? 'an unknown body'
          : (orb.body.id === here.bodyId ? '' : orb.body.name),
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
    /** GP-650. The body the picture is OF, read once per readout so the globe,
     *  the air line, the framing and every altitude beside them are one world. */
    const here = this.d.body();

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
      bodyRadiusM: here.radiusM,
      atmosphereCeilingM: here.atmosphereTopM,
      planeU: b.u, planeV: b.v,
      centreM: foc.centreM, focusName: foc.name, axisName: foc.axisName,
      shipPos, playerPos, current, planned, nodePos, spanM: 0,
      discovered: null, ore,
      // GP-520. ONE registry, read here and in Map3D's syncMarkers: neither
      // map queries it a second way, and neither gates it a second time
      // (MapMarker's own `known` field is the only gate, honoured downstream).
      markers: markerRegistry.list(),
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
      planner: plannerReadout(this.planner, flying,
        flying ? this.d.flight.session.remainingDvMS() : 0),
      three: !this.flat && this.d.three !== null,
    };
  }


  report(): unknown {
    const n = this.nodeCtl.report();
    const f = this.d.flight;
    const here = this.d.body();
    return {
      open: this.open, opens: this.opens, holding: n.holding,
      // GP-650. THE BODY THE MAP IS OF, and THE ROWS THE PANEL IS HANDED, both
      // published so a probe reads what the player sees rather than parsing it
      // back off the markup or re-deriving it from the registry. `vessels` goes
      // through the SAME `vesselRows` the panel is built from, so a probe cannot
      // pass against a second computation kept in agreement with the first.
      body: { bodyId: here.bodyId, name: here.name, radiusM: here.radiusM,
              muM3S2: here.muM3S2, atmosphereTopM: here.atmosphereTopM },
      vessels: this.vesselRows(f.aboard && f.session.live),
      spanM: Math.round(this.spanM),
      focus: this.focus.report(),
      world: this.d.world === null ? null : this.d.world.report(),
      node: n.node,
      plan: n.plan,
      // PH-350. The node's countdown and the spend it is derived from, so a
      // probe asserts the decrement against the delta-v actually flown rather
      // than against the plan's own opinion of itself.
      burn: n.burn,
      spentMS: n.spentMS,
      wantedMS: n.wantedMS,
      selectedId: this.selectedId,
      flat: this.flat,
      three: this.d.three === null ? null : this.d.three.report(),
      view: this.view.report(),
      planner: this.planner.report(),
    };
  }
}
