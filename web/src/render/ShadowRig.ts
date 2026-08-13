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
import { LAYER_PLAYER_BODY, LAYER_PROPS } from './Scenes.js';
import { publishCascade } from './ShadowLod.js';
import { NEAREST_CASTER_M } from './ShadowLodK.js';
// SIDE EFFECT ONLY, and it is load bearing: `ShadowLodReport.ts` registers
// `window.__ofShadowLod`, and nothing else imports it. Split out of
// `ShadowLod.ts` for the 400-line cap, a probe surface that no module pulls in
// is a probe surface that does not exist, and every check would have read
// `undefined` while the feature worked perfectly.
import './ShadowLodReport.js';

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
  /**
   * RN-1420. `PCFSoftShadowMap` rather than `PCFShadowMap`. The rig does not
   * SET it (the filter is a renderer-wide define, `Renderer.ts`) but it is the
   * one place a probe already reads shadow state from, and a pair of frames
   * that differ only in this needs the difference in the report.
   */
  soft: boolean;
  /** Cascade 0's world metres per shadow texel. §2.1.5's own number, derived. */
  texel0M: number;
}

export class ShadowRig {
  readonly lights: THREE.DirectionalLight[] = [];
  readonly splits: number[];
  readonly mapSize: number;
  /** RN-1420. Reported, not applied: `Renderer.ts` owns the define. */
  readonly soft: boolean;
  /** Cascade 0's metres per texel, published rather than recomputed (RN-681). */
  private texel0M = 0;
  private active = true;
  private readonly centre = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, q: QualityKnobs, enabled: boolean) {
    const n = enabled ? q.csmCascades : 0;
    this.splits = (n === 1 ? SPLITS_1 : SPLITS_3).slice(0, Math.max(0, n));
    this.mapSize = q.shadowMapSize;
    this.soft = q.shadowSoft;
    for (let i = 0; i < this.splits.length; ++i) {
      // Cascade 0 IS the near scene's sun (W4). TerrainMaterial lights itself
      // from uSunDir, but the rigged player is a stock MeshStandardMaterial, and
      // a MeshStandardMaterial is only shadowed by a light that CASTS. W3's
      // separate non-casting sun therefore left the character lit but never
      // shadowed by the terrain it stood on. Merging the two costs nothing:
      // cascades 1 and 2 stay at intensity 0 and exist only to produce a map.
      const light = new THREE.DirectionalLight(0xffffff, 0);
      light.castShadow = true;
      light.shadow.mapSize.set(this.mapSize, this.mapSize);
      light.shadow.bias = -0.0006;
      // RN-1420. VSM reads `radius` and `blurSamples`; the PCF path reads
      // neither, so setting them unconditionally is inert on the PCF tier and
      // there is no branch to keep in step.
      light.shadow.radius = 3;
      light.shadow.blurSamples = 8;
      light.shadow.camera.near = 1;
      light.shadow.camera.far = CASTER_BACKOFF_M * 2;
      // THIS BLOCK IS A NO-OP AND IS KEPT ONLY SO THAT THE NEXT READER DOES NOT
      // REDISCOVER IT THE HARD WAY (corrected RN-45, 2026-07-27).
      //
      // It used to claim that `WebGLShadowMap` culls casters against the
      // SHADOW camera's layers, and that enabling these two on cascade 0 alone
      // is what confines the player and the props to the nearest cascade. Both
      // halves are false, and it was checked in three's source rather than
      // reasoned about. `WebGLShadowMap.renderObject` (r185, line 511) filters
      // with `object.layers.test( camera.layers )` where `camera` is the VIEW
      // camera handed to `shadowMap.render( shadowsArray, scene, camera )`, NOT
      // the per-light shadow camera. `light.shadow.camera.layers` is therefore
      // never consulted anywhere in the shadow pass, and layers cannot select a
      // cascade. `Object3D.onBeforeShadow` does fire per object per light, but
      // at lines 535 and 549, i.e. AFTER the `castShadow` test, so it cannot
      // veto a draw either. The only per-cascade signal three supports is
      // `_frustum.intersectsObject`.
      //
      // What actually puts the player and the props in the shadow map is
      // `CameraRig` enabling those layers on the NEAR camera. The 45-to-27
      // draw-call measurement recorded here was real and had another cause.
      // "Understorey in cascade 0 only" would need a fork of three's shadow
      // map, so the understorey was taken out of the shadow pass entirely
      // instead (RN-15, its own `:detail` batches with `castShadow` false).
      //
      // Removing these two lines changes nothing. They are left in place
      // because a future three release could start honouring the shadow
      // camera's layers, at which point this is the behaviour we would want.
      if (i === 0) {
        light.shadow.camera.layers.enable(LAYER_PLAYER_BODY);
        light.shadow.camera.layers.enable(LAYER_PROPS);
      }
      light.name = `shadowCascade${i}`;
      scene.add(light);
      scene.add(light.target);
      this.lights.push(light);
    }
  }

  get cascades(): number { return this.lights.length; }

  /** The one cascade that also LIGHTS stock materials, or null. */
  get sunLight(): THREE.DirectionalLight | null { return this.lights[0] ?? null; }

  /**
   * Fit every cascade around the eye, aligned to the sun. Called once per frame
   * AFTER the camera is placed, so it needs no rebase subscription: the eye is
   * already engine-space and re-derived, and the cascades follow it.
   */
  update(eye: THREE.Vector3, forward: THREE.Vector3, sunDir: THREE.Vector3, on: boolean): void {
    this.active = on && this.lights.length > 0;
    for (let i = 0; i < this.lights.length; ++i) {
      const light = this.lights[i];
      // Cascade 0 stays in the scene when the rig is off, because it is also the
      // sun: dropping it would turn the avatar black at night instead of dark,
      // and black in a lit frame reads as a missing asset.
      light.visible = this.active || i === 0;
      light.castShadow = this.active;
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
      if (i === 0) this.texel0M = Math.round(texel * 1e5) / 1e5;
      // THE SAME NUMBER, PUBLISHED (RN-681). A cascade's world metres per texel
      // is already computed here for the snap, and it is also the entire input
      // to the shadow-LOD rule in `ShadowLod.ts`. Publishing it rather than
      // letting the batches re-derive it is what stops a second copy of
      // `(2 * far * 0.72) / mapSize` drifting away from this one the next time a
      // split or a map size moves. Keyed on the shadow CAMERA because that is
      // the only object three's shadow pass hands a caster.
      // AND ITS NEAR WORKING DISTANCE, which is the other half of the screen
      // footprint (RN-696). Cascade 0 has no split below it, so the nearest a
      // caster can actually be stands in for one.
      publishCascade(light.name, cam, texel, i === 0 ? NEAREST_CASTER_M : this.splits[i - 1]);
      // Bias in WORLD units has to scale with the cascade, or cascade 0 at
      // 11 mm per texel is offset by the same amount as cascade 2 at 200 mm and
      // the contact shadow detaches from the caster.
      light.shadow.normalBias = 3.0 * texel;
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
      soft: this.soft,
      texel0M: this.texel0M,
    };
  }
}
