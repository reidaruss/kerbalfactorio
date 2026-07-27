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

export class VesselPlume {
  private readonly geo: THREE.ConeGeometry;
  private readonly flameMat: THREE.MeshBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly flame: THREE.InstancedMesh;
  private readonly core: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private throttleV = 0;
  private countV = 0;

  /** `parent` is the object carrying the vessel's world placement, so the
   *  plume inherits it and never needs a transform of its own. */
  constructor(parent: THREE.Object3D) {
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
    for (let i = 0; i < n; ++i) {
      const z = nozzles[i];
      const r = Math.max(0.05, z.radiusM);
      const len = r * LENGTH_PER_RADIUS * grow;
      this.write(this.flame, i, z.pos, r * 1.05, len);
      this.write(this.core, i, z.pos, r * 0.55, len * 0.62);
    }
    this.flame.instanceMatrix.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    this.flameMat.opacity = 0.25 + 0.45 * t;
    this.coreMat.opacity = 0.4 + 0.55 * t;
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
