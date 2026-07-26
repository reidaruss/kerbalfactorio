// The SOLE owner of every camera in the application (ARCHITECTURE.md 2.2 rule 2).
// Four cameras, one orientation. Each sees at most about six decades of range,
// which is what makes the surface-to-orbit seam tractable without log depth.

import * as THREE from 'three';
import type { DepthPolicy } from './DepthPolicy.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { FAR_SCALE, LAYER_PLAYER_BODY, LAYER_PROPS } from './Scenes.js';

export class CameraRig {
  /** Pass 1. Rotation only: never translated, so the sky is at infinity. */
  readonly skyCam: THREE.PerspectiveCamera;
  /** Pass 2. Scaled space, FAR_SCALE units per metre. */
  readonly farCam: THREE.PerspectiveCamera;
  /** Pass 3. Metres, near the engine origin. */
  readonly nearCam: THREE.PerspectiveCamera;
  /** Pass 4. FP view model. */
  readonly vmCam: THREE.PerspectiveCamera;

  private fovDeg = 60;

  constructor(depth: DepthPolicy) {
    this.skyCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.1, 10);
    this.farCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.01, 1e5);
    this.nearCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.1, depth.nearFarPlaneM());
    this.vmCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.01, 5);
    this.skyCam.name = 'skyCam';
    this.farCam.name = 'farCam';
    this.nearCam.name = 'nearCam';
    this.vmCam.name = 'vmCam';
    // The character mesh renders in TP only; the shadow caster keeps it enabled
    // (section 3.4), which is the M3.1b "FP black slab self-shadow" bug fixed by
    // construction instead of by a workaround.
    this.nearCam.layers.enable(LAYER_PLAYER_BODY);
    this.nearCam.layers.enable(LAYER_PROPS);
  }

  /** FP disables the layer on the CAMERA, never on the object. */
  setOwnBodyVisible(visible: boolean): void {
    if (visible) this.nearCam.layers.enable(LAYER_PLAYER_BODY);
    else this.nearCam.layers.disable(LAYER_PLAYER_BODY);
  }

  cameras(): THREE.PerspectiveCamera[] {
    return [this.skyCam, this.farCam, this.nearCam, this.vmCam];
  }

  setFov(deg: number): void {
    this.fovDeg = deg;
    for (const c of this.cameras()) { c.fov = deg; c.updateProjectionMatrix(); }
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    for (const c of this.cameras()) { c.aspect = aspect; c.updateProjectionMatrix(); }
  }

  /**
   * One orientation, three positions.
   * @param engineEye camera position in near-scene metres (relative to the engine origin)
   * @param universeEye the same point in body-frame f64 metres, for the scaled pass
   */
  setView(engineEye: THREE.Vector3, universeEye: Vec3d, orientation: THREE.Quaternion): void {
    this.nearCam.position.copy(engineEye);
    this.farCam.position.set(
      universeEye.x * FAR_SCALE, universeEye.y * FAR_SCALE, universeEye.z * FAR_SCALE,
    );
    this.skyCam.position.set(0, 0, 0);
    this.vmCam.position.set(0, 0, 0);
    for (const c of this.cameras()) {
      c.quaternion.copy(orientation);
      c.updateMatrixWorld(true);
    }
  }

  /** Pixels of screen height a sphere of `radiusM` subtends at `distanceM`. */
  screenSizePx(radiusM: number, distanceM: number, viewportHeightPx: number): number {
    const halfFov = (this.fovDeg * Math.PI) / 360;
    return (radiusM / Math.max(1e-6, distanceM)) * (viewportHeightPx / (2 * Math.tan(halfFov)));
  }
}
