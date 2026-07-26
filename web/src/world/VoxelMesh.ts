// The near-field voxel surface: one THREE.Mesh holding the greedy-meshed
// exposed faces around the player, rebuilt from the DIRTY REGION only.
//
// It draws the cut faces a dig exposes. The untouched planet is still the
// heightfield's job, and it stays that way: this mesh only ever contains faces
// inside a box that a dig has actually touched, so a pristine world costs one
// empty draw call, not a voxelised planet.
//
// One responsibility: geometry + placement. It does not dig (VoxelWorld), does
// not decide the box, and does not collide (KinematicBody resolves against
// solidCell directly, per DW-12 there is no physics engine to feed).

import * as THREE from 'three';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { Vec3d } from './PlanetBody.js';
import type { CellBox } from './VoxelWorld.js';
import { greedyMesh, type GreedyMesh } from './VoxelGreedy.js';

/** Metres of margin added around a dirty box before re-meshing it. */
const PAD_M = 3;

export interface VoxelMeshStats {
  rebuilds: number;
  faces: number;
  quads: number;
  triangles: number;
  lastMs: number;
  /** faces / quads. 1 means the greedy pass merged nothing. */
  mergeRatio: number;
  boxes: number;
}

export class VoxelMesh {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  /** Body-frame anchor the f32 vertices are relative to (standing rule 6). */
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  /** Union of every box dug so far, in cells. Re-meshed as one region. */
  private box: CellBox | null = null;
  readonly stats: VoxelMeshStats = {
    rebuilds: 0, faces: 0, quads: 0, triangles: 0, lastMs: 0, mergeRatio: 0, boxes: 0,
  };

  constructor(
    private readonly M: OfCoreModule,
    private readonly bodyHandle: number,
    private readonly editsHandle: number,
    private readonly origin: FloatingOrigin,
  ) {
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshLambertMaterial({
      color: 0x8a7a63,
      // Cut rock is seen from BOTH sides during a dissolve frame: the wall you
      // are tunnelling into becomes the wall behind you. Backface culling here
      // costs nothing visually and hides the moment a face flips.
      side: THREE.FrontSide,
      flatShading: true,
    }));
    this.mesh.name = 'voxelNear';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }

  /** Grow the meshed region by a dirty box and rebuild. Returns the mesh stats. */
  applyDirty(dirty: CellBox): void {
    this.box = this.box === null ? { ...dirty } : {
      minX: Math.min(this.box.minX, dirty.minX),
      minY: Math.min(this.box.minY, dirty.minY),
      minZ: Math.min(this.box.minZ, dirty.minZ),
      maxX: Math.max(this.box.maxX, dirty.maxX),
      maxY: Math.max(this.box.maxY, dirty.maxY),
      maxZ: Math.max(this.box.maxZ, dirty.maxZ),
    };
    this.stats.boxes++;
    this.rebuild();
  }

  /** Re-derive the engine transform from the 64-bit anchor. Rebase handler. */
  place(): void {
    if (this.box === null) return;
    const p = new THREE.Vector3();
    this.origin.toEngine(this.anchor, p);
    this.mesh.position.copy(p);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }

  private rebuild(): void {
    const b = this.box;
    if (b === null) return;
    const t0 = performance.now();
    const cellM = this.M._of_voxel_size();

    // exposedFaces takes a sphere, so cover the box with one that contains it,
    // padded: a dig at the edge of the box exposes faces one cell OUTSIDE it.
    const cx = (b.minX + b.maxX + 1) * 0.5 * cellM;
    const cy = (b.minY + b.maxY + 1) * 0.5 * cellM;
    const cz = (b.minZ + b.maxZ + 1) * 0.5 * cellM;
    const half = 0.5 * cellM * Math.hypot(
      b.maxX - b.minX + 1, b.maxY - b.minY + 1, b.maxZ - b.minZ + 1,
    );
    const count = this.M._of_exposed_faces(
      this.bodyHandle, this.editsHandle, cx, cy, cz, half + PAD_M,
    );
    if (count < 0) return;

    // Standing rule 5: the scratch pointer and HEAP32 are re-read here, after
    // the call that may have grown the heap, and copied out before anything
    // else can call into WASM.
    const ptr = this.M._of_scratch_i32() >> 2;
    const src = this.M.HEAP32.subarray(ptr, ptr + count * 5);
    const i32 = new Int32Array(src);

    const aCell: [number, number, number] = [b.minX, b.minY, b.minZ];
    const mesh: GreedyMesh = greedyMesh({ i32, count }, aCell, cellM);

    this.anchor.x = aCell[0] * cellM;
    this.anchor.y = aCell[1] * cellM;
    this.anchor.z = aCell[2] * cellM;

    this.geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    this.geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.geo.computeBoundingSphere();
    this.mesh.visible = mesh.indices.length > 0;
    this.place();

    this.stats.rebuilds++;
    this.stats.faces = mesh.faces;
    this.stats.quads = mesh.quads;
    this.stats.triangles = mesh.indices.length / 3;
    this.stats.mergeRatio = mesh.quads > 0 ? +(mesh.faces / mesh.quads).toFixed(2) : 0;
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
