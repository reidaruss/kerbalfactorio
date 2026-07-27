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
import { FOOTPRINT, type BuildKind, type Placed } from './FactoryKinds.js';
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
  /** GP-39: the top of a deck covering this site-local point, in metres of
   *  site-local up, or null for bare ground. See `Structures.deckTopAt`. */
  deckTopAt(site: Site, e: number, n: number, nearU?: number): number | null;
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
  /**
   * GP-39: the aim's own height over the site plane, metres, when there was an
   * aim to read it from.
   *
   * It is the only thing that can tell a furnace aimed at the ground floor of a
   * two-storey base from one aimed at the balcony, because a machine cell is a
   * SQUARE and a base is a stack of them. Optional because half the addresses in
   * this system are synthesised (a drag fill, a re-key after a site is adopted)
   * and have no aim behind them; those fall back to the highest deck, which is
   * the right answer for the single-storey base that is every base today.
   */
  u?: number;
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

/**
 * The inverse of `machineCellKey`, for a REAL (adopted) key. Null otherwise.
 *
 * Here rather than in `Factory` so the key's FORMAT lives in exactly one file,
 * beside the function that writes it. A second place that knew how to spell
 * `m1:2,-3` would be free to disagree with this one, and a saved placement is
 * keyed in this form, so the disagreement would be permanent.
 */
export function parseMachineCellKey(cell: string):
{ site: number; i: number; j: number } | null {
  const m = /^m(\d+):(-?\d+),(-?\d+)$/.exec(cell);
  return m === null ? null
    : { site: Number(m[1]), i: Number(m[2]), j: Number(m[3]) };
}

/**
 * GP-49: DO THESE TWO MACHINES OVERLAP?
 *
 * Both stand on the SAME site grid, axis-aligned, `f` cells across and CENTRED
 * on their cell (`anchorIn` puts them at `(i + 0.5) * tile`). Two axis-aligned
 * squares overlap when they overlap on BOTH axes, and a centre separation of
 * `d` cells clears a pair of widths `fa` and `fb` when `2*d >= fa + fb`. So two
 * 2 m machines need their centres two cells apart, and one cell apart is half
 * of each one standing inside the other.
 *
 * MEASURED, and this is the whole defect. A burner generator went down at
 * `m1:1,1` and an electric smelter aimed 15 degrees away landed at `m1:1,2`,
 * ONE CELL over: offset 1.0000 m total, tangent 1.0000 m, up 8.3e-7 m. The
 * roadmap recorded that as "one metre ABOVE it" from a world-frame y that moved
 * by 1.00 m, but at a 600 km radius the y axis is very nearly TANGENTIAL there
 * (the world dy over the step was in fact 0.025 m), so the machine was never in
 * the air: it was inside its neighbour. The consequence the player sees is the
 * same either way and is worse than a refusal, because `Factory.pick` resolves
 * an aim to the best-centred building within 3.5 m, so one of the two can never
 * again be aimed at, opened, fed or demolished. It was paid for and it is gone.
 */
export function footprintsOverlap(ai: number, aj: number, fa: number,
                                  bi: number, bj: number, fb: number): boolean {
  const reach = fa + fb;
  return Math.abs(ai - bi) * 2 < reach && Math.abs(aj - bj) * 2 < reach;
}

/**
 * The placed machine this placement would stand INSIDE, or null (GP-49).
 *
 * ONLY BETWEEN THINGS TWO CELLS WIDE, and that is deliberate rather than a
 * simplification. Belts and poles are one cell, and a belt whose whole purpose
 * is to run INTO a smelter must be able to sit against it; applying the rule to
 * them would refuse the feed the power system exists to make possible (GP-50's
 * conclusion, that a belt is the only way to address a dense base at all). So
 * the rule is exactly the one the defect needs: two two-metre boxes may not
 * occupy the same two metres.
 *
 * Reads each placed machine's address by PARSING its own key rather than
 * re-snapping its position, because re-snapping is a WASM call per machine per
 * ghost frame and the key is already the authority the save is written with.
 */
export function machineClash(placed: readonly Placed[], kind: BuildKind,
                             addr: MachineAddr | undefined): Placed | null {
  if (addr === undefined || addr.prospective) return null;
  const fa = FOOTPRINT[kind];
  if (fa < 2) return null;
  for (const p of placed) {
    const fb = FOOTPRINT[p.kind];
    if (fb < 2) continue;
    const b = parseMachineCellKey(p.cell);
    if (b === null || b.site !== addr.site.id) continue;
    if (footprintsOverlap(addr.i, addr.j, fa, b.i, b.j, fb)) return p;
  }
  return null;
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
    site, prospective, u: l.z,
    i: Math.floor(l.x / MACHINE_TILE_M), j: Math.floor(l.y / MACHINE_TILE_M),
  };
}

/**
 * Where a machine at this address stands, and which way is up there.
 *
 * The two tangent coordinates are the site's, EXACT to the module; the height is
 * the ORACLE's on bare ground and the DECK's over a base. That split is the
 * whole fix: spacing comes from a metric frame that cannot drift, height comes
 * from the one authority that owns the surface the machine is actually on.
 *
 * GP-39, and the complaint it answers is "items like smelters dont sit ontop of
 * the foundation". They did not, because every machine took its radius from
 * `of_surface_radius` and a foundation deliberately does not write to the voxel
 * layer (DW-24), so a smelter placed on a 0.50 m deck sank half a metre into it
 * and stood on the soil underneath. The deck top is asked for by ADDRESS rather
 * than by raycast so the answer is exact: it is the level's base plane plus the
 * asset's own `socket_top` height, in the frame both parts already share.
 *
 * On a deck the normal is the SITE's up rather than the local radial. Over a
 * 64 m site those differ by 1e-4 rad, which is invisible, but the deck is a
 * plane and a machine standing on a plane should be flush with it rather than
 * with the sphere the plane is tangent to.
 */
export function anchorIn(host: SiteHost, a: MachineAddr):
{ pos: Vec3d; up: THREE.Vector3; onDeck: boolean } {
  const c = MACHINE_TILE_M;
  const e = (a.i + 0.5) * c, n = (a.j + 0.5) * c;
  const deck = host.deckTopAt(a.site, e, n, a.u);
  if (deck !== null) {
    return { pos: worldOf(a.site, e, n, deck, { x: 0, y: 0, z: 0 }),
      up: a.site.up.clone(), onDeck: true };
  }
  const p = worldOf(a.site, e, n, 0, { x: 0, y: 0, z: 0 });
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  const up = new THREE.Vector3(p.x / r, p.y / r, p.z / r);
  const ground = host.groundRadius(p.x, p.y, p.z);
  return {
    pos: { x: up.x * ground, y: up.y * ground, z: up.z * ground },
    up, onDeck: false,
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
      prospective: a.prospective, u: a.u };
  }
  return { site: a.site, i: a.i, j: a.j + Math.sign(dj),
    prospective: a.prospective, u: a.u };
}

/** Is this point still inside a site's reach? Past it, a new site is founded. */
export function withinSite(site: Site, p: Vec3d): boolean {
  const l = localOf(site, p, new THREE.Vector3());
  return Math.hypot(l.x, l.y) < SITE_REACH_M;
}
