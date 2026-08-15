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
/**
 * GP-289. How much tangential aim is enough to say which way the player is
 * facing. `dir` is a unit vector, so this is sin(angle from the local
 * vertical): 0.09 is about 5 degrees, i.e. the preview is refused only inside a
 * narrow cone straight up or straight down where no heading exists at all. It
 * is a bound rather than a taste, and the alternative was picking an arbitrary
 * bearing and watching the preview swing as the camera crossed the pole.
 */
const OVERHEAD_TAN = 0.09;
/**
 * GP-289. THE NEAREST A PREVIEW MAY BE PLACED, and this is the number Reid's
 * report is actually about.
 *
 * Measured before fixing, foundation in hand, pitch swept: at 0 degrees the
 * preview sits 6.051 m away and the player is outside it; at -30, 3.206 m and
 * outside; at -60, 1.645 m and INSIDE; at -85, 1.385 m and INSIDE. The aim ray
 * is hitting real ground every time. Nothing is malfunctioning: look down and
 * the ground is close, so the building goes where you are standing, and the
 * preview material is `DoubleSide` with `depthWrite` off, so the inside faces
 * of a 4 m slab you are within ARE the viewport. "The translucent preview fills
 * the screen rather than sitting on the ground where the thing will go" is that
 * sentence exactly, and it happens at any downward pitch past about 45 degrees,
 * which is most of the time somebody is placing something.
 *
 * 3.2 m is the smallest value that keeps a standing eye outside the largest
 * 4 m module's box (half-diagonal 2.83 m plus a margin), derived rather than
 * tuned. THIS IS A SEMANTICS CHANGE AND IT IS FLAGGED: a player can no longer
 * put a building directly under their own feet, they have to take a step back.
 * That is how every builder this game is like behaves, and the alternative is a
 * preview that cannot be seen at the moment it matters most, but it is Reid's
 * call and it is one constant.
 */
const MIN_PLACE_M = 3.2;

export interface StructureTarget {
  /** GP-289. FALSE when the aim ray reached its full reach without touching
   *  ground or a solid, i.e. the player is looking at the sky. `pos` is then a
   *  fallback point in mid-air and NOTHING MAY BE DRAWN AT IT: the preview
   *  material is DoubleSide, so a slab six metres up a ray pointing at the sky
   *  is a slab the player is standing inside, and its inner faces are the whole
   *  viewport. That was Reid's report. */
  aimed: boolean;
  /** GP-289. TRUE inside the narrow cone straight up or down where the aim has
   *  no heading at all. Nothing may be drawn: every position is a guess and the
   *  nearest guess puts the player inside the preview. */
  overhead: boolean;
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
 *
 * =============================================================================
 * GP-966. "IGNORE THE SOLIDS A PLACEMENT CANNOT STAND ON" WAS BUILT, MEASURED
 * AND REVERTED. The numbers are here so nobody spends the afternoon this lane
 * did (FS-129's precedent, one file over).
 *
 * The brief was GP-937's UX finding: aiming a placement ghost across a tall
 * placed structure resolves the target block from that structure's own body hit,
 * so a player near a 28 m launch pad gets a misresolved cell from every vantage
 * the pad occludes; five were tried and all failed identically. The fix built
 * for it was principled: every solid shares one `StructureBodies` by design
 * (GP-58, one collision set for the walker), so tag the structural base parts
 * and let this march see only those, since a pad stands on 36 decks and nothing
 * is ever built on a pad. `Solid.basePart`, one flag, five files.
 *
 * IT MOVES NOTHING, MEASURED. Two dists one line apart, same seed, same
 * standoff, same single aim, real D3D11 headless Chrome: the block resolved is
 * `[-3,-2,0]` in BOTH arms, with the whole ghost JSON identical. Two independent
 * reasons, both of which had to be measured to be believed:
 *
 *  1. THE NEAR HIT IS DISCARDED BEFORE THE MARCH RESULT IS USED. `MIN_PLACE_M`
 *     below throws away any hit inside 3.2 m, and on a finished platform the
 *     nearest surface is the deck you are standing on. Measured from pad.js's
 *     own 3 m standoff: first solid on the ray at 0.20 m with the pad placed and
 *     3.00 m without it, and the same block out of both. Whatever the march
 *     found, this function did not use it.
 *  2. THE PAD IS NOT 28 m TO THE AIM. `heightM` 28 is the GEOMETRY BOUND,
 *     "tower and masts included" (LaunchPadModule.ts). The `col_*` proxy set the
 *     march actually sees tops out at the launch table and the deck banks:
 *     measured live by sweeping `solidBuild` up the pad's own vertical, the
 *     collision crown is a small fraction of 28 m, and a real aim from 10 m back
 *     at 15 m up the visual tower meets NO solid within the full 24 m reach.
 *     Every "a 28 m body against a 24 m aim reach, so no vantage clears it"
 *     argument, this lane's included, was reasoning about the mesh.
 *
 * So the pad never was the occluder, and the reported symptom is GP-968 below,
 * one constant away. The ownership rule may still be right in principle -- a
 * ruin wall is genuinely tall and genuinely carries no address -- but it is not
 * shipping on principle alone: a change to this function with no measurable
 * consequence is a liability in the one place every placement in the game goes
 * through. The pair of assertions that would catch it live in `probes/pad.js`
 * (GP-967 and GP-969), so the day a real occluder appears, the arm is already
 * built and the flag is four lines away.
 *
 * The three other candidates, for the same reason: IGNORE ALL PLACED STRUCTURES
 * takes decks out too and deletes multi-storey aiming; RESOLVE THE GROUND BEHIND
 * A HIT ON THE PLACEMENT'S OWN KIND fixes pad-behind-pad and leaves machine,
 * ruin, antenna and station each to be found separately; A VISIBLE CUE names a
 * wrong cell without making it right. None of them addresses GP-968, which is
 * what was actually wrong.
 * =============================================================================
 */
/**
 * GP-289. THE MARCH, AND WHETHER IT HIT ANYTHING.
 *
 * `found` is false when the ray reached `REACH_M` without touching ground or a
 * solid, which is what happens the moment a player looks up. The point is still
 * returned, at `FALLBACK_M`, because callers want somewhere to put a crosshair
 * even then; what they may NOT do any longer is draw a building there.
 *
 * REID'S BUG WAS THIS FALLBACK BEING SILENT. Measured 2026-08-03: with a
 * foundation in hand and the camera pitched at the sky, the preview lands
 * 1.385 m from the eye with the eye INSIDE its bounding box, and the ghost
 * material is `DoubleSide` with `depthWrite: false`, so what fills the viewport
 * is the inside of a 4 m slab you are standing in. "The translucent preview
 * fills the screen rather than sitting on the ground where the thing will go"
 * is exactly that, and the fallback distance is why: 6 m along a ray pointing
 * at the sky is 6 m of air over your own head.
 */
export function aimHit(s: Structures, ray: { origin: Vec3d; dir: Vec3d }):
{ p: Vec3d; found: boolean; overhead: boolean } {
  const o = ray.origin, d = ray.dir;
  let tGround = -1;
  for (let t = 0.6; t <= REACH_M; t += STEP_M) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.hypot(x, y, z) <= s.groundRadius(x, y, z)) { tGround = t; break; }
  }
  const tSolid = s.bodies.rayHit(o, d, REACH_M, STEP_M);
  if (tGround >= 0 || tSolid >= 0) {
    const raw = tGround >= 0 && tSolid >= 0 ? Math.min(tGround, tSolid)
      : tGround >= 0 ? tGround : tSolid;
    // PUSHED OUT TO ARM'S LENGTH, then dropped back onto the surface. Moving
    // along the ray alone would lift the point off the ground as the pitch
    // steepens, which trades one wrong preview for another; `fallbackOnGround`
    // already knows how to put a point on the surface in the direction the
    // player is facing, so a close hit reuses it rather than inventing a second
    // projection.
    //
    // =========================================================================
    // GP-968. ARM'S LENGTH IS `MIN_PLACE_M`, AND THIS PUSHED TO `FALLBACK_M`.
    //
    // `fallbackOnGround` used to hardcode `Math.max(FALLBACK_M, MIN_PLACE_M)`,
    // which is 6.0 m, so a hit refused for being nearer than 3.2 m was moved to
    // 6.0 m: 2.8 m further than the rule that rejected it asks for, in a
    // direction the player did not aim. On the shipped 4 m module that is most
    // of a cell, and it lands in the NEXT one.
    //
    // IT IS THE WHOLE OF THE "PAD OCCLUSION" REPORT (GP-937's five vantages),
    // MEASURED. On a finished platform the nearest surface is the deck you are
    // standing on, so `raw` is always inside 3.2 m and this branch always fires;
    // the point it returns is then a function of the eye and the aim direction
    // ALONE, with nothing in the world in it. That is why five different
    // vantages returned one identical block, and why an A/B one line apart --
    // marching the pad's body versus not marching it -- returns the same block
    // too, on the same seed, from the same standoff, with the first solid on the
    // ray at 0.20 m in one arm and 3.00 m in the other. The pad was never the
    // cause; this constant was, and the pad was simply the thing in frame.
    //
    // Measured at pad.js's own 3 m standoff, 4 m cells: pushing to 6.0 m puts
    // the point 3.0 m past the aimed cell CENTRE, over its 2.0 m boundary and
    // into the next cell (`[-3,-2,0]` for `[-3,-3,0]`). Pushing to 3.2 m puts it
    // 0.2 m past the centre, inside the cell that was aimed at.
    //
    // GP-289's ARGUMENT IS UNTOUCHED AND THAT IS THE POINT OF USING ITS OWN
    // NUMBER. 3.2 m is derived there as the smallest distance that keeps a
    // standing eye outside the largest 4 m module's box (half-diagonal 2.83 m
    // plus margin), so pushing to exactly it satisfies the rule exactly, and the
    // 6.0 m was never a second safety margin -- it is `FALLBACK_M`, the distance
    // for a ray that hit NOTHING, borrowed by a branch about a ray that hit
    // something too close. Two different questions were sharing one constant.
    // =========================================================================
    if (raw < MIN_PLACE_M) {
      return { p: fallbackOnGround(s, o, d, MIN_PLACE_M), found: true,
               overhead: overheadOf(o, d) };
    }
    return { p: { x: o.x + d.x * raw, y: o.y + d.y * raw, z: o.z + d.z * raw },
             found: true, overhead: false };
  }
  return { p: fallbackOnGround(s, o, d, FALLBACK_M), found: false,
           overhead: overheadOf(o, d) };
}

/**
 * GP-289. WHERE A BUILDING GOES WHEN THE AIM RAY HITS NOTHING, and it is ON THE
 * GROUND rather than wherever the ray happened to be at six metres.
 *
 * THE MISS IS THE NORMAL CASE, WHICH IS THE PART THAT WAS NOT UNDERSTOOD. The
 * march runs 24 m across a body 600 km in radius, so a ray anywhere near the
 * horizontal never dips below the surface: measured on a fresh spawn looking at
 * flat open ground, the foundation preview sat at 6.014 m, which is
 * `FALLBACK_M` to the millimetre. It had NEVER been a hit. So the old fallback
 * was not an edge case for a player staring at the sky, it was the ordinary
 * path, and it worked by accident only while the camera was roughly level: at
 * that pitch "six metres along the ray" and "six metres ahead on the ground"
 * are nearly the same point, and they diverge exactly as the player looks up,
 * until at full pitch the point is six metres above their own head and the
 * DoubleSide preview they are standing inside becomes the whole viewport.
 *
 * The fix is to stop using the ray's own direction for the distance. Take the
 * aim direction's component in the local TANGENT PLANE, step `FALLBACK_M` along
 * that from under the eye, and put the result on the surface. It agrees with
 * the old behaviour where the old behaviour was right, it is defined at every
 * pitch, and it means the preview is on the ground by construction rather than
 * by the player happening to look at it.
 */
/** How much heading the aim has, as sin(angle from the local vertical). */
function overheadOf(o: Vec3d, d: Vec3d): boolean {
  const up = new THREE.Vector3(o.x, o.y, o.z).normalize();
  const tan = new THREE.Vector3(d.x, d.y, d.z);
  tan.addScaledVector(up, -tan.dot(up));
  return tan.length() < OVERHEAD_TAN;
}

/**
 * GP-968. `aheadM` IS THE CALLER'S, because the two callers are asking two
 * different questions and used to share one answer. A ray that hit NOTHING
 * wants `FALLBACK_M`; a ray that hit something INSIDE arm's length wants
 * `MIN_PLACE_M`, the constant that rejected it. The `Math.max` that used to sit
 * on the step below made the second silently take the first's value.
 */
function fallbackOnGround(s: Structures, o: Vec3d, d: Vec3d,
                          aheadM: number): Vec3d {
  const up = new THREE.Vector3(o.x, o.y, o.z).normalize();
  const fwd = new THREE.Vector3(d.x, d.y, d.z);
  fwd.addScaledVector(up, -fwd.dot(up));
  // STRAIGHT UP OR STRAIGHT DOWN has no heading of its own, so the ghost goes
  // where the player is standing rather than in a direction invented here. Any
  // invented direction would be a preview that moves when the camera passes
  // through the pole, which is worse than one that sits at your feet.
  if (fwd.lengthSq() < OVERHEAD_TAN * OVERHEAD_TAN) {
    // STRAIGHT UP OR STRAIGHT DOWN HAS NO HEADING, and every answer here is a
    // guess. Returning the player's own feet was the second wrong version of
    // this fix: a 4 m slab centred where you stand is a slab you are inside,
    // which is the very thing being fixed. The point is still returned so a
    // caller has something, and `overhead` tells `BuildMode` to draw nothing.
    const r0 = s.groundRadius(up.x, up.y, up.z);
    return { x: up.x * r0, y: up.y * r0, z: up.z * r0 };
  }
  fwd.normalize();
  // GP-968: `aheadM`, not `Math.max(FALLBACK_M, MIN_PLACE_M)`. The clamp is kept
  // as a floor so no caller can ask for a point inside its own preview box.
  const p = new THREE.Vector3(o.x, o.y, o.z)
    .addScaledVector(fwd, Math.max(aheadM, MIN_PLACE_M));
  p.normalize();
  const r = s.groundRadius(p.x, p.y, p.z);
  return { x: p.x * r, y: p.y * r, z: p.z * r };
}

/** The point alone, for callers that genuinely do not care. Unchanged. */
export function aimPoint(s: Structures, ray: { origin: Vec3d; dir: Vec3d }): Vec3d {
  return aimHit(s, ray).p;
}

/** Where a part would go and whether it would be accepted. */
export function resolveTarget(s: Structures, kind: StructureKind,
                              ray: { origin: Vec3d; dir: Vec3d },
                              flip: number, freePlaced: boolean): StructureTarget {
  const aim = aimHit(s, ray);
  const hit = aim.p;
  if (freePlaced) return { ...freeTarget(s, kind, hit, ray.dir, flip),
                           aimed: aim.found, overhead: aim.overhead };
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
    aimed: aim.found, overhead: aim.overhead,
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
