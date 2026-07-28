// WHAT A SHOT LOOKS LIKE. The pictures, with none of the rule in them.
//
// "A gun that silently decrements a number will feel broken even when it is
// correct" is the whole reason this file exists, and it is not decoration: a
// weapon is the one system where the player's entire model of whether it works
// comes from the feedback rather than from the state. So a shot has four
// simultaneous tells, and each answers a different question:
//
//   MUZZLE FLASH  -> "the gun went off"       (did my input register?)
//   REPORT (sound)-> "the gun went off"       (the same answer, in a second
//                                              sense, which is what makes it
//                                              land at 400 rpm when the flash
//                                              is one frame long)
//   TRACER        -> "the round went THERE"   (where did it go?)
//   IMPACT        -> "it arrived on THAT"     (did it hit?)
//
// Dropping any one of them leaves a specific, nameable confusion, which is why
// none of them is optional and why the probe counts all four separately.
//
// EVERYTHING HERE IS DRAWN IN THE BODY FRAME AND CONVERTED THROUGH
// `FloatingOrigin.toEngine` every frame, exactly as `Debris` does. A tracer
// cached in engine space would slide across the world on the next rebase, and a
// rebase happens every few hundred metres.
//
// COST: two objects, both of which LEAVE THE GRAPH when idle (`visible = false`
// on an empty pool is still a draw call, which is the lesson `Debris.update`
// already learned against a 150 draw budget).

import * as THREE from 'three';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** How many shots can be in flight visually at once. At 400 rpm and a 60 ms
 *  tracer life this is reached at 8, so 24 is three times the steady state and
 *  the pool is recycled oldest-first rather than refusing. A tracer that failed
 *  to draw would be invisible by definition, so refusing is not an option that
 *  could ever be noticed: recycling is the only honest full-pool behaviour for
 *  a decoration, and it is the reason this is NOT a DW-28 pool. */
const MAX_TRACERS = 24;
/** Seconds a tracer is on screen. Short: a tracer that outlives the shot reads
 *  as a laser, and this is a gun. */
const TRACER_SECS = 0.06;
const FLASH_SECS = 0.045;

export class WeaponFx {
  readonly group = new THREE.Group();
  private readonly tracers: THREE.InstancedMesh;
  private readonly flash: THREE.Mesh;
  /** Per tracer: the two body-frame endpoints and the life left. */
  private readonly ax = new Float64Array(MAX_TRACERS);
  private readonly ay = new Float64Array(MAX_TRACERS);
  private readonly az = new Float64Array(MAX_TRACERS);
  private readonly bx = new Float64Array(MAX_TRACERS);
  private readonly by = new Float64Array(MAX_TRACERS);
  private readonly bz = new Float64Array(MAX_TRACERS);
  private readonly life = new Float32Array(MAX_TRACERS);
  private next = 0;
  private liveTracers = 0;
  /** Body-frame muzzle point and the life left on the flash. */
  private fx = 0; private fy = 0; private fz = 0;
  private flashLife = 0;
  /** Ledger. Counted separately so a probe can tell "the shot did not fire"
   *  from "it fired and drew nothing", which one combined number cannot. */
  tracersDrawn = 0;
  flashesDrawn = 0;
  /**
   * FRAMES ON WHICH SOMETHING WAS ACTUALLY PAINTED, which is a different claim
   * from `flashesDrawn` and is the one that matters.
   *
   * A counter that rises when `shot()` is called proves a shot was REQUESTED. It
   * says nothing about whether a pixel ever appeared, and "counted but never
   * visible" is precisely the silent-gun failure this whole file exists to
   * prevent. These two rise inside `update`, from the same branch that sets
   * `visible`, so they cannot be true unless the frame drew it.
   *
   * They also let a probe assert it WITHOUT WINNING A RACE. A flash lives 45 ms
   * and a tracer 60 ms, so a headless probe sampling `flashVisible` has three
   * frames to hit and will lose that race about as often as it wins it, which
   * is a flaky test dressed up as a strict one (DW-20: a harness is suspect
   * until it proves itself, and a harness that needs luck never can).
   */
  flashFrames = 0;
  tracerFrames = 0;
  peakLiveTracers = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pA = new THREE.Vector3();
  private readonly pB = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'weaponFx';
    // A unit box along +Y so the default `setFromUnitVectors(+Y, dir)` needs no
    // extra basis. 2 cm across is a tracer, not a beam.
    const g = new THREE.BoxGeometry(0.02, 1, 0.02);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd08a, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.tracers = new THREE.InstancedMesh(g, mat, MAX_TRACERS);
    this.tracers.name = 'tracers';
    this.tracers.frustumCulled = false;
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_TRACERS; ++i) {
      this.m.makeScale(0, 0, 0);
      this.tracers.setMatrixAt(i, this.m);
    }
    this.group.add(this.tracers);

    // The flash. An additive sphere rather than a billboarded sprite, because a
    // sphere is correct from every angle including third person and costs the
    // same 80 triangles. `toneMapped` off so it stays white-hot through the
    // grade rather than being pulled back down into the scene's exposure.
    const fg = new THREE.SphereGeometry(0.13, 8, 6);
    const fm = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.flash = new THREE.Mesh(fg, fm);
    this.flash.name = 'muzzleFlash';
    this.flash.frustumCulled = false;
    this.flash.visible = false;
    this.group.add(this.flash);
  }

  /**
   * One shot's worth of picture: a flash at `from`, a tracer to `to`.
   *
   * Both points are BODY FRAME. The caller is the only thing that knows where
   * the muzzle is, and it is deliberately not derived here from the eye: a
   * muzzle offset baked into the effects layer would be a second opinion about
   * where the gun is held the moment a view model exists.
   */
  shot(from: { x: number; y: number; z: number },
       to: { x: number; y: number; z: number }): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_TRACERS;
    if (this.life[i] <= 0) this.liveTracers++;
    this.ax[i] = from.x; this.ay[i] = from.y; this.az[i] = from.z;
    this.bx[i] = to.x; this.by[i] = to.y; this.bz[i] = to.z;
    this.life[i] = TRACER_SECS;
    this.tracersDrawn++;

    this.fx = from.x; this.fy = from.y; this.fz = from.z;
    this.flashLife = FLASH_SECS;
    this.flashesDrawn++;
  }

  /** Every frame. Ages both, and re-derives engine space from the body frame. */
  update(dt: number, origin: FloatingOrigin): void {
    // --- the flash ----------------------------------------------------------
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) {
        this.flash.visible = false;
      } else {
        origin.toEngine({ x: this.fx, y: this.fy, z: this.fz }, this.pA);
        this.flash.position.copy(this.pA);
        // Shrinks over its life rather than fading, because at 45 ms a fade is
        // one or two frames and reads as a flicker, while a collapse reads as
        // a flash even when the player only ever sees the middle of it.
        const k = this.flashLife / FLASH_SECS;
        const s = 0.55 + k * 0.75;
        this.flash.scale.set(s, s, s);
        this.flash.visible = true;
        this.flashFrames++;
      }
    }

    // --- the tracers --------------------------------------------------------
    this.tracers.visible = this.liveTracers > 0;
    if (this.liveTracers === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX_TRACERS; ++i) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.tracers.setMatrixAt(i, this.m);
        continue;
      }
      alive++;
      origin.toEngine({ x: this.ax[i], y: this.ay[i], z: this.az[i] }, this.pA);
      origin.toEngine({ x: this.bx[i], y: this.by[i], z: this.bz[i] }, this.pB);
      this.dir.subVectors(this.pB, this.pA);
      const len = this.dir.length();
      if (len < 1e-6) { this.life[i] = 0; continue; }
      this.dir.multiplyScalar(1 / len);
      this.mid.addVectors(this.pA, this.pB).multiplyScalar(0.5);
      this.q.setFromUnitVectors(this.up, this.dir);
      // Thins as it ages, which is what makes a 60 ms streak read as motion
      // rather than as a stick that blinked.
      const k = this.life[i] / TRACER_SECS;
      this.scale.set(0.4 + k * 0.9, len, 0.4 + k * 0.9);
      this.m.compose(this.mid, this.q, this.scale);
      this.tracers.setMatrixAt(i, this.m);
    }
    this.liveTracers = alive;
    if (alive > 0) this.tracerFrames++;
    if (alive > this.peakLiveTracers) this.peakLiveTracers = alive;
    this.tracers.instanceMatrix.needsUpdate = true;
  }

  stats(): unknown {
    return {
      tracersDrawn: this.tracersDrawn, flashesDrawn: this.flashesDrawn,
      // REQUESTED against PAINTED. The pair is the assertion: `flashesDrawn`
      // rising with `flashFrames` flat is a gun that fires and shows nothing.
      flashFrames: this.flashFrames, tracerFrames: this.tracerFrames,
      peakLiveTracers: this.peakLiveTracers,
      liveTracers: this.liveTracers,
      flashVisible: this.flash.visible,
      capacity: MAX_TRACERS,
      tracerSecs: TRACER_SECS, flashSecs: FLASH_SECS,
    };
  }
}
