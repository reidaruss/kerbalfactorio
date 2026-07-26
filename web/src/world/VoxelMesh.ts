// The near-field voxel surface: one THREE.Mesh holding the greedy-meshed
// exposed faces around the player, rebuilt from the DIRTY REGION only.
//
// It draws only what the heightfield CANNOT express: the cavities a dig opened
// and any ground placed above the surface. Everything else, including a
// levelled pad, is the terrain chunk's and always was (VoxelSkin, and the field
// of dark pyramids that motivated it).
//
// Its COLOUR comes from the terrain's own biome palette and slope-to-rock rule
// (VoxelSkin.faceColours), so a tunnel mouth and the hillside it is cut into
// read as one substance; its LIGHT stays Headlamp's, which is why the material
// is still a Lambert and not the terrain's own program.
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
import { filterDrawnFaces, faceColours, FACE_STRIDE } from './VoxelSkin.js';
import type { SurfaceRadiusFn } from './VoxelSkin.js';

/**
 * Cells per side of a BRICK: the unit this mesh re-meshes and caches.
 *
 * The old shape re-meshed the UNION of every box ever dug, as one cube, on every
 * strike. That is O(tunnelLength^3) work per swing for O(1) new geometry, and it
 * is where 27 to 69 ms came from. Bricks are a fixed, disjoint lattice, so a
 * strike re-meshes only the one or two bricks it touched and the rest are served
 * from cache: the cost of a swing stops growing with the length of the tunnel.
 * 8 keeps a brick's padded region at 10^3 cells, small enough that touching
 * eight of them at once is still cheaper than one 20 m cube was.
 */
const BRICK = 8;

export interface VoxelMeshStats {
  rebuilds: number;
  faces: number;
  quads: number;
  triangles: number;
  lastMs: number;
  /** faces / quads. 1 means the greedy pass merged nothing. */
  mergeRatio: number;
  boxes: number;
  /** Bricks holding geometry, and how many the last strike had to re-mesh. */
  bricks: number;
  remeshed: number;
  /**
   * Faces /core exposed in the re-meshed bricks, and how many of those the
   * heightfield already draws and were therefore dropped. `dropped / exposed`
   * is the size of the redundant skin this mesh used to paint over the terrain.
   */
  exposed: number;
  dropped: number;
  /** false with `?voxelskin=0`: the whole solid-to-air shell, as W5 drew it. */
  editFacesOnly: boolean;
  /** The /core biome the vertex colours were taken from. */
  biome: number;
}

export interface VoxelMeshOptions {
  /** Datum radius and max relief: the two numbers the terrain's own albedo rule
   *  needs to place a vertex in the snow band (BiomePalette.terrainAlbedo). */
  readonly bodyRadiusM: number;
  readonly maxReliefM: number;
  /** The ONE surface, so this mesh can tell what the terrain chunk already
   *  draws from what only it can (standing rule 1). */
  readonly surfaceRadiusAt: SurfaceRadiusFn;
  /**
   * `?voxelskin=0` restores the mesh exactly as W5 shipped it: the WHOLE
   * solid-to-air shell of every re-meshed brick, in its own flat brown Lambert.
   * That is the layer being accused, so it has to stay switchable (rule 7).
   */
  readonly editFacesOnly: boolean;
}

export class VoxelMesh {
  readonly mesh: THREE.Mesh;
  private readonly ownMaterial: THREE.Material;
  private readonly geo = new THREE.BufferGeometry();
  /** Body-frame anchor the f32 vertices are relative to (standing rule 6). */
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  /** Cached exposed faces per brick, keyed `bx,by,bz`. Empty bricks are dropped. */
  private readonly bricks = new Map<string, Int32Array>();
  /** Lowest brick corner seen, in cells. The f32 anchor (standing rule 6). */
  private anchorCell: [number, number, number] | null = null;
  readonly stats: VoxelMeshStats = {
    rebuilds: 0, faces: 0, quads: 0, triangles: 0, lastMs: 0, mergeRatio: 0,
    boxes: 0, bricks: 0, remeshed: 0, exposed: 0, dropped: 0, editFacesOnly: true,
    biome: -1,
  };

  constructor(
    private readonly M: OfCoreModule,
    private readonly bodyHandle: number,
    private readonly editsHandle: number,
    private readonly origin: FloatingOrigin,
    private readonly opts: VoxelMeshOptions,
  ) {
    // Lambert, because Headlamp is the lighting authority underground and the
    // terrain's own program ignores three's light list entirely: shading this
    // mesh with it made a tunnel stop responding to the lamp (lift 3.46x ->
    // 1.12x, measured). Colour is imported instead of light. `?voxelskin=0`
    // restores the flat brown W5 shipped, or the isolation would show only half
    // of what changed.
    this.ownMaterial = new THREE.MeshLambertMaterial(opts.editFacesOnly
      ? { vertexColors: true, flatShading: true }
      : { color: 0x8a7a63, flatShading: true });
    this.mesh = new THREE.Mesh(this.geo, this.ownMaterial);
    this.stats.editFacesOnly = opts.editFacesOnly;
    this.mesh.name = 'voxelNear';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }

  /**
   * Re-mesh the bricks a dirty box touched, then rebuild the geometry from the
   * brick cache. The box is expanded by one cell first: a cell carved on a brick
   * boundary exposes a face belonging to the NEIGHBOURING brick, and skipping
   * that is a one-cell hole in the tunnel wall exactly where two bricks meet.
   */
  applyDirty(dirty: CellBox): void {
    const t0 = performance.now();
    const b0 = Math.floor((dirty.minX - 1) / BRICK), b1 = Math.floor((dirty.maxX + 1) / BRICK);
    const c0 = Math.floor((dirty.minY - 1) / BRICK), c1 = Math.floor((dirty.maxY + 1) / BRICK);
    const d0 = Math.floor((dirty.minZ - 1) / BRICK), d1 = Math.floor((dirty.maxZ + 1) / BRICK);
    let remeshed = 0;
    this.stats.exposed = 0;
    this.stats.dropped = 0;
    for (let bz = d0; bz <= d1; ++bz)
      for (let by = c0; by <= c1; ++by)
        for (let bx = b0; bx <= b1; ++bx) { this.meshBrick(bx, by, bz); remeshed++; }
    this.stats.boxes++;
    this.stats.remeshed = remeshed;
    this.rebuild();
    this.stats.lastMs = +(performance.now() - t0).toFixed(3);
  }

  /**
   * Ask /core for the exposed faces of ONE brick and cache them. The radius is
   * (BRICK-1)/2, not BRICK/2, because exposedFaces builds its cell box from
   * floor(centre +/- radius): half a brick would spill one cell into the next
   * brick and every boundary face would be emitted twice, drawn twice, and
   * z-fight with itself.
   */
  private meshBrick(bx: number, by: number, bz: number): void {
    const cellM = this.M._of_voxel_size();
    const half = (BRICK - 1) * 0.5 * cellM;
    const count = this.M._of_exposed_faces(
      this.bodyHandle, this.editsHandle,
      (bx * BRICK + BRICK * 0.5) * cellM,
      (by * BRICK + BRICK * 0.5) * cellM,
      (bz * BRICK + BRICK * 0.5) * cellM,
      half,
    );
    const key = `${bx},${by},${bz}`;
    if (count <= 0) { this.bricks.delete(key); return; }
    this.stats.exposed += count;
    // Standing rule 5: the scratch pointer and HEAP32 are re-read here, after
    // the call that may have grown the heap, and copied out before anything
    // else can call into WASM.
    const ptr = this.M._of_scratch_i32() >> 2;
    const raw = new Int32Array(this.M.HEAP32.subarray(ptr, ptr + count * FACE_STRIDE));
    // The filter is the fix for the pyramid field: everything /core exposes on
    // the derived surface is already drawn, better and smoothly, by the chunk.
    let kept: Int32Array = raw;
    let keptCount = count;
    if (this.opts.editFacesOnly) {
      const f = filterDrawnFaces(this.M, this.editsHandle, this.opts.surfaceRadiusAt,
        cellM, raw, count);
      kept = f.i32; keptCount = f.count;
      this.stats.dropped += f.dropped;
    }
    if (keptCount <= 0) { this.bricks.delete(key); return; }
    this.bricks.set(key, new Int32Array(kept));
    const cx = bx * BRICK, cy = by * BRICK, cz = bz * BRICK;
    if (this.anchorCell === null) this.anchorCell = [cx, cy, cz];
    else {
      this.anchorCell[0] = Math.min(this.anchorCell[0], cx);
      this.anchorCell[1] = Math.min(this.anchorCell[1], cy);
      this.anchorCell[2] = Math.min(this.anchorCell[2], cz);
    }
  }

  /** Re-derive the engine transform from the 64-bit anchor. Rebase handler. */
  place(): void {
    if (this.anchorCell === null) return;
    const p = new THREE.Vector3();
    this.origin.toEngine(this.anchor, p);
    this.mesh.position.copy(p);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }

  /** Greedy-mesh the concatenation of every cached brick. No WASM call here. */
  private rebuild(): void {
    const aCell = this.anchorCell;
    if (aCell === null) return;
    const cellM = this.M._of_voxel_size();

    let total = 0;
    for (const f of this.bricks.values()) total += f.length;
    const i32 = new Int32Array(total);
    let at = 0;
    for (const f of this.bricks.values()) { i32.set(f, at); at += f.length; }
    const count = total / FACE_STRIDE;

    const mesh: GreedyMesh = greedyMesh({ i32, count }, aCell, cellM);

    this.anchor.x = aCell[0] * cellM;
    this.anchor.y = aCell[1] * cellM;
    this.anchor.z = aCell[2] * cellM;

    // One biome for the whole near mesh, from the SAME `of_biome_at` a chunk
    // vertex reads. The mesh spans tens of metres and a biome spans kilometres,
    // so a per-face call would buy nothing but calls.
    const ar = Math.hypot(this.anchor.x, this.anchor.y, this.anchor.z) || 1;
    const biomeId = this.M._of_biome_at(
      this.bodyHandle, this.anchor.x / ar, this.anchor.y / ar, this.anchor.z / ar);
    this.stats.biome = biomeId;

    this.geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    if (this.opts.editFacesOnly) {
      this.geo.setAttribute('color', new THREE.BufferAttribute(faceColours(
        mesh.positions, mesh.normals, [this.anchor.x, this.anchor.y, this.anchor.z],
        this.opts.bodyRadiusM, this.opts.maxReliefM, biomeId), 3));
    }
    this.geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.geo.computeBoundingSphere();
    this.mesh.visible = mesh.indices.length > 0;
    this.place();

    this.stats.rebuilds++;
    this.stats.faces = mesh.faces;
    this.stats.quads = mesh.quads;
    this.stats.triangles = mesh.indices.length / 3;
    this.stats.mergeRatio = mesh.quads > 0 ? +(mesh.faces / mesh.quads).toFixed(2) : 0;
    this.stats.bricks = this.bricks.size;
  }

  dispose(): void {
    this.geo.dispose();
    this.ownMaterial.dispose();
    this.mesh.removeFromParent();
  }
}
