// WHERE A MACHINE ACTUALLY GOES, and why it is no longer /core's voxel lattice.
//
// THE BUG THE PLAYER REPORTED was "belts don't smoothly line up with each
// other", and it is the same defect the base-building lane hit and solved
// (GP-22, ARCHITECTURE 15.2 item 102). It is measured, not suspected. The build
// grid was `of_cell_for_pos`, a 1 m cube lattice in the BODY frame, and the
// ground sphere cuts through it obliquely, so one unit step of a cell key covers
// a different amount of GROUND on each axis. Measured on Forge at the spawn,
// with `__of.snapCell`:
//
//     body X   0.5903 m        body Y   1.0167 m        body Z   0.8110 m
//
// A belt tile is a 1.00 m mesh. Laid on those centres, two tiles that the player
// put down side by side OVERLAP by 0.41 m along one axis and leave a 0.017 m
// seam along another, and a run walking a staircase of all three is visibly
// ragged. The same arithmetic is why `chainRuns` kept splitting one run into
// three: the tile ahead was not where a metre said it was.
//
// THE FIX IS TO REUSE WHAT ALREADY WORKS rather than to invent a second answer.
// A machine now snaps to a SITE, exactly as a foundation does: a local metric
// tangent frame whose ORIGIN is a world lattice cell centre, inside which the
// spacing is exactly the module the assets ship. Adjacent tiles are then 1.000 m
// apart by construction. It also means a base and a belt run finally agree about
// where things are, because they are the same frame, which matters the first
// time anybody runs a belt into a building.
//
// The height is still the ground's, not the site plane's: a machine follows the
// terrain (a belt over a rise must go over it), so the site fixes the two
// TANGENT coordinates and `of_surface_radius` fixes the radius. Standing rule 1,
// one more time.

import * as THREE from 'three';
import { SITE_REACH_M, localOf, worldOf, type Site, type StructureModule }
  from './StructureGrid.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * The tile pitch a MACHINE stands on, in metres. It is deliberately NOT
 * `module.cellM`.
 *
 * A machine and a foundation share the site FRAME, which is what GP-27 asked
 * for and what made belts line up; they do not share the CELL SIZE, because
 * they are different sizes of thing. DW-32 took the structural module from 1 m
 * to 4 m, and machines went with it because this file was reading `cellM`: belt
 * tiles ended up 4 m apart, so `FactoryWiring.chainRuns` correctly stopped
 * seeing them as neighbours and `probes/controls.js` measured one dragged run
 * of four tiles reported as FOUR transport lines, `runs [1,1,1,1]`. The belt
 * mesh is a 1.00 m tile and the miner, smelter and assembler are built to it,
 * so 1.00 is what the assets ship and 1.00 is what this is.
 */
export const MACHINE_TILE_M = 1.0;

/** What a placement needs of the site registry. A port, so Factory does not
 *  have to know the whole base-building module. */
export interface SiteHost {
  readonly module: StructureModule;
  nearestSite(p: Vec3d): Site | null;
  prospectiveSite(p: Vec3d): Site;
  adoptSite(s: Site): void;
  groundRadius(x: number, y: number, z: number): number;
}

/**
 * A machine cell: which site, and which square of its metric grid.
 *
 * `prospective` means the site does not exist yet: it was founded on the lattice
 * cell under the query point purely so the ghost has a frame to stand in, and it
 * will only become real if something is placed. It is NOT a detail a consumer may
 * ignore, which is why it sits on the address rather than being inferred, and
 * why it appears on the ghost report. See `siteAt`.
 */
export interface MachineAddr {
  site: Site;
  i: number;
  j: number;
  prospective: boolean;
}

/**
 * The occupancy key. Namespaced by site, or two sites would share cell 0,0.
 *
 * FS-19: A PROSPECTIVE ADDRESS IS KEYED BY THE CELL IT WAS FOUNDED ON, not by
 * the site id. An unadopted site's id is whatever the registry would hand out
 * next, so EVERY unadopted site in the world answers `m1`, and a prospective
 * site is centred on the query point so the address inside it is always 0,0 (or
 * -1,0 on a boundary). Two aim points eight metres apart therefore returned the
 * identical key `m1:0,0`. Three separate probes tripped over that independently
 * and one of them concluded "no lattice axis carries a chainable line", which was
 * simply false. The founding cell discriminates, and nothing persists in this
 * form: `Factory.stage` claims the site (which adopts it) before it keys a
 * placement, so a saved `Placed.cell` is always the `m<id>` shape it always was.
 */
export function machineCellKey(a: MachineAddr): string {
  return a.prospective ? `m~${a.site.cell}:${a.i},${a.j}`
    : `m${a.site.id}:${a.i},${a.j}`;
}

/** The site whose grid reaches `p`, or a fresh one founded on the lattice cell
 *  containing it. NOT adopted: a ghost must not found sites by being looked at. */
export function siteAt(host: SiteHost, p: Vec3d): { site: Site; prospective: boolean } {
  const near = host.nearestSite(p);
  return near !== null ? { site: near, prospective: false }
    : { site: host.prospectiveSite(p), prospective: true };
}

/** Which square of a site's grid a point falls in. */
export function addressIn(site: Site, _m: StructureModule, p: Vec3d,
                          prospective = false): MachineAddr {
  const l = localOf(site, p, new THREE.Vector3());
  return {
    site, prospective,
    i: Math.floor(l.x / MACHINE_TILE_M), j: Math.floor(l.y / MACHINE_TILE_M),
  };
}

/**
 * Where a machine at this address stands, and which way is up there.
 *
 * The two tangent coordinates are the site's, EXACT to the module; the radius is
 * the oracle's. That split is the whole fix: spacing comes from a metric frame
 * that cannot drift, height comes from the one surface authority.
 */
export function anchorIn(host: SiteHost, a: MachineAddr):
{ pos: Vec3d; up: THREE.Vector3 } {
  const c = MACHINE_TILE_M;
  const p = worldOf(a.site, (a.i + 0.5) * c, (a.j + 0.5) * c, 0,
    { x: 0, y: 0, z: 0 });
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  const up = new THREE.Vector3(p.x / r, p.y / r, p.z / r);
  const ground = host.groundRadius(p.x, p.y, p.z);
  return {
    pos: { x: up.x * ground, y: up.y * ground, z: up.z * ground },
    up,
  };
}

/**
 * The site tangent axis nearest `dir`, then `quarters` quarter turns off it.
 *
 * The axes are the SITE's east and north, not a basis rebuilt per tile, so every
 * tile of a run shares one heading exactly rather than to within whatever the
 * local frame reconstruction happened to give. A belt at 37 degrees has no cell
 * ahead of it to chain to, which is why this is four directions and not a yaw.
 */
export function headingIn(site: Site, dir: Vec3d, quarters: number): THREE.Vector3 {
  const de = dir.x * site.east.x + dir.y * site.east.y + dir.z * site.east.z;
  const dn = dir.x * site.north.x + dir.y * site.north.y + dir.z * site.north.z;
  let axis: THREE.Vector3;
  if (Math.abs(de) >= Math.abs(dn)) {
    axis = de >= 0 ? site.east.clone() : site.east.clone().negate();
  } else {
    axis = dn >= 0 ? site.north.clone() : site.north.clone().negate();
  }
  return axis.applyAxisAngle(site.up, (quarters % 4) * Math.PI * 0.5).normalize();
}

/** The address one step from `a` towards `to`, or null when they are the same. */
export function stepToward(a: MachineAddr, to: MachineAddr): MachineAddr | null {
  if (a.site.id !== to.site.id) return null;
  const di = to.i - a.i;
  const dj = to.j - a.j;
  if (di === 0 && dj === 0) return null;
  // The dominant axis first, so a drag that wandered diagonally comes out as an
  // L of straight runs rather than as a staircase of corners.
  if (Math.abs(di) >= Math.abs(dj)) {
    return { site: a.site, i: a.i + Math.sign(di), j: a.j,
      prospective: a.prospective };
  }
  return { site: a.site, i: a.i, j: a.j + Math.sign(dj),
    prospective: a.prospective };
}

/** Is this point still inside a site's reach? Past it, a new site is founded. */
export function withinSite(site: Site, p: Vec3d): boolean {
  const l = localOf(site, p, new THREE.Vector3());
  return Math.hypot(l.x, l.y) < SITE_REACH_M;
}
