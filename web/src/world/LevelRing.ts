// The levelling tool's ground indicator: a disc that shows exactly which ground
// a level press will move, before it moves it.
//
// One responsibility: draw the footprint. It does not decide the radius, does
// not level anything, and holds no opinion about terrain height — every vertex
// asks the SAME oracle the walker and the mesher ask (standing rule 1), so the
// ring lies ON the ground it is describing, including on ground that has already
// been terraformed. A decal that floated over its own pad would be worse than no
// decal at all.
//
// Standing rule 6: vertices are f32 offsets from a 64-bit body-frame anchor,
// re-placed on every rebase, so it cannot smear at planet scale.
//
// DW-10: stock MeshBasicMaterial with vertex colours. NO custom shader.

import * as THREE from 'three';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { SurfaceOracle } from './SurfaceOracle.js';
import type { Vec3d } from './PlanetBody.js';

/** Segments around the circle. 32 is smooth at a 6 m radius and costs 65 oracle
 *  calls per rebuild, which is why rebuilds are gated on real movement below. */
const SEGMENTS = 32;
/** Metres the decal floats above the surface. Enough to clear z-fighting on a
 *  1 m voxel staircase, small enough that it still reads as painted on. */
const LIFT_M = 0.09;
/** Fraction of the radius where the bright rim band starts. */
const RIM_T = 0.86;
/** Rebuild only after the centre has moved this far, or the radius changed. */
const REBUILD_M = 0.35;

export interface LevelRingStats {
  visible: boolean;
  rebuilds: number;
  /** Oracle calls the last rebuild made, so its cost is never a guess. */
  samples: number;
  lastMs: number;
  radiusM: number;
  /** Alpha actually applied, so a probe can tell armed from active. */
  strength: number;
}

export class LevelRing {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.MeshBasicMaterial;
  /** Body-frame anchor the f32 vertices are relative to. */
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  private readonly pos = new Float32Array((1 + 2 * SEGMENTS) * 3);
  private readonly col = new Float32Array((1 + 2 * SEGMENTS) * 3);
  private readonly lastCentre: Vec3d = { x: NaN, y: NaN, z: NaN };
  private lastRadius = -1;
  readonly stats: LevelRingStats = {
    visible: false, rebuilds: 0, samples: 0, lastMs: 0, radiusM: 0, strength: 0,
  };

  constructor(
    private readonly oracle: SurfaceOracle,
    private readonly origin: FloatingOrigin,
  ) {
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'levelRing';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setIndex(new THREE.BufferAttribute(buildIndex(), 1));
    this.writeColours();
  }

  /** Stop drawing. Called when the aim leaves the ground or the tool is stowed. */
  hide(): void {
    this.mesh.visible = false;
    this.stats.visible = false;
    this.stats.strength = 0;
  }

  /**
   * Show the footprint of a level press centred on `centre` (body-frame metres).
   *
   * `strength` in [0,1] is how loud to draw it: low while the tool is merely
   * aimed, high while the key is down. It is a material opacity, not a geometry
   * change, so brightening costs nothing.
   */
  show(centre: Vec3d, radiusM: number, strength: number): void {
    const moved = !(Math.abs(centre.x - this.lastCentre.x) < REBUILD_M
      && Math.abs(centre.y - this.lastCentre.y) < REBUILD_M
      && Math.abs(centre.z - this.lastCentre.z) < REBUILD_M);
    if (moved || radiusM !== this.lastRadius) this.rebuild(centre, radiusM);
    this.mat.opacity = strength;
    this.mesh.visible = strength > 0.001;
    this.stats.visible = this.mesh.visible;
    this.stats.strength = +strength.toFixed(3);
    this.place();
  }

  /** Re-derive the engine transform from the 64-bit anchor. Rebase handler. */
  place(): void {
    const p = new THREE.Vector3();
    this.origin.toEngine(this.anchor, p);
    this.mesh.position.copy(p);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }

  /**
   * Sample the ground around the centre and write the disc.
   *
   * The two rings are at RIM_T and 1.0 of the radius; the bright band between
   * them is what makes the edge readable on a slope, where a hairline circle
   * disappears into the terrain. Every radius comes from `oracle.surfaceRadius`,
   * which is the ONE surface: on ground that was already levelled, the decal sits
   * on the new pad, not on the hill that used to be there.
   */
  private rebuild(centre: Vec3d, radiusM: number): void {
    const t0 = performance.now();
    const cr = Math.hypot(centre.x, centre.y, centre.z) || 1;
    const up: Vec3d = { x: centre.x / cr, y: centre.y / cr, z: centre.z / cr };
    // Any two tangents; which pair does not matter for a circle.
    const seed: Vec3d = Math.abs(up.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const e1 = norm(cross(up, seed));
    const e2 = cross(up, e1);

    this.anchor.x = centre.x; this.anchor.y = centre.y; this.anchor.z = centre.z;
    let samples = 0;
    const put = (i: number, ox: number, oy: number, oz: number): void => {
      // The sample dir, then the ground radius under it, then LIFT_M above.
      const px = centre.x + ox, py = centre.y + oy, pz = centre.z + oz;
      const L = Math.hypot(px, py, pz) || 1;
      const dx = px / L, dy = py / L, dz = pz / L;
      const r = this.oracle.surfaceRadius(dx, dy, dz) + LIFT_M;
      samples++;
      this.pos[i * 3] = dx * r - centre.x;
      this.pos[i * 3 + 1] = dy * r - centre.y;
      this.pos[i * 3 + 2] = dz * r - centre.z;
    };

    put(0, 0, 0, 0);
    for (let s = 0; s < SEGMENTS; ++s) {
      const a = (2 * Math.PI * s) / SEGMENTS;
      const cx = Math.cos(a), sy = Math.sin(a);
      for (let ring = 0; ring < 2; ++ring) {
        const rr = radiusM * (ring === 0 ? RIM_T : 1.0);
        put(1 + s * 2 + ring,
          (e1.x * cx + e2.x * sy) * rr,
          (e1.y * cx + e2.y * sy) * rr,
          (e1.z * cx + e2.z * sy) * rr);
      }
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.computeBoundingSphere();

    this.lastCentre.x = centre.x;
    this.lastCentre.y = centre.y;
    this.lastCentre.z = centre.z;
    this.lastRadius = radiusM;
    this.stats.rebuilds++;
    this.stats.samples = samples;
    this.stats.radiusM = radiusM;
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
  }

  /** Faint fill, bright rim. Written once: the shape never changes, only alpha. */
  private writeColours(): void {
    const set = (i: number, v: number): void => {
      this.col[i * 3] = v * 0.55; this.col[i * 3 + 1] = v; this.col[i * 3 + 2] = v * 0.75;
    };
    set(0, 0.25);
    for (let s = 0; s < SEGMENTS; ++s) {
      set(1 + s * 2, 0.30);      // inner ring: still faint
      set(2 + s * 2, 1.00);      // outer ring: the readable edge
    }
    this.geo.getAttribute('color').needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

/** Centre fan out to the inner ring, then a band between the two rings. */
function buildIndex(): Uint16Array {
  const idx: number[] = [];
  for (let s = 0; s < SEGMENTS; ++s) {
    const a0 = 1 + s * 2, a1 = 1 + ((s + 1) % SEGMENTS) * 2;
    idx.push(0, a0, a1);                    // fan
    idx.push(a0, a0 + 1, a1);               // band
    idx.push(a1, a0 + 1, a1 + 1);
  }
  return new Uint16Array(idx);
}

function cross(a: Vec3d, b: Vec3d): Vec3d {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function norm(v: Vec3d): Vec3d {
  const L = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}
