// Cascaded shadow maps for a walking player (ARCHITECTURE.md section 7.2).
//
// NOT three/addons/csm/CSM.js. CSM patches materials through onBeforeCompile at
// `#include <lights_fragment_begin>`, and TerrainMaterial is a ShaderMaterial
// that does its own lighting from uSunDir, so there is no such include to patch.
// Instead each cascade is a real THREE.DirectionalLight with castShadow, which
// means three owns the depth material, the reversed-depth projection flip, the
// packing, the PCF kernel and the per-cascade frustum culling. Cascades 1 and 2
// carry intensity 0: they exist ONLY to produce a shadow map, and TerrainMaterial
// picks between them by view depth.
//
// One shadow render per frame, not four: only the near scene holds shadow-casting
// lights, so WebGLShadowMap returns early for the sky, far and view-model passes.

import * as THREE from 'three';
import type { QualityKnobs } from './Quality.js';

/** Cascade far planes in metres, for the 3-cascade tiers. */
const SPLITS_3 = [22, 80, 300];
const SPLITS_1 = [90];
/** How far behind the fitted centre the light sits. Must clear the tallest relief. */
const CASTER_BACKOFF_M = 4000;

export interface ShadowStats {
  cascades: number;
  mapSize: number;
  vramMB: number;
  /** Cascade far planes actually in use. */
  splits: number[];
  active: boolean;
}

export class ShadowRig {
  readonly lights: THREE.DirectionalLight[] = [];
  readonly splits: number[];
  readonly mapSize: number;
  private active = true;
  private readonly centre = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, q: QualityKnobs, enabled: boolean) {
    const n = enabled ? q.csmCascades : 0;
    this.splits = (n === 1 ? SPLITS_1 : SPLITS_3).slice(0, Math.max(0, n));
    this.mapSize = q.shadowMapSize;
    for (let i = 0; i < this.splits.length; ++i) {
      // Intensity 0: TerrainMaterial lights itself from uSunDir, and the stock
      // materials in the near scene are lit by the ONE sun light Boot adds. A
      // second lit directional would double-count the sun.
      const light = new THREE.DirectionalLight(0xffffff, 0);
      light.castShadow = true;
      light.shadow.mapSize.set(this.mapSize, this.mapSize);
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.6 + i * 1.8;
      light.shadow.camera.near = 1;
      light.shadow.camera.far = CASTER_BACKOFF_M * 2;
      light.name = `shadowCascade${i}`;
      scene.add(light);
      scene.add(light.target);
      this.lights.push(light);
    }
  }

  get cascades(): number { return this.lights.length; }

  /**
   * Fit every cascade around the eye, aligned to the sun. Called once per frame
   * AFTER the camera is placed, so it needs no rebase subscription: the eye is
   * already engine-space and re-derived, and the cascades follow it.
   */
  update(eye: THREE.Vector3, forward: THREE.Vector3, sunDir: THREE.Vector3, on: boolean): void {
    this.active = on && this.lights.length > 0;
    for (let i = 0; i < this.lights.length; ++i) {
      const light = this.lights[i];
      light.visible = this.active;
      if (!this.active) continue;
      const far = this.splits[i];
      // Centre the cascade a little ahead of the eye: a walking player looks
      // forward, so a box centred on the feet wastes half its texels behind.
      this.fwd.copy(forward).multiplyScalar(far * 0.35);
      this.centre.copy(eye).add(this.fwd);
      const r = far * 0.72;
      const cam = light.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.near = 1;
      cam.far = CASTER_BACKOFF_M * 2;
      // Texel snapping. Without it the ortho box slides continuously with the
      // walk and every shadow edge crawls, which reads as worse than no shadows.
      const texel = (2 * r) / this.mapSize;
      this.centre.set(
        Math.round(this.centre.x / texel) * texel,
        Math.round(this.centre.y / texel) * texel,
        Math.round(this.centre.z / texel) * texel,
      );
      light.target.position.copy(this.centre);
      light.position.copy(this.centre).addScaledVector(sunDir, CASTER_BACKOFF_M);
      light.target.updateMatrixWorld(true);
      light.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
    }
  }

  /** Bytes of shadow-map storage, at 4 B per texel per cascade. */
  vramBytes(): number {
    return this.lights.length * this.mapSize * this.mapSize * 4;
  }

  stats(): ShadowStats {
    return {
      cascades: this.lights.length,
      mapSize: this.mapSize,
      vramMB: Math.round((this.vramBytes() / 1048576) * 10) / 10,
      splits: [...this.splits],
      active: this.active,
    };
  }
}
