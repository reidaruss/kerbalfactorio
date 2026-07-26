// THE surface answer. DECISIONS.md standing rule 1: no other module re-derives
// terrain height or solidity, ever. Every call here is a synchronous, allocation
// free trip into WASM measured at single-digit microseconds (WASM-BRIDGE.md 7.2),
// so it is safe to call inside the frame.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64, scratchI32 } from '../sim/wasm/heap.js';
import type { PlanetBody, Vec3d } from './PlanetBody.js';

export class SurfaceOracle {
  /** Voxel edit set handle; 0 means "the pristine procedural world". */
  editsHandle = 0;

  constructor(private readonly M: OfCoreModule, readonly body: PlanetBody) {}

  /** The designed surface relief in metres. baseHeight === sampleDesignedHeight (WG-21). */
  baseHeight(dx: number, dy: number, dz: number): number {
    return this.M._of_base_height(this.body.handle, dx, dy, dz);
  }

  /** Relief after voxel lowering. Identical to baseHeight when no edits are bound. */
  surfaceHeight(dx: number, dy: number, dz: number): number {
    return this.M._of_surface_height(this.body.handle, this.editsHandle, dx, dy, dz);
  }

  /** Distance from the body centre to the walkable surface, in metres. */
  surfaceRadius(dx: number, dy: number, dz: number): number {
    return this.M._of_surface_radius(this.body.handle, this.editsHandle, dx, dy, dz);
  }

  biomeAt(dx: number, dy: number, dz: number): number {
    return this.M._of_biome_at(this.body.handle, dx, dy, dz);
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.M._of_solid_at(this.body.handle, this.editsHandle, x, y, z) !== 0;
  }

  /**
   * Voxel cell size in metres. /core quantizes with `floor(pos / kVoxelSizeM)`,
   * so a cell spans [c * size, (c + 1) * size); anything resolving against a
   * voxel FACE needs this number and must not assume 1.0.
   */
  voxelSizeM(): number { return this.M._of_voxel_size(); }

  solidCell(cx: number, cy: number, cz: number): boolean {
    return this.M._of_solid_cell(this.body.handle, this.editsHandle, cx | 0, cy | 0, cz | 0) !== 0;
  }

  /**
   * IS THIS POINT INSIDE THE WORLD AS DRAWN? DW-26's second shape of solid,
   * stated for anything that marches a ray at what the player can see.
   *
   * `solidAt` answers with the 1 m lattice shell, which is the right answer for
   * the mesher and the wrong one for an aim: the shell disagrees with the
   * smooth `surfaceRadius` by up to half a cell diagonal in BOTH directions, so
   * a ray stops on invisible rock in front of the ground (measured: 17 of 40
   * aims, up to 3.8 m short) or sails through visible ground into it.
   *
   * The predicate is `solidAt` with its ONE quantised term swapped for the
   * smooth surface, and the two edit sets left exactly as they are:
   *
   *     inside = added(cell) || (r <= surfaceRadius(dir) && !removed(cell))
   *
   * so a tunnel is still hollow (its cells are removed), a tunnel WALL is still
   * rock (below the surface, not removed), and a placed slab above the fill cap
   * is still there. With no edits bound it collapses to `r <= surfaceRadius`,
   * which is the surface every other consumer already reads (standing rule 1).
   */
  solidForAim(x: number, y: number, z: number): boolean {
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) return true;
    if (r > this.surfaceRadius(x / r, y / r, z / r)) return this.addedAt(x, y, z);
    return !this.removedAt(x, y, z);
  }

  /** Was the cell containing this point CARVED by the player? */
  removedAt(x: number, y: number, z: number): boolean {
    if (this.editsHandle === 0) return false;
    const c = this.cellOf(x, y, z);
    return this.M._of_edits_is_removed_cell(this.editsHandle, c[0], c[1], c[2]) !== 0;
  }

  /** Was the cell containing this point PLACED by the player? */
  addedAt(x: number, y: number, z: number): boolean {
    if (this.editsHandle === 0) return false;
    const c = this.cellOf(x, y, z);
    return this.M._of_edits_is_added_cell(this.editsHandle, c[0], c[1], c[2]) !== 0;
  }

  private cellOf(x: number, y: number, z: number): Int32Array {
    this.M._of_cell_for_pos(x, y, z);
    // Standing rule 5: the view is taken after the call that filled it.
    return scratchI32(this.M, 3);
  }

  /** Unit direction for a geodetic lat/lon in RADIANS. */
  dirFromLatLon(lat: number, lon: number, out: Vec3d): Vec3d {
    this.M._of_latlon_to_dir(lat, lon);
    const s = scratchF64(this.M, 3);
    out.x = s[0]; out.y = s[1]; out.z = s[2];
    return out;
  }

  /**
   * Body-frame position at lat/lon (RADIANS) and altitude above the surface.
   *
   * NOT of_observer_latlon_alt. That shim helper is built on sampleRawHeight,
   * which is the pre-design heightfield: at lat 48 / lon 18 on Forge it returns
   * 4,075.51 m where the DESIGNED surface (baseHeight === sampleDesignedHeight,
   * WG-21) is 6,520.81 m, so an "altitude 60 m" observer starts 2.4 km
   * underground and the terrain mesh renders entirely behind the camera. This
   * is exactly the multiple-surfaces failure D-011 exists to prevent, so the
   * position is derived from the ONE surface authority instead. Reported to
   * core-engine as a bridge gap; see docs/web/ARCHITECTURE.md section 4.2.
   */
  observerPos(lat: number, lon: number, altM: number, out: Vec3d): Vec3d {
    this.dirFromLatLon(lat, lon, out);
    const r = this.surfaceRadius(out.x, out.y, out.z) + altM;
    out.x *= r; out.y *= r; out.z *= r;
    return out;
  }

  latLonFromDir(dx: number, dy: number, dz: number): { lat: number; lon: number } {
    this.M._of_dir_to_latlon(dx, dy, dz);
    const s = scratchF64(this.M, 2);
    return { lat: s[0], lon: s[1] };
  }

  /** Altitude of a body-frame position above the designed surface, in metres. */
  altitudeOf(p: Vec3d): number {
    const r = Math.hypot(p.x, p.y, p.z);
    if (r < 1e-6) return -this.body.radiusM;
    return r - this.surfaceRadius(p.x / r, p.y / r, p.z / r);
  }
}
