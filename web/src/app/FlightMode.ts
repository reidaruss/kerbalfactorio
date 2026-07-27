// THE FLIGHT MODE: roll out, board, fly, come back. Wiring only.
//
// It owns the session (the sim), the observer (the eye), the view (the meshes)
// and the navball (the readout), and it owns exactly one decision of its own:
// what the `board` key means right now. Everything else is a hand-off.
//
// WHY THERE IS NO THIRD RENDER MODE. `Frame.vabActive` swaps the four passes for
// one because a rocket on a stand and a planet at 600 km share no depth range.
// Flight is the OPPOSITE case: the whole point of the milestone is that the
// vessel is in the same near 1:1 scene the walker is, so the scaled-space rig
// carries it from the pad to orbit continuously. A flight pass would have been a
// second seam to maintain and would have deleted the feature it was meant to
// serve. `vabActive` therefore stays a boolean.

import * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { FlightSession } from '../sim/FlightSession.js';
import { dot, len, norm } from '../sim/FlightAbi.js';
import { horizonAngles, horizonFrame, rollAngle } from '../sim/FlightAttitude.js';
import type { Vec3 } from '../sim/FlightAbi.js';
import { VesselObserver } from '../player/VesselObserver.js';
import type { ViewRouter } from '../player/ViewRouter.js';
import type { Input } from '../player/Input.js';
import type { Controller } from '../player/Controller.js';
import { VesselView } from '../render/VesselView.js';
import { Navball } from '../ui/Navball.js';
import type { NavballReadout, BallMarker } from '../ui/Navball.js';
import { readCatalogue } from '../game/VesselCatalogue.js';
import type { PartRow } from '../game/VesselCatalogue.js';

/** How close the player must stand to a vessel to climb aboard, metres. */
const BOARD_RANGE_M = 18;
/** Beyond this the live vessel counts as abandoned and G rolls out a new one. */
const ABANDON_RANGE_M = 200;
/** How far in front of the player a rolled-out vessel is planted, metres. It is
 *  deliberately outside BOARD_RANGE_M: you WALK to your rocket. */
const PAD_AHEAD_M = 26;

export interface FlightDeps {
  M: OfCoreModule;
  bodyHandle: number;
  bodyRadiusM: number;
  oracle: SurfaceOracle;
  origin: FloatingOrigin;
  router: ViewRouter;
  input: Input;
  player: Controller;
  scene: THREE.Scene;
  host: HTMLElement;
  /** The live design handle from the assembly bay, or 0 when there is none. */
  designHandle(): number;
  /** Hide the on-foot HUD and the build ghost while strapped in. */
  setWorldUi(visible: boolean): void;
}

export class FlightMode {
  readonly session: FlightSession;
  readonly observer: VesselObserver;
  readonly view: VesselView;
  readonly navball: Navball;

  aboard = false;
  rollouts = 0;
  boardings = 0;
  disembarks = 0;
  refusals = 0;
  message = '';

  private catalogue: PartRow[] = [];
  private byId = new Map<number, PartRow>();
  private loaded = false;
  private drawnRevision = -1;
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly rgt = new THREE.Vector3();

  constructor(private readonly d: FlightDeps) {
    this.session = new FlightSession({
      M: d.M, bodyHandle: d.bodyHandle, bodyRadiusM: d.bodyRadiusM,
      surfaceRadius: (x, y, z) => d.oracle.surfaceRadius(x, y, z),
    });
    this.observer = new VesselObserver(this.session, d.oracle, d.input);
    this.view = new VesselView(d.scene);
    this.navball = new Navball(d.host);
    this.navball.setVisible(false);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.catalogue = readCatalogue(this.d.M);
    for (const p of this.catalogue) this.byId.set(p.id, p);
    await this.view.load(this.catalogue);
    this.loaded = true;
  }

  // --- the one decision this file makes -------------------------------------

  /**
   * ONE key, three meanings, decided by where you are standing. DW-29's actual
   * entrance is a launch pad gated behind ground progression and that does not
   * exist at any layer (gameplay R9, an Admin sequencing call), so roll-out is
   * the honest stand-in: it puts the vessel you designed on the ground in front
   * of you and says so.
   */
  board(): void {
    if (this.aboard) { this.disembark(); return; }
    if (!this.session.live) { this.rollOut(); return; }
    const d = this.distanceToVessel();
    if (d <= BOARD_RANGE_M) { this.climbIn(); return; }
    // Between "in reach" and "clearly abandoned" the key must NOT quietly build
    // a second rocket on top of the first. It says how far away the one you
    // already have is, which is the only answer that is never surprising.
    if (d <= ABANDON_RANGE_M) { this.refuse(`vessel is ${d.toFixed(0)} m away`); return; }
    this.rollOut();
  }

  rollOut(): void {
    const design = this.d.designHandle();
    if (design <= 0) { this.refuse('nothing built: press C and build a rocket'); return; }
    const feet = this.d.player.body.feet;
    const r = Math.hypot(feet.x, feet.y, feet.z) || 1;
    const up: Vec3 = [feet.x / r, feet.y / r, feet.z / r];
    // A pad in front of the player, projected back onto the sphere. The offset
    // is an ARC on the ground rather than a straight line, so the pad sits at
    // the same altitude the surface does under it.
    const { east, north } = horizonFrame(up);
    const a = this.d.player.view.yaw;
    const ahead: Vec3 = [
      north[0] * Math.cos(a) + east[0] * Math.sin(a),
      north[1] * Math.cos(a) + east[1] * Math.sin(a),
      north[2] * Math.cos(a) + east[2] * Math.sin(a),
    ];
    const t = PAD_AHEAD_M / this.d.bodyRadiusM;
    const dir = norm([up[0] + ahead[0] * t, up[1] + ahead[1] * t, up[2] + ahead[2] * t]);
    if (!this.session.rollOut(design, dir)) { this.refusals += 1; return; }
    this.rollouts += 1;
    this.drawnRevision = -1;
    this.rebuild();
    this.flash('rocket on the pad, walk over and press G');
  }

  private climbIn(): void {
    this.aboard = true;
    this.boardings += 1;
    this.observer.yaw = 0;
    this.observer.pitch = 0.22;
    this.d.router.setSource(this.observer);
    this.navball.setVisible(true);
    this.d.setWorldUi(false);
    this.flash('aboard: Space stages, Shift throttles up, WASD flies');
  }

  /** The reverse MUST work or a player who lands is stuck. It is refused only
   *  while actually moving, which is the one case a walker cannot survive. */
  disembark(): void {
    if (!this.aboard) return;
    // The STATE's velocity, not the telemetry's: telemetry is only written by
    // `of_fl_step`, so after an arrest it still reports the impact speed and
    // the hatch would stay locked on a vessel standing perfectly still.
    const moving = len(this.session.state.vel) > 2.0;
    const airborne = this.session.status !== 'CLAMPED' && this.session.status !== 'DOWN';
    if (moving || (airborne && this.session.altitudeAglM > 5)) {
      this.refuse('cannot get out in flight');
      return;
    }
    const p = this.session.state.pos;
    const r = len(p) || 1;
    const ll = this.d.oracle.latLonFromDir(p[0] / r, p[1] / r, p[2] / r);
    // A few metres to the side, so the player is not standing inside the hull.
    const off = 8 / this.d.bodyRadiusM;
    this.d.player.teleport(((ll.lat + off) * 180) / Math.PI,
                           (ll.lon * 180) / Math.PI, 0);
    this.aboard = false;
    this.disembarks += 1;
    this.d.router.setSource(null);
    this.navball.setVisible(false);
    this.d.setWorldUi(true);
    this.flash('back on the ground');
  }

  distanceToVessel(): number {
    const feet = this.d.player.body.feet;
    const p = this.session.state.pos;
    return Math.hypot(feet.x - p[0], feet.y - p[1], feet.z - p[2]);
  }

  private refuse(why: string): void { this.refusals += 1; this.flash(why); }
  private flash(m: string): void { this.message = m; }

  // --- per frame -------------------------------------------------------------

  frame(simSecs: number): void {
    if (!this.session.live) return;
    this.session.tick(simSecs);
    if (this.drawnRevision !== this.session.revision) this.rebuild();
    // The INTERPOLATED position, the one the camera was placed for. See
    // VesselObserver.renderPos: the raw sim position is a whole tick ahead.
    this.d.origin.toEngine(this.observer.renderPos, this.pos);
    const f = this.session.state.forward;
    const r = this.session.state.right;
    this.fwd.set(f[0], f[1], f[2]);
    this.rgt.set(r[0], r[1], r[2]);
    this.view.place(this.pos, this.fwd, this.rgt);
    // Which nozzles are lit: the parts still bolted on that produce thrust. The
    // craft's tree is re-read on every staging event, so a jettisoned booster
    // stops burning because it is GONE, not because a flag was cleared.
    const firing = this.session.status === 'DOWN' ? [] : this.session.partRows
      .filter((q) => (this.byId.get(q.partId)?.thrustVacuumN ?? 0) > 0)
      .map((q) => q.handle);
    this.view.setPlume(this.session.clamped ? 0 : this.session.throttleValue, firing);
    if (this.aboard) this.navball.render(this.readout());
  }

  private rebuild(): void {
    this.view.rebuild(this.session.partRows.map((q) => ({
      handle: q.handle, partId: q.partId, attach: q.attach,
      originM: q.originM, radialAngleRad: q.radialAngleRad,
    })), (id) => this.byId.get(id));
    // Re-frame on what is LEFT. A stage separation halves the vehicle, and a
    // camera still framed on the full stack points at empty space where the
    // booster used to be.
    this.observer.frameFor(Math.max(1, -this.view.lowestLocalY()));
    this.drawnRevision = this.session.revision;
  }

  // --- the readout -----------------------------------------------------------

  /** Heading and pitch of a unit direction, in THE local horizon frame. There is
   *  one of those and it is `FlightAttitude`'s, so the ball, the ribbon and the
   *  keys cannot disagree about which way east is. */
  private marker(dir: Vec3 | null): BallMarker | null {
    return dir === null ? null : horizonAngles(dir, this.session.up);
  }

  readout(): NavballReadout {
    const s = this.session;
    const st = s.state;
    const tm = s.telemetry;
    const u = s.up;
    const nose = this.marker(st.forward) ?? { headingDeg: 0, pitchDeg: 90 };
    const v = st.vel;
    const speed = len(v);
    const pro = speed > 0.5 ? this.marker(v) : null;
    const retro = pro === null ? null
      : { headingDeg: (pro.headingDeg + 180) % 360, pitchDeg: -pro.pitchDeg };
    const roll = rollAngle(st.forward, st.right, u);
    const next = s.nextStageIndex();
    return {
      headingDeg: nose.headingDeg, pitchDeg: nose.pitchDeg,
      rollDeg: (roll * 180) / Math.PI,
      prograde: pro, retrograde: retro,
      command: this.marker(s.sasName === 'CMD' ? st.forward : null),
      guidance: this.marker(s.guidanceDir()),
      altitudeM: s.altitudeAglM, altitudeDatumM: tm.altitudeM,
      surfaceSpeedMS: speed, orbitalSpeedMS: speed,
      verticalSpeedMS: dot(v, u),
      apoapsisM: s.orbit.apoapsisAltM, periapsisM: s.orbit.periapsisAltM,
      bound: s.orbit.bound,
      throttle: s.throttleValue,
      stages: s.stageRows.map((q) => ({
        index: q.index, dvVacMS: q.dvVacMS, twr: q.twr, burnS: q.burnS,
        active: q.index === Math.max(0, next - 1),
      })),
      totalDvMS: s.totalDvMS(), remainingDvMS: s.remainingDvMS(),
      sas: s.sasName, status: s.status,
      qPa: tm.qPa, maxQPa: s.maxQPa, twr: s.currentTwr(), massKg: tm.massKg,
      gForce: tm.accelMS2 / 9.80665, metS: Math.max(0, s.metS),
      message: s.message !== '' ? s.message : this.message,
    };
  }

  vesselPosition(out: Vec3d): Vec3d { return this.observer.vesselPosition(out); }

  report(): unknown {
    return {
      aboard: this.aboard, rollouts: this.rollouts, boardings: this.boardings,
      disembarks: this.disembarks, refusals: this.refusals,
      distanceToVesselM: this.session.live
        ? Math.round(this.distanceToVessel() * 100) / 100 : -1,
      boardRangeM: BOARD_RANGE_M,
      message: this.message, loaded: this.loaded,
      catalogue: this.catalogue.length,
      flight: this.session.report(),
      observer: this.observer.report(),
      view: this.view.report(),
      navball: this.navball.report(),
    };
  }
}
