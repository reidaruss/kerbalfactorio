// RN-845. THE SECOND BODY, DRAWN.
//
// Nothing in this client drew a celestial body other than the one under the
// camera, and until PH-161 nothing COULD: `kCinderOrbitRadiusM` lived in
// `sim_world.h`, which is not in the wasm build, and of 207 exports none
// returned a body position. The previous rendering lane hit that and refused to
// transcribe the constant; physics MOVED it into `orbital.h` and published
// `of_body_state` / `of_body_facts`. This file is the consumer.
//
// FOUR THINGS ARE READ AND NOTHING IS WRITTEN DOWN:
//
//  - WHERE. `_of_body_state(id, simTimeS)` in the parent's frame, EVERY FRAME.
//    Admin ruled that Cinder orbits rather than sitting at a static frame
//    offset, and `cinderStateAt` is phased so t = 0 is bit-exactly the offset
//    the frame graph installs. Caching the position at boot would silently
//    render that ruling inoperative, so it is read per frame and the cost is
//    one wasm call.
//  - WHAT SIZE. `_of_body_facts(id)` -> radius. Not `PlanetBody.radiusM`,
//    because the disc must be sized by the ephemeris's own idea of the body.
//  - WHAT SHAPE. The body's OWN `SurfaceOracle`, baked once into an equirect
//    height map. A moon in the sky made of a different height field from the
//    moon you land on is the second-authority defect this project has paid for
//    repeatedly; there is one field here and the bake is a resampling of it.
//  - WHETHER IT HAS AIR. `PlanetBody.hasAtmosphere`, i.e. /core's
//    `AtmosphereProfile::present()`, the same authority RN-840 used. It picks
//    the photometric law. See materials/CelestialMaterial.ts.
//
// THE BODY LIST IS DISCOVERED, NOT DECLARED. `of_body_facts` returns 0 words
// for an unknown id, which physics chose deliberately over returning a
// plausible origin. That refusal is the loop terminator here, so a third body
// authored in /core is drawn with no edit in this file, and the refusing case
// is exercised on every single boot rather than being a branch nobody reaches.

import * as THREE from 'three';
import { FAR_SCALE } from './Scenes.js';
import { createCelestialMaterial, type CelestialUniforms }
  from './materials/CelestialMaterial.js';
import { bakeBody, meanAlbedo, uvResidualOf } from './CelestialBake.js';
import type { BodyId, Vec3d } from '../world/PlanetBody.js';
import { tangentFrame } from '../player/ViewSource.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import {
  discover, hasEphemeris, readFacts, relativeTo, stateOf,
  type BodyFacts, type EphemerisModule,
} from './CelestialEphemeris.js';

export type { BodyFacts } from './CelestialEphemeris.js';

export interface CelestialReport {
  readonly present: boolean;
  /** Why nothing is drawn, when nothing is drawn. Never silent. */
  readonly reason: string | null;
  readonly drawn: string[];
  /** The id the discovery loop REFUSED, proving the terminator is real. */
  readonly refusedId: number;
  readonly texW: number;
  readonly texH: number;
  readonly bakeMs: number;
  readonly oracleSamples: number;
  /** Max |dirForUv(uv) - normalize(position)| over the sphere's vertices. */
  readonly uvResidual: number;
  /** The EYE in body-frame metres at the instant of the report. Published so a
   *  probe can reconstruct `aim().distanceM` from `bodies[].posM` EXACTLY and
   *  check the two paths against each other, rather than against a tolerance
   *  somebody guessed. The first version of that check asserted the two agree
   *  to "well under a per-cent"; they differ by 4.45 per cent at the spawn,
   *  because one measures from the body CENTRE and the other from the eye, and
   *  Forge's 600 km radius is 5 per cent of 1.2e7 m. The instrument was wrong,
   *  not the code, and a tighter tolerance would have "found" a bug that is a
   *  planet's radius. */
  readonly eyeM: [number, number, number];
  readonly bodies: {
    name: string; distanceM: number; angularDiamDeg: number;
    posM: [number, number, number]; visible: boolean;
    reliefMinM: number; reliefMaxM: number; texelM: number;
  }[];
  readonly simSecs: number;
}

/** Equirect bake size. `?skybodytex=` overrides; see the report's `texelM`. */
const TEX_W_DEFAULT = 512;

interface Drawn {
  facts: BodyFacts;
  mesh: THREE.Mesh;
  uniforms: CelestialUniforms;
  reliefMinM: number;
  reliefMaxM: number;
  texelM: number;
}

export interface CelestialDeps {
  readonly core: OfCoreModule;
  readonly scene: THREE.Scene;
  readonly seedLo: number;
  readonly seedHi: number;
  /** Which body the observer's frame is centred on. A GETTER: CE-20's world
   *  rebuild replaces the body, and a value captured here would draw Forge in
   *  Forge's own sky after a hop to Cinder. */
  readonly observerBody: () => BodyId;
  /** The sun direction, BY REFERENCE from SkyPass, so the disc's phase and the
   *  sky's sun cannot drift apart. */
  readonly sunDir: THREE.Vector3;
  readonly simSecs: () => number;
  /** The EYE in body-frame metres, and the local radial there. Both are what
   *  `aim()` needs and neither is guessable from the far camera alone. */
  readonly eye: () => Vec3d;
  readonly up: () => THREE.Vector3;
}

/** Where a body is FROM THE PLAYER: an azimuth, an elevation, and the aim the
 *  debug `of.look` takes. Angles in degrees. */
export interface BodyAim {
  readonly name: string;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly elevationDeg: number;
  readonly angularDiamDeg: number;
  readonly distanceM: number;
  /** False when the body is below the local horizon; aiming still works. */
  readonly aboveHorizon: boolean;
}

export class CelestialBodies {
  readonly group = new THREE.Group();
  private readonly drawn: Drawn[] = [];
  private reason: string | null = null;
  private refusedId = -1;
  private bakeMs = 0;
  private oracleSamples = 0;
  private uvResidual = 0;
  private texW = 0;
  private texH = 0;
  private lastSimSecs = 0;
  /** The observer body's mean surface reflectance and radius: the two things
   *  planetshine needs about the body doing the shining. Measured once. */
  private hostAlbedo = new THREE.Color(0.3, 0.3, 0.3);
  private hostRadiusM = 0;
  private hostId = -1;
  /** Last computed planetshine irradiance, as a fraction of the sun's. The
   *  GROUND under the player wants this same number (Admin's ask), so it is
   *  published rather than left inside the disc shader. */
  private shine = new THREE.Color(0, 0, 0);
  /** `?skybodytime=` pins the ephemeris clock, so a shot can be posed. */
  private pinnedSecs: number | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: CelestialDeps, opts: {
    texW?: number; relief?: number; detail?: number; timeS?: number | null;
  } = {}) {
    this.group.name = 'celestialBodies';
    this.pinnedSecs = opts.timeS ?? null;
    const M = d.core as EphemerisModule;
    if (!hasEphemeris(M)) {
      this.reason = 'of_body_state / of_body_facts are not in this wasm build '
        + '(PH-161, ABI 22 additive). Nothing is drawn rather than guessed.';
      return;
    }
    const w = Math.max(32, Math.round(opts.texW ?? TEX_W_DEFAULT));
    this.texW = w;
    this.texH = w >> 1;
    const t0 = performance.now();
    const here = d.observerBody();
    const found = discover(M);
    this.refusedId = found.refusedId;
    for (const facts of found.bodies) {
      if (facts.id === here) continue;           // you are standing on it
      this.drawn.push(this.build(facts, opts.relief ?? 1, opts.detail ?? 0));
    }
    this.bakeMs = performance.now() - t0;
    if (this.drawn.length === 0 && this.reason === null) {
      this.reason = `no body other than ${here} was published (ids 0..`
        + `${this.refusedId - 1} exist)`;
    }
    d.scene.add(this.group);
  }

  private build(facts: BodyFacts, reliefGain: number, detailGain: number): Drawn {
    const { core, seedLo, seedHi } = this.d;
    const W = this.texW, H = this.texH;
    const baked = bakeBody(core, facts.id, seedLo, seedHi, W, H);
    this.oracleSamples += baked.samples;
    const geo = new THREE.SphereGeometry(facts.radiusM * FAR_SCALE, 96, 48);
    this.uvResidual = Math.max(this.uvResidual, uvResidualOf(geo));
    // The twilight/limb width, from /core's own ceiling. `atmoTopM` is 0 on an
    // airless body, so this is exactly 0 there and both terms vanish without a
    // branch anywhere.
    const rr = facts.radiusM / (facts.radiusM + facts.atmoTopM);
    const { material, uniforms } = createCelestialMaterial({
      radiusM: facts.radiusM, reliefM: baked.reliefM, airless: facts.airless,
      atmoSin: Math.sqrt(Math.max(0, 1 - rr * rr)),
      atmoScaleHM: facts.atmoScaleHM,
      relief: baked.relief, albedo: baked.albedo, texW: W, texH: H,
    });
    uniforms.uReliefGain.value = reliefGain;
    uniforms.uDetailGain.value = detailGain;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `${facts.name}Disc`;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return {
      facts, mesh, uniforms, reliefMinM: baked.minM, reliefMaxM: baked.maxM,
      texelM: (2 * Math.PI * facts.radiusM) / W,
    };
  }

  /** Per frame. `farCamPos` is the far camera's position in far-scene units. */
  update(farCamPos: THREE.Vector3): void {
    if (this.drawn.length === 0) return;
    const M = this.d.core as EphemerisModule;
    const t = this.pinnedSecs ?? this.d.simSecs();
    this.lastSimSecs = t;
    const here = this.d.observerBody();
    // THE OBSERVER'S OWN BODY IS THE ORIGIN OF THE FRAME BEING DRAWN, so every
    // other body is (its root-frame state) minus (the observer body's). For
    // Forge that subtracts the zeros physics deliberately returns, which is why
    // those zeros are the truth and not a stub: this expression is correct for
    // an observer on either body with no branch.
    const hereR = stateOf(M, here, t, this.tmp).clone();
    if (here !== this.hostId) this.learnHost(M, here);
    const p = new THREE.Vector3();
    for (const b of this.drawn) {
      stateOf(M, b.facts.id, t, p).sub(hereR);
      b.mesh.position.set(p.x * FAR_SCALE, p.y * FAR_SCALE, p.z * FAR_SCALE);
      b.mesh.updateMatrixWorld();
      b.uniforms.uSunDir.value.copy(this.d.sunDir);
      b.uniforms.uEyeObj.value.copy(farCamPos).sub(b.mesh.position);
      // PLANETSHINE, computed here rather than in GLSL so the ONE number can
      // also be handed to the ground the player stands on.
      //
      //   E / E_sun  =  (2/3) * A * (R/d)^2 * (1 + cos alpha) / 2
      //
      // A Lambert sphere of albedo A and radius R at distance d, at phase angle
      // alpha (sun-host-body). The 2/3 is the disc integral of a Lambert
      // sphere at full phase, not a fudge. For Forge lighting Cinder that is
      // about 5e-4 of sunlight, which is the right order: earthshine on our own
      // Moon is about 1e-4, and Forge subtends three times the angle Earth does
      // from the Moon.
      const dM = Math.max(1, p.length());
      const cosA = -p.dot(this.d.sunDir) / dM;   // -p points host -> sun side
      const k = (2 / 3) * (this.hostRadiusM / dM) * (this.hostRadiusM / dM)
        * 0.5 * (1 + cosA);
      this.shine.copy(this.hostAlbedo).multiplyScalar(k);
      b.uniforms.uShine.value.copy(this.shine)
        .multiplyScalar(b.uniforms.uSunIrr.value);
      b.uniforms.uShineDir.value.copy(p).multiplyScalar(-1 / dM);
    }
  }

  /** The host body's radius and mean reflectance, measured once per world. */
  private learnHost(M: EphemerisModule, id: BodyId): void {
    const f = readFacts(M, id);
    if (f === null) return;
    this.hostId = id;
    this.hostRadiusM = f.radiusM;
    this.hostAlbedo = meanAlbedo(this.d.core, id, this.d.seedLo, this.d.seedHi);
  }

  /** Planetshine irradiance at the drawn body, as a fraction of the sun's.
   *  Published so the GROUND can be lit by the same number the disc is. */
  planetshine(): { r: number; g: number; b: number; hostRadiusM: number;
    hostAlbedo: [number, number, number] } {
    return { r: this.shine.r, g: this.shine.g, b: this.shine.b,
      hostRadiusM: this.hostRadiusM,
      hostAlbedo: [this.hostAlbedo.r, this.hostAlbedo.g, this.hostAlbedo.b] };
  }

  setRelief(g: number): number {
    for (const b of this.drawn) b.uniforms.uReliefGain.value = g;
    return g;
  }

  setDetail(g: number): number {
    for (const b of this.drawn) b.uniforms.uDetailGain.value = g;
    return g;
  }

  setDebug(on: boolean): number {
    for (const b of this.drawn) b.uniforms.uDebug.value = on ? 1 : 0;
    return on ? 1 : 0;
  }

  /** Pin the ephemeris clock, or pass null to follow sim time again. */
  setTimeS(s: number | null): number | null { this.pinnedSecs = s; return s; }

  report(): CelestialReport {
    const M = this.d.core as EphemerisModule;
    const here = this.d.observerBody();
    const t = this.pinnedSecs ?? this.lastSimSecs;
    const hereR = hasEphemeris(M)
      ? stateOf(M, here, t, new THREE.Vector3()) : new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = this.d.eye();
    return {
      present: this.drawn.length > 0,
      reason: this.reason,
      drawn: this.drawn.map((b) => b.facts.name),
      refusedId: this.refusedId,
      texW: this.texW, texH: this.texH,
      bakeMs: this.bakeMs,
      oracleSamples: this.oracleSamples,
      uvResidual: this.uvResidual,
      eyeM: [e.x, e.y, e.z] as [number, number, number],
      simSecs: t,
      bodies: this.drawn.map((b) => {
        if (hasEphemeris(M)) {
          stateOf(M, b.facts.id, t, p).sub(hereR);
        }
        const dM = Math.max(1, p.length());
        return {
          name: b.facts.name,
          distanceM: dM,
          angularDiamDeg: 2 * Math.asin(Math.min(1, b.facts.radiusM / dM))
            * 180 / Math.PI,
          posM: [p.x, p.y, p.z] as [number, number, number],
          visible: b.mesh.visible,
          // The optics uniforms READ BACK OFF THE MATERIAL, not recomputed.
          // A number that is derived here and asserted here proves only that
          // this function is self-consistent; these are what the GPU is
          // actually running, which is the only version that draws anything.
          optics: {
            airless: b.uniforms.uAirless.value,
            atmoSin: b.uniforms.uAtmoSin.value,
            atmoScaleHM: b.uniforms.uAtmoH.value,
            reliefGain: b.uniforms.uReliefGain.value,
            detailGain: b.uniforms.uDetailGain.value,
            shine: [b.uniforms.uShine.value.r, b.uniforms.uShine.value.g,
              b.uniforms.uShine.value.b] as [number, number, number],
          },
          reliefMinM: b.reliefMinM, reliefMaxM: b.reliefMaxM, texelM: b.texelM,
        };
      }),
    };
  }

  facts(): BodyFacts[] { return this.drawn.map((b) => b.facts); }

  /**
   * WHERE TO LOOK. `yawDeg` / `pitchDeg` are exactly what `of.look` takes,
   * derived through `ViewSource.tangentFrame` and `ObserverCamera`'s own
   * forward expression, so this cannot drift from the aim the camera actually
   * adopts: forward = east*sin(yaw)*cos(pitch) + north*cos(yaw)*cos(pitch)
   * + up*sin(pitch), inverted.
   *
   * A probe that instead searched yaw/pitch numerically would need a settle per
   * sample and would agree with the camera only by luck. This is the same
   * three lines the camera runs, read backwards.
   */
  aim(): BodyAim[] {
    const M = this.d.core as EphemerisModule;
    if (this.drawn.length === 0 || !hasEphemeris(M)) return [];
    const t = this.pinnedSecs ?? this.lastSimSecs;
    const here = this.d.observerBody();
    const e = this.d.eye();
    const up = this.d.up().clone().normalize();
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    tangentFrame(up, east, north);
    const p = new THREE.Vector3();
    return this.drawn.map((b) => {
      relativeTo(M, b.facts.id, here, t, p);
      const dM = p.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
      p.sub(new THREE.Vector3(e.x, e.y, e.z)).normalize();
      const su = p.dot(up);
      return {
        name: b.facts.name,
        yawDeg: Math.atan2(p.dot(east), p.dot(north)) * 180 / Math.PI,
        pitchDeg: Math.asin(THREE.MathUtils.clamp(su, -1, 1)) * 180 / Math.PI,
        elevationDeg: Math.asin(THREE.MathUtils.clamp(su, -1, 1)) * 180 / Math.PI,
        angularDiamDeg: 2 * Math.asin(Math.min(1, b.facts.radiusM / Math.max(1, dM)))
          * 180 / Math.PI,
        distanceM: dM,
        aboveHorizon: su > 0,
      };
    });
  }

  dispose(): void {
    for (const b of this.drawn) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.uniforms.uRelief.value.dispose();
      b.uniforms.uAlbedo.value.dispose();
    }
    this.drawn.length = 0;
    this.group.removeFromParent();
  }
}
