// The harvestable world: where the nodes are, what they look like, how they
// visibly deplete, and what a landed swing does to them.
//
// The nodes THEMSELVES live in WASM (of_gp_node_*), because RemainingAmount is
// sim state and the depletion diff is what persistence will save. This module
// owns only the presentation: which .glb, which `_Full`/`_Half`/`_Low` variant,
// and where it sits in engine space this frame.
//
// WORLD-ANCHORED, like everything else that is not the camera. Each node keeps
// its 64-bit body-frame position and re-derives its engine transform through
// FloatingOrigin.toEngine every frame, so a rebase cannot leave a boulder
// hanging in the air (ARCHITECTURE.md 3.6).
//
// The three depletion variants share a pivot by contract (ASSET-SPECS 2.7), so
// swapping one for another is a geometry-id write with no re-snap and no pop.
//
// THE ART IS BATCHED (DW-11): see NodeBatch. A node is a set of instance slots,
// one per material it uses, not a cloned Group.

import * as THREE from 'three';
import { loadGlb } from '../assets/Loaders.js';
import { NodeBatch, type NodePart } from './NodeBatch.js';
import { ART, frac, hash32, variantFor, type NodeArt } from './NodeArt.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { GameCore, NodeState } from './GameCore.js';
import { NODE_KIND } from './GameCore.js';

/**
 * The warm, sun-bleached end of the tree spread. MUCH weaker than the
 * understorey's DRY (1.22, 1.06, 0.62), and not because trees are less varied.
 *
 * A grass tint colours one 6-triangle card among thousands, so a strong drift
 * reads as one blade catching the light. A node tint colours a 6.5 m tree that
 * the player is standing next to, and the SAME multiplier applied to an object
 * that size stops reading as light and starts reading as a different species.
 * The understorey's own comment makes this argument for flowers; at tree scale
 * it binds harder, so the drift is capped lower and there is no flower branch.
 */
const TREE_DRY = new THREE.Vector3(1.14, 1.05, 0.76);

/**
 * The colour multiplier for ONE placed node.
 *
 * Value jitter is what breaks up a stand at a glance; the hue drift is what
 * stops it reading as one paint colour on a second look. `ScatterLook.tintFor`
 * argues both at length for the understorey and this is deliberately the same
 * shape, but it is NOT a call into that function: the flower branch would put a
 * 1.70/1.50/0.38 yellow on a whole conifer, and the value range there (0.80 to
 * 1.18) is wide enough that two neighbouring trees would differ by more than a
 * third in brightness, which at tree size reads as a lighting bug rather than
 * as variation.
 *
 * Ore boulders take VALUE ONLY, for the reason ScatterLook already gives: a
 * rock whose hue wandered reads as a different rock rather than as the same
 * rock in different light, and the point of the mineral family is that it is
 * one substance. It matters more here than for scatter, because a node's colour
 * is how the player identifies what they are about to mine.
 */
function nodeTint(isTree: boolean, h: number, out: THREE.Color): THREE.Color {
  const v = 0.88 + frac(hash32(h, 17)) * 0.24;
  if (!isTree) return out.setRGB(v, v, v);
  const d = frac(hash32(h, 19));
  // Squared, so most trees sit near their own species colour and only a few
  // drift far. Linear would spread the stand evenly across the range and read
  // as two species mixed, which is the failure the understorey names.
  const t = d * d * 0.55;
  return out.setRGB(
    v * (1 + (TREE_DRY.x - 1) * t),
    v * (1 + (TREE_DRY.y - 1) * t),
    v * (1 + (TREE_DRY.z - 1) * t),
  );
}

const ROOT = 'assets/nodes/';

/** Seconds the hit reaction lasts. Short: a swing lands, it does not bounce. */
const PUNCH_SECS = 0.26;
/** Seconds the felled collapse takes to settle. It never plays backwards. */
const FELL_SECS = 0.9;

interface Placed {
  index: number;
  kind: number;
  art: NodeArt;
  parts: readonly NodePart[];
  slots: number[];
  /** 64-bit body-frame position. THE anchor; engine space is derived from it. */
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  yaw: number;
  variant: number;
  /** Seconds left in the hit reaction. */
  punch: number;
  /** Seconds left in the FELLED collapse. Runs once, when the node empties. */
  fell: number;
  /** Tangent axis the collapse leans about, fixed per node so it never jitters. */
  lean: THREE.Vector3;
  empty: boolean;
  /** Art scale. An outcrop varies with the richness of the ground it sits in. */
  scale: number;
  /**
   * Metres pushed INWARD along the ground normal. Zero for a tree; positive for
   * an outcrop, which is the part of a buried ore body that breaks the surface
   * and therefore has to be seen coming out of the ground rather than resting
   * on it.
   */
  sinkM: number;
}

export interface HitPoint {
  pos: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  colour: number;
}

export class NodeField {
  readonly group = new THREE.Group();
  readonly placed: Placed[] = [];
  readonly batch = new NodeBatch();
  private readonly templates = new Map<string, { root: string; scene: THREE.Object3D }>();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qFell = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Vector3();
  private readonly tintC = new THREE.Color();
  private readonly engineUp = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Nodes that have visibly collapsed, for the HUD counters and the probe. */
  felled = 0;

  constructor(private readonly core: GameCore, private readonly origin: FloatingOrigin) {
    this.group.name = 'harvestNodes';
    this.group.add(this.batch.group);
  }

  /** Preload every node .glb once, then collapse them into the batches. */
  async load(): Promise<void> {
    const want = new Map<string, string>();
    for (const list of Object.values(ART)) for (const a of list) want.set(a.file, a.root);
    await Promise.all([...want].map(async ([file, root]) => {
      const g = await loadGlb(ROOT + file);
      this.templates.set(file, { root, scene: g.scene });
    }));
    this.batch.build(this.templates);
  }

  /**
   * Scatter the clearing's STANDALONE nodes around `dir` and build them.
   *
   * Ore does not come from here any more. A tree is a thing you chop and it is
   * gone; ore is a patch of ground (OreField), and the pieces of it that break
   * the surface are added afterwards through `addOutcrop`. So what this lays out
   * is scenery you can harvest, and everything that is a RULE is still /core's:
   * the resource, the amount, the grade, and through of_gp_node_add the surface
   * the node stands on.
   *
   * Placement is ours, not `/core`'s, and that is a measured choice rather than
   * a shortcut: worldgen::survival::LayoutTestArea jitters every node by up to
   * 0.0003 rad, which is 180 m at Forge's 600 km radius, so at any walkable ring
   * radius the jitter is an order of magnitude larger than the ring.
   */
  populate(body: number, edits: number, dir: THREE.Vector3, seed: number): number {
    this.core.clearNodes();
    // RELEASED, not just hidden. A slot that is only hidden is never handed out
    // again, so regrowing the clearing leaks one instance per node per regrow.
    for (const pl of this.placed)
      for (let i = 0; i < pl.parts.length; ++i)
        this.batch.release(pl.parts[i].material, pl.slots[i]);
    this.placed.length = 0;

    // A tangent basis at the spawn direction, so a metre offset is a metre.
    const d = dir.clone().normalize();
    const t1 = new THREE.Vector3(0, 1, 0);
    if (Math.abs(d.y) > 0.99) t1.set(1, 0, 0);
    t1.crossVectors(t1, d).normalize();
    const t2 = new THREE.Vector3().crossVectors(d, t1).normalize();
    const R = 600000;   // only the SCALE of the offset; the snap is the oracle's

    const plan = this.plan();
    for (let i = 0; i < plan.length; ++i) {
      const h = hash32(seed, i);
      // Golden-angle spiral: even coverage with no clumping and no grid look.
      const ang = i * 2.399963229728653 + frac(hash32(h, 7)) * 0.6;
      const rad = 7 + Math.sqrt((i + 0.6) / plan.length) * 46 + frac(hash32(h, 11)) * 4;
      const ox = (Math.cos(ang) * rad) / R;
      const oy = (Math.sin(ang) * rad) / R;
      const nd = new THREE.Vector3(
        d.x + t1.x * ox + t2.x * oy,
        d.y + t1.y * ox + t2.y * oy,
        d.z + t1.z * ox + t2.z * oy,
      ).normalize();
      const idx = this.core.addNode(body, edits, plan[i], nd.x, nd.y, nd.z);
      if (idx < 0) continue;
      const st = this.core.node(idx);
      if (st !== null) this.build(idx, st, plan[i], h);
    }
    return this.placed.length;
  }

  /**
   * The clearing's standalone contents: trees, and nothing else. Wood is one
   * half of every starting tool; the other half is ore, and ore now comes out of
   * the ground the drills stand on.
   */
  private plan(): number[] {
    return new Array<number>(14).fill(NODE_KIND.Tree);
  }

  /**
   * Add one OUTCROP: a piece of an ore patch breaking the surface.
   *
   * The node index is already /core's (of_gp_node_add_outcrop made it and linked
   * it to its patch), so this is presentation only. `scale` and `sink` come from
   * deposits.h §P, which means a piece standing in rich ground is bigger and a
   * piece at the rim is a stub, and every one of them is part buried.
   */
  addOutcrop(index: number, scale: number, sink: number): boolean {
    const st = this.core.node(index);
    if (st === null) return false;
    const before = this.placed.length;
    this.build(index, st, st.kind, hash32(index, 0x0c40b), scale, sink);
    return this.placed.length > before;
  }

  private build(index: number, st: NodeState, kind: number, h: number,
                scale = 1, sinkM = 0): void {
    const list = ART[kind];
    if (list === undefined) return;
    const art = list[Math.floor(frac(hash32(h, 3)) * list.length) % list.length];
    const parts = this.batch.partsOf(art.file);
    if (parts === null) return;
    const slots = parts.map((p) => this.batch.acquire(p.material));
    const isTree = kind === NODE_KIND.Tree;
    // PER-INSTANCE SIZE, TREES ONLY. Outcrop scale is derived from the richness
    // of the deposit under it and means something, so it is left exactly alone;
    // trees were the ones pinned at a literal 1.0. The range is deliberately
    // narrow, and the reason is a real inconsistency rather than taste: the
    // harvest reach is `art.radiusM` and the hit point is `art.hitUpM`, neither
    // of which scales with this, so a big tree and a small tree are chopped from
    // the same distance. At +/-14% that is under the aim tolerance; at +/-40% it
    // would be a gameplay bug wearing an art change's clothes.
    const size = isTree ? 0.86 + frac(hash32(h, 13)) * 0.28 : 1;
    nodeTint(isTree, h, this.tintC);
    for (let i = 0; i < parts.length; ++i)
      this.batch.tint(parts[i].material, slots[i], this.tintC);
    const up = new THREE.Vector3(st.x, st.y, st.z).normalize();
    // A fixed tangent axis per node: the direction a felled tree goes over.
    const lean = new THREE.Vector3(-up.y, up.x, 0);
    if (lean.lengthSq() < 1e-9) lean.set(1, 0, 0);
    lean.normalize().applyAxisAngle(up, frac(hash32(h, 9)) * Math.PI * 2);
    const pl: Placed = {
      index, kind, art, parts, slots,
      pos: { x: st.x, y: st.y, z: st.z },
      up,
      yaw: frac(hash32(h, 5)) * Math.PI * 2,
      variant: -1, punch: 0, fell: 0, lean, empty: st.remaining <= 0,
      scale: scale * size, sinkM,
    };
    this.placed.push(pl);
    this.setVariant(pl, variantFor(st.initial > 0 ? st.remaining / st.initial : 0));
  }

  /** Point every one of a node's slots at the geometry for `variant`. */
  private setVariant(pl: Placed, variant: number): void {
    if (pl.variant === variant) return;
    pl.variant = variant;
    this.compose(pl, 0);
    for (let i = 0; i < pl.parts.length; ++i)
      this.batch.set(pl.parts[i].material, pl.slots[i], pl.parts[i].geom[variant], this.m);
  }

  /** Build `this.m` for a node: engine position, ground normal, yaw, hit reaction. */
  private compose(pl: Placed, punch: number): void {
    this.origin.toEngine(pl.pos, this.p);
    this.q.setFromUnitVectors(this.up, pl.up);
    // A decaying wobble about the ground normal reads as "that hit landed" from
    // any angle, unlike a scale pulse, which is invisible head on. The yaw is
    // composed here rather than baked at build time, so every node in a stand
    // faces a different way.
    this.qYaw.setFromAxisAngle(this.up, pl.yaw + Math.sin(punch * 46) * 0.13 * punch);
    this.q.multiply(this.qYaw);
    // Squash, not shrink: a struck tree compresses along its own trunk.
    this.s.set(1 + 0.05 * punch, 1 - 0.11 * punch, 1 + 0.05 * punch);
    this.s.multiplyScalar(pl.scale);
    // An outcrop is pushed INTO the ground along its own normal, so the ore
    // reads as rock breaking through the surface rather than a boulder somebody
    // put down. The offset is metres of the node's own size, not a constant.
    if (pl.sinkM > 0) {
      this.p.addScaledVector(this.engineUp.set(pl.up.x, pl.up.y, pl.up.z), -pl.sinkM);
    }
    if (pl.fell > 0) this.collapse(pl);
    this.m.compose(this.p, this.q, this.s);
  }

  /**
   * THE FELLED MOTION, folded into the same compose the hit reaction uses.
   *
   * A tree goes OVER: it leans about a fixed tangent axis, accelerating, which
   * is the one motion that reads as felling from any angle. A boulder cannot
   * topple, so it drops and shrinks into its own footprint instead. Both end at
   * the `_Low` silhouette the variant swap already produces, so the collapse
   * hands over to the stump rather than fighting it.
   */
  private collapse(pl: Placed): void {
    // `fell` counts UP and SATURATES: it is elapsed time since the last swing,
    // not a countdown. A countdown would run out and the node would spring back
    // upright, which is the one thing a felled node must never do.
    const k = Math.min(1, pl.fell / FELL_SECS);
    const ease = k * k;
    if (pl.kind === NODE_KIND.Tree) {
      this.qFell.setFromAxisAngle(pl.lean, ease * 1.35);
      this.q.premultiply(this.qFell);
      this.s.multiplyScalar(1 - 0.18 * ease);
    } else {
      // Sink along the node's own up, so a boulder settles into the ground.
      const drop = ease * 0.42;
      this.p.addScaledVector(this.engineUp.set(pl.up.x, pl.up.y, pl.up.z), -drop);
      this.s.multiplyScalar(1 - 0.42 * ease);
      this.qFell.setFromAxisAngle(pl.lean, Math.sin(ease * 9) * 0.16 * (1 - ease));
      this.q.premultiply(this.qFell);
    }
  }

  /** Start the hit reaction on a node. Purely visual; the sim already moved. */
  punch(index: number): void {
    const pl = this.placed.find((n) => n.index === index);
    if (pl !== undefined) pl.punch = PUNCH_SECS;
  }

  /**
   * Start the collapse. Called once, on the swing that emptied the node.
   *
   * `away` is the tangent direction the node should go over in, which is away
   * from whoever felled it. A hashed axis was tried first and a tree that falls
   * ON the player fills the whole screen with bark: dramatic once, obstructive
   * every time after. Rotating `up` about `up x away` tips the trunk along
   * `away` exactly, because `(up x away) x up == away` for a tangent `away`.
   */
  fell(index: number, away?: { x: number; y: number; z: number }): void {
    const pl = this.placed.find((n) => n.index === index);
    if (pl === undefined || pl.fell > 0) return;
    if (away !== undefined) {
      const a = new THREE.Vector3(away.x, away.y, away.z);
      a.addScaledVector(pl.up, -a.dot(pl.up));
      if (a.lengthSq() > 1e-9) pl.lean.crossVectors(pl.up, a.normalize()).normalize();
    }
    pl.fell = 1e-4;
    this.felled++;
  }

  /** worldgen::survival::NodeKind of a placed node, or -1. */
  kindOf(index: number): number {
    return this.placed.find((n) => n.index === index)?.kind ?? -1;
  }

  /**
   * Where a swing on `index` lands, in the body frame, and what colour it is.
   * The node's own art decides the height, so a chop lands on the trunk and a
   * pick lands on the boulder rather than both landing at the pivot in the dirt.
   */
  hitPoint(index: number): HitPoint | null {
    const pl = this.placed.find((n) => n.index === index);
    if (pl === undefined) return null;
    const u = pl.up, r = pl.art.hitUpM * pl.scale - pl.sinkM;
    return {
      pos: { x: pl.pos.x + u.x * r, y: pl.pos.y + u.y * r, z: pl.pos.z + u.z * r },
      up: { x: u.x, y: u.y, z: u.z },
      colour: pl.art.colour,
    };
  }

  /** Re-read every node's depletion state and re-place it in engine space. */
  update(dt: number): void {
    for (const pl of this.placed) {
      const st = this.core.node(pl.index);
      if (st !== null) {
        const f = st.initial > 0 ? st.remaining / st.initial : 0;
        this.setVariant(pl, variantFor(f));
        pl.empty = st.remaining <= 0;
      }
      if (pl.punch > 0) pl.punch = Math.max(0, pl.punch - dt);
      if (pl.fell > 0) pl.fell = Math.min(FELL_SECS, pl.fell + dt);
      this.compose(pl, pl.punch / PUNCH_SECS);
      for (let i = 0; i < pl.parts.length; ++i)
        this.batch.move(pl.parts[i].material, pl.slots[i], this.m);
    }
  }

  /**
   * Nearest node whose sphere the aim ray enters, within `reachM`.
   *
   * REACH IS MEASURED TO THE NODE, NOT TO ITS PIVOT. A tree's origin is on the
   * ground and the eye is 1.6 m above it, so a player standing at a natural
   * chopping distance from a trunk is 4.1 m from the PIVOT and the pick used to
   * refuse: you could see the tree filling the screen and not be allowed to
   * swing at it, with no way to get closer because the walk stops there too.
   * Subtracting the node's own radius is the same rule every melee reach uses.
   */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number): Placed | null {
    let best: Placed | null = null;
    let bestT = reachM;
    for (const pl of this.placed) {
      const ox = pl.pos.x - eye.x, oy = pl.pos.y - eye.y, oz = pl.pos.z - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      // The pick sphere follows the art: an outcrop standing in rich ground is
      // bigger than a stub at the rim, and aiming at what you can see has to hit.
      const rad = pl.art.radiusM * pl.scale;
      const surfaceT = Math.max(0, t - rad);
      if (t < -rad || surfaceT > bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      // A tree is tall and its origin is at the base, so the pick sphere is
      // raised and widened rather than centred on the pivot; aiming at a trunk
      // at chest height must hit, and it does not with a base-centred sphere.
      const perp = Math.hypot(cx, cy, cz);
      if (perp > rad * 1.35 + 0.6) continue;
      best = pl; bestT = surfaceT;
    }
    return best;
  }

  stats(): { nodes: number; empty: number; felled: number; collapsing: number;
             batches: number; instances: number; free: number;
             capacity: number; slots: number;
             ceiling: number; grows: number; refused: number } {
    const b = this.batch.stats();
    let slots = 0;
    for (const p of this.placed) slots += p.slots.filter((s) => s >= 0).length;
    return {
      nodes: this.placed.length,
      empty: this.placed.filter((p) => p.empty).length,
      felled: this.felled,
      collapsing: this.placed.filter((p) => p.fell > 0 && p.fell < FELL_SECS).length,
      batches: b.batches, instances: b.instances,
      // `instances` is what the batch thinks is live and `slots` is what the
      // nodes actually hold. They must agree; a gap is a leak.
      free: this.batch.detail().free, capacity: b.capacity, slots,
      // DW-28. The pool now DOUBLES instead of returning -1 at a fixed 128, and
      // `refused` is the number that must stay zero: it counts nodes that exist
      // and can be mined and are not on screen. A silent exhaustion here is
      // exactly the failure that hid 150-machine bases and 25% of the foliage.
      ceiling: b.ceiling, grows: b.grows, refused: b.refused,
    };
  }
}
