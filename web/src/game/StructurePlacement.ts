// THE RULES: where a structural part would go, and whether it would be allowed.
//
// Split out of Structures.ts because they are a different kind of thing. That
// file owns what exists in the world; this one owns the four questions asked
// before anything is allowed to exist, in the order a player needs the answers:
//
//   1. is the cell already built on?
//   2. is there anything to build ON (a deck under a wall, a storey under a
//      floor)?
//   3. DW-24: is the ground under the footprint flat enough to rest on?
//   4. is the cost in the pack?
//
// Every one of them produces a SENTENCE, and the sentence is on the ghost before
// the key is pressed rather than in a toast after it. Refusal 3 names the
// levelling tool, because being refused is how a player discovers it exists.

import * as THREE from 'three';
import { orient } from './Grid.js';
import { MAX_LEVEL, SITE_REACH_M, addrKey, addressAt, anchorOf, footprintOf,
  isDeck, localOf, type Addr, type Site, type StructureKind }
  from './StructureGrid.js';
import type { Structures } from './Structures.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** Aim march: step and reach, metres. Longer than a machine's, because a base is
 *  laid out by looking across it, not by standing on every cell of it. */
const STEP_M = 0.2;
const REACH_M = 12.0;
/** Where the ghost falls back to when the aim meets neither ground nor build. */
const FALLBACK_M = 3.0;

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
}

/**
 * March the aim against the ground AND against what is already built, and take
 * whichever comes first. Without the second half a player aiming at the top of a
 * foundation would be told about the soil underneath it, and no upper storey
 * could ever be aimed at.
 */
function aimPoint(s: Structures, ray: { origin: Vec3d; dir: Vec3d }): Vec3d {
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

/** The nearest site whose grid still reaches this point. */
function siteNear(s: Structures, p: Vec3d): Site | null {
  const v = new THREE.Vector3();
  let best: Site | null = null;
  let bestD = SITE_REACH_M;
  for (const site of s.sites) {
    const l = localOf(site, p, v);
    const d = Math.hypot(l.x, l.y);
    if (d < bestD) { bestD = d; best = site; }
  }
  return best;
}

/** Where a part would go and whether it would be accepted. */
export function resolveTarget(s: Structures, kind: StructureKind,
                              ray: { origin: Vec3d; dir: Vec3d },
                              flip: number, freePlaced: boolean): StructureTarget {
  const hit = aimPoint(s, ray);
  if (freePlaced) return freeTarget(s, kind, hit, ray.dir, flip);
  const site = siteNear(s, hit) ?? s.prospectiveSite(hit);
  const addr = addressAt(site, s.module, kind, hit, flip);
  const a = anchorOf(site, s.module, addr);
  const t: StructureTarget = {
    kind, site, addr, key: addrKey(addr), pos: a.pos, up: site.up.clone(),
    fwd: a.fwd, quat: orient(site.up, a.fwd), ok: true, reason: '',
    unevennessM: 0, freePlaced: false,
  };
  if (s.has(t.key)) { t.ok = false; t.reason = 'already built here'; return t; }
  if (addr.level > MAX_LEVEL) { t.ok = false; t.reason = 'too high'; return t; }
  if (!supported(s, site, addr)) {
    t.ok = false;
    t.reason = isDeck(addr.kind) ? 'nothing to build on up here'
      : 'a wall needs a deck under it';
    return t;
  }
  if (addr.level === 0) checkGround(s, t);
  if (t.ok) checkCost(s, t);
  return t;
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
    kind, site: null, addr: null, key: 'free:0',
    pos: { x: up.x * r, y: up.y * r, z: up.z * r },
    up, fwd, quat: orient(up, fwd), ok: true, reason: '', unevennessM: 0,
    freePlaced: true,
  };
  checkGround(s, t);
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
      || s.has(`w0:${a.i},${a.j},${b}`) || s.has(`w0:${a.i},${a.j + 1},${b}`)
      || s.has(`w1:${a.i},${a.j},${b}`) || s.has(`w1:${a.i + 1},${a.j},${b}`);
  }
  return a.axis === 0
    ? hasDeck(s, site, a.i, a.j, a.level) || hasDeck(s, site, a.i, a.j - 1, a.level)
    : hasDeck(s, site, a.i, a.j, a.level) || hasDeck(s, site, a.i - 1, a.j, a.level);
}

function hasDeck(s: Structures, site: Site, i: number, j: number,
                 level: number): boolean {
  const p = s.partAt(`d:${i},${j},${level}`);
  return p !== undefined && p.siteId === site.id;
}

/**
 * DW-24. Sample the oracle under the part's own footprint and compare each
 * reading with the base plane the part would stand on.
 *
 * The samples are in the PART's local frame, so a freely placed part is judged
 * by exactly the same rule as a snapped one. The deviation is signed: positive
 * ground would bury the corner, negative would leave it hanging in the air.
 */
function checkGround(s: Structures, t: StructureTarget): void {
  let worst = 0;
  const v = new THREE.Vector3();
  for (const [lx, lz] of footprintOf(s.module, t.kind)) {
    v.set(lx, 0, lz).applyQuaternion(t.quat);
    const x = t.pos.x + v.x, y = t.pos.y + v.y, z = t.pos.z + v.z;
    const dev = s.groundRadius(x, y, z) - Math.hypot(x, y, z);
    if (Math.abs(dev) > Math.abs(worst)) worst = dev;
  }
  t.unevennessM = worst;
  if (Math.abs(worst) <= s.groundToleranceM) return;
  t.ok = false;
  t.reason = `ground too uneven here (${worst >= 0 ? '+' : ''}${worst.toFixed(2)} m)`
    + ', level it with Q';
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
