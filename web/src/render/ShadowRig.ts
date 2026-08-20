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

// ===========================================================================
// RN-1571. THE DEPTH BIAS, AND THE SIGN ERROR THAT PUT EVERY MACHINE IN ITS
// OWN SHADOW FOR THE WHOLE OF THE ART CAMPAIGN.
//
// `light.shadow.bias` is an offset in DEPTH-BUFFER UNITS, added to the
// receiver's projected z before the shadow comparison. Two things about this
// rig make the shipped `-0.0006` wrong, and they are independent:
//
// (1) THE SIGN IS INVERTED UNDER REVERSED DEPTH ON THE PCF PATH, AND THAT IS A
//     GAP IN THREE ITSELF, not in this file. In `shadowmap_pars_fragment.glsl`
//     (r185) the VSM branch (line 161) and the BASIC branch (line 228) both
//     read
//
//         #ifdef USE_REVERSED_DEPTH_BUFFER
//           shadowCoord.z -= shadowBias;
//         #else
//           shadowCoord.z += shadowBias;
//         #endif
//
//     while the `SHADOWMAP_TYPE_PCF` branch (line 122) has NO such guard and
//     adds unconditionally. `Renderer.ts` selects `PCFShadowMap` on every tier
//     that is not `shadowSoft`, and this project runs reversed depth wherever
//     the capability exists, so the shipped configuration is precisely the one
//     branch three does not correct. Under reversed depth a LARGER z is NEARER
//     the light, so a negative bias pushes the receiver AWAY from the light,
//     i.e. deeper into shadow. The conventional acne-reducing sign becomes an
//     acne-CREATING one.
//
// (2) THE MAGNITUDE WAS NEVER SCALED BY THIS RIG'S DEPTH RANGE. `-0.0006` is
//     the number every three.js example carries, and those examples use a
//     shadow camera a few tens of metres deep. This one is `near = 1` to
//     `far = 2 * CASTER_BACKOFF_M`, i.e. 7999 m, because the light has to stand
//     back far enough to clear the tallest relief on a planet. 0.0006 of 7999 m
//     is 4.8 WORLD METRES. A smelter is about 4 m tall, so the error was larger
//     than the entire object: every vertical face tested as though it sat 4.8 m
//     behind where it is, which is behind its own back wall's entry in the
//     shadow map.
//
// MEASURED, RN-1570, matched arms one variable apart on the `smelterhero` pose
// at sun elevation dot 0.443, machine casting throughout, camera untouched:
// bias -0.0006 (shipped) box luma 19.36 / firebox 4.08; bias -0.0001 box 22.02;
// bias 0 box 39.56 / firebox 23.07; bias +0.0001 box 40.62; bias +0.0006 box
// 40.30. The curve is flat either side of zero and steps across it, which is
// the signature of a SIGN defect rather than a magnitude one. The independent
// arm agrees: clearing `castShadow` on the machine alone (it still receives,
// the terrain still casts) takes the same box 19.52 -> 45.05, so the umbra was
// the machine's own. `?shadowlod=0` reads 19.52, bit-identical, which refutes
// the shadow-proxy explanation.
//
// THE FIX EXPRESSES THE BIAS IN METRES AND DERIVES BOTH THE SIGN AND THE SCALE.
// A world-space constant survives a change to the splits, to `CASTER_BACKOFF_M`
// or to the quality tier, none of which the raw depth-unit number did.
/**
 * Depth bias in WORLD METRES, converted per cascade against that cascade's own
 * depth range. Deliberately far smaller than one texel of normal bias: three's
 * `normalBias` already offsets along the surface normal in world units and is
 * sign-safe under either depth convention, so this term only has to cover the
 * residual on faces nearly parallel to the light.
 */
const SHADOW_BIAS_M = 0.02;

/**
 * STANDING RULE 7'S NEGATIVE CONTROL: `?shadowbias=0` restores the behaviour
 * immediately before RN-1571, i.e. the raw `-0.0006` depth-unit literal with no
 * sign derivation and no range scaling. It is what makes the fix a one-flag
 * pair on ONE binary instead of two builds that differ by everything.
 *
 * The boot default is a FIXTURE, not an inference (rendering.md section 2.6):
 * a missing parameter is parsed as missing and the raw string is published
 * beside the resolved value, because `Number(null)` is 0 and this project has
 * shipped features switched off because every probe passed an explicit flag.
 */
const SHADOW_BIAS_RAW = new URLSearchParams(self.location.search).get('shadowbias');
export const SHADOW_BIAS_LEGACY = SHADOW_BIAS_RAW === '0';
/** Exactly the constant this rig carried from its first commit to RN-1571. */
const LEGACY_BIAS_UNITS = -0.0006;

/**
 * RN-1954. `?shadowcast=0` -- THE CONTROL `?shadows=0` IS NOT.
 *
 * `?shadows=0` reaches this rig as `on=false`, and `update` below then does two
 * separate things at once: it clears `castShadow` AND it sets
 * `light.visible = i === 0`. `cfg.shadows` false also clears
 * `renderer.shadowMap.enabled` in `Renderer.ts`. So a pair taken across that
 * flag differs by the shadow maps AND by which cascades are in the scene at
 * all, and a level change it shows is unattributable between the two.
 *
 * It is NOT "two thirds of the sun rig", and an earlier draft of this comment
 * said so wrongly: cascades 1 and 2 are constructed at INTENSITY 0 a few lines
 * below and exist only to produce a map, and only `lights[0]` is ever pushed
 * into `sunLights` (`Boot.ts`). Removing them removes no light.
 *
 * This flag clears `castShadow` ONLY. Every cascade stays in the scene, still
 * fitted, still texel-snapped, still published, and the sole difference is that
 * no shadow map is rendered or sampled. `castOff` in the stats says which arm
 * produced a reading, so a frame taken under it cannot be mistaken for the
 * shipped one (RN-150: the flag's presence is published, not inferred).
 *
 * WHAT IT CANNOT DO, recorded so the next reader does not repeat the mistake it
 * was born from: `Systems.ts` gates this rig with `band !== 'ORBIT'`, so on any
 * shot at orbital altitude -- the `station` canonical shot among them -- `active`
 * is already false and `castShadow` already off, and THIS FLAG CANNOT CHANGE A
 * PIXEL THERE. It was introduced while chasing that shot's residual and read
 * three different "spreads" over identical pixels, which measures the noise
 * floor of that ratio and nothing else. It ships because it is a correct control
 * for shots where the rig is actually on.
 *
 * Absent is the shipped identity. Standing rule 7.
 */
const SHADOW_CAST_RAW = new URLSearchParams(self.location.search).get('shadowcast');
export const SHADOW_CAST_OFF = SHADOW_CAST_RAW === '0';

/**
 * Does THIS renderer configuration need the bias sign flipped? True only for
 * reversed depth on the PCF path, which is the one combination three r185 does
 * not correct for itself. Passed in rather than read from a global so the rule
 * is testable and so a tier that switches to VSM stops flipping automatically.
 */
export function shadowBiasSign(reversedDepth: boolean, soft: boolean): number {
  return reversedDepth && !soft ? +1 : -1;
}

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
  /** RN-1571. The depth bias, in the three forms a reader needs: the world
   *  metres it was authored as, the sign the depth convention forced, and the
   *  depth-buffer units that actually reach `light.shadow.bias`. */
  biasM: number;
  biasSign: number;
  biasUnits: number;
  reversedDepth: boolean;
  /** RN-1571's negative control: `?shadowbias=0` and the raw string behind it. */
  biasLegacy: boolean;
  /** RN-1954. `?shadowcast=0`: casting cleared, every cascade light kept. */
  castOff: boolean;
  castRaw: string | null;
  biasRaw: string | null;
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
  /** RN-1571. +1 where three's own shader does not flip for reversed depth. */
  private readonly biasSign: number;
  private readonly reversedDepth: boolean;
  /** The depth-unit bias every cascade carries, published for the report. */
  private biasUnits = 0;

  constructor(scene: THREE.Scene, q: QualityKnobs, enabled: boolean,
              reversedDepth = false) {
    this.biasSign = shadowBiasSign(reversedDepth, q.shadowSoft);
    this.reversedDepth = reversedDepth;
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
      // RN-1571. Derived, not a literal. See the block above `SHADOW_BIAS_M`:
      // the sign follows the depth convention and the scale follows this rig's
      // own 7999 m ortho range, because the shipped `-0.0006` was 4.8 world
      // metres pointing the wrong way and it shadowed every machine in the game.
      this.biasUnits = SHADOW_BIAS_LEGACY ? LEGACY_BIAS_UNITS
        : (this.biasSign * SHADOW_BIAS_M) / (CASTER_BACKOFF_M * 2 - 1);
      light.shadow.bias = this.biasUnits;
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
      // RN-1954. The ONLY line `?shadowcast=0` touches. The cascade is still
      // fitted, still snapped and still published below, so `texel0M`, the LOD
      // rule that reads it and every cascade uniform are the shipped ones; the
      // light simply stops writing and sampling a depth map.
      light.castShadow = this.active && !SHADOW_CAST_OFF;
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
      // ...AND ITS FAR WORKING DISTANCE (RN-2203), which is the split this
      // cascade ends at. It is the only thing that can answer "can this cascade
      // reach a caster at 420 m", and the far-shadow skip refuses to act
      // without it rather than assuming a split table.
      publishCascade(light.name, cam, texel,
        i === 0 ? NEAREST_CASTER_M : this.splits[i - 1], this.splits[i]);
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
      // RN-1571. Published because a frame taken either side of the sign fix
      // is otherwise indistinguishable in the report from a frame taken at a
      // different hour, and the whole of RN-1492's null was a shadow term
      // nobody could read out of a capture.
      biasM: SHADOW_BIAS_M, biasSign: this.biasSign,
      biasUnits: this.biasUnits, reversedDepth: this.reversedDepth,
      biasLegacy: SHADOW_BIAS_LEGACY, biasRaw: SHADOW_BIAS_RAW,
      // RN-1954, and it is the flag's PRESENCE rather than a re-read of the
      // behaviour: `castShadow` is per light and a reader cannot tell "the arm
      // was requested" from "the rig happened to be inactive" without it.
      castOff: SHADOW_CAST_OFF, castRaw: SHADOW_CAST_RAW,
    };
  }
}
