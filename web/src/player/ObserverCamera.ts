// The free/orbit camera. It is deliberately ALSO the streaming observer, so
// there is one position driving both what is drawn and what is resident, and
// they cannot drift apart. At W2 it is one of TWO ViewSource implementations
// (the other is player/Controller, the walking capsule); Loop.ts consumes the
// interface and never branches on which is active.

import * as THREE from 'three';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';
import type { InputFrame } from './Input.js';
import type { ObserverState, ViewSource } from './ViewSource.js';

const POLAR = new THREE.Vector3(0, 1, 0);

export class ObserverCamera implements ViewSource {
  /** Geodetic, radians. */
  lat = 0;
  lon = 0;
  altM = 1000;
  yaw = 0;
  pitch = -0.3;

  /** Body-frame f64 position of the eye. */
  readonly position: Vec3d = { x: 0, y: 0, z: 0 };
  readonly orientation = new THREE.Quaternion();
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly forward = new THREE.Vector3(0, 0, -1);

  private readonly east = new THREE.Vector3();
  private readonly north = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpV = new THREE.Vector3();
  private readonly zero = new THREE.Vector3();

  constructor(private readonly oracle: SurfaceOracle) {}

  teleport(latDeg: number, lonDeg: number, altM: number, reframe = true): void {
    this.lat = THREE.MathUtils.degToRad(latDeg);
    this.lon = THREE.MathUtils.degToRad(lonDeg);
    this.altM = altM;
    if (reframe) this.reframe();
    this.update();
  }

  /**
   * Point the camera at the body. The horizon's depression angle is
   * acos(R / (R + alt)), so this tilt lands on the limb at every altitude: about
   * 3 degrees down on the surface and about 73 degrees down from 2400 km.
   * Without it a space start looks at empty sky, which is exactly what a naive
   * "pitch = -0.3" default did.
   */
  reframe(): void {
    const R = this.oracle.body.radiusM;
    const horizonDepression = Math.acos(Math.min(1, R / (R + Math.max(0, this.altM))));
    this.pitch = THREE.MathUtils.clamp(-(horizonDepression * 0.9 + 0.05), -1.5, 0);
  }

  state(): ObserverState {
    return {
      latDeg: THREE.MathUtils.radToDeg(this.lat),
      lonDeg: THREE.MathUtils.radToDeg(this.lon),
      altM: this.altM,
      yawDeg: THREE.MathUtils.radToDeg(this.yaw),
      pitchDeg: THREE.MathUtils.radToDeg(this.pitch),
      mode: 'FLY',
      grounded: false,
      speedMps: 0,
    };
  }

  /** The ViewSource fixed-tick step: look, zoom, then move, then re-derive. */
  step(inp: InputFrame, dt: number): void {
    if (inp.dYaw !== 0 || inp.dPitch !== 0) this.look(inp.dYaw, inp.dPitch);
    if (inp.zoom !== 0) this.zoom(Math.pow(1.22, inp.zoom));
    this.update();
    if (inp.fwd !== 0 || inp.right !== 0 || inp.up !== 0) {
      const v = this.moveSpeed(inp.boost) * dt;
      this.move(inp.fwd * v, inp.right * v, inp.up * v);
      this.update();
    }
  }

  /**
   * No-op by design. The free camera's speed spans 12 m/s to 400 km/s, so a
   * lerp between two ticks is meaningless at the top of that range and
   * invisible at the bottom. The character interpolates; this does not.
   */
  interpolate(_alpha: number): void {}

  /** Metres per second of tangential travel, scaled so orbit is not a crawl. */
  moveSpeed(boost: boolean): number {
    const s = THREE.MathUtils.clamp(this.altM * 0.6 + 12, 12, 4.0e5);
    return boost ? s * 6 : s;
  }

  look(dYaw: number, dPitch: number): void {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -1.55, 1.55);
  }

  /** Multiplicative altitude change; keeps the same feel at 60 m and at 2400 km. */
  zoom(factor: number): void {
    this.altM = THREE.MathUtils.clamp(this.altM * factor, 3, 6.0e6);
  }

  /**
   * Move over the surface. `fwd`/`right` are metres in the local tangent frame,
   * applied by rotating the direction vector, so the pole is not a special case.
   */
  move(fwd: number, right: number, up: number): void {
    this.rebuildBasis();
    const p = this.position;
    const r = Math.hypot(p.x, p.y, p.z);
    if (r < 1e-6) return;
    // The heading is yaw about the local up, in the (east, north) plane.
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    const t = this.tmpV.set(0, 0, 0)
      .addScaledVector(this.north, fwd * hz + right * hx)
      .addScaledVector(this.east, fwd * hx - right * hz);
    const nx = p.x / r + t.x / r, ny = p.y / r + t.y / r, nz = p.z / r + t.z / r;
    const n = Math.hypot(nx, ny, nz);
    const ll = this.oracle.latLonFromDir(nx / n, ny / n, nz / n);
    this.lat = ll.lat;
    this.lon = ll.lon;
    if (up !== 0) this.altM = THREE.MathUtils.clamp(this.altM + up, 3, 6.0e6);
  }

  private rebuildBasis(): void {
    const p = this.position;
    this.up.set(p.x, p.y, p.z);
    if (this.up.lengthSq() < 1e-9) this.up.set(0, 1, 0);
    this.up.normalize();
    this.east.crossVectors(POLAR, this.up);
    if (this.east.lengthSq() < 1e-9) this.east.set(1, 0, 0);
    this.east.normalize();
    this.north.crossVectors(this.up, this.east).normalize();
  }

  /** Recompute the f64 eye position and the orientation shared by all 4 cameras. */
  update(): void {
    this.oracle.observerPos(this.lat, this.lon, this.altM, this.position);
    this.rebuildBasis();
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.forward.set(0, 0, 0)
      .addScaledVector(this.east, Math.sin(this.yaw) * cp)
      .addScaledVector(this.north, Math.cos(this.yaw) * cp)
      .addScaledVector(this.up, sp)
      .normalize();
    this.tmpM.lookAt(this.zero, this.forward, this.up);
    this.orientation.setFromRotationMatrix(this.tmpM);
  }
}
