// FS-28: THE ORE IS ON THE BELT, and you can see which ore it is.
//
// Reid, verbatim: "Belts should show the material being transported (like
// factorio or satisfactory), and i should be able to pick up that stuff off the
// belts." This file is the first half; the taking is `Factory.takeFromBelt`.
//
// DW-8 IS NOT RELAXED BY THIS, and that is the whole design constraint. Belt
// MOTION is still shader-driven from one `FFactoryBeltFlowState` row per line
// and there is still no AnimationMixer anywhere: the scrolling band on the deck
// is what a belt looks like at every distance. What this adds is the LOD-0-only
// layer the section 6 contract has always described and nobody had ever called
// (`AutoLine.lineItems` shipped with zero callers, lane A's finding A-7): the
// discrete item meshes, pulled from `GetLineItems`, which is by design the single
// O(items) call in the whole render path. Past `LOD0_M` a line falls back to the
// band alone and its per-item cost is exactly zero, which is the collapse
// `render_cost.h` was written to prove.
//
// THE PLACEMENT CONVENTION IS THE ART LANE'S AND IS READ, NOT GUESSED.
// ASSET-SPECS 4.12 publishes three sockets per belt tile that between them
// describe the whole path an item takes across it: `socket_item_a` where the
// path enters, `socket_item` at the midpoint, `socket_item_b` where it leaves.
// On a straight tile those are collinear; on a CURVE they are three points of a
// quarter arc (measured on the shipped file: a at (0, 0.28, -0.5), b at
// (-0.5, 0.28, 0), midpoint at (-0.1464, 0.28, -0.1464), which is r = 0.5
// through 45 degrees), so interpolating through the midpoint rather than
// straight from a to b is what keeps cargo on the deck round a corner instead of
// cutting the inside of it. And ASSET-SPECS 4.20 publishes `socket_rest` on every
// item at its own lowest point, so "put this item on the belt" is one
// subtraction and there is no per-item height table anywhere in this client.
//
// THE INSTANCE BUDGET IS THE RISK AND IT IS BOUNDED HERE. FS-16 measured that
// more than half the instances at 900 machines are already auto-created
// inserters, and factory_sim's `kItemSpacing` of 64 against `kUnitsPerTile` of
// 256 means a saturated belt carries FOUR items per tile: a 24-tile run at
// saturation is 96 instances where the run itself is 24. So this is capped three
// ways, all of them counted and reported rather than silent (DW-28): a line
// beyond `LOD0_M` contributes nothing, a frame stops at `MAX_ITEMS`, and the
// pool underneath is a `MachineBatch`, which doubles on demand and shouts at its
// ceiling.

import * as THREE from 'three';
import { loadGlb } from '../assets/Loaders.js';
import { MachineBatch } from './MachineBatch.js';
import { ITEM_MESH_NODE } from './ItemIcons.js';
import type { Factory } from './Factory.js';
import type { GameCore } from './GameCore.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/**
 * How near a run's nearest tile must be for its cargo to be drawn as meshes.
 *
 * 32 m is a little over the 24-tile drag cap, so a player standing at one end of
 * the longest run they can lay in one gesture sees cargo along all of it. Past
 * it the scrolling band carries the reading, which is what it is for.
 */
const LOD0_M = 32.0;

/**
 * The hard per-frame item budget. 768 is three saturated 64-tile runs, or eight
 * of the longest single drag. It is a BUDGET and not a capacity: the pool below
 * grows, and what this bounds is the per-frame CPU of building transforms.
 * Anything over it is counted into `skipped` and shown, never dropped quietly.
 */
const MAX_ITEMS = 768;

/**
 * The circle through a tile's three published sockets, solved ONCE at load.
 *
 * `theta` is measured from `b` (the exit, t = 0) in the plane of the three
 * points, and `sweep` is the signed total angle to `a` the short way THROUGH
 * the midpoint. Interpolating theta linearly is arc-length parameterisation
 * exactly, on a circle, with no integration and no lookup table: that is the
 * whole reason the art lane published a midpoint rather than just two ends.
 */
interface Arc {
  centre: THREE.Vector3; u: THREE.Vector3; w: THREE.Vector3;
  radius: number; sweep: number;
}

/** Where a belt tile's item path enters, passes and leaves, in tile-local m. */
interface Path {
  a: THREE.Vector3; mid: THREE.Vector3; b: THREE.Vector3;
  /** null when the three sockets are collinear, i.e. a straight tile. */
  arc: Arc | null;
}

/** Which tile shape a run tile is drawing, matching FactoryView's templates. */
export type Turn = 'l' | 'r';

/**
 * A circle through three points is a LINE when they are collinear, and floating
 * point does not do "exactly collinear". So the degenerate branch is chosen on
 * the solved RADIUS rather than on a cross-product epsilon: past this multiple
 * of the tile's own chord the arc is straighter than the 1 mm the assets are
 * authored to and the lerp is both correct and better conditioned. A straight
 * tile's three sockets solve to a radius of order 1e8 m; the shipped curve
 * solves to 0.5 m.
 */
const STRAIGHT_RADIUS_RATIO = 40;

/** Solve the circumcircle of a, mid, b in 3D. null when they are collinear. */
function arcThrough(a: THREE.Vector3, mid: THREE.Vector3,
                    b: THREE.Vector3): Arc | null {
  const v1 = new THREE.Vector3().subVectors(mid, b);
  const v2 = new THREE.Vector3().subVectors(a, b);
  const n = new THREE.Vector3().crossVectors(v1, v2);
  const nn = n.lengthSq();
  const chord = v2.length();
  if (nn <= 0 || chord <= 0) return null;
  // centre = b + ((|v1|^2 v2 - |v2|^2 v1) x n) / (2|n|^2)
  const num = new THREE.Vector3()
    .addScaledVector(v2, v1.lengthSq())
    .addScaledVector(v1, -v2.lengthSq())
    .cross(n)
    .multiplyScalar(1 / (2 * nn));
  const centre = new THREE.Vector3().addVectors(b, num);
  const u = new THREE.Vector3().subVectors(b, centre);
  const radius = u.length();
  if (!Number.isFinite(radius) || radius <= 0) return null;
  if (radius > chord * STRAIGHT_RADIUS_RATIO) return null;  // collinear enough
  u.multiplyScalar(1 / radius);
  const w = new THREE.Vector3().crossVectors(n.normalize(), u).normalize();
  const ang = (p: THREE.Vector3): number => {
    const d = new THREE.Vector3().subVectors(p, centre);
    return Math.atan2(d.dot(w), d.dot(u));
  };
  const tm = ang(mid);
  let ta = ang(a);
  // Take the branch that keeps the midpoint BETWEEN the ends. Without this a
  // 90-degree corner is as likely to be drawn as the 270-degree one, which puts
  // every item on a lap of the tile it is standing on.
  if (tm > 0 && ta < tm) ta += 2 * Math.PI;
  if (tm < 0 && ta > tm) ta -= 2 * Math.PI;
  if (!Number.isFinite(ta)) return null;
  return { centre, u, w, radius, sweep: ta };
}

function pathOf(root: THREE.Object3D | null): Path | null {
  if (root === null) return null;
  const g = (n: string): THREE.Vector3 | null =>
    root.getObjectByName(n)?.position.clone() ?? null;
  const a = g('socket_item_a'), mid = g('socket_item'), b = g('socket_item_b');
  if (a === null || mid === null || b === null) return null;
  return { a, mid, b, arc: arcThrough(a, mid, b) };
}

export class BeltCargo {
  readonly group = new THREE.Group();
  private readonly batch = new MachineBatch(256, 'beltCargo');
  private straight: Path | null = null;
  private curve: Record<Turn, Path | null> = { l: null, r: null };
  /** Each item mesh's own `socket_rest`, so nothing here knows a height. */
  private readonly rest = new Map<string, THREE.Vector3>();
  /** Which meshes the atlas actually shipped, so a miss falls back loudly. */
  private readonly have = new Set<string>();
  private readonly slots: number[] = [];
  private readonly drawnKey: string[] = [];
  /** What the last frame did. Every one of these is on the debug HUD. */
  drawn = 0;
  lines = 0;
  skipped = 0;
  pulls = 0;
  lastKey = '';
  lastWant = '';
  private ready = false;

  constructor() { this.group.name = 'beltCargo'; this.group.add(this.batch.group); }

  /**
   * Load the item meshes and read the belt's path sockets.
   *
   * IT RESOLVES EVEN WHEN THE ATLAS IS MISSING, and that is deliberate rather
   * than lazy: the art lane authors these files in parallel with this code, and
   * a client that refuses to boot because one .glb has not landed yet is a
   * client that blocks the other lane. With nothing loaded `sync` is a no-op and
   * the belts read exactly as they did before, from the band alone.
   */
  async load(beltScene: THREE.Object3D | null,
             curveL: THREE.Object3D | null = null,
             curveR: THREE.Object3D | null = null): Promise<void> {
    beltScene?.updateWorldMatrix(true, true);
    this.straight = pathOf(beltScene);
    this.curve.l = pathOf(curveL) ?? this.straight;
    this.curve.r = pathOf(curveR) ?? this.straight;
    const g = await loadGlb('assets/items/items_atlas.glb').catch(() => null);
    if (g === null || this.straight === null) return;
    g.scene.updateWorldMatrix(true, true);
    const templates = new Map<string, { def: { url: string; root: string;
      nodeMatch: RegExp }; scene: THREE.Object3D }>();
    // Every Item_* node the atlas ships, plus the generic crate, rather than the
    // subset the icon table happens to name: an item the sim can put on a belt
    // and the icon panel has no row for still has to be drawable.
    for (const child of [...g.scene.children, ...(g.scene.children[0]?.children ?? [])]) {
      const node = child.name;
      if (!node.startsWith('Item_') || templates.has(node)) continue;
      const r = child.getObjectByName('socket_rest');
      this.rest.set(node, r?.position.clone() ?? new THREE.Vector3());
      this.have.add(node);
      // `_\d+` IS NOT OPTIONAL POLISH. GLTFLoader names a node's mesh after the
      // node only when that node has ONE primitive; a mesh with two materials
      // becomes a Group named `Item_X` whose children are `Item_X_0` and
      // `Item_X_1`. Measured: an exact `^Item_X$` match loaded 15 item meshes,
      // registered ONE of them, and drew nothing while reporting `meshes: 15`,
      // which is precisely the shape of failure that reports success. The
      // machine templates have always used the same suffix tolerance.
      templates.set(node, { def: { url: 'items_atlas', root: node,
        nodeMatch: new RegExp(`^${node}(?:_\\d+)?$`) }, scene: child });
    }
    if (templates.size === 0 || !this.have.has('Item_Crate')) return;
    this.batch.build(templates);
    this.ready = true;
  }

  /**
   * One pass over every NEAR run, placing one instance per item it carries.
   *
   * `corners` is FactoryView's own answer to which tiles are curves and how they
   * are oriented, passed in rather than recomputed: two answers to "is this tile
   * a corner" is exactly how cargo ends up riding a deck that is not there.
   */
  sync(f: Factory, core: GameCore, origin: FloatingOrigin,
       eye: { x: number; y: number; z: number },
       corners: ReadonlyMap<number, { turn: Turn; quat: THREE.Quaternion }>): void {
    this.drawn = 0; this.lines = 0; this.skipped = 0; this.pulls = 0;
    if (!this.ready) return;
    const p = new THREE.Vector3();
    const local = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let i = 0; i < f.runs.length; ++i) {
      const run = f.runs[i];
      const build = f.runBuilds[i];
      if (build === undefined || run.length === 0) continue;
      // The NEAREST tile decides, not the head: a 24-tile run laid away from the
      // player has its head 24 m off and its tail under their feet, and culling
      // on the head would blank the cargo they are standing over.
      if (nearestTileM(run, eye) > LOD0_M) continue;
      const items = f.line.lineItems(build);
      this.pulls++;
      if (items.length === 0) continue;
      this.lines++;
      for (const it of items) {
        if (n >= MAX_ITEMS) { this.skipped++; continue; }
        const idx = Math.min(run.length - 1,
          Math.max(0, Math.floor(it.offsetTiles)));
        const tile = run[run.length - 1 - idx];
        const c = corners.get(tile.id);
        const path = c === undefined ? this.straight : this.curve[c.turn];
        if (path === null) continue;
        // ITEM_MESH_NODE also names the meshes the icon baker borrows for the
        // BUILDABLES (a smelter's own LOD0 stands in for its inventory icon),
        // and those are not in the atlas and must not be instanced at 1:1 scale
        // on a belt: a 2 m smelter riding a 1 m tile is not a placeholder, it is
        // a bug that looks deliberate. `Item_Crate` is the art lane's published
        // answer for exactly this and it is the fallback for anything the atlas
        // does not carry.
        const want = ITEM_MESH_NODE[core.itemName(it.item)] ?? '';
        const key = this.have.has(want) ? want : 'Item_Crate';
        this.lastWant = want; this.lastKey = key;
        const slot = this.slotFor(n, key);
        if (slot < 0) { this.skipped++; continue; }
        const q = c === undefined ? tile.quat : c.quat;
        pointOnPath(path, it.offsetTiles - idx, local);
        local.sub(this.rest.get(key) ?? ZERO);
        local.applyQuaternion(q);
        origin.toEngine(tile.pos, p);
        p.add(local);
        m.compose(p, q, one);
        this.batch.place(slot, m);
        this.batch.setFx(slot, { flow: 0, density: 0, state: 0, level: 0 });
        n++;
      }
    }
    for (let k = n; k < this.slots.length; ++k) this.batch.hide(this.slots[k]);
    this.drawn = n;
    this.batch.flush();
  }

  /** Slot `k` of the ribbon, re-pointed at `key`'s mesh. -1 at the ceiling. */
  private slotFor(k: number, key: string): number {
    if (k < this.slots.length) {
      if (this.drawnKey[k] !== key && this.batch.setGeometry(this.slots[k], key)) {
        this.drawnKey[k] = key;
      }
      return this.slots[k];
    }
    const s = this.batch.acquire(key);
    if (s < 0) return -1;
    this.slots.push(s);
    this.drawnKey.push(key);
    return s;
  }

  stats(): unknown {
    return { items: this.drawn, lines: this.lines, skipped: this.skipped,
      pulls: this.pulls, lod0M: LOD0_M, budget: MAX_ITEMS,
      // The MESHES that loaded and the last key that was asked for. A `skipped`
      // count alone cannot tell "the budget bound" from "that item has no mesh",
      // and those want completely different fixes.
      meshes: this.have.size, lastKey: this.lastKey, lastWant: this.lastWant,
      pool: this.batch.stats() };
  }
}

const ZERO = new THREE.Vector3();

/** Distance from `eye` to the nearest tile of a run, in metres. */
function nearestTileM(run: readonly { pos: { x: number; y: number; z: number } }[],
                      eye: { x: number; y: number; z: number }): number {
  let best = Infinity;
  for (const t of run) {
    const d = Math.hypot(t.pos.x - eye.x, t.pos.y - eye.y, t.pos.z - eye.z);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Where along a tile's published path an item sits, for `f` in 0..1.
 *
 * `f` is the FRACTION OF THE TILE STILL AHEAD OF THE ITEM, because
 * `GetLineItems` reports the distance from the line HEAD and the head is where
 * items leave. So f = 0 is the exit socket and f = 1 is the entry socket, which
 * is the reverse of the direction it reads in, and getting it backwards puts
 * every item on a belt travelling the wrong way while every other number stays
 * correct.
 *
 * FS-31: ONE RULE FOR BOTH TILE SHAPES, which is the art lane's published
 * convention (ASSET-SPECS 4.13.1) and is why there is no `if (curve)` here. An
 * item follows the CIRCLE through the three sockets, parameterised by arc
 * length; on a straight the three are collinear, the circle degenerates to a
 * line, and the same call is a plain lerp. This replaced two straight chords
 * b->mid->a, which cut the inside of every corner: on the shipped curve (r =
 * 0.5 m through 90 degrees, midpoint at 45) a chord pair sags r(1 - cos 22.5)
 * = 0.038 m inside the arc and is 0.7654 m long against the true 0.7854, so
 * cargo rode 3.8 cm off the belt centre and changed pace twice per corner.
 *
 * Note what is NOT wrong and must not be "fixed": a curve tile's path is 21.5%
 * shorter than a straight one (0.7854 m against 1.000) while costing the SAME
 * one tile of sim capacity, so an item genuinely crosses a corner slower in
 * metres per second. That is the tile-capacity model, it is what Factorio does,
 * and multiplying `offsetTiles` by a constant metres-per-tile to "correct" it
 * is the trap the art lane flagged as A-9: it would accelerate items 27%
 * (1.000 / 0.785398) through every corner instead.
 */
function pointOnPath(p: Path, f: number, out: THREE.Vector3): void {
  const t = Math.min(1, Math.max(0, f));
  if (p.arc === null) { out.copy(p.b).lerp(p.a, t); return; }
  const th = p.arc.sweep * t;
  out.copy(p.arc.u).multiplyScalar(Math.cos(th) * p.arc.radius)
    .addScaledVector(p.arc.w, Math.sin(th) * p.arc.radius)
    .add(p.arc.centre);
}
