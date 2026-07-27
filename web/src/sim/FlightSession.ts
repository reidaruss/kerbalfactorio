// ONE flown vessel: the /core flight handle, the launch clamp, and the control
// state a player's keys move. Nothing here integrates anything; `of_fl_step`
// does all of it, and this file decides only WHEN and with what inputs.
//
// GROUND CONTACT, physics risk R5. `/core` has no contact at any layer: a vessel
// flies and orbits, it cannot sit on anything. This file solves the PAD end with
// a launch clamp (`stepClamped`) and does NOT pretend to solve the landing end.
// `DOWN` is an ARREST: the state freezes at the surface, with no gear
// compression, no friction, no tip-over and no impact tolerance. Landing legs
// remain data. Real contact is a later milestone, and half-building it here
// would produce a landing that looks right and is not.
import { vesselAbi } from './wasm/vesselabi.js';
import type { OfVesselModule } from './wasm/vesselabi.js';
import type { OfCoreModule } from './wasm/heap.js';
import {
  SAS_COMMAND, SAS_PROGRADE, SAS_RETROGRADE, SAS_NAMES, add,
  flightOrbit, flightParts, flightState, flightTelemetry, guidancePitch, len,
  norm, rotateAbout, scale,
} from './FlightAbi.js';
import { flightReport, readStagePerformance } from './FlightReport.js';
import { holdRoll, horizonFrame, slewCommand } from './FlightAttitude.js';
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

/** Degrees per second the command slews at full deflection. DW-30 item 3 asks
 *  for generous authority, but a rate the torque cannot keep up with is not
 *  generosity, it is a marker that lies about where the nose is going: 45 deg/s
 *  overshot the ribbon by 20 degrees a side, 20 tracks it. */
const SLEW_DEG_S = 20;
const ROLL_DEG_S = 60;
/** How fast stability assist takes roll back out. Slower than the player's own
 *  roll rate, so a deliberate roll wins while the key is held. */
const ROLL_HOLD_DEG_S = 20;
/**
 * PHYSICS warp, and the distinction matters. `of_fl_step_n(f, dt, n)` takes n
 * steps of the SAME dt, so warping costs the integrator exactly nothing: the
 * trajectory is the one a real-time flight would fly. What it costs is CONTROL
 * LATENCY, the stick being sampled once per block, which is why the in-air cap
 * is the LOWER one, not KSP's on-rails warp that cannot be used under thrust.
 */
const WARP_STEPS = [1, 2, 4, 10, 50, 200, 1000] as const;
const WARP_IN_AIR_MAX = 10;

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
  clampTicks = 0; clampStepOk = 0;   // "did the sim advance", from outside
  liftoffAltM = 0; peakAltM = 0;

  /** Pad ground radius, and the vessel base offset below its own origin. */
  padRadiusM = 0; baseOffsetM = 0;
  padUp: Vec3 = [0, 1, 0];

  private readonly V: OfVesselModule;
  /** The DESIGN the craft was copied from. Kept because the per-stage delta-v
   *  table is an `of_vs_*` read and those take a VESSEL handle, never a flight
   *  one, and the two registries both number from 1. */
  private design = 0;
  private sasMode = SAS_COMMAND;
  private command: Vec3 = [0, 1, 0];
  private throttle = 0;
  private parts: FlightPartRow[] = [];
  private stages: FlightStageRow[] = [];
  private st: FlightStateRow;
  private tm: FlightTelemetryRow;
  private orb: OrbitRow;
  private msgUntilS = 0; private partsRevision = 0;

  constructor(private readonly p: FlightPorts) {
    this.V = vesselAbi(p.M);
    this.st = flightState(p.M, 0);
    this.tm = flightTelemetry(p.M, 0);
    this.orb = flightOrbit(p.M, 0);
  }

  get live(): boolean { return this.handle > 0; }
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

  /** Metres from the vessel's BASE to the ground under it: what "did it leave
   *  the pad" is asked of, and NOT `telemetry.altitudeM` (from the datum). */
  get altitudeAglM(): number {
    const r = len(this.st.pos);
    if (!(r > 0)) return 0;
    const u = norm(this.st.pos);
    return r - this.p.surfaceRadius(u[0], u[1], u[2]) + this.baseOffsetM;
  }

  /** Roll a design out at a unit direction on the body. The vessel's origin is
   *  at the TOP of the stack, so the BASE (most negative local Y) goes on the
   *  ground and the origin `-minY` above it, or the vehicle would be buried. */
  rollOut(designHandle: number, dir: Vec3): boolean {
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
    this.padRadiusM = this.p.surfaceRadius(u[0], u[1], u[2]);
    const r = this.padRadiusM + this.baseOffsetM;
    this.V._of_fl_set_pos_vel(h, u[0] * r, u[1] * r, u[2] * r, 0, 0, 0);
    // Nose straight up, +X east: the gravity turn is flown east (FlightAttitude).
    const east = horizonFrame(u).east;
    this.V._of_fl_set_attitude(h, u[0], u[1], u[2], east[0], east[1], east[2]);
    this.V._of_fl_set_ang_vel(h, 0, 0, 0);
    this.command = u;
    this.sasMode = SAS_COMMAND;
    this.V._of_fl_set_sas(h, SAS_COMMAND);
    this.V._of_fl_set_sas_command(h, u[0], u[1], u[2]);
    this.throttle = 0;
    this.V._of_fl_set_throttle(h, 0);
    this.status = 'CLAMPED'; this.metS = -1;
    this.maxQPa = 0; this.stagings = 0; this.steps = 0;
    this.liftedOff = false; this.peakAltM = 0; this.warpIndex = 0;
    this.sample();
    this.flash('on the pad, held by the clamp');
    return true;
  }

  destroy(): void {
    if (this.handle > 0) this.V._of_fl_destroy(this.handle);
    this.handle = 0; this.parts = []; this.stages = [];
    this.status = 'CLAMPED';
  }

  // --- controls, all driven by ACTIONS and never by a key --------------------

  setThrottle(t: number): void {
    this.throttle = t < 0 ? 0 : t > 1 ? 1 : t;
    if (this.handle > 0) this.V._of_fl_set_throttle(this.handle, this.throttle);
  }
  nudgeThrottle(d: number): void { this.setThrottle(this.throttle + d); }

  /** Slew the command in the LOCAL HORIZON FRAME (FlightAttitude). Radians:
   *  pitch > 0 lowers the nose, yaw > 0 turns right, roll > 0 rolls right. */
  slew(pitchRad: number, yawRad: number, rollRad: number): void {
    if (this.handle <= 0) return;
    if (pitchRad === 0 && yawRad === 0 && rollRad === 0) return;
    const c = slewCommand(this.command, this.up, pitchRad, yawRad);
    this.command = norm(c);
    if (this.sasMode !== SAS_COMMAND) this.setSas(SAS_COMMAND);
    this.V._of_fl_set_sas_command(this.handle, this.command[0], this.command[1],
                                  this.command[2]);
    if (rollRad !== 0) {
      const rr = rotateAbout(norm(this.st.right), norm(this.st.forward), rollRad);
      this.V._of_fl_set_attitude(this.handle, this.st.forward[0], this.st.forward[1],
                                 this.st.forward[2], rr[0], rr[1], rr[2]);
    }
  }

  setSas(mode: number): void {
    if (this.handle <= 0) return;
    this.sasMode = mode;
    this.V._of_fl_set_sas(this.handle, mode);
    if (mode === SAS_COMMAND) {
      this.command = norm(this.st.forward);
      this.V._of_fl_set_sas_command(this.handle, this.command[0], this.command[1],
                                    this.command[2]);
    }
  }

  /** Command / Prograde / Retrograde, in that cycle. DW-30 item 2. */
  cycleSas(): void {
    const next = this.sasMode === SAS_COMMAND ? SAS_PROGRADE
      : this.sasMode === SAS_PROGRADE ? SAS_RETROGRADE : SAS_COMMAND;
    this.setSas(next);
    this.flash(`SAS ${SAS_NAMES[next] ?? ''}`);
  }

  setWarp(i: number): void {
    this.warpIndex = Math.max(0, Math.min(WARP_STEPS.length - 1, i));
    this.flash(`warp ${this.warpFactor}x`);
  }

  /**
   * Fire the next stage. On the pad this LIGHTS the first engine and releases
   * the clamp, as in KSP and as `test_flight.cpp`'s flyToOrbit does it: set the
   * throttle, then `sim.stage()`.
   */
  fireStage(): boolean {
    if (this.handle <= 0) return false;
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

    let n = this.warpFactor;
    if (!this.tm.inSpace && n > WARP_IN_AIR_MAX) n = WARP_IN_AIR_MAX;
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

  /**
   * THE CLAMP, and the reason it STEPS AND RESTORES rather than skipping the
   * step: `FlightSim::telemetry` is written by `step` and nothing else, so a
   * clamp that did not step reported zero thrust and zero mass, hence TWR zero,
   * hence refused to release, forever, while every HUD number read healthy.
   * It is also what a hold-down physically does, and with the throttle shut it
   * is free, because a step with no thrust and no motion burns nothing.
   */
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

  /** Stability assist's third axis (FlightAttitude.holdRoll). */
  private levelWings(dt: number): void {
    if (this.sasName === 'OFF' || this.handle <= 0) return;
    const r = holdRoll(this.st.forward, this.st.right, this.up,
                       ROLL_HOLD_DEG_S * (Math.PI / 180) * dt);
    if (r === this.st.right) return;
    const f = this.st.forward;
    this.V._of_fl_set_attitude(this.handle, f[0], f[1], f[2], r[0], r[1], r[2]);
    this.st.right = r;
  }

  /** Per-frame message expiry only. Everything else moves on the fixed tick. */
  tick(simSecs: number): void {
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


  private flash(msg: string): void {
    this.message = msg;
    this.msgUntilS = (this.metS < 0 ? 0 : this.metS) + 4;
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
  guidanceDir(): Vec3 | null {
    if (this.handle <= 0) return null;
    const g = guidancePitch(this.p.M, Math.max(0, this.altitudeAglM));
    const u = this.up;
    const p = g.pitchFromVerticalRad;
    return norm(add(scale(u, Math.cos(p)), horizonFrame(u).east, Math.sin(p)));
  }

  report(): unknown { return flightReport(this); }
}


export { SLEW_DEG_S as FLIGHT_SLEW_DEG_S, ROLL_DEG_S as FLIGHT_ROLL_DEG_S,
         WARP_STEPS as FLIGHT_WARP_STEPS };
