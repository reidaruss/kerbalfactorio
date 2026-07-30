// The engine plume: one additive cone per firing nozzle, two draw calls total.
//
// Split out of VesselView.ts to keep both files inside the 400-line cap
// (ARCHITECTURE.md section 2.2 rule 1). It knows nothing about parts, sockets,
// staging or the catalogue. It is handed a list of nozzle points already
// expressed in the VESSEL's own local frame plus a throttle, and it draws flame
// there. That is the whole contract, and it is why the plume can be tested
// without a rocket.
//
// Two THREE.InstancedMesh sharing ONE unit-cone geometry: an outer flame and a
// brighter inner core. Both allocate their instances once and then move `count`
// rather than rebuilding a buffer, so a staging event that changes which engines
// burn costs a handful of matrix writes and no allocation. At throttle 0 both
// meshes are invisible, which is the common case for most of a flight.

import * as THREE from 'three';

/** A firing nozzle: its exit point in VESSEL LOCAL metres, and its exit radius. */
export interface PlumeNozzle {
  pos: THREE.Vector3;
  radiusM: number;
}

/** Instances allocated once, up front. A craft with more simultaneous engines
 *  than this has its plume truncated rather than triggering a reallocation
 *  mid-burn, which is the cheaper failure of the two. */
const MAX_NOZZLES = 16;
/** Plume length at full throttle, measured in nozzle exit radii. */
const LENGTH_PER_RADIUS = 9;
/** Below this the throttle counts as shut: the plume draws nothing at all. */
const CUTOFF = 1e-3;

// RN-125: THE FLICKER. A rocket plume is turbulent combustion and a cone of
// constant size reads as a decal. Each nozzle's length, width and the core's
// share of the length breathe independently on smoothed value noise, and the
// AMPLITUDE follows the throttle: a deep-throttled engine burns steadier
// than one at the stop, which is also what keeps the ignition crack visible
// (the first frames at low throttle are not buried in jitter).
//
// NO SHADER. This is per-instance matrix writes plus two material opacities,
// on meshes that already rewrite their matrices every frame, so the DW-10
// ledger does not move and the cost is arithmetic on at most 16 nozzles.
//
// THE CLOCK is an internal step advanced once per set() call, i.e. once per
// rendered frame while a stage burns. That is a WALL-adjacent clock and it
// is chosen deliberately: flame turbulence at 60 Hz is a look, not a sim
// quantity, and no gameplay reads it. The cost of that choice is that a
// frame captured mid-burn is not reproducible frame for frame, so ?anim=0
// (Config.anim, RN-121) zeroes the flicker and restores the pre-RN-125
// rendering exactly: standing rule 7's isolation, and the setting any probe
// that hashes frames during a burn should run under.
/** Peak fractional length flicker at full throttle. */
const FLICKER_LEN = 0.14;
/** Peak fractional width flicker at full throttle. */
const FLICKER_RAD = 0.07;
/** Peak opacity flutter at full throttle. */
const FLICKER_OPACITY = 0.06;
/** Noise phase advance per rendered frame: ~2 flicker events a second at
 *  60 fps per nozzle, which reads as burn rather than as strobe. */
const FLICKER_STEP = 0.13;

/** Deterministic hash noise in [-1, 1]. */
function noise(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smoothed value noise: lerp between integer steps of the phase. */
function flicker(lane: number, phase: number): number {
  const k = Math.floor(phase);
  const f = phase - k;
  const sm = f * f * (3 - 2 * f);
  const a = noise(lane * 7919 + k * 131);
  const b = noise(lane * 7919 + (k + 1) * 131);
  return a + (b - a) * sm;
}

export class VesselPlume {
  private readonly geo: THREE.ConeGeometry;
  private readonly flameMat: THREE.MeshBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly flame: THREE.InstancedMesh;
  private readonly core: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private throttleV = 0;
  private countV = 0;
  /** Flicker phase, advanced once per set() while burning. See RN-125 note. */
  private phase = 0;

  /** `parent` is the object carrying the vessel's world placement, so the
   *  plume inherits it and never needs a transform of its own. `live` is
   *  Config.anim (?anim=0): frozen, the flicker terms are exactly zero and
   *  the drawing is the pre-RN-125 one. */
  constructor(parent: THREE.Object3D,
              private readonly live: boolean =
                new URL(location.href).searchParams.get('anim') !== '0') {
    // Apex at the local origin, base one unit along -Y at radius 1. The vessel's
    // +Y is the stack axis toward the nose, so exhaust leaves DOWN the stack,
    // and a per-instance scale of (r, length, r) is then the whole placement.
    this.geo = new THREE.ConeGeometry(1, 1, 14, 1, true);
    this.geo.translate(0, -0.5, 0);
    this.flameMat = plumeMaterial(0xff9a3c, 0.5);
    this.coreMat = plumeMaterial(0xfff0c8, 0.8);
    this.flame = this.build(this.flameMat, 'vesselPlumeFlame', parent);
    this.core = this.build(this.coreMat, 'vesselPlumeCore', parent);
  }

  /** The last throttle written, clamped to [0,1]. */
  get throttle(): number { return this.throttleV; }
  /** How many cones are actually being drawn. Zero whenever the throttle is shut. */
  get count(): number { return this.countV; }

  /**
   * Redraw. `throttle` is clamped to [0,1] and a non-finite value reads as 0,
   * because a NaN throttle arriving from a diverged integrator should put the
   * flame out rather than write NaN into an instance matrix, which in three
   * silently kills the whole InstancedMesh for the rest of the session.
   */
  set(nozzles: readonly PlumeNozzle[], throttle: number): void {
    const t = Number.isFinite(throttle) ? Math.min(1, Math.max(0, throttle)) : 0;
    this.throttleV = t;
    const n = t > CUTOFF ? Math.min(nozzles.length, MAX_NOZZLES) : 0;
    this.countV = n;
    this.flame.count = n;
    this.core.count = n;
    this.flame.visible = n > 0;
    this.core.visible = n > 0;
    if (n === 0) return;
    // A quarter of full length at a crack of throttle, so the ignition frame
    // reads as ignition rather than as nothing happening.
    const grow = 0.25 + 0.75 * t;
    // Flicker amplitude follows the throttle; ?anim=0 zeroes it (RN-125).
    const amp = this.live ? t : 0;
    if (this.live) this.phase += FLICKER_STEP;
    for (let i = 0; i < n; ++i) {
      const z = nozzles[i];
      const r = Math.max(0.05, z.radiusM);
      const fl = 1 + FLICKER_LEN * amp * flicker(i * 3 + 1, this.phase);
      const fr = 1 + FLICKER_RAD * amp * flicker(i * 3 + 2, this.phase * 1.31);
      // The core's SHARE of the flame breathes too, out of phase with the
      // length, which is what makes the bright tongue lick rather than pump.
      const coreShare = 0.62 + 0.05 * amp * flicker(i * 3 + 3, this.phase * 0.77);
      const len = r * LENGTH_PER_RADIUS * grow * fl;
      this.write(this.flame, i, z.pos, r * 1.05 * fr, len);
      this.write(this.core, i, z.pos, r * 0.55 * fr, len * coreShare);
    }
    this.flame.instanceMatrix.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    const op = FLICKER_OPACITY * amp * flicker(97, this.phase * 1.13);
    this.flameMat.opacity = 0.25 + 0.45 * t + op;
    this.coreMat.opacity = 0.4 + 0.55 * t + op;
  }

  private write(mesh: THREE.InstancedMesh, i: number, at: THREE.Vector3,
                radius: number, length: number): void {
    // makeScale resets the whole matrix, so setPosition afterwards is the only
    // other write needed: there is no rotation, the cone already points -Y.
    this.m.makeScale(radius, length, radius);
    this.m.setPosition(at);
    mesh.setMatrixAt(i, this.m);
  }

  private build(mat: THREE.MeshBasicMaterial, name: string,
                parent: THREE.Object3D): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geo, mat, MAX_NOZZLES);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The instances move every frame and the craft is the thing the camera is
    // pointed at, so a per-frame bounding-sphere recompute buys nothing.
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    mesh.count = 0;
    parent.add(mesh);
    return mesh;
  }

  dispose(): void {
    this.flame.removeFromParent();
    this.core.removeFromParent();
    this.flame.dispose();
    this.core.dispose();
    this.geo.dispose();
    this.flameMat.dispose();
    this.coreMat.dispose();
  }
}

/** Additive, unlit, depth-tested but not depth-writing: flame occludes nothing
 *  and two overlapping plumes brighten rather than cut into each other. */
function plumeMaterial(colour: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
