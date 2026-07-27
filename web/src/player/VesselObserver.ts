// The vessel as the STREAMING OBSERVER: a chase camera that implements the same
// ViewSource contract the walking capsule does.
//
// This is the load-bearing idea of the whole flight milestone. The four-pass
// scaled-space rig, the floating origin, the regime bands and the terrain
// streamer are all driven from ONE object, `services.observer`. Make the rocket
// that object and the surface-to-orbit handoff needs no flight-specific code at
// all: the origin rebases around the vessel, chunks stream to it, the regime
// crosses SURFACE -> ASCENT -> ORBIT off its altitude and the near scene empties
// into the far scaled one exactly as it was designed to. Anything else would
// have been a second definition of "where the player is".
//
// step() is also where the flight sim advances, because Loop's fixed order is
// input -> observer -> FloatingOrigin, and the origin must rebase in the SAME
// tick the vessel moved or a 2 km/s vehicle presents a stale eye.

import * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { InputFrame } from './Input.js';
import type { Input } from './Input.js';
import type { ObserverState, ViewSource } from './ViewSource.js';
import { tangentFrame } from './ViewSource.js';
import { FlightControls } from './FlightControls.js';
import type { FlightSession } from '../sim/FlightSession.js';

/** Chase distance as a multiple of the vessel's own length, and the floor. */
const CHASE_SPAN = 2.2;
const CHASE_MIN_M = 14;
const PITCH_MIN = -1.35;
const PITCH_MAX = 1.35;

export class VesselObserver implements ViewSource {
  readonly position: Vec3d = { x: 0, y: 0, z: 0 };
  readonly orientation = new THREE.Quaternion();
  readonly up = new THREE.Vector3(0, 1, 0);
  altM = 0;
  readonly controls: FlightControls;

  /** Camera orbit about the vessel, in the vessel's local frame. */
  yaw = 0;
  pitch = 0.22;
  distanceM = CHASE_MIN_M;
  /** How far below the vessel's own origin the camera looks. The origin is at
   *  the TOP of the stack, so aiming at it puts a 12 m rocket entirely below
   *  the crosshair; this is half the LIVE craft's length, re-measured on every
   *  staging, because a stale value from roll-out leaves the camera pointing at
   *  where the discarded booster used to be. */
  midOffsetM = 0;

  /**
   * The vessel's own body-frame position AT THE INTERPOLATED INSTANT the camera
   * was placed for, which is NOT `session.state.pos`.
   *
   * Anything that draws the vessel must read THIS. The camera aims at the lerp
   * between the last two fixed ticks and the sim's own position is the end of
   * that lerp, so a renderer that used the raw one put the model up to a whole
   * tick of travel away from where the camera was looking: 38 m at orbital
   * speed against a 21 m chase distance, which is the rocket completely out of
   * frame. On the pad the two agree exactly, so it looks perfect until it moves.
   */
  readonly renderPos: Vec3d = { x: 0, y: 0, z: 0 };

  private readonly prev: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly curr: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly eye = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();

  constructor(
    private readonly flight: FlightSession,
    private readonly oracle: SurfaceOracle,
    input: Input,
  ) {
    this.controls = new FlightControls(input);
  }

  /** Frame on a craft of this length. Called on roll-out AND on every staging,
   *  because both the distance and the look-at point are properties of what is
   *  still bolted on, not of what left the pad. */
  frameFor(lengthM: number): void {
    this.distanceM = Math.max(CHASE_MIN_M, lengthM * CHASE_SPAN);
    this.midOffsetM = lengthM * 0.5;
  }

  step(_inp: InputFrame, dt: number): void {
    this.prev.x = this.curr.x; this.prev.y = this.curr.y; this.prev.z = this.curr.z;
    this.controls.step(this.flight, dt);
    this.flight.step(dt);
    const p = this.flight.state.pos;
    this.curr.x = p[0]; this.curr.y = p[1]; this.curr.z = p[2];
    if (this.prev.x === 0 && this.prev.y === 0 && this.prev.z === 0) {
      this.prev.x = this.curr.x; this.prev.y = this.curr.y; this.prev.z = this.curr.z;
    }
    this.interpolate(1);
  }

  /**
   * SEED THE INTERPOLATOR FROM THE SIM WITHOUT STEPPING IT (PH-31).
   *
   * `step` is only reached through `ViewRouter`, and the vessel is the router's
   * source only while somebody is ABOARD. So between roll-out and boarding
   * nothing wrote `renderPos`, it was still the {0,0,0} it was constructed
   * with, and `FlightMode.frame` drew the whole rocket at the BODY CENTRE, 600
   * km under the pad and outside the near camera's far plane. The vessel is
   * planted at PAD_AHEAD_M = 26 m and boarding reaches to 18 m, so there is
   * ALWAYS a walk during which the rocket the game just told you to walk to
   * does not exist on screen, and it appears out of nowhere as you board.
   *
   * Invisible to every instrument because `distanceToVessel` reads
   * `session.state.pos`, which was right the whole time: the walk, the range
   * refusal and the boarding all measured correctly against a rocket that was
   * not being drawn.
   *
   * Also the reset the roll-out needed anyway: without it a SECOND flight
   * lerps its first tick from wherever the LAST one ended, sweeping the camera
   * and the model across the intervening ground in one frame.
   */
  syncToVessel(): void {
    const p = this.flight.state.pos;
    this.curr.x = p[0]; this.curr.y = p[1]; this.curr.z = p[2];
    this.prev.x = p[0]; this.prev.y = p[1]; this.prev.z = p[2];
    this.interpolate(1);
  }

  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dPitch));
  }

  /**
   * The chase camera. It orbits the SURFACE frame, not the vessel's own frame:
   * a camera welded to the hull rolls with it, and a rolling horizon is the
   * fastest way to make a player unable to tell which way is up. KSP does the
   * same thing and it is the right call.
   */
  interpolate(alpha: number): void {
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
    const cx = this.prev.x + (this.curr.x - this.prev.x) * a;
    const cy = this.prev.y + (this.curr.y - this.prev.y) * a;
    const cz = this.prev.z + (this.curr.z - this.prev.z) * a;

    this.renderPos.x = cx; this.renderPos.y = cy; this.renderPos.z = cz;
    const r = Math.hypot(cx, cy, cz) || 1;
    this.camUp.set(cx / r, cy / r, cz / r);
    this.up.copy(this.camUp);
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    tangentFrame(this.camUp, east, north);

    // Offset in the local horizon frame: yaw around up, pitch above the horizon.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw), cyw = Math.cos(this.yaw);
    const dirX = north.x * cyw * cp + east.x * sy * cp + this.camUp.x * sp;
    const dirY = north.y * cyw * cp + east.y * sy * cp + this.camUp.y * sp;
    const dirZ = north.z * cyw * cp + east.z * sy * cp + this.camUp.z * sp;

    // Aim at the middle of the stack, not at its origin, or a tall rocket sits
    // at the top of the frame with the pad filling it.
    const mid = this.midOffsetM;
    const ax = cx - this.camUp.x * mid;
    const ay = cy - this.camUp.y * mid;
    const az = cz - this.camUp.z * mid;

    this.position.x = ax + dirX * this.distanceM;
    this.position.y = ay + dirY * this.distanceM;
    this.position.z = az + dirZ * this.distanceM;
    this.aim.set(ax - this.position.x, ay - this.position.y, az - this.position.z)
      .normalize();

    // Basis from the aim and the LOCAL up, so the horizon stays level.
    this.fwd.copy(this.aim);
    this.right.crossVectors(this.fwd, this.camUp);
    if (this.right.lengthSq() < 1e-9) this.right.set(1, 0, 0);
    this.right.normalize();
    const trueUp = new THREE.Vector3().crossVectors(this.right, this.fwd).normalize();
    // three's camera looks down -Z, so the Z column is -forward.
    this.basis.makeBasis(this.right, trueUp, this.fwd.clone().negate());
    this.orientation.setFromRotationMatrix(this.basis);

    const er = Math.hypot(this.position.x, this.position.y, this.position.z) || 1;
    this.altM = er - this.oracle.surfaceRadius(
      this.position.x / er, this.position.y / er, this.position.z / er);
  }

  /** The vessel's own body-frame position, which is NOT the eye. */
  vesselPosition(out: Vec3d): Vec3d {
    out.x = this.curr.x; out.y = this.curr.y; out.z = this.curr.z;
    return out;
  }

  teleport(): void { /* a vessel is rolled out, never teleported. */ }

  state(): ObserverState {
    const p = this.curr;
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const ll = this.oracle.latLonFromDir(p.x / r, p.y / r, p.z / r);
    return {
      latDeg: (ll.lat * 180) / Math.PI,
      lonDeg: (ll.lon * 180) / Math.PI,
      altM: this.flight.altitudeAglM,
      yawDeg: (this.yaw * 180) / Math.PI,
      pitchDeg: (this.pitch * 180) / Math.PI,
      mode: 'FLIGHT',
      grounded: this.flight.clamped || this.flight.status === 'DOWN',
      speedMps: this.flight.telemetry.speedMS,
    };
  }

  report(): unknown {
    return {
      yawDeg: (this.yaw * 180) / Math.PI,
      pitchDeg: (this.pitch * 180) / Math.PI,
      distanceM: Math.round(this.distanceM * 100) / 100,
      midOffsetM: Math.round(this.midOffsetM * 100) / 100,
      eyeAltM: Math.round(this.altM * 100) / 100,
      presses: this.controls.report(),
    };
  }

  /** Engine-space eye, for anything that needs it before the rig is set. */
  eyeEngine(originX: number, originY: number, originZ: number): THREE.Vector3 {
    return this.eye.set(this.position.x - originX, this.position.y - originY,
                        this.position.z - originZ);
  }
}
