// THE RULES: where a structural part would go, and whether it would be allowed.
//
// Split out of Structures.ts because they are a different kind of thing. That
// file owns what exists in the world; this one owns the questions asked before
// anything is allowed to exist, in the order a player needs the answers:
//
//   0. GP-37: is there a published SOCKET near the aim to snap to? A part
//      prefers an existing part's socket to the bare grid (StructureSnap.ts).
//   1. is the cell already built on?
//   2. is there anything to build ON (a deck under a wall, a storey under a
//      floor)?
//   3. DW-24: is the ground under the footprint flat enough to rest on, given
//      that GP-38 lets a NEIGHBOUR carry the float side of that question?
//   4. is the cost in the pack?
//
// Every one of them produces a SENTENCE, and the sentence is on the ghost before
// the key is pressed rather than in a toast after it. Refusal 3 names the
// levelling tool, because being refused is how a player discovers it exists.

import * as THREE from 'three';
import { CANTILEVER_STOREYS, MAX_CANTILEVER_CELLS } from './StructureTolerance.js';
import { SNAP_FRACTION, addrFromSocket, nearestSocket } from './StructureSnap.js';
import { orient } from './Grid.js';
import { labelOf } from '../player/Bindings.js';
import { MAX_LEVEL, addrKey, addressAt, anchorOf, deckKey, footprintOf,
  isDeck, wallKey, type Addr, type Site, type StructureKind }
  from './StructureGrid.js';
import { FREE_KEY, type StructurePart, type Structures } from './Structures.js';
import type { HudTarget } from '../ui/GameHud.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** Aim march: step and reach, metres. Longer than a machine's, because a base is
 *  laid out by looking across it, not by standing on every cell of it.
 *
 *  DW-32 DOUBLED IT. 12 m was twelve cells at the 1 m module and is three at the
 *  4 m one, which is not enough to reach the far edge of the cell you are aiming
 *  at from inside a room you have already walled. 24 m is six cells: the whole
 *  of a 20 x 20 m five-cell room from its own doorway, without walking. The
 *  march still steps at 0.2 m, so this is 120 oracle samples rather than 60, and
 *  it stops at the first hit either way. */
const STEP_M = 0.2;
const REACH_M = 24.0;
/** Where the ghost falls back to when the aim meets neither ground nor build.
 *  A cell and a half, keeping the quarter-of-reach ratio 3.0 had against 12. */
const FALLBACK_M = 6.0;

export interface StructureTarget {
  kind: StructureKind;
  site: Site | null;
  addr: Addr | null;
  key: string;
  pos: Vec3d;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  ok: boolean;
  reason: string;
  /** DW-24: the worst signed deviation of the ground from the base plane.
   *  Positive buries a corner, negative leaves it hanging. */
  unevennessM: number;
  freePlaced: boolean;
  /** GP-37: the socket this address came from, `"#12 socket_edge_e"`, or null
   *  when the address is the bare grid's. On the ghost, so a player can see
   *  WHAT it caught rather than inferring it from where the preview jumped. */
  snapped: string | null;
  /** GP-38: cells from the nearest deck that rests on the ground. 0 is a deck
   *  standing on its own ground, n >= 1 is carried by a neighbour, and -1 is a
   *  run that has reached past `MAX_CANTILEVER_CELLS`. */
  carryRun: number;
}

/**
 * What the crosshair SAYS while a structural part is in hand.
 *
 * The reason is on screen while the player is still aiming, not flashed after a
 * refused press, because DW-24's whole argument is that being refused is how the
 * levelling tool gets discovered. A message that only appears once you have
 * already pressed the key teaches nothing.
 */
export function ghostPrompt(t: StructureTarget | null): HudTarget | null {
  if (t === null) return null;
  const held = t.snapped === null ? '' : `  [snapped to ${t.snapped}]`;
  return {
    name: `${t.kind}${t.freePlaced ? '  (free)' : ''}${held}  ${t.reason}`,
    fraction: 0, empty: !t.ok, distanceM: 0,
    action: `${labelOf('use')} place  (hold to drag)`
      + `    ${labelOf('rotate')} turn    ${labelOf('freeSnap')} snap`,
  };
}

/**
 * March the aim against the ground AND against what is already built, and take
 * whichever comes first. Without the second half a player aiming at the top of a
 * foundation would be told about the soil underneath it, and no upper storey
 * could ever be aimed at.
 */
export function aimPoint(s: Structures, ray: { origin: Vec3d; dir: Vec3d }): Vec3d {
  const o = ray.origin, d = ray.dir;
  let tGround = -1;
  for (let t = 0.6; t <= REACH_M; t += STEP_M) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.hypot(x, y, z) <= s.groundRadius(x, y, z)) { tGround = t; break; }
  }
  const tSolid = s.bodies.rayHit(o, d, REACH_M, STEP_M);
  let t = FALLBACK_M;
  if (tGround >= 0 && tSolid >= 0) t = Math.min(tGround, tSolid);
  else if (tGround >= 0) t = tGround;
  else if (tSolid >= 0) t = tSolid;
  return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
}

/** Where a part would go and whether it would be accepted. */
export function resolveTarget(s: Structures, kind: StructureKind,
                              ray: { origin: Vec3d; dir: Vec3d },
                              flip: number, freePlaced: boolean): StructureTarget {
  const hit = aimPoint(s, ray);
  if (freePlaced) return freeTarget(s, kind, hit, ray.dir, flip);
  const site = s.nearestSite(hit) ?? s.prospectiveSite(hit);
  // GP-37. The bare grid answers first, then a socket is allowed to overrule it.
  // The grid is kept as the fallback rather than replaced, because a player
  // aiming at open ground fifty metres from the base must still get an address.
  let addr = addressAt(site, s.module, kind, hit, flip);
  let snapped: string | null = null;
  const sock = nearestSocket(s.parts, s.sockets, hit,
    s.module.cellM * SNAP_FRACTION);
  if (sock !== null) {
    const alt = addrFromSocket(site, kind, sock, flip);
    // Only when the proposal is FREE. A socket that offers an occupied cell has
    // nothing to add: the grid's own answer already says "already built here",
    // and overruling it would move the refusal to a cell the player is not
    // looking at.
    if (alt !== null && !s.has(addrKey(site.id, alt))) {
      addr = alt;
      snapped = `#${sock.part.id} ${sock.name}`;
    }
  }
  const a = anchorOf(site, s.module, addr);
  const t: StructureTarget = {
    kind, site, addr, key: addrKey(site.id, addr), pos: a.pos, up: site.up.clone(),
    fwd: a.fwd, quat: orient(site.up, a.fwd), ok: true, reason: '',
    unevennessM: 0, freePlaced: false, snapped, carryRun: 0,
  };
  if (s.has(t.key)) { t.ok = false; t.reason = 'already built here'; return t; }
  if (addr.level > MAX_LEVEL) { t.ok = false; t.reason = 'too high'; return t; }
  if (!supported(s, site, addr)) {
    t.ok = false;
    t.reason = isDeck(addr.kind) ? 'nothing to build on up here'
      : 'a wall needs a deck under it';
    return t;
  }
  if (addr.level === 0) groundOrCarried(s, t, site, addr);
  if (t.ok) checkCost(s, t);
  return t;
}

/**
 * GP-38 (DW-32). Ask the ground, unless a NEIGHBOUR is answering for it.
 *
 * `supported()` has always returned true for any level-0 deck, which is right:
 * a foundation may found itself anywhere. What was missing is the other half of
 * DW-32, that a deck with a deck beside it is HELD UP by it and so may hang
 * where a lone one may not. Only the float side is relaxed. Bury stays at the
 * deck thickness, because a neighbour can carry weight and cannot move soil.
 */
function groundOrCarried(s: Structures, t: StructureTarget, site: Site,
                         addr: Addr): void {
  if (!isDeck(addr.kind)) { checkGround(s, t, s.floatToleranceM); return; }
  const run = carryRun(s, site, addr);
  t.carryRun = run;
  if (run === 0) { checkGround(s, t, s.floatToleranceM); return; }
  if (run < 0) {
    t.ok = false;
    t.reason = `nothing under this and no solid ground within `
      + `${MAX_CANTILEVER_CELLS} cells, bring the base back down`;
    return;
  }
  checkGround(s, t, s.cantileverFloatM);
}

/**
 * How many cells this address stands from the nearest deck that genuinely rests
 * on the ground. 0 when it has no deck neighbour at all, -1 when it has one but
 * every route back to solid ground is longer than `MAX_CANTILEVER_CELLS`.
 *
 * A breadth-first walk rather than a stored depth, and that is a deliberate
 * trade. A stored depth would be one integer per part, a save-schema change and
 * a second thing that can go stale the moment the terrain under a base is dug
 * out; this recomputes from the parts and the LIVE oracle every time, so a base
 * whose hillside has been mined away is re-judged honestly. It costs at most a
 * few dozen oracle samples per ghost frame and short-circuits on the first
 * grounded deck, which is the common case for every base that is not a bridge.
 */
function carryRun(s: Structures, site: Site, a: Addr): number {
  let frontier: [number, number][] = [[a.i, a.j]];
  const seen = new Set<string>([`${a.i},${a.j}`]);
  for (let d = 1; d <= MAX_CANTILEVER_CELLS; ++d) {
    const next: [number, number][] = [];
    let touched = false;
    for (const [i, j] of frontier) {
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, k = `${ni},${nj}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const p = deckAt(s, site, ni, nj, a.level);
        if (p === null) continue;
        touched = true;
        if (restsOnGround(s, p)) return d;
        next.push([ni, nj]);
      }
    }
    if (d === 1 && !touched) return 0;
    frontier = next;
  }
  return -1;
}

/** The deck part at a cell of this site's level, or null. */
function deckAt(s: Structures, site: Site, i: number, j: number,
                level: number): StructurePart | null {
  const p = s.partAt(deckKey(site.id, i, j, level));
  return p !== undefined && p.addr !== null ? p : null;
}

/**
 * Does this placed deck rest on the ground, by the ORDINARY float bound?
 *
 * Re-measured against the live oracle rather than remembered, so a deck that was
 * grounded when it was placed and has since been undermined stops carrying its
 * neighbours. That is the same argument GP-28 made about reading the live edit
 * set: a build system that remembers the terrain is a second definition of it.
 */
function restsOnGround(s: Structures, p: StructurePart): boolean {
  const v = new THREE.Vector3();
  for (const [lx, lz] of footprintOf(s.module, p.kind)) {
    v.set(lx, 0, lz).applyQuaternion(p.quat);
    const x = p.pos.x + v.x, y = p.pos.y + v.y, z = p.pos.z + v.z;
    if (s.groundRadius(x, y, z) - Math.hypot(x, y, z) < -s.floatToleranceM) {
      return false;
    }
  }
  return true;
}

/** One storey of clear air under a carried deck. See StructureTolerance.ts. */
export function cantileverFloatM(storeyM: number): number {
  return storeyM * CANTILEVER_STOREYS;
}

/**
 * Free placement: the same parts with the rounding taken out. The ground rule
 * still applies, because DW-24 is about resting on terrain and not about the
 * grid, and a part dropped across a boulder would float either way.
 */
function freeTarget(s: Structures, kind: StructureKind, hit: Vec3d, dir: Vec3d,
                    flip: number): StructureTarget {
  const up = new THREE.Vector3(hit.x, hit.y, hit.z).normalize();
  const fwd = new THREE.Vector3(dir.x, dir.y, dir.z);
  fwd.addScaledVector(up, -fwd.dot(up));
  if (fwd.lengthSq() < 1e-9) fwd.set(-up.y, up.x, 0);
  fwd.normalize().applyAxisAngle(up, (flip % 4) * Math.PI * 0.5);
  const r = s.groundRadius(up.x, up.y, up.z);
  const t: StructureTarget = {
    kind, site: null, addr: null, key: FREE_KEY,
    pos: { x: up.x * r, y: up.y * r, z: up.z * r },
    up, fwd, quat: orient(up, fwd), ok: true, reason: '', unevennessM: 0,
    freePlaced: true, snapped: null, carryRun: 0,
  };
  // No cantilever off the grid: a carried deck is carried by an ADDRESS, and a
  // freely placed part has none, so there is nothing to be adjacent to.
  checkGround(s, t, s.floatToleranceM);
  if (t.ok) checkCost(s, t);
  return t;
}

/**
 * Is there something under this address? A wall's base IS the deck top, so its
 * own level must already have a deck on one of the two cells its edge divides.
 * A deck above ground level needs the storey below it: either a deck directly
 * under it or a wall on one of its four edges holding it up.
 */
function supported(s: Structures, site: Site, a: Addr): boolean {
  if (isDeck(a.kind)) {
    if (a.level === 0) return true;
    const b = a.level - 1;
    return hasDeck(s, site, a.i, a.j, b)
      || s.has(wallKey(site.id, 0, a.i, a.j, b))
      || s.has(wallKey(site.id, 0, a.i, a.j + 1, b))
      || s.has(wallKey(site.id, 1, a.i, a.j, b))
      || s.has(wallKey(site.id, 1, a.i + 1, a.j, b));
  }
  return a.axis === 0
    ? hasDeck(s, site, a.i, a.j, a.level) || hasDeck(s, site, a.i, a.j - 1, a.level)
    : hasDeck(s, site, a.i, a.j, a.level) || hasDeck(s, site, a.i - 1, a.j, a.level);
}

function hasDeck(s: Structures, site: Site, i: number, j: number,
                 level: number): boolean {
  return s.partAt(deckKey(site.id, i, j, level)) !== undefined;
}

/**
 * DW-24. Sample the oracle under the part's own footprint and compare each
 * reading with the base plane the part would stand on.
 *
 * The samples are in the PART's local frame, so a freely placed part is judged
 * by exactly the same rule as a snapped one. The deviation is signed, and the
 * two signs are judged against DIFFERENT bounds: ground BELOW the base leaves a
 * visible gap under a hovering slab and is held to `floatToleranceM`, ground
 * ABOVE it disappears inside the slab and is allowed all the way to the deck
 * thickness. See Structures.ts for why that is not a fudge.
 */
function checkGround(s: Structures, t: StructureTarget, floatM: number): void {
  let low = 0;
  let high = 0;
  const v = new THREE.Vector3();
  for (const [lx, lz] of footprintOf(s.module, t.kind)) {
    v.set(lx, 0, lz).applyQuaternion(t.quat);
    const x = t.pos.x + v.x, y = t.pos.y + v.y, z = t.pos.z + v.z;
    const dev = s.groundRadius(x, y, z) - Math.hypot(x, y, z);
    if (dev < low) low = dev;
    if (dev > high) high = dev;
  }
  // The reported number is whichever side is closest to refusing, so a probe
  // and a player are both looking at the binding constraint.
  const floatSlack = -low / floatM;
  const burySlack = high / s.buryToleranceM;
  t.unevennessM = floatSlack >= burySlack ? low : high;
  if (floatSlack <= 1 && burySlack <= 1) return;
  t.ok = false;
  const gap = floatSlack > burySlack
    ? `it would hang ${(-low).toFixed(2)} m clear`
    : `the ground stands ${high.toFixed(2)} m into it`;
  t.reason = `ground too uneven here, ${gap}, level it with Q`;
}

function checkCost(s: Structures, t: StructureTarget): void {
  if (s.defFor(t.kind) === null) {
    t.ok = false; t.reason = 'no structural content loaded'; return;
  }
  if (s.canAfford(t.kind)) { t.reason = s.costText(t.kind); return; }
  t.ok = false;
  t.reason = `need ${s.costText(t.kind)}`;
}

/**
 * Commit a resolved target. Returns the part, or null if it was refused.
 * The cost is paid FIRST and the part only built on success, so a refused
 * placement can never eat the stone.
 */
export function commitTarget(s: Structures, t: StructureTarget | null) {
  if (t === null || !t.ok) {
    if (t !== null) {
      s.refusals++;
      if (t.reason.startsWith('ground too uneven')) s.unevenRefusals++;
    }
    return null;
  }
  const def = s.defFor(t.kind);
  if (def === null || !s.pay(t.kind)) { s.refusals++; return null; }
  if (t.site !== null) s.adoptSite(t.site);
  const p = s.adopt(t.kind, def, t.site?.id ?? -1, t.addr, t.key, t.pos, t.up,
    t.fwd);
  s.placements++;
  return p;
}
