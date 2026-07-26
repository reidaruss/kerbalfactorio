// THE underground lighting authority: one measurement, one lamp, one ambient.
//
// A dug tunnel used to be lit by the near scene's HemisphereLight alone, so
// every voxel face received the same constant and the passage read as a flat
// grey box. Nothing about being ten metres inside a hill was visible.
//
// The measurement is how much SKY the eye can still see, sampled straight up
// through the same `surface_field.h` solidity the mesher and the walker read
// (standing rule 1: nothing here re-derives what is solid). That single number
// drives three consumers, so they cannot disagree about how dark it is:
//
//   * the headlamp cone, which comes on as the sky closes over,
//   * the sky ambient (hemisphere + scene environment), which falls away,
//   * `sunScale`, which Systems multiplies into every stock sun light, and
//     which also lets the whole cascade pass be skipped under rock.
//
// It deliberately does NOT touch TerrainMaterial. The heightfield outside the
// mouth must stay daylit: the contrast between the lamp cone and the bright
// hole you came in through is the entire point, and dimming both would just
// make the world uniformly darker.
//
// Cost: ONE SpotLight, no shadow map, no new custom shader (DW-10's cap of 5 is
// untouched), and four `solidAt` calls per frame at roughly 2 us each.

import * as THREE from 'three';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * Radial heights above the EYE that are tested for rock, in metres. Four is
 * enough to separate the three states that matter and cheap enough to run every
 * frame: open sky (0 hits), a mouth or a shallow shelf (1 to 2), and properly
 * buried (4). The deepest sample is 9 m because a 1 m voxel roof with hillside
 * above it must read as buried, not as a shelf.
 */
const SKY_PROBE_M = [0.9, 2.2, 4.5, 9.0];
/**
 * Seconds for the driven value to reach a new measurement. This is eye
 * adaptation, and it is the reason stepping into a mouth reads as a transition
 * rather than as a light switch. It also swallows the one-frame flicker a
 * sample point crossing a cell boundary would otherwise produce.
 */
const ADAPT_SECS = 0.5;

/** Daylight ambient: what W3/W4 shipped, and what full sky visibility restores. */
const SKY_HEMI = { sky: 0x334466, ground: 0x101008, intensity: 0.35 };
const VM_HEMI = { sky: 0x8fb0d8, ground: 0x35301f, intensity: 1.1 };
/**
 * Buried ambient. NOT zero: a tunnel with no ambient at all is unreadable
 * outside the cone and stops being atmospheric the moment the player cannot
 * tell floor from wall. Cold, so the lamp is the only warm light down there.
 */
const CAVE_HEMI = { sky: 0x131a26, ground: 0x0a0806, intensity: 0.055 };
/** Warm fill for the FP arms, so the hands holding the lamp are not silhouettes. */
const CAVE_VM = { sky: 0xffdcae, ground: 0x2a1d10, intensity: 0.5 };
/** Scene environment (the sky IBL) multiplier when fully buried. */
const CAVE_ENV = 0.07;

/**
 * Lamp candela. three is on physically correct units, so this is
 * intensity / distance^decay: 46 at decay 1.45 puts roughly 1.0 of irradiance
 * on a wall 6 m away and 0.28 at 15 m, which reads as a real hand torch rather
 * than as a second sun.
 */
const LAMP_CD = 46;
const LAMP_DECAY = 1.45;
const LAMP_RANGE_M = 34;
/** Half-angle. 0.44 rad is a 25 degree cone: a 5.5 m pool of light at 12 m. */
const LAMP_ANGLE = 0.44;
/**
 * Mounted off-axis, like a helmet lamp and like the rig's own `socket_lamp`
 * would be. A light exactly at the eye casts no visible gradient on anything it
 * illuminates, so the tunnel walls flatten out again; 14 cm to the right and
 * 6 cm down is enough shading to read the cut faces.
 */
const LAMP_OFFSET = { right: 0.14, up: -0.06, fwd: 0.1 };

export interface HeadlampStats {
  /** Player toggle. False means the lamp stays off however dark it gets. */
  enabled: boolean;
  /** Smoothed sky visibility at the eye, 1 open and 0 buried. */
  skyVis: number;
  /** The unsmoothed measurement, so a probe can see the raw state. */
  rawVis: number;
  /** Lamp intensity actually applied, in candela. 0 is off. */
  lampCd: number;
  /** What Systems multiplies into every stock sun light. */
  sunScale: number;
  /** Near-scene hemisphere intensity, for the ambient claim. */
  ambient: number;
  oracleCalls: number;
}

export class Headlamp {
  readonly spot: THREE.SpotLight;
  private readonly nearHemi: THREE.HemisphereLight;
  private readonly vmHemi: THREE.HemisphereLight;
  private readonly pos = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly eyeM: Vec3d = { x: 0, y: 0, z: 0 };

  /** Player toggle (KeyL). Auto behaviour lives in the sky-visibility curve. */
  enabled = true;
  /** Smoothed 0..1. 1 is open sky, 0 is fully enclosed. */
  skyVis = 1;
  private rawVis = 1;
  oracleCalls = 0;

  /**
   * Owns the ambient lights it competes with, rather than reaching into ones
   * Boot created: "how dark is it here" and "what lights you here" are one
   * question, and splitting them across two files is how they drift apart.
   */
  constructor(
    private readonly near: THREE.Scene,
    private readonly viewModel: THREE.Scene,
  ) {
    this.nearHemi = new THREE.HemisphereLight(
      SKY_HEMI.sky, SKY_HEMI.ground, SKY_HEMI.intensity);
    this.nearHemi.name = 'nearAmbient';
    near.add(this.nearHemi);

    // The view-model pass has no lights of its own beyond this one and a sun.
    this.vmHemi = new THREE.HemisphereLight(VM_HEMI.sky, VM_HEMI.ground, VM_HEMI.intensity);
    this.vmHemi.name = 'viewModelAmbient';
    viewModel.add(this.vmHemi);

    this.spot = new THREE.SpotLight(0xffe4b5, 0, LAMP_RANGE_M, LAMP_ANGLE, 0.6, LAMP_DECAY);
    this.spot.name = 'headlamp';
    // No shadow map. A second shadowed light would double the 48 MB the cascades
    // already cost and buy nothing in a corridor two metres wide.
    this.spot.castShadow = false;
    near.add(this.spot);
    near.add(this.spot.target);
  }

  /** One press of KeyL. Returns the new state so the caller can report it. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /**
   * Sample rock above the eye. Body-frame metres in, nothing rendered: this is
   * separated from `update` so it can run on the fixed tick if it ever needs to
   * be, and so the measurement is testable without a scene.
   */
  measure(oracle: SurfaceOracle, eye: Vec3d): number {
    const r = Math.hypot(eye.x, eye.y, eye.z);
    if (r < 1e-6) return this.rawVis;
    const ux = eye.x / r, uy = eye.y / r, uz = eye.z / r;
    let blocked = 0;
    for (const h of SKY_PROBE_M) {
      this.oracleCalls++;
      if (oracle.solidAt(eye.x + ux * h, eye.y + uy * h, eye.z + uz * h)) blocked++;
    }
    this.rawVis = 1 - blocked / SKY_PROBE_M.length;
    return this.rawVis;
  }

  /**
   * Drive the lamp and the ambient. `eye`/`aim`/`up` are body-frame; the lamp is
   * placed through the ONE rebase authority like every other world-anchored
   * object (ARCHITECTURE.md 3.6), never by applying a delta by hand.
   */
  update(dt: number, origin: FloatingOrigin, eye: Vec3d | null,
    aim: THREE.Vector3, up: THREE.Vector3): void {
    if (eye === null) {
      // No character: a free camera has no head to bolt a lamp to, and the
      // measurement must not leave the world dark for the orbit scenarios.
      this.rawVis = 1;
      this.skyVis = 1;
      this.spot.intensity = 0;
      this.applyAmbient(1, 0);
      return;
    }
    // Exponential approach, frame-rate independent. dt is sim time, so a driven
    // run adapts at exactly the rate a real one does.
    const a = ADAPT_SECS > 0 ? 1 - Math.exp(-dt / ADAPT_SECS) : 1;
    this.skyVis += (this.rawVis - this.skyVis) * a;

    // The lamp comes on as the sky closes, not on a hard threshold: at 3/4 sky
    // it is off, by 1/2 it is at full. Under open sky it contributes nothing, so
    // leaving it enabled in daylight costs one light's worth of shader work and
    // changes no pixel.
    const dark = 1 - this.skyVis;
    const lampK = this.enabled ? THREE.MathUtils.smoothstep(dark, 0.25, 0.62) : 0;
    this.spot.intensity = LAMP_CD * lampK;
    this.spot.visible = lampK > 0.001;

    if (this.spot.visible) {
      this.right.crossVectors(aim, up);
      if (this.right.lengthSq() < 1e-9) this.right.set(1, 0, 0);
      this.right.normalize();
      this.eyeM.x = eye.x + this.right.x * LAMP_OFFSET.right + up.x * LAMP_OFFSET.up + aim.x * LAMP_OFFSET.fwd;
      this.eyeM.y = eye.y + this.right.y * LAMP_OFFSET.right + up.y * LAMP_OFFSET.up + aim.y * LAMP_OFFSET.fwd;
      this.eyeM.z = eye.z + this.right.z * LAMP_OFFSET.right + up.z * LAMP_OFFSET.up + aim.z * LAMP_OFFSET.fwd;
      origin.toEngine(this.eyeM, this.pos);
      this.spot.position.copy(this.pos);
      // The target is a scene object, so it needs its own world matrix updated:
      // three reads target.matrixWorld, not target.position.
      this.spot.target.position.copy(this.tmp.copy(this.pos).addScaledVector(aim, 12));
      this.spot.target.updateMatrixWorld();
    }
    this.applyAmbient(this.skyVis, lampK);
  }

  /** Sky ambient fades out; a warm lamp fill fades in on the FP arms only. */
  private applyAmbient(vis: number, lampK: number): void {
    const h = this.nearHemi;
    h.intensity = THREE.MathUtils.lerp(CAVE_HEMI.intensity, SKY_HEMI.intensity, vis);
    h.color.set(CAVE_HEMI.sky).lerp(TMP_SKY.set(SKY_HEMI.sky), vis);
    h.groundColor.set(CAVE_HEMI.ground).lerp(TMP_GROUND.set(SKY_HEMI.ground), vis);

    // The arms are ALWAYS inside the cone, so underground they are lit by the
    // lamp by definition. Modelling that as a fill costs nothing and avoids a
    // second SpotLight in the view-model pass.
    const vm = this.vmHemi;
    const caveVm = CAVE_VM.intensity * lampK + 0.03;
    vm.intensity = THREE.MathUtils.lerp(caveVm, VM_HEMI.intensity, vis);
    vm.color.set(CAVE_VM.sky).lerp(TMP_SKY.set(VM_HEMI.sky), vis);
    vm.groundColor.set(CAVE_VM.ground).lerp(TMP_GROUND.set(VM_HEMI.ground), vis);

    // The sky IBL is the other half of the ambient: stock PBR materials read it
    // for their diffuse and specular, so leaving it at full would keep every
    // prop and the player himself lit by a sky he cannot see.
    const env = THREE.MathUtils.lerp(CAVE_ENV, 1, vis);
    this.near.environmentIntensity = env;
    this.viewModel.environmentIntensity = env;
  }

  /**
   * Multiplier Systems applies to every stock sun light. Sharper than the
   * ambient curve: direct sun through a metre of rock is not a gradient, and
   * leaving 10% of a 3.0 directional on underground is plainly visible on the
   * voxel walls as a second, wrong light direction.
   */
  get sunScale(): number {
    return THREE.MathUtils.smoothstep(this.skyVis, 0.05, 0.5);
  }

  /** True while the cascade pass can be skipped entirely: 58 draw calls. */
  get sunOccluded(): boolean { return this.sunScale <= 0.002; }

  stats(): HeadlampStats {
    return {
      enabled: this.enabled,
      skyVis: Math.round(this.skyVis * 1000) / 1000,
      rawVis: this.rawVis,
      lampCd: Math.round(this.spot.intensity * 100) / 100,
      sunScale: Math.round(this.sunScale * 1000) / 1000,
      ambient: Math.round(this.nearHemi.intensity * 1000) / 1000,
      oracleCalls: this.oracleCalls,
    };
  }
}

const TMP_SKY = new THREE.Color();
const TMP_GROUND = new THREE.Color();
