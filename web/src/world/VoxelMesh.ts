// The near-field terrain surface: one THREE.Mesh holding the SURFACE NETS
// extraction of /core's density field around the player, rebuilt from the DIRTY
// REGION only.
//
// WG-24 changed what this file draws. It used to ask `of_exposed_faces` for the
// solid-to-air cube faces of a binary occupancy lattice and greedy-merge them
// into axis-aligned rectangles. That is where "the way the ground breaks when
// you dig is kinda fucky ... all these sharp edges" came from: the edges were
// literal cube edges, and the shell they formed disagreed with the smooth
// surface the chunk draws by up to half a cell diagonal (DW-26), which is what
// poked through as dark pyramids and what the aim ray stopped short on.
//
// It now asks `of_surface_nets_brick` for TRIANGLES on the zero level of the
// same signed field that collision reads, with normals from the field gradient.
// A dig is a sphere and a levelled pad is a plane, both to sub-millimetre,
// because the surface is an interpolated isosurface rather than a set of cell
// faces. `VoxelGreedy` is gone with the cubes it merged.
//
// It still draws only what the heightfield CANNOT express: `editedOnly` in
// /core keeps the cells near an actual edit and drops the rest, because the
// terrain chunk already draws untouched ground, better and at its own LOD
// (ARCHITECTURE 15.2 item 108). The filter moved into /core with the mesher,
// where it can be expressed on the edit store directly instead of reconstructed
// from surface heights in the client.
//
// Its COLOUR comes from the terrain's own biome palette and slope-to-rock rule
// (VoxelSkin.faceAttributes), so a tunnel mouth and the hillside it is cut into
// read as one substance; its LIGHT stays Headlamp's, which is why the material
// reads three's light list and is not the terrain's own program.
//
// RN-1258 gave that material MAPS. It was `vertexColors: true` and nothing
// else, i.e. an interpolated gradient on the one surface a player puts their
// face against every time they dig. It now projects `of_ground.png` triplanarly
// and carries an analytic sub-metre relief bump, both keyed on a coordinate
// that survives this file's own anchor rebase. The whole argument, including
// why the bump is analytic while the albedo is sampled, is in
// VoxelFaceMaterial's header; the only thing THIS file owes it is the anchor,
// the biome and the rockness attribute, all pushed from `rebuild`.
//
// One responsibility: geometry + placement. It does not dig (VoxelWorld), does
// not decide the box, and does not collide (KinematicBody resolves against the
// oracle directly, per DW-12 there is no physics engine to feed).

import * as THREE from 'three';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { Vec3d } from './PlanetBody.js';
import type { CellBox } from './VoxelWorld.js';
import { faceAttributes } from './VoxelSkin.js';
import type { VoxelFaceMaterial } from './VoxelFaceMaterial.js';
import { createVoxelFaceMaterial, voxelFaceOptionsFromQuery } from './VoxelFaceMaterial.js';
import type { SurfaceRadiusFn } from './VoxelSkin.js';

/**
 * Cells per side of a BRICK: the unit this mesh re-meshes and caches.
 *
 * The old shape re-meshed the UNION of every box ever dug, as one cube, on every
 * strike. That is O(tunnelLength^3) work per swing for O(1) new geometry, and it
 * is where 27 to 69 ms came from. Bricks are a fixed, disjoint lattice, so a
 * strike re-meshes only the one or two bricks it touched and the rest are served
 * from cache: the cost of a swing stops growing with the length of the tunnel.
 *
 * The rule that keeps neighbouring bricks from seaming or doubling a triangle
 * lives in /core's `surfaceNetsBrick`, not here, because it is exactly the kind
 * of off-by-one that should be stated once and tested.
 */
const BRICK = 8;

/** Floats per vertex in the f32 scratch: position xyz then normal xyz. */
const VERT_STRIDE = 6;

/** One brick's extracted geometry, positions relative to the brick's own corner. */
interface BrickMesh {
  readonly cell: [number, number, number];
  readonly verts: Float32Array;   // stride VERT_STRIDE
  readonly idx: Uint32Array;
}

export interface VoxelMeshStats {
  rebuilds: number;
  /** Vertices and triangles the extraction produced across every cached brick. */
  vertices: number;
  triangles: number;
  lastMs: number;
  boxes: number;
  /** Bricks holding geometry, and how many the last strike had to re-mesh. */
  bricks: number;
  remeshed: number;
  /**
   * Vertices /core emitted in the re-meshed bricks. `dropped` is retained at 0:
   * the edit filter now runs inside /core, so the client never sees the faces it
   * would have discarded. Kept as a field so the HUD and the probes that read it
   * do not have to change shape.
   */
  exposed: number;
  dropped: number;
  /** false with `?voxelskin=0`: the whole isosurface, not only edited cells. */
  editFacesOnly: boolean;
  /** The /core biome the vertex colours were taken from. */
  biome: number;
}

export interface VoxelMeshOptions {
  /** Datum radius and max relief: the two numbers the terrain's own albedo rule
   *  needs to place a vertex in the snow band (BiomePalette.terrainAlbedo). */
  readonly bodyRadiusM: number;
  readonly maxReliefM: number;
  /** The ONE surface. Retained on the options so `?voxelskin=0` and the probes
   *  keep their shape; the filter itself now lives in /core (standing rule 1:
   *  the edit store is what knows which cells are the player's). */
  readonly surfaceRadiusAt: SurfaceRadiusFn;
  /**
   * `?voxelskin=0` meshes the WHOLE isosurface of every re-meshed brick rather
   * than only the cells near an edit, in its own flat brown Lambert. That is the
   * layer under accusation whenever the near field looks wrong, so it has to stay
   * switchable (standing rule 7).
   */
  readonly editFacesOnly: boolean;
}

export class VoxelMesh {
  readonly mesh: THREE.Mesh;
  /** RN-1258. Null on the `?voxelskin=0` diagnostic path. */
  private readonly face: VoxelFaceMaterial | null;
  private readonly ownMaterial: THREE.Material;
  private readonly geo = new THREE.BufferGeometry();
  /** Body-frame anchor the f32 vertices are relative to (standing rule 6). */
  private readonly anchor: Vec3d = { x: 0, y: 0, z: 0 };
  /** Cached extraction per brick, keyed `bx,by,bz`. Empty bricks are dropped. */
  private readonly bricks = new Map<string, BrickMesh>();
  /** Lowest brick corner seen, in cells. The f32 anchor (standing rule 6). */
  private anchorCell: [number, number, number] | null = null;
  readonly stats: VoxelMeshStats = {
    rebuilds: 0, vertices: 0, triangles: 0, lastMs: 0,
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
    // 1.12x, measured). Colour is imported instead of light.
    //
    // flatShading is GONE with the cubes. Surface nets supplies a real gradient
    // normal per vertex, and flat shading would have thrown it away and drawn
    // the smooth surface as facets, which is the artifact this whole change
    // exists to remove.
    //
    // RN-1258: `vertexColors: true` and NOTHING ELSE is what this was. The
    // face now wears a projected material (VoxelFaceMaterial), which keeps the
    // Lambert diffuse term bit-for-bit and adds the maps the surface never
    // had. `?voxelskin=0`'s diagnostic path is deliberately left as the flat
    // brown it was: it is the layer under accusation whenever the near field
    // looks wrong, and a diagnostic that has been art-directed is no longer a
    // diagnostic.
    this.face = opts.editFacesOnly
      ? createVoxelFaceMaterial(voxelFaceOptionsFromQuery()) : null;
    this.ownMaterial = this.face?.material
      ?? new THREE.MeshLambertMaterial({ color: 0x8a7a63 });
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
   * boundary moves a corner belonging to the NEIGHBOURING brick, and skipping
   * that is a one-cell notch in the wall exactly where two bricks meet.
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
   * Ask /core to extract ONE brick and cache it. Positions come back relative to
   * the brick's own corner cell, which is a fixed 64-bit integer, so a cached
   * brick survives an origin rebase and the anchor can move without re-meshing.
   */
  private meshBrick(bx: number, by: number, bz: number): void {
    const count = this.M._of_surface_nets_brick(
      this.bodyHandle, this.editsHandle, bx, by, bz, BRICK,
      bx * BRICK, by * BRICK, bz * BRICK,
      this.opts.editFacesOnly ? 1 : 0,
    );
    const key = `${bx},${by},${bz}`;
    if (count <= 0) { this.bricks.delete(key); return; }
    const idxCount = this.M._of_surface_nets_index_count();
    if (idxCount <= 0) { this.bricks.delete(key); return; }
    this.stats.exposed += count;
    // Standing rule 5: both scratch pointers and both heap views are re-read
    // here, after the call that may have grown the heap, and copied out before
    // anything else can call into WASM.
    const fp = this.M._of_scratch_f32() >> 2;
    const verts = new Float32Array(
      this.M.HEAPF32.subarray(fp, fp + count * VERT_STRIDE));
    const ip = this.M._of_scratch_i32() >> 2;
    const idx = new Uint32Array(this.M.HEAP32.subarray(ip, ip + idxCount));
    const cx = bx * BRICK, cy = by * BRICK, cz = bz * BRICK;
    this.bricks.set(key, { cell: [cx, cy, cz], verts, idx });
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

  /**
   * Concatenate every cached brick into one geometry, rebasing each brick's
   * positions from its own corner onto the shared anchor and offsetting its
   * indices. No WASM call here, so a rebuild costs only the copy.
   */
  private rebuild(): void {
    const aCell = this.anchorCell;
    if (aCell === null) return;
    const cellM = this.M._of_voxel_size();

    let nv = 0, ni = 0;
    for (const b of this.bricks.values()) { nv += b.verts.length / VERT_STRIDE; ni += b.idx.length; }
    const positions = new Float32Array(nv * 3);
    const normals = new Float32Array(nv * 3);
    const indices = new Uint32Array(ni);
    let v = 0, iAt = 0;
    for (const b of this.bricks.values()) {
      const dx = (b.cell[0] - aCell[0]) * cellM;
      const dy = (b.cell[1] - aCell[1]) * cellM;
      const dz = (b.cell[2] - aCell[2]) * cellM;
      const n = b.verts.length / VERT_STRIDE;
      for (let i = 0; i < n; ++i) {
        const s = i * VERT_STRIDE, d = (v + i) * 3;
        positions[d] = b.verts[s] + dx;
        positions[d + 1] = b.verts[s + 1] + dy;
        positions[d + 2] = b.verts[s + 2] + dz;
        normals[d] = b.verts[s + 3];
        normals[d + 1] = b.verts[s + 4];
        normals[d + 2] = b.verts[s + 5];
      }
      for (let i = 0; i < b.idx.length; ++i) indices[iAt + i] = b.idx[i] + v;
      v += n;
      iAt += b.idx.length;
    }

    this.anchor.x = aCell[0] * cellM;
    this.anchor.y = aCell[1] * cellM;
    this.anchor.z = aCell[2] * cellM;

    // One biome for the whole near mesh, from the SAME `of_biome_at` a chunk
    // vertex reads. The mesh spans tens of metres and a biome spans kilometres,
    // so a per-vertex call would buy nothing but calls.
    const ar = Math.hypot(this.anchor.x, this.anchor.y, this.anchor.z) || 1;
    const biomeId = this.M._of_biome_at(
      this.bodyHandle, this.anchor.x / ar, this.anchor.y / ar, this.anchor.z / ar);
    this.stats.biome = biomeId;

    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (this.opts.editFacesOnly) {
      // The DESIGNED relief, not opts.surfaceRadiusAt: the skin colours by
      // depth below the ORIGINAL ground (RN-80, VoxelSkin's note), and the
      // edited surface would report a pit floor at depth zero.
      const attr = faceAttributes(
        positions, normals, [this.anchor.x, this.anchor.y, this.anchor.z],
        this.opts.bodyRadiusM, this.opts.maxReliefM, biomeId,
        (dx, dy, dz) => this.M._of_base_height(this.bodyHandle, dx, dy, dz));
      this.geo.setAttribute('color', new THREE.BufferAttribute(attr.color, 3));
      // RN-1258. One float per vertex, filled in the same loop the colour was.
      this.geo.setAttribute('aRock', new THREE.BufferAttribute(attr.rock, 1));
      // The projection's two live inputs, both pushed HERE rather than on a
      // frame tick, because both can only change on a rebuild: the biome is
      // read one line above and the anchor was just recomputed. See
      // VoxelFaceMaterial's coordinate note for why the anchor matters at all.
      this.face?.setBiome(biomeId);
      this.face?.setAnchor(aCell, cellM);
    }
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geo.computeBoundingSphere();
    this.mesh.visible = indices.length > 0;
    this.place();

    this.stats.rebuilds++;
    this.stats.vertices = nv;
    this.stats.triangles = ni / 3;
    this.stats.bricks = this.bricks.size;
  }

  /** CE-20. The body handle this mesher was built against; see Scatter's. */
  get bodyHandleForAudit(): number { return this.bodyHandle; }

  dispose(): void {
    this.geo.dispose();
    this.ownMaterial.dispose();
    this.mesh.removeFromParent();
  }
}
