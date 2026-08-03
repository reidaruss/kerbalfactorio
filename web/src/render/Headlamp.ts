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
// untouched), and nine oracle calls per frame at roughly 2 us each.

import * as THREE from 'three';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * Samples taken up the column between the eye and the sky. THIS IS A THICKNESS
 * MEASUREMENT, not a ladder of fixed heights, and the first attempt got that
 * wrong: fixed probes at 0.9 / 2.2 / 4.5 / 9.0 m reported 3 of 4 CLEAR while
 * the player stood under a solid roof, because a walkable tunnel is only two or
 * three metres under the hillside and everything above the hillside is sky by
 * definition. Measured: skyVis bottomed out at 0.619 inside a tunnel the same
 * probe was simultaneously asserting had rock overhead on 10 of 10 samples.
 *
 * The span is therefore adaptive: it runs from just above the head to just past
 * the heightfield, so every sample is inside the only region that can contain
 * rock and none of the budget is spent on open sky.
 */
const SKY_SAMPLES = 8;
/** Where the column starts, metres above the eye. Just clear of the head. */
const SKY_SPAN_LO_M = 0.3;
/** Span clamp. The lower bound keeps the measurement defined at the surface. */
const SKY_SPAN_MIN_M = 1.5;
const SKY_SPAN_MAX_M = 10;
/**
 * Metres of rock that cut the sky to 1/e. 1 m of roof leaves 43%, which is a
 * shelf you can still read by; 2 m leaves 19% and 3.5 m leaves 5%, which is a
 * tunnel. Tuned so a 3-cell bore under a hillside is properly dark and the lip
 * of a mouth is not.
 */
const ROCK_EFOLD_M = 1.2;
/**
 * Seconds for the driven value to reach a new measurement, ASYMMETRIC because
 * the two directions are different physics. Rock arriving overhead blocks light
 * at once, so going dark is nearly immediate; coming back out into daylight is
 * eye adaptation, so it is slow, and that is what makes stepping out of a mouth
 * read as relief rather than as a light switch. A single 0.5 s constant was
 * measured lagging a 4.6 m/s walk by a full sample: the driven sun was still at
 * 31% under 1.7 m of roof the occlusion had already reported.
 */
const ADAPT_DARK_SECS = 0.12;
const ADAPT_LIGHT_SECS = 0.6;

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

  /**
   * Player toggle (KeyL). Auto behaviour lives in the sky-visibility curve.
   *
   * RN-1011. `?lamp=0` BOOTS IT OFF, and this line is the whole fix for a flag
   * that has been registered, forwarded and dead. `lamp` was in `run.mjs`'s
   * PAGE_PARAMS, so the runner put it in the query string and no file in
   * `web/src` ever read it. That is worse than an absent flag: RN-153 made this
   * lamp AUTO-ENABLE at night on the sun's own elevation, so every night
   * measurement taken with `?lamp=0` in the URL was taken with the lamp on,
   * while its filename and its report said otherwise. RN-846's night hunt lists
   * "it survives `?lamp=0`" as one of four eliminations; that elimination was
   * vacuous, and it happens to survive for the TERRAIN only because
   * `TerrainShader` reads no three.js light at all, which is luck rather than
   * method and does not extend to props, rocks or the player.
   *
   * Read HERE rather than in Boot or Config because this class already owns
   * every other decision about how dark it is and what lights you, and a
   * default that lives beside the thing it defaults is a default that cannot
   * drift from it. `of.lamp(on)` still works and still wins, because it is the
   * same field: the flag sets the BOOT state, not a lock.
   *
   * A missing parameter is MISSING and takes the boot default true, never
   * `Number(null) === 0`; only the exact string '0' turns it off, so `?lamp=1`
   * and `?lamp=` cannot silently mean the opposite of what they read like.
   */
  enabled = new URLSearchParams(self.location.search).get('lamp') !== '0';
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
    // AND `visible` STAYS TRUE FOR THE WHOLE SESSION. three's projectObject
    // drops an invisible light before it reaches the lights state, so the
    // program cache key changes and EVERY material in the near scene recompiles
    // the frame the lamp switches. Measured: the first entry into a tunnel cost
    // a 441 ms stall and 30 new programs. An off lamp is therefore intensity 0,
    // never hidden: one spot light's worth of fragment maths, always, in
    // exchange for one lights configuration that compiles once at boot.
    this.spot.visible = true;
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
    // How much heightfield is above the eye. This is the EDITED surface, so a
    // vertical shaft (whose column has been lowered to its floor) correctly
    // reports open sky while a horizontal tunnel under intact ground does not:
    // it is the same derivedLoweringAt the mouth reconciliation is built on.
    this.oracleCalls++;
    const gapM = oracle.surfaceRadius(ux, uy, uz) - r;
    const top = Math.min(SKY_SPAN_MAX_M, Math.max(SKY_SPAN_MIN_M, gapM + 1.0));
    const step = (top - SKY_SPAN_LO_M) / (SKY_SAMPLES - 1);
    let solid = 0;
    for (let i = 0; i < SKY_SAMPLES; ++i) {
      const h = SKY_SPAN_LO_M + i * step;
      this.oracleCalls++;
      if (oracle.solidAt(eye.x + ux * h, eye.y + uy * h, eye.z + uz * h)) solid++;
    }
    const rockM = (solid / SKY_SAMPLES) * (top - SKY_SPAN_LO_M);
    this.rawVis = Math.exp(-rockM / ROCK_EFOLD_M);
    return this.rawVis;
  }

  /**
   * Drive the lamp and the ambient. `eye`/`aim`/`up` are body-frame; the lamp is
   * placed through the ONE rebase authority like every other world-anchored
   * object (ARCHITECTURE.md 3.6), never by applying a delta by hand.
   */
  update(dt: number, origin: FloatingOrigin, eye: Vec3d | null,
    aim: THREE.Vector3, up: THREE.Vector3, sunElevationDot = 1): void {
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
    const tau = this.rawVis < this.skyVis ? ADAPT_DARK_SECS : ADAPT_LIGHT_SECS;
    this.skyVis += (this.rawVis - this.skyVis) * (1 - Math.exp(-dt / tau));

    // The lamp comes on as the sky closes, not on a hard threshold: above 82%
    // sky it is off, and it is at full by 45%, which is roughly a metre of rock
    // overhead. Under open sky it contributes nothing, so leaving it enabled in
    // daylight costs one light's worth of shader work and changes no pixel.
    //
    // RN-153: AND at NIGHT. This gate keyed on sky OCCLUSION only, so the lamp
    // that has existed since W5 never once lit a surface night: the one state
    // a player most wants it (PH-86 landed the first real night and measured
    // mid-field terrain unnavigable). The night half keys on the sun's own
    // elevation, coming up over 0.03 to -0.05, the same band the starlight
    // floor uses (TerrainAmbient.terrainNightAmbient), because both are
    // statements about when the DIRECT term has collapsed: the terminator's
    // transmittance has extinguished the sun well before elevation -0.05, and
    // above 0.03 the ground is still sunlit and the lamp would read as a
    // flashlight at noon. max(), not sum: a night-time tunnel is dark once.
    const dark = 1 - this.skyVis;
    const occK = THREE.MathUtils.smoothstep(dark, 0.18, 0.55);
    const nightK = THREE.MathUtils.smoothstep(-sunElevationDot, -0.03, 0.05);
    const lampK = this.enabled ? Math.max(occK, nightK) : 0;
    this.spot.intensity = LAMP_CD * lampK;

    // Placing it is skipped while it is dark, not because of the cost but
    // because a stale position on a light contributing nothing is invisible.
    if (lampK > 0.001) {
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
    // SQUARED. The sky ambient is what the lamp has to beat, and a linear fade
    // leaves a quarter of full daylight on the walls at the point where the
    // occlusion measurement already says "tunnel". The colour lerps stay linear
    // so the tint still crosses over smoothly.
    const k = vis * vis;
    const h = this.nearHemi;
    h.intensity = THREE.MathUtils.lerp(CAVE_HEMI.intensity, SKY_HEMI.intensity, k);
    h.color.set(CAVE_HEMI.sky).lerp(TMP_SKY.set(SKY_HEMI.sky), vis);
    h.groundColor.set(CAVE_HEMI.ground).lerp(TMP_GROUND.set(SKY_HEMI.ground), vis);

    // The arms are ALWAYS inside the cone, so underground they are lit by the
    // lamp by definition. Modelling that as a fill costs nothing and avoids a
    // second SpotLight in the view-model pass.
    const vm = this.vmHemi;
    const caveVm = CAVE_VM.intensity * lampK + 0.03;
    vm.intensity = THREE.MathUtils.lerp(caveVm, VM_HEMI.intensity, k);
    vm.color.set(CAVE_VM.sky).lerp(TMP_SKY.set(VM_HEMI.sky), vis);
    vm.groundColor.set(CAVE_VM.ground).lerp(TMP_GROUND.set(VM_HEMI.ground), vis);

    // The sky IBL is the other half of the ambient: stock PBR materials read it
    // for their diffuse and specular, so leaving it at full would keep every
    // prop and the player himself lit by a sky he cannot see.
    const env = THREE.MathUtils.lerp(CAVE_ENV, 1, k);
    this.near.environmentIntensity = env;
    this.viewModel.environmentIntensity = env;
  }

  /**
   * Multiplier Systems applies to every stock sun light. It reaches zero WELL
   * before the ambient does, at the point the occlusion first reads as a roof
   * rather than as a shelf: direct sun through a metre of rock is not a
   * gradient, and leaving even 10% of a 3.0 directional on underground is
   * plainly visible on the voxel walls as a second, wrong light direction.
   */
  get sunScale(): number {
    return THREE.MathUtils.smoothstep(this.skyVis, 0.42, 0.85);
  }

  /**
   * True while the sun contributes nothing. It is REPORTED, not acted on: the
   * obvious saving (skip the cascade pass, 58 draw calls) turned out to cost a
   * full material recompile at the tunnel mouth, so Systems leaves the shadow
   * rig alone and only the intensity goes to zero. See ARCHITECTURE 15.2.
   */
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
