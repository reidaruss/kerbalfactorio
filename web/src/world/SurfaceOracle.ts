// THE surface answer. DECISIONS.md standing rule 1: no other module re-derives
// terrain height or solidity, ever. Every call here is a synchronous, allocation
// free trip into WASM measured at single-digit microseconds (WASM-BRIDGE.md 7.2),
// so it is safe to call inside the frame.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import { scratchF64 } from '../sim/wasm/heap.js';
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

  solidCell(cx: number, cy: number, cz: number): boolean {
    return this.M._of_solid_cell(this.body.handle, this.editsHandle, cx | 0, cy | 0, cz | 0) !== 0;
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
