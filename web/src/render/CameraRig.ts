// The SOLE owner of every camera in the application (ARCHITECTURE.md 2.2 rule 2).
// Four cameras, one orientation. Each sees at most about six decades of range,
// which is what makes the surface-to-orbit seam tractable without log depth.

import * as THREE from 'three';
import type { DepthPolicy } from './DepthPolicy.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { FAR_SCALE, LAYER_PLAYER_BODY, LAYER_PROPS } from './Scenes.js';
// RN-696: the shadow-LOD budget is a SCREEN error, so it needs the FOV the
// client is actually running. Published here because this is the one place that
// knows, and RN-641 already moved this number once.
import { publishFov } from './ShadowLodK.js';

export class CameraRig {
  /** Pass 1. Rotation only: never translated, so the sky is at infinity. */
  readonly skyCam: THREE.PerspectiveCamera;
  /** Pass 2. Scaled space, FAR_SCALE units per metre. */
  readonly farCam: THREE.PerspectiveCamera;
  /** Pass 3. Metres, near the engine origin. */
  readonly nearCam: THREE.PerspectiveCamera;
  /** Pass 4. FP view model. */
  readonly vmCam: THREE.PerspectiveCamera;
  /**
   * The assembly bay. It is here rather than owned by the VAB because rule 2 of
   * ARCHITECTURE 2.2 is that this class owns every camera in the application,
   * and a second owner is how two views end up disagreeing about aspect ratio.
   * It is NOT driven by setView: the VAB orbits it around a rocket instead.
   */
  readonly vabCam: THREE.PerspectiveCamera;
  /**
   * The 3D map (GP-208). Here for the same reason vabCam is: rule 2 says this
   * class owns every camera in the application. Like vabCam it is NOT driven by
   * setView and NOT in cameras(): Map3D orbits it around the map's focus. Units
   * are FAR_SCALE metres, so the whole planet sits inside a few hundred units.
   */
  readonly mapCam: THREE.PerspectiveCamera;

  private fovDeg = 60;

  constructor(depth: DepthPolicy) {
    this.skyCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.1, 10);
    this.farCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.01, 1e5);
    this.nearCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.1, depth.nearFarPlaneM());
    this.vmCam = new THREE.PerspectiveCamera(this.fovDeg, 1, 0.01, 5);
    this.vabCam = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    this.mapCam = new THREE.PerspectiveCamera(50, 1, 0.002, 5000);
    this.mapCam.name = 'mapCam';
    this.vabCam.name = 'vabCam';
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
    publishFov(deg);
    for (const c of this.cameras()) { c.fov = deg; c.updateProjectionMatrix(); }
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    for (const c of this.cameras()) { c.aspect = aspect; c.updateProjectionMatrix(); }
    // vabCam and mapCam are resized but are deliberately NOT in cameras():
    // each keeps its own framing and is never touched by setFov or setView.
    this.vabCam.aspect = aspect;
    this.vabCam.updateProjectionMatrix();
    this.mapCam.aspect = aspect;
    this.mapCam.updateProjectionMatrix();
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
