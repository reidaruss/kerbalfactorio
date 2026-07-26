// Input tape -> movement intent -> capsule -> camera. The player half of the
// ViewSource contract; the free/orbit camera is the other implementation.
//
// It owns NO physics (KinematicBody) and NO camera maths (ViewMode). What it
// owns is the mapping from an InputFrame to a MoveIntent, and the prev/curr
// pair that lets the 60 Hz capsule be sampled at vsync without judder.

import * as THREE from 'three';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';
import type { InputFrame } from './Input.js';
import { CAPSULE, KinematicBody, type MoveIntent } from './KinematicBody.js';
import { ViewMode, type CameraMode } from './ViewMode.js';
import type { ObserverState, ViewSource } from './ViewSource.js';

export class Controller implements ViewSource {
  readonly body: KinematicBody;
  readonly view: ViewMode;
  readonly position: Vec3d = { x: 0, y: 0, z: 0 };
  readonly orientation = new THREE.Quaternion();
  readonly up = new THREE.Vector3(0, 1, 0);
  altM = CAPSULE.eyeHeightM;

  private readonly prevFeet: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly lerpFeet: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly intent: MoveIntent = { wx: 0, wy: 0, wz: 0, speed: 0, jump: false };
  private toggleHeld = false;

  constructor(
    private readonly oracle: SurfaceOracle,
    startMode: CameraMode,
    /** Base ground speed, m/s. Sprint is twice this. */
    private readonly walkMps = 4.6,
    /** false pins alpha to 1: the un-interpolated W1 behaviour, for measuring. */
    private readonly interpolation = true,
  ) {
    this.body = new KinematicBody(oracle);
    this.view = new ViewMode(oracle);
    this.view.mode = startMode;
  }

  teleport(latDeg: number, lonDeg: number, _altM: number): void {
    this.body.spawn(THREE.MathUtils.degToRad(latDeg), THREE.MathUtils.degToRad(lonDeg));
    this.prevFeet.x = this.body.feet.x;
    this.prevFeet.y = this.body.feet.y;
    this.prevFeet.z = this.body.feet.z;
    this.view.update(this.body.feet, CAPSULE.eyeHeightM, 1 / 60);
    this.interpolate(1);
  }

  setMode(mode: CameraMode): void {
    if (this.view.mode !== mode) this.view.toggle();
  }

  step(inp: InputFrame, dt: number): void {
    if (inp.dYaw !== 0 || inp.dPitch !== 0) this.view.look(inp.dYaw, inp.dPitch);
    if (inp.toggleView && !this.toggleHeld) this.view.toggle();
    this.toggleHeld = inp.toggleView;

    // The heading is yaw about the local up, in the (east, north) plane. The
    // tangent frame comes from ViewMode, so there is exactly one basis.
    const s = Math.sin(this.view.yaw), c = Math.cos(this.view.yaw);
    const fx = this.view.north.x * c + this.view.east.x * s;
    const fy = this.view.north.y * c + this.view.east.y * s;
    const fz = this.view.north.z * c + this.view.east.z * s;
    const rx = this.view.east.x * c - this.view.north.x * s;
    const ry = this.view.east.y * c - this.view.north.y * s;
    const rz = this.view.east.z * c - this.view.north.z * s;
    let wx = fx * inp.fwd + rx * inp.right;
    let wy = fy * inp.fwd + ry * inp.right;
    let wz = fz * inp.fwd + rz * inp.right;
    const wl = Math.hypot(wx, wy, wz);
    const it = this.intent;
    if (wl > 1e-6) {
      wx /= wl; wy /= wl; wz /= wl;
      it.speed = inp.boost ? this.walkMps * 2 : this.walkMps;
    } else {
      it.speed = 0;
    }
    it.wx = wx; it.wy = wy; it.wz = wz;
    it.jump = inp.jump;

    this.prevFeet.x = this.body.feet.x;
    this.prevFeet.y = this.body.feet.y;
    this.prevFeet.z = this.body.feet.z;
    this.body.step(dt, it);
    this.view.update(this.body.feet, CAPSULE.eyeHeightM, dt);
  }

  /**
   * THE anti-judder step. The capsule advances at a fixed 60 Hz; sampling that
   * at a variable vsync without interpolation aliases the walk into a visible
   * shimmer that is orders of magnitude larger than any float32 effect. Measured
   * before and after in JitterProbe.
   */
  interpolate(alpha: number): void {
    const a = !this.interpolation ? 1 : alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
    const p = this.prevFeet, q = this.body.feet, l = this.lerpFeet;
    l.x = p.x + (q.x - p.x) * a;
    l.y = p.y + (q.y - p.y) * a;
    l.z = p.z + (q.z - p.z) * a;
    this.view.update(l, CAPSULE.eyeHeightM, 0);
    this.position.x = this.view.camera.x;
    this.position.y = this.view.camera.y;
    this.position.z = this.view.camera.z;
    this.orientation.copy(this.view.orientation);
    this.up.copy(this.view.up);
    const r = Math.hypot(this.position.x, this.position.y, this.position.z) || 1;
    this.altM = r - this.oracle.surfaceRadius(
      this.position.x / r, this.position.y / r, this.position.z / r,
    );
  }

  /** Aim ray. Origin is the EYE in both modes, so a toggle cannot change it. */
  aimRay(): { origin: Vec3d; dir: { x: number; y: number; z: number } } {
    return {
      origin: { x: this.view.eye.x, y: this.view.eye.y, z: this.view.eye.z },
      dir: { x: this.view.aim.x, y: this.view.aim.y, z: this.view.aim.z },
    };
  }

  state(): ObserverState {
    const p = this.body.feet;
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const ll = this.oracle.latLonFromDir(p.x / r, p.y / r, p.z / r);
    return {
      latDeg: THREE.MathUtils.radToDeg(ll.lat),
      lonDeg: THREE.MathUtils.radToDeg(ll.lon),
      altM: this.altM,
      yawDeg: THREE.MathUtils.radToDeg(this.view.yaw),
      pitchDeg: THREE.MathUtils.radToDeg(this.view.pitch),
      mode: this.view.mode,
      grounded: this.body.grounded,
      speedMps: this.body.speedMps,
    };
  }
}
