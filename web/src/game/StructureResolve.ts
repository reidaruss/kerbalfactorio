// Where a part would go and whether it would be accepted, plus committing it.
// Split out of StructurePlacement.ts (line-cap batch 2, BT-285): everything
// here is reached from `resolveTarget`/`commitTarget` and reached from
// nothing in StructureAim.ts, so the two groups share no mutable state.

import * as THREE from 'three';
import { CANTILEVER_STOREYS, MAX_CANTILEVER_CELLS } from './StructureTolerance.js';
import { SNAP_FRACTION, addrFromSocket, nearestSocket } from './StructureSnap.js';
import { orient } from './Grid.js';
import { aimHit } from './StructureAim.js';
import { MAX_LEVEL, addrKey, addressAt, anchorOf, crownOf, deckKey,
  footprintOf, isDeck, wallKey, type Addr, type Site, type StructureKind }
  from './StructureGrid.js';
import { FREE_KEY, type StructurePart, type Structures } from './Structures.js';
import type { StructureTarget } from './StructurePlacement.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * GP-1065. THE PREVIEW AND THE PRESS ASK DIFFERENT QUESTIONS, and conflating
 * them was the bug. `ghostsize.js` pins, as a regression, that the GHOST must
 * stay drawn across nearly every pitch including straight up (GP-289: hiding
 * it on every miss was tried first and was worse, because a 24 m march never
 * dips below a 600 km sphere near the horizon either, so a hidden-on-miss
 * ghost vanished on ordinary flat ground). That invariant is about DRAWING,
 * not about BUYING. `resolveTarget` used to let the second question default
 * to "yes" whenever nothing else refused it, so a press aimed at the sky
 * (`aim.found === false`, the ray reached `REACH_M` without touching ground
 * or a solid, e.g. pitch +45) resolved a real address off
 * `fallbackOnGround`'s yaw-only projection and PLACED THERE, silently,
 * because nothing downstream of `aimed` ever read it.
 *
 * THE GATE IS `aim.found` ALONE, NOT `aim.overhead`, and that split matters.
 * `overhead` is true both for the sky-miss case above AND for a hit STRAIGHT
 * DOWN at the player's own feet (`overheadOf` is symmetric: no tangential
 * heading exists looking straight up or straight down either one), and the
 * second of those is a real, close, `found: true` hit that `wallstuck.js`
 * exercises on purpose (pitch -88, "the wall aimed straight down at the
 * player's own feet", `fallbackOnGround`'s own dedicated "return the player's
 * feet" branch). Gating on `overhead` too was tried first and measured wrong:
 * it refused that exact placement, `ghost.ok=false "no heading to aim by"`,
 * turning a shipped, deliberate feature red. `aim.found` alone lets it
 * through (the near-hit branch in `aimHit` hardcodes `found: true` whenever
 * `raw < MIN_PLACE_M`, regardless of the cone), while still catching the sky.
 *
 * The ghost still draws on a miss (BuildMode's hide condition, `t.overhead`
 * alone, is untouched on purpose, or `ghostsize.js` goes red), but it now draws
 * REFUSED, the same way an occupied cell or unlevel ground already does: a
 * sentence on the ghost before the key is pressed, per this file's own header.
 * `overhead` still picks the wording, purely cosmetic, once `found` is false.
 */
function gateAim(t: StructureTarget, aim: { found: boolean; overhead: boolean }):
boolean {
  if (aim.found) return true;
  t.ok = false;
  t.reason = aim.overhead ? 'no heading to aim by' : 'nothing there to build on';
  return false;
}

/** Where a part would go and whether it would be accepted. */
export function resolveTarget(s: Structures, kind: StructureKind,
                              ray: { origin: Vec3d; dir: Vec3d },
                              flip: number, freePlaced: boolean): StructureTarget {
  const aim = aimHit(s, ray);
  const hit = aim.p;
  if (freePlaced) {
    const t: StructureTarget = { ...freeTarget(s, kind, hit, ray.dir, flip),
                             aimed: aim.found, overhead: aim.overhead };
    gateAim(t, aim);
    return t;
  }
  const site = s.nearestSite(hit) ?? s.prospectiveSite(hit);
  // GP-37. The bare grid answers first, then a socket is allowed to overrule it.
  // The grid is kept as the fallback rather than replaced, because a player
  // aiming at open ground fifty metres from the base must still get an address.
  //
  // GP-1027: the crown of the body the ray entered, in THIS site's frame, so the
  // grid can tell a hit on a crown from a hit on a face. Null for a ground hit.
  const crownU = aim.solid === null ? null : crownOf(site, aim.solid);
  let addr = addressAt(site, s.module, kind, hit, flip, crownU);
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
    aimed: aim.found, overhead: aim.overhead,
  };
  if (!gateAim(t, aim)) return t;
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
    // The caller overwrites this with the real answer; `true` here keeps
    // `freeTarget` usable on its own and the spread in `resolveTarget` is what
    // actually decides.
    aimed: true, overhead: false,
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
