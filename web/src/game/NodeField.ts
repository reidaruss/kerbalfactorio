// The harvestable world: where the nodes are, what they look like, and how they
// visibly deplete.
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
// swapping one for another is a visibility flip with no re-snap and no pop.

import * as THREE from 'three';
import { loadGlb, selectLod } from '../assets/Loaders.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { GameCore, NodeState } from './GameCore.js';
import { NODE_KIND } from './GameCore.js';

const ROOT = 'assets/nodes/';

/** One .glb per node kind, plus the root node name the meshes are prefixed with. */
interface NodeArt { file: string; root: string; radiusM: number }

/** Kind -> art. Trees alternate between two files so a stand is not a clone army. */
const ART: Record<number, NodeArt[]> = {
  [NODE_KIND.Tree]: [
    { file: 'tree_conifer.glb', root: 'TreeConifer', radiusM: 1.6 },
    { file: 'tree_broadleaf.glb', root: 'TreeBroadleaf', radiusM: 2.2 },
  ],
  [NODE_KIND.Rock]: [{ file: 'boulder_stone.glb', root: 'BoulderStone', radiusM: 1.0 }],
  [NODE_KIND.CoalSeam]: [{ file: 'boulder_coal.glb', root: 'BoulderCoal', radiusM: 1.1 }],
  [NODE_KIND.IronOre]: [{ file: 'boulder_iron.glb', root: 'BoulderIron', radiusM: 1.1 }],
  [NODE_KIND.CopperOre]: [{ file: 'boulder_copper.glb', root: 'BoulderCopper', radiusM: 1.0 }],
};

/**
 * Depletion thresholds, from ASSET-SPECS 3.1: remaining/initial at 0.66 and
 * 0.33. `Stump` exists only for the conifer, so `Low` is the floor everywhere
 * and an emptied node keeps its `Low` silhouette rather than vanishing, which
 * is what tells a player "this one is done" instead of "this one moved".
 */
const VARIANTS = ['Full', 'Half', 'Low'] as const;
function variantFor(fraction: number): string {
  if (fraction > 0.66) return 'Full';
  if (fraction > 0.33) return 'Half';
  return 'Low';
}

interface Placed {
  index: number;
  group: THREE.Group;
  root: string;
  radiusM: number;
  /** 64-bit body-frame position. THE anchor; engine space is derived from it. */
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  variant: string;
  /** Seconds left in the hit reaction. */
  punch: number;
  empty: boolean;
}

function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
const frac = (h: number): number => (h >>> 8) / 16777216;

export class NodeField {
  readonly group = new THREE.Group();
  readonly placed: Placed[] = [];
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly core: GameCore, private readonly origin: FloatingOrigin) {
    this.group.name = 'harvestNodes';
  }

  /** Preload every node .glb once. Six files, all untextured, about 90 kB. */
  async load(): Promise<void> {
    const files = new Set<string>();
    for (const list of Object.values(ART)) for (const a of list) files.add(a.file);
    await Promise.all([...files].map(async (f) => {
      const g = await loadGlb(ROOT + f);
      this.templates.set(f, g.scene);
    }));
  }

  /**
   * Scatter a clearing of nodes around `dir` and build their meshes.
   *
   * Placement is ours, not `/core`'s, and that is a measured choice rather than
   * a shortcut: worldgen::survival::LayoutTestArea jitters every node by up to
   * 0.0003 rad, which is 180 m at Forge's 600 km radius, so at any walkable ring
   * radius the jitter is an order of magnitude larger than the ring. What stays
   * `/core`'s is everything that is a RULE: the resource, the amount, the grade,
   * and, through of_gp_node_add, the surface the node stands on.
   */
  populate(body: number, edits: number, dir: THREE.Vector3, seed: number): number {
    this.core.clearNodes();
    for (const pl of this.placed) this.group.remove(pl.group);
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

  /** The clearing's contents. Enough wood and iron in reach to craft the tools. */
  private plan(): number[] {
    const K = NODE_KIND;
    return [
      K.Tree, K.IronOre, K.Tree, K.Rock, K.Tree, K.CoalSeam,
      K.Tree, K.IronOre, K.Rock, K.Tree, K.CopperOre, K.Tree,
      K.Rock, K.Tree, K.IronOre, K.CoalSeam, K.Tree, K.Rock,
      K.Tree, K.CopperOre, K.Tree, K.IronOre, K.Rock, K.Tree,
    ];
  }

  private build(index: number, st: NodeState, kind: number, h: number): void {
    const list = ART[kind];
    if (list === undefined) return;
    const art = list[Math.floor(frac(hash32(h, 3)) * list.length) % list.length];
    const tpl = this.templates.get(art.file);
    if (tpl === undefined) return;
    const g = new THREE.Group();
    const clone = tpl.clone(true);
    // ASSET-SPECS 2.5: a col_* proxy is a physics box in the same file, and
    // adding one to the scene draws a grey cube through the middle of the asset.
    selectLod(clone, '_LOD0');
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(clone);
    g.rotateY(frac(hash32(h, 5)) * Math.PI * 2);
    this.group.add(g);
    const up = new THREE.Vector3(st.x, st.y, st.z).normalize();
    const pl: Placed = {
      index, group: g, root: art.root, radiusM: art.radiusM,
      pos: { x: st.x, y: st.y, z: st.z }, up,
      variant: '', punch: 0, empty: st.remaining <= 0,
    };
    this.placed.push(pl);
    this.setVariant(pl, variantFor(st.initial > 0 ? st.remaining / st.initial : 0));
  }

  /**
   * Flip which depletion variant is visible. `selectLod` already hid every
   * `_LOD1`/`_LOD2` and every `col_*`, so this only has to agree about LOD0.
   */
  private setVariant(pl: Placed, variant: string): void {
    if (pl.variant === variant) return;
    pl.variant = variant;
    const want = `${pl.root}_${variant}_LOD0`;
    pl.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      if (m.name.startsWith('col_')) { m.visible = false; return; }
      // GLTFLoader splits a multi-material mesh into `<name>_0`, `<name>_1`, ...
      const base = /_(\d+)$/.test(m.name) ? m.name.replace(/_(\d+)$/, '') : m.name;
      for (const v of VARIANTS) {
        if (base === `${pl.root}_${v}_LOD0`) { m.visible = base === want; return; }
      }
      // Anything that is not a variant LOD0 (a stump, a higher LOD) stays hidden.
      if (/_LOD[12]$/.test(base) || /_Stump_/.test(base)) m.visible = false;
    });
  }

  /** Start the hit reaction on a node. Purely visual; the sim already moved. */
  punch(index: number): void {
    const pl = this.placed.find((n) => n.index === index);
    if (pl !== undefined) pl.punch = 0.22;
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
      this.origin.toEngine(pl.pos, this.p);
      pl.group.position.copy(this.p);
      this.q.setFromUnitVectors(this.up, pl.up);
      pl.group.quaternion.copy(this.q);
      if (pl.punch > 0) {
        pl.punch = Math.max(0, pl.punch - dt);
        // A decaying wobble about the ground normal reads as "that hit landed"
        // from any angle, unlike a scale pulse, which is invisible head on.
        const k = pl.punch / 0.22;
        pl.group.rotateY(Math.sin(k * 34) * 0.10 * k);
        pl.group.scale.setScalar(1 - 0.06 * k);
      } else if (pl.group.scale.x !== 1) {
        pl.group.scale.setScalar(1);
      }
      pl.group.updateMatrixWorld(true);
    }
  }

  /** Nearest node whose sphere the aim ray enters, within `reachM`. */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number): Placed | null {
    let best: Placed | null = null;
    let bestT = reachM;
    for (const pl of this.placed) {
      const ox = pl.pos.x - eye.x, oy = pl.pos.y - eye.y, oz = pl.pos.z - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -pl.radiusM || t > bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      // A tree is tall and its origin is at the base, so the pick sphere is
      // raised and widened rather than centred on the pivot; aiming at a trunk
      // at chest height must hit, and it does not with a base-centred sphere.
      const perp = Math.hypot(cx, cy, cz);
      if (perp > pl.radiusM * 1.35 + 0.6) continue;
      best = pl; bestT = Math.max(0, t);
    }
    return best;
  }

  stats(): { nodes: number; empty: number } {
    return { nodes: this.placed.length, empty: this.placed.filter((p) => p.empty).length };
  }
}
