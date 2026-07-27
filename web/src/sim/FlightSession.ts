// ONE flown vessel: the /core flight handle, the launch clamp, and the control
// state a player's keys move. Nothing here integrates anything; `of_fl_step`
// does all of it, and this file decides only WHEN and with what inputs.
//
// GROUND CONTACT, physics risk R5. `/core` has no contact at any layer, so this
// solves the PAD end with a launch clamp and does NOT pretend to solve the
// landing end: `DOWN` is an ARREST, no gear or friction or tip-over or impact
// tolerance. Half-building it would look right and not be.
import { vesselAbi } from './wasm/vesselabi.js';
import type { OfVesselModule } from './wasm/vesselabi.js';
import type { OfCoreModule } from './wasm/heap.js';
import {
  SAS_COMMAND, SAS_OFF, SAS_NAMES, dot, flightOrbit, flightParts, flightState,
  flightTelemetry, len, norm,
} from './FlightAbi.js';
import { flightReport, readStagePerformance } from './FlightReport.js';
import { commandDirection, cycleSas, guidanceDir, levelWings, setSas, slew }
  from './FlightSas.js';
import { horizonFrame } from './FlightAttitude.js';
import { WARP_STEPS, warpSteps } from './FlightWarp.js';
import type { FlightPartRow, FlightStateRow, FlightTelemetryRow, OrbitRow, Vec3 } from './FlightAbi.js';

export type FlightStatus = 'CLAMPED' | 'ASCENT' | 'COAST' | 'ORBIT' | 'DOWN';

export interface FlightStageRow {
  index: number; dvVacMS: number; twr: number; burnS: number;
  thrustVacN: number; propellantKg: number;
}

export interface FlightPorts {
  M: OfCoreModule;
  bodyHandle: number;
  bodyRadiusM: number;
  /** Ground radius under a unit direction, metres from the body centre. */
  surfaceRadius(dx: number, dy: number, dz: number): number;
}

/** Degrees per second the command slews at full deflection. DW-30 item 3 wants
 *  generous authority, but a rate the torque cannot follow is a marker that
 *  LIES: 45 deg/s overshot the ribbon by 20 degrees a side; 20 tracks it. */
const SLEW_DEG_S = 20;
const ROLL_DEG_S = 60;
export class FlightSession {
  handle = 0;
  status: FlightStatus = 'CLAMPED';
  message = '';
  /** Sim seconds since the clamp released. -1 while still held. */
  metS = -1;
  warpIndex = 0;
  maxQPa = 0;
  stagings = 0;
  steps = 0;
  /** Set when the vessel first rises 1 m: the proof it left the ground. */
  liftedOff = false;
  clampTicks = 0; clampStepOk = 0; liftoffAltM = 0; peakAltM = 0;

  /** Pad ground radius, and the vessel base offset below its own origin. */
  padRadiusM = 0; baseOffsetM = 0;
  padUp: Vec3 = [0, 1, 0];
  /** GP-57: true when `rollOut` was given a stand radius, i.e. the vessel is on
   *  a built launch pad rather than on the R12 stand-in patch of ground. */
  onPad = false;
  /**
   * HOW MANY TIMES THE LAUNCH CLAMP HAS RELEASED, and the sim tick it last did.
   *
   * A COUNTER RATHER THAN A CALLBACK, and that is the whole point of it. The
   * pad's own clamps have to swing back at this exact instant, and wiring them
   * as a direct call from `tryRelease` would make "they fired together" true by
   * construction and therefore unassertable: a probe checking it would be
   * checking that one line calls another. A counter plus a tick lets the pad
   * record its OWN release tick independently, so the acceptance compares two
   * numbers that were written by two systems and can genuinely disagree.
   *
   * The tick is a FIXED tick and not a timestamp because release happens inside
   * `stepClamped` on the fixed step, and a frame carries one to three of those:
   * a per-frame clock cannot tell "the same instant" from "within 50 ms" and
   * would turn the assertion into a coincidence detector.
   */
  releases = 0;
  releasedAtTick = -1;
  /** The fixed tick this session is being stepped on. Written by the caller each
   *  tick, because a sim has no business knowing the loop's index and the loop
   *  is the only thing that does. Named `fixedTick` rather than `tick` because
   *  `tick(nowS)` is already this class's per-frame method. */
  fixedTick = -1;

  /** PUBLIC because FlightSas.ts drives the attitude exports directly. It is
   *  still nobody else's: the ABI face is `vesselabi.ts` and this is one
   *  session's bound handle onto it. */
  readonly V: OfVesselModule;
  /** The DESIGN the craft was copied from. Kept because the per-stage delta-v
   *  table is an `of_vs_*` read taking a VESSEL handle, and the two registries
   *  both number from 1 (PH-27). */
  private design = 0;
  /** PUBLIC for FlightSas.ts, which owns every transition either one makes. */
  sasMode = SAS_COMMAND;
  command: Vec3 = [0, 1, 0];
  private throttle = 0;
  private parts: FlightPartRow[] = [];
  private stages: FlightStageRow[] = [];
  /** PUBLIC for FlightSas.ts: a roll writes `right` back into the live row. The
   *  `state` getter stays, because everything that only READS should use it. */
  st: FlightStateRow;
  private tm: FlightTelemetryRow;
  private orb: OrbitRow;
  private msgUntilS = 0; private partsRevision = 0; private nowS = 0;

  constructor(private readonly p: FlightPorts) {
    this.V = vesselAbi(p.M);
    this.st = flightState(p.M, 0);
    this.tm = flightTelemetry(p.M, 0);
    this.orb = flightOrbit(p.M, 0);
  }

  get live(): boolean { return this.handle > 0; }
  /** The wasm module, for FlightSas.ts. The ports stay private. */
  get core(): OfCoreModule { return this.p.M; }
  get partRows(): readonly FlightPartRow[] { return this.parts; }
  get revision(): number { return this.partsRevision; }
  get state(): FlightStateRow { return this.st; }
  get telemetry(): FlightTelemetryRow { return this.tm; }
  get orbit(): OrbitRow { return this.orb; }
  get stageRows(): readonly FlightStageRow[] { return this.stages; }
  get throttleValue(): number { return this.throttle; }
  get sasName(): string { return SAS_NAMES[this.sasMode] ?? 'OFF'; }
  get warpFactor(): number { return WARP_STEPS[this.warpIndex] ?? 1; }
  get clamped(): boolean { return this.status === 'CLAMPED'; }
  get up(): Vec3 { return norm(this.st.pos); }
  /** Where SAS is AIMING, which is NOT where the nose is (PH-44). */
  get commandDir(): Vec3 { return this.command; }

  /** Metres from the vessel's BASE to the ground, which is what "did it leave
   *  the pad" asks, and NOT `telemetry.altitudeM` (from the datum). The offset
   *  SUBTRACTS (PH-28): the origin is the stack's TOP, so the base is that far
   *  below it. Adding it read ALT AGL 19.20 m standing still on the pad. */
  get altitudeAglM(): number {
    const r = len(this.st.pos);
    if (!(r > 0)) return 0;
    const u = norm(this.st.pos);
    return r - this.p.surfaceRadius(u[0], u[1], u[2]) - this.baseOffsetM;
  }

  /**
   * Roll a design out at a unit direction. The origin is the TOP of the stack,
   * so the BASE goes on the ground and the origin `-minY` above it.
   *
   * GP-57: `standRadiusM` OVERRIDES the ground for the base's radius, and it is
   * how a rocket stands on a launch pad's `socket_vessel` (2.00 m above the
   * pad's own base) instead of in the dirt. It is a RADIUS rather than a height
   * offset on purpose: the caller has already measured the socket in the pad's
   * own frame and turned it into a body-frame point, so handing over a length
   * from the planet centre leaves nothing here to re-derive, and a pad on a
   * hillside, on a second storey or on another body all arrive the same way.
   *
   * `padRadiusM` still records whatever the base was put on, so a probe reading
   * it gets the pad deck's radius on a pad launch and the ground's on a
   * stand-in launch, which is exactly the distinction worth being able to see.
   * ALT AGL is deliberately NOT adjusted: it measures against the terrain, and a
   * rocket standing on a 2 m deck genuinely IS 2 m above the ground. Making it
   * read zero on a pad would be making an instrument lie to keep a number the
   * same.
   */
  rollOut(designHandle: number, dir: Vec3, standRadiusM = 0): boolean {
    this.destroy();
    const h = this.V._of_fl_create(designHandle, this.p.bodyHandle);
    if (h <= 0) { this.flash('no vessel to launch'); return false; }
    this.handle = h;
    this.design = designHandle;
    this.refreshParts();
    if (this.parts.length === 0) { this.destroy(); this.flash('empty design'); return false; }

    let minY = 0;
    for (const q of this.parts) minY = Math.min(minY, q.originM[1]);
    this.baseOffsetM = -minY;

    const u = norm(dir);
    this.padUp = u;
    this.padRadiusM = standRadiusM > 0 ? standRadiusM
      : this.p.surfaceRadius(u[0], u[1], u[2]);
    this.onPad = standRadiusM > 0;
    const r = this.padRadiusM + this.baseOffsetM;
    this.V._of_fl_set_pos_vel(h, u[0] * r, u[1] * r, u[2] * r, 0, 0, 0);
    // Nose straight up, +X east: the gravity turn is flown east (FlightAttitude).
    const east = horizonFrame(u).east;
    this.V._of_fl_set_attitude(h, u[0], u[1], u[2], east[0], east[1], east[2]);
    this.V._of_fl_set_ang_vel(h, 0, 0, 0);
    this.sasMode = SAS_OFF;      // so commandDirection does the switch itself
    this.commandDirection(u);
    this.throttle = 0;
    this.V._of_fl_set_throttle(h, 0);
    this.status = 'CLAMPED'; this.metS = -1;
    this.releasedAtTick = -1;
    this.maxQPa = 0; this.stagings = 0; this.steps = 0;
    this.liftedOff = false; this.peakAltM = 0; this.warpIndex = 0;
    this.sample(); this.flash('on the pad, held by the clamp');
    return true;
  }

  destroy(): void {
    if (this.handle > 0) this.V._of_fl_destroy(this.handle);
    this.handle = 0; this.parts = []; this.stages = []; this.status = 'CLAMPED';
  }

  // --- controls, all driven by ACTIONS and never by a key --------------------

  setThrottle(t: number): void {
    this.throttle = t < 0 ? 0 : t > 1 ? 1 : t;
    if (this.handle > 0) this.V._of_fl_set_throttle(this.handle, this.throttle);
  }
  nudgeThrottle(d: number): void { this.setThrottle(this.throttle + d); }

  /** Slew, set a mode, aim the command, cycle. All in FlightSas.ts. */
  slew(p: number, y: number, r: number): void { slew(this, p, y, r); }
  setSas(mode: number): void { setSas(this, mode); }
  commandDirection(dir: Vec3): void { commandDirection(this, dir); }
  cycleSas(): void { cycleSas(this); }

  setWarp(i: number): void {
    this.warpIndex = Math.max(0, Math.min(WARP_STEPS.length - 1, i));
    this.flash(`warp ${this.warpFactor}x`);
  }

  /** Fire the next stage. On the pad this LIGHTS the first engine and releases
   *  the clamp, as in KSP: set the throttle, then `sim.stage()`. */
  fireStage(): boolean {
    if (this.handle <= 0) return false;
    // ONE PRESS ON THE PAD (PH-29). The first lights the engine; a second while
    // the clamp holds throws away the booster, what is left cannot reach TWR 1
    // and the clamp never releases. Measured: four presses took the reference
    // vehicle from 11 parts to 4 and bolted it to the ground.
    if (this.status === 'CLAMPED' && this.stagings > 0) {
      this.flash('clamp still holding: throttle up first, do not stage again');
      return false;
    }
    const jettisoned = this.V._of_fl_stage(this.handle);
    if (jettisoned < 0) { this.flash('no stage left'); return false; }
    this.stagings += 1;
    this.refreshParts();
    if (this.status === 'CLAMPED') this.tryRelease();
    else this.flash(`staged, ${Math.round(jettisoned)} kg away`);
    return true;
  }

  /** The clamp lets go when the thrust can actually lift the vehicle. */
  tryRelease(): boolean {
    if (this.handle <= 0 || this.status !== 'CLAMPED') return false;
    const twr = this.currentTwr();
    if (!(twr >= 1.0)) {
      this.flash(`clamp holding: TWR ${twr.toFixed(2)}, throttle up`);
      return false;
    }
    this.status = 'ASCENT';
    this.metS = 0;
    this.liftoffAltM = this.altitudeAglM;
    this.releases += 1;
    this.releasedAtTick = this.fixedTick;
    this.flash('clamp released');
    return true;
  }

  currentTwr(): number {
    if (this.handle <= 0) return 0;
    const mass = this.tm.massKg;
    if (!(mass > 0)) return 0;
    const r = Math.max(1, len(this.st.pos));
    // mu/r^2 is the one gravity authority (DW-18/PH-18). kG0 is a unit
    // conversion and is deliberately not used here.
    const g = this.p.bodyHandle > 0
      ? this.p.M._of_gravity_accel(this.p.bodyHandle, r) : 9.81;
    return this.tm.thrustN / (mass * g);
  }

  // --- the tick --------------------------------------------------------------

  /** One fixed sim tick. `dt` is the loop's fixed step. */
  step(dt: number): void {
    if (this.handle <= 0) return;
    if (this.status === 'CLAMPED') { this.stepClamped(dt); return; }
    if (this.status === 'DOWN') { this.sample(); return; }

    const n = warpSteps(this.warpFactor, this.tm.inSpace, this.altitudeAglM,
                        -dot(this.st.vel, this.up), dt);
    this.V._of_fl_step_n(this.handle, dt, n);
    this.steps += n;
    this.metS += dt * n;
    this.sample();
    this.levelWings(dt * n);

    const agl = this.altitudeAglM;
    if (!this.liftedOff && agl > this.liftoffAltM + 1.0) this.liftedOff = true;
    this.peakAltM = Math.max(this.peakAltM, this.tm.altitudeM);
    this.maxQPa = Math.max(this.maxQPa, this.tm.qPa);

    if (agl <= 0 && this.liftedOff) {
      // ARRESTED, not landed. See the header: there is no gear model here.
      // Snapped UP to the surface: one step at re-entry speed buries the base.
      const u = this.up;
      const gr = this.p.surfaceRadius(u[0], u[1], u[2]) + this.baseOffsetM;
      this.V._of_fl_set_pos_vel(this.handle, u[0] * gr, u[1] * gr, u[2] * gr, 0, 0, 0);
      this.V._of_fl_set_throttle(this.handle, 0);
      this.throttle = 0; this.status = 'DOWN'; this.warpIndex = 0;
      this.sample();
      // `telemetry` is only written by `step` and still holds the impact speed,
      // so the STATE is the authority for "is it moving" from here on.
      this.st.vel = [0, 0, 0];
      this.flash('down, arrested at the surface');
      return;
    }
    this.status = this.tm.inSpace
      ? (this.orb.bound && this.orb.periapsisAltM > 0 ? 'ORBIT' : 'COAST')
      : 'ASCENT';
  }

  /** THE CLAMP. It STEPS AND RESTORES rather than skipping the step because
   *  `FlightSim::telemetry` is written by `step` and nothing else, so a clamp
   *  that did not step read zero thrust, zero mass, TWR zero, and refused to
   *  release forever while every HUD number looked healthy. With the throttle
   *  shut the step is free: no thrust and no motion burns nothing. */
  private stepClamped(dt: number): void {
    this.clampTicks += 1;
    const p0 = this.st.pos, f0 = this.st.forward, r0 = this.st.right;
    this.clampStepOk = this.V._of_fl_step(this.handle, dt);
    this.V._of_fl_set_pos_vel(this.handle, p0[0], p0[1], p0[2], 0, 0, 0);
    this.V._of_fl_set_attitude(this.handle, f0[0], f0[1], f0[2], r0[0], r0[1], r0[2]);
    this.V._of_fl_set_ang_vel(this.handle, 0, 0, 0);
    this.sample();
    // A clamped rocket is not moving, whatever one step of gravity just did.
    this.st.pos = p0; this.st.vel = [0, 0, 0];
    this.st.forward = f0; this.st.right = r0;
    if (this.throttle > 0) this.tryRelease();
  }

  /** Stability assist's third axis. See FlightSas.ts. */
  private levelWings(dt: number): void { levelWings(this, dt); }

  /** Per-frame message expiry only; everything else moves on the fixed tick.
   *  `nowS` is captured here because it is the ONLY place the LOOP's clock
   *  reaches this file, and both message clocks must be that one (PH-35: they
   *  were not, and no message this session raised was ever visible). */
  tick(simSecs: number): void {
    this.nowS = simSecs;
    if (this.message !== '' && simSecs > this.msgUntilS) this.message = '';
  }

  private sample(): void {
    const M = this.p.M;
    this.st = flightState(M, this.handle);
    this.tm = flightTelemetry(M, this.handle);
    this.orb = flightOrbit(M, this.handle);
  }

  private refreshParts(): void {
    this.parts = flightParts(this.p.M, this.handle);
    this.partsRevision += 1;
    this.stages = readStagePerformance(this.p.M, this.design, this.p.bodyHandle,
                                       this.p.bodyRadiusM);
    this.sample();
  }

  /** Public: anything that answers a key answers on the line the sim uses. */
  flash(msg: string): void {
    this.message = msg;
    this.msgUntilS = this.nowS + 5;
  }

  // --- what the navball and the probe read -----------------------------------

  remainingDvMS(): number {
    return this.handle > 0 ? this.V._of_fl_remaining_dv_vacuum(this.handle) : 0;
  }
  totalDvMS(): number {
    let s = 0;
    for (const r of this.stages) s += r.dvVacMS;
    return s;
  }
  onRails(): boolean {
    return this.handle > 0 && this.V._of_fl_on_rails_eligible(this.handle) === 1;
  }
  nextStageIndex(): number {
    return this.handle > 0 ? this.V._of_fl_next_stage_index(this.handle) : -1;
  }
  /** Off the LIVE craft's parts, not `of_vs_propellant_aboard`: the two handle
   *  registries both number from 1 (FlightReport.readStagePerformance). */
  propellantKg(): number {
    let s = 0;
    for (const q of this.parts) s += q.propellantKg;
    return s;
  }

  /** The ribbon (DW-30 item 6), fed the altitude ABOVE THE PAD. Its 500 m and
   *  45 km are numbers about a LAUNCH: the shipped spawn is on terrain 3 km up,
   *  so datum altitude had it commanding 18 degrees of pitch-over on the pad. */
  guidanceDir(): Vec3 | null { return guidanceDir(this); }

  report(): unknown { return flightReport(this); }
}

export { SLEW_DEG_S as FLIGHT_SLEW_DEG_S, ROLL_DEG_S as FLIGHT_ROLL_DEG_S };
