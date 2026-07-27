// H-6 (lane D's D-3): THE POWER WIRES, DRAWN.
//
// `power.h` has published a spanning-tree edge list since ABI 9 and nothing in
// the browser had ever drawn one. A pole was therefore a four-metre mast with
// nothing coming out of it, and a grid that was WORKING (satisfaction 65536,
// smelters running) read on screen as a row of unconnected posts. This file is
// the whole of the fix: one instanced box per segment, stretched along it.
//
// THE COUNT COMES FROM /core AND IS NOT RE-DERIVED HERE. `wireSegments()` is a
// spanning tree, exactly (poles in network - 1), never one per in-reach pair:
// 30 poles a metre apart is 182 in-reach pairs against 29 segments. Nothing in
// this file looks at a supply radius, so a rule change in power.h cannot leave a
// second, disagreeing opinion behind in the renderer.
//
// AND IT IS PULLED ONLY WHEN THE TOPOLOGY MOVES. `Power.wires()` crosses the
// WASM boundary and allocates a row per segment, so calling it per frame would
// be sixty crossings a second to redraw an edge list that changes when a player
// puts down a pole. `AutoLine.rebuilds` is the generation counter: every plan
// edit goes through `commitPlan`, which calls `recreate()`, which bumps it. The
// only other thing that moves a segment on screen is a floating-origin rebase,
// so the transforms are rewritten on `origin.rebases` and on nothing else.
//
// NO WASM VIEW IS HELD ACROSS A CALL (standing rule 5): `wires()` returns plain
// rows and the scratch heap is never referenced after it returns.
//
// WHY InstancedMesh AND NOT BatchedMesh. MachineBatch needs a batch because it
// draws eight different meshes; a wire is one box, one material, one geometry,
// so instancing is the smaller tool. It is also the SAFER one for the claim
// being made: three renders a BatchedMesh as `drawCount` separate draw calls
// when `WEBGL_multi_draw` is absent (WebGLRenderer, the `! extensions.get`
// branch), which is a real configuration in headless ANGLE, so "one extra draw
// call" would have been true on the dev machine and false in CI. An
// InstancedMesh is `renderInstances` and therefore exactly one call everywhere.
//
// THE POOL GROWS AND EXHAUSTION IS LOUD (DW-28), the same policy MachineBatch
// states: doubling, a ceiling that exists only so a runaway cannot allocate
// unbounded GPU memory, refusals counted, and one console.error rather than
// segments that quietly stop appearing.
//
// THE ATTACHMENT HEIGHT IS READ OFF THE ASSET. `power_pole.glb` publishes
// `socket_wire_a` and `socket_wire_b` on the two insulator caps for exactly this
// ("wires are runtime geometry between the socket_wire_* nodes of connected
// poles, never authored geometry", build_power_pole.py) and nothing had ever
// called them. A hardcoded 3.95 here would be a second copy of a number the art
// lane owns, and it would silently go wrong the day the mast changes height.

import * as THREE from 'three';
import { MAX_CAPACITY, registerPool, type PoolReport }
  from '../game/InstancePools.js';
import type { WireRow } from '../game/Power.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** Cable section, metres. A pole leg is 0.08, so the wire reads as thinner. */
const THICK_M = 0.05;
/** Segments the pool starts at. A base is poles, not belt tiles; it doubles. */
const START_CAPACITY = 64;
/** How near a wire endpoint must be to a placed pole to be that pole, metres.
 *  /core stores pole positions as f32 about the anchor, so the real error is
 *  ~1e-6 m; this is loose enough to be a match test and far too tight to pair
 *  an endpoint with the wrong pole on a 1 m grid. */
const MATCH_M = 0.05;

const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** What this view needs of a placed building: where it is and which way is up. */
export interface WirePoleRow {
  readonly kind: string;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly up: THREE.Vector3;
}

/**
 * The factory, as narrowly as the wires need it. Structural rather than an
 * import of `Factory`, so `src/render` does not take a dependency on the plan.
 */
export interface WireSource {
  readonly power: { wires(): WireRow[] };
  /** `rebuilds` is the topology generation; see the header. */
  readonly line: { readonly rebuilds: number };
  readonly placed: readonly WirePoleRow[];
  anchor(): { x: number; y: number; z: number };
}

/** One resolved wire end: the pole's body-frame position and its own up. */
interface WireEnd {
  x: number; y: number; z: number;
  up: THREE.Vector3;
  /** False when no placed pole stands where /core says this wire ends. */
  matched: boolean;
}

export class WireView {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material: THREE.MeshBasicMaterial;
  private mesh: THREE.InstancedMesh;
  private cap = START_CAPACITY;
  private live = 0;
  private grows = 0;
  private refused = 0;
  private warned = false;

  /** /core's last edge list, and the poles its ends resolved to. */
  private rows: WireRow[] = [];
  private ends: WireEnd[] = [];
  private unmatched = 0;
  private pulls = 0;

  /** Local +Y offset to the crossarm, from the asset's own wire sockets. */
  private attachM = 0;
  private attachFromAsset = false;

  private gen = -1;
  private rebases = -1;
  private origin: FloatingOrigin | null = null;

  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  constructor(private readonly name = 'factoryWires',
              private readonly ceiling = MAX_CAPACITY) {
    this.group.name = name;
    this.group.visible = false;
    this.material = new THREE.MeshBasicMaterial({ color: 0x14171c });
    this.material.name = 'factory:wires';
    this.mesh = this.makeMesh(this.cap);
    this.group.add(this.mesh);
    registerPool(this);
  }

  private makeMesh(cap: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    mesh.name = this.name;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The unit box's bounding sphere describes none of the stretched instances,
    // and the factory is always within tens of metres of the player, so a
    // whole-object cull here could only ever be a false negative.
    mesh.frustumCulled = false;
    // Deliberately NOT a shadow caster. A 5 cm cable contributes nothing a
    // player would notice to a shadow map and it would cost one draw call per
    // cascade, which is the whole of this feature's budget three times over.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  /**
   * Take the wire attachment point off the pole asset.
   *
   * The midpoint of the two published insulator sockets, which is on the mast's
   * own axis by construction (they are at local +/-0.42 x on a symmetric
   * crossarm), so it reduces to one offset along the pole's up and needs no
   * per-pole quaternion. Silent failure is the thing to avoid here: with no
   * sockets the wires would be drawn along the ground, which reads as a
   * different bug entirely, so it is said out loud and published in the report.
   */
  load(poleScene: THREE.Object3D | null): void {
    const a = poleScene?.getObjectByName('socket_wire_a');
    const b = poleScene?.getObjectByName('socket_wire_b');
    if (a === undefined || b === undefined) {
      console.error(`[of] ${this.name}: power_pole.glb published no`
        + ' socket_wire_a/socket_wire_b; wires will be drawn at ground level');
      this.attachM = 0;
      this.attachFromAsset = false;
      return;
    }
    this.attachM = (a.position.y + b.position.y) * 0.5;
    this.attachFromAsset = true;
  }

  /**
   * Draw whatever /core currently says the grid is wired like.
   *
   * Two guards, and they are the reason this is cheap: the edge list is pulled
   * only when the plan generation moves, and the transforms are rewritten only
   * when the edge list or the floating origin moves. A steady frame does none
   * of it.
   */
  sync(f: WireSource, origin: FloatingOrigin): void {
    this.origin = origin;
    const gen = f.line.rebuilds;
    const moved = gen !== this.gen;
    if (moved) { this.gen = gen; this.pull(f); }
    if (!moved && this.rebases === origin.rebases) return;
    this.rebases = origin.rebases;
    this.place(origin);
  }

  /** ONE crossing of the WASM boundary, and one resolve of both ends. */
  private pull(f: WireSource): void {
    this.rows = f.power.wires();
    this.pulls++;
    const a = f.anchor();
    this.ends = [];
    this.unmatched = 0;
    for (const w of this.rows) {
      this.ends.push(this.endAt(f, a.x + w.ax, a.y + w.ay, a.z + w.az));
      this.ends.push(this.endAt(f, a.x + w.bx, a.y + w.by, a.z + w.bz));
    }
  }

  /**
   * Which placed pole /core means by this endpoint, and therefore which way is
   * up there. The plan's own `up` rather than the radial, because a site is
   * levelled to its own plane and on a slope the two differ by degrees, which
   * over a 4 m mast is a wire that misses the crossarm by a visible margin.
   */
  private endAt(f: WireSource, x: number, y: number, z: number): WireEnd {
    let best: WirePoleRow | null = null;
    let bestD = MATCH_M;
    for (const p of f.placed) {
      if (p.kind !== 'pole') continue;
      const d = Math.hypot(p.pos.x - x, p.pos.y - y, p.pos.z - z);
      if (d >= bestD) continue;
      bestD = d;
      best = p;
    }
    if (best === null) {
      // /core reported a wire ending where the plan has no pole. Not drawn at
      // the origin and not skipped: drawn at the point /core named, with the
      // radial for an up, and COUNTED, because a silent fallback here is how a
      // stale edge list would look exactly like a working one.
      this.unmatched++;
      const r = Math.hypot(x, y, z) || 1;
      return { x, y, z, up: new THREE.Vector3(x / r, y / r, z / r), matched: false };
    }
    return { x: best.pos.x, y: best.pos.y, z: best.pos.z, up: best.up, matched: true };
  }

  /** One matrix per segment, in engine space, from the cached body-frame ends. */
  private place(origin: FloatingOrigin): void {
    const want = this.rows.length;
    const draw = Math.min(want, this.ensure(want));
    for (let i = 0; i < draw; ++i) {
      const p = this.ends[i * 2];
      const q = this.ends[i * 2 + 1];
      origin.toEngine(p, this.a).addScaledVector(p.up, this.attachM);
      origin.toEngine(q, this.b).addScaledVector(q.up, this.attachM);
      this.d.subVectors(this.b, this.a);
      const len = this.d.length();
      if (len < 1e-6) { this.d.copy(AXIS_Z); } else { this.d.multiplyScalar(1 / len); }
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
      this.q.setFromUnitVectors(AXIS_Z, this.d);
      this.s.set(THICK_M, THICK_M, Math.max(len, 1e-4));
      this.m.compose(this.mid, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.live = draw;
    this.mesh.count = draw;
    this.mesh.instanceMatrix.needsUpdate = true;
    // An empty grid draws NOTHING, not an empty mesh: three skips an invisible
    // object entirely, so with no poles the draw-call cost of this file is 0.
    this.group.visible = draw > 0;
  }

  /**
   * Capacity for `want` instances, doubling; returns what is actually available.
   *
   * The same policy as MachineBatch.grow, for the same reason: a fixed cap
   * would not get slower at the wall, it would stop drawing, and a base whose
   * wires stop halfway is indistinguishable from a base whose grid is broken.
   */
  private ensure(want: number): number {
    if (want <= this.cap) return this.cap;
    let next = this.cap;
    while (next < want && next < this.ceiling) next = Math.min(next * 2, this.ceiling);
    if (next > this.cap) {
      const old = this.mesh;
      const mesh = this.makeMesh(next);
      // Every live transform survives the growth: the new buffer is strictly
      // longer, so a flat copy keeps instance i at instance i.
      (mesh.instanceMatrix.array as Float32Array)
        .set(old.instanceMatrix.array as Float32Array);
      this.group.remove(old);
      old.dispose();
      this.group.add(mesh);
      this.mesh = mesh;
      this.cap = next;
      this.grows++;
    }
    if (want > this.cap) {
      this.refused += want - this.cap;
      if (!this.warned) {
        this.warned = true;
        console.error(`[of] instance pool '${this.name}' is FULL at ${this.cap}`
          + ' segments: power wires past this exist in /core and are NOT DRAWN');
      }
    }
    return this.cap;
  }

  /** The HUD pool line and `instancePools()`. Exactly a PoolReport. */
  stats(): PoolReport {
    return {
      name: this.name, batches: this.live > 0 ? 1 : 0,
      instances: this.live, capacity: this.cap, ceiling: this.ceiling,
      grows: this.grows, refused: this.refused,
    };
  }

  /**
   * What is ACTUALLY DRAWN, read back out of the instance matrices.
   *
   * `a` and `b` are recovered from the matrix itself (its +Z column is the
   * segment, its translation the midpoint), not from the numbers that produced
   * it, and `base` is the pole position resolved against the CURRENT floating
   * origin. So a segment drawn one rebase late, or at the origin, or in a stale
   * frame, shows up as `|a - base|` no longer being the attachment height, and
   * a probe can fail on it. That is the difference between reporting a count and
   * proving a wire is where the pole is.
   */
  report(): unknown {
    const o = this.origin;
    const e = this.mesh.instanceMatrix.array;
    const segs: {
      a: number[]; b: number[]; base: number[][] | null;
      matched: boolean; network: number;
    }[] = [];
    for (let i = 0; i < this.live; ++i) {
      const k = i * 16;
      const half = [e[k + 8] * 0.5, e[k + 9] * 0.5, e[k + 10] * 0.5];
      const mid = [e[k + 12], e[k + 13], e[k + 14]];
      const p = this.ends[i * 2];
      const q = this.ends[i * 2 + 1];
      segs.push({
        a: [mid[0] - half[0], mid[1] - half[1], mid[2] - half[2]],
        b: [mid[0] + half[0], mid[1] + half[1], mid[2] + half[2]],
        base: o === null ? null : [
          [p.x - o.origin.x, p.y - o.origin.y, p.z - o.origin.z],
          [q.x - o.origin.x, q.y - o.origin.y, q.z - o.origin.z],
        ],
        matched: p.matched && q.matched,
        network: this.rows[i]?.network ?? -1,
      });
    }
    return {
      ...this.stats(),
      /** How many times the edge list was pulled out of /core. Topology
       *  changes, not frames: a probe checks it is not climbing per frame. */
      pulls: this.pulls,
      coreSegments: this.rows.length,
      unmatchedEnds: this.unmatched,
      attachM: this.attachM,
      attachFromAsset: this.attachFromAsset,
      thickM: THICK_M,
      visible: this.group.visible,
      segments: segs,
    };
  }
}
