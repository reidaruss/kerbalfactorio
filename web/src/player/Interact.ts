// Aim at a harvest node, press the mine key, swing, get items.
//
// ONE responsibility: turn an aim ray plus an edge-detected key into a call to
// /core's harvestNode, at the moment the authored swing actually connects. It
// owns no yields (gameplay.h decides those from what is in the pack), no node
// state (WASM owns RemainingAmount) and no meshes (NodeField owns those).
//
// THE IMPACT FRAME IS A CONTRACT, and DW-34 MOVED IT. ASSET-SPECS pins pickaxe
// impact at authored frame 17 and axe at 18 of a 33-key swing, identical in the
// body rig and the FP arms, so the grant fires when the tool visibly lands
// rather than when the key went down. Granting on keydown is the single
// clearest tell that a game is a menu with a camera attached.
//
// The exporter used to write the first key at Blender frame 1, so a clip opened
// with a 16.7 ms dead hold and the RUNTIME tick of an authored frame was one
// higher than its index. DW-34 shifted the first key to frame 0, which removes
// the hold and makes sample index and tick index coincide. The published
// indices therefore all move down by one: pickaxe 17 -> 16, axe 18 -> 17, dig
// 16 -> 15, read back out of the exported sampler and not inferred. This
// constant and the re-exported clips are one commit for that reason.

import { NODE_KIND } from '../game/GameCore.js';
import type { GameCore } from '../game/GameCore.js';
import type { NodeField } from '../game/NodeField.js';
import type { Avatar } from './Avatar.js';
import type { Controller } from './Controller.js';
import { SWING_CLIPS, type SwingKind } from './AnimGraph.js';

export const HARVEST = {
  /** Metres. Slightly under the dig reach so the two never fight over one press. */
  reachM: 4.0,
  /**
   * 0 and 0 mean "gameplay.h decides", and that is the point: §S.2a authors
   * SWINGS-TO-CLEAR, not units per swing, and derives the pull from the node's
   * own size. A tree and a coal seam are then the same handful of swings even
   * though the seam holds ten times as much, and the browser keeps no balance
   * opinion of its own. Non-zero would override /core, which is what a probe
   * that wants a fixed pull passes.
   */
  baseYield: 0,
  toolYield: 0,
};

/**
 * The impact tick and the cadence are PER CLIP, and they were one constant.
 * Both come from `SWING_CLIPS` (AnimGraph) so exactly one file states them:
 * pickaxe lands on tick 16 of 32, the axe on 17 of 34. The cooldown is the clip
 * length plus one, which is the one-tick gap the single constant always had.
 */
const swingTiming = (kind: SwingKind): { impact: number; cooldown: number } => {
  const c = SWING_CLIPS[kind];
  return { impact: c.impactTicks, cooldown: c.ticks + 1 };
};

export interface AimTarget {
  index: number;
  /** The item this node yields, by its /core display name. */
  name: string;
  fraction: number;
  remaining: number;
  distanceM: number;
  empty: boolean;
  /** worldgen::survival::NodeKind. A tree is chopped, everything else is mined. */
  kind: number;
}

export interface HarvestEvent {
  item: number;
  name: string;
  granted: number;
  usedTool: boolean;
  nodeEmpty: boolean;
  /** Which node took the hit, so the impact feedback lands on the right one. */
  index: number;
  /** Sim tick the grant landed on, so a probe can prove it advanced. */
  tick: number;
}

export class Interact {
  target: AimTarget | null = null;
  /** The last grant, kept for the HUD toast and for __of.game(). */
  last: HarvestEvent | null = null;
  swings = 0;
  /** Swings by tool, so a probe can prove the axe path was reached at all. */
  readonly swingKinds: Record<SwingKind, number> = { pickaxe: 0, axe: 0, dig: 0 };
  grants = 0;
  granted = 0;
  misses = 0;
  /** GP-506. Swings the tool gate turned away BEFORE they were ever committed
   *  — no cooldown paid, no animation played, for a probe to prove both. */
  refusals = 0;
  /** The most recent refusal, for the HUD toast and for a probe. */
  lastRefusal: { index: number; code: number; tick: number } | null = null;

  private cooldown = 0;
  private pending = -1;
  private pendingIndex = -1;

  constructor(
    private readonly core: GameCore,
    private readonly field: NodeField,
    private readonly player: Controller,
    private readonly avatar: Avatar | null,
  ) {}

  /** True while a node is in reach, so the dig action can stand down. */
  get hasTarget(): boolean { return this.target !== null && !this.target.empty; }

  /**
   * Fixed-tick step. Returns true on the tick a harvest was granted, so the
   * caller can see the sim moved rather than take the call's word for it.
   */
  step(held: boolean, tick: number): boolean {
    this.aim();
    if (this.cooldown > 0) this.cooldown--;

    // GP-553. HOLDING THE BUTTON SWINGS AGAIN, which is what the very first
    // sentence this game shows a player already promises ("aim at one and hold
    // Left click") and what the same button already did at bare ground.
    //
    // It fired on the RISING EDGE only, so a held button gave exactly one swing
    // for ever: measured, 45 frames of hold against a 35-tick axe cooldown
    // produced `swings: 1`. Felling one tree was five separate clicks. The
    // decisive argument is not the hint, it is that `DigAction.step` takes the
    // SAME `use` frame and says in its own comment "the cooldown makes it
    // repeat", so one button repeated at dirt and did not repeat at a tree.
    // The edge latch is DELETED rather than left dead: it was the whole
    // mechanism, and a field kept "in case" is a field the next reader has to
    // work out the purpose of.
    if (held && this.cooldown === 0 && this.target !== null && !this.target.empty) {
      // GP-506. ASK BEFORE SWINGING (GP-51's rule, applied to harvest): the
      // tool gate is knowable from the pack alone, so a refusal is caught
      // HERE, before the cooldown or the animation ever commit. Refusing
      // AFTER the swing (the old shape, still how an empty node or a full
      // pack are found out) would burn the same cooldown a real swing pays,
      // which is exactly what the brief forbids for a gated refusal.
      const gate = this.core.harvestGate(this.target.index);
      if (gate !== 0) {
        this.refusals++;
        this.lastRefusal = { index: this.target.index, code: gate, tick };
      } else {
        const kind: SwingKind = this.target.kind === NODE_KIND.Tree ? 'axe' : 'pickaxe';
        const t = swingTiming(kind);
        this.cooldown = t.cooldown;
        this.pending = t.impact;
        this.pendingIndex = this.target.index;
        this.swings++;
        this.swingKinds[kind]++;
        this.avatar?.swing(kind);
      }
    }

    if (this.pending < 0) return false;
    if (--this.pending >= 0) return false;
    return this.grant(this.pendingIndex, tick);
  }

  private grant(index: number, tick: number): boolean {
    this.pendingIndex = -1;
    const before = this.core.node(index);
    if (before === null || before.remaining <= 0) { this.misses++; return false; }
    const r = this.core.harvest(index, HARVEST.baseYield, HARVEST.toolYield);
    // GP-506. THE GATE, AUTHORITATIVE HERE TOO, not only in step()'s pre-check.
    // `step()` catches the common case before a swing ever commits, but this
    // is the one path every entry point shares (the probe's harvestNow among
    // them), so refusal has to be correct here on its own rather than assume
    // the caller already asked. Cleared unconditionally first: `lastRefusal`
    // describes THIS attempt, and a stale refusal object surviving a later
    // successful swing would read as a refusal that never actually happened.
    this.lastRefusal = null;
    if (r.refusal !== 0) {
      this.refusals++;
      this.lastRefusal = { index, code: r.refusal, tick };
      this.misses++;
      return false;
    }
    if (r.granted === 0) { this.misses++; return false; }
    this.field.punch(index);
    this.grants++;
    this.granted += r.granted;
    this.last = {
      item: r.resource, name: this.core.itemName(r.resource), granted: r.granted,
      usedTool: r.usedTool, nodeEmpty: r.nodeEmpty, index, tick,
    };
    return true;
  }

  /** Re-pick every tick: the prompt has to follow the crosshair, not the press. */
  private aim(): void {
    const ray = this.player.aimRay();
    const pl = this.field.pick(ray.origin, ray.dir, HARVEST.reachM);
    if (pl === null) { this.target = null; return; }
    const st = this.core.node(pl.index);
    if (st === null) { this.target = null; return; }
    const dx = pl.pos.x - ray.origin.x;
    const dy = pl.pos.y - ray.origin.y;
    const dz = pl.pos.z - ray.origin.z;
    this.target = {
      index: pl.index,
      name: this.core.itemName(st.resource),
      fraction: st.initial > 0 ? st.remaining / st.initial : 0,
      remaining: st.remaining,
      distanceM: Math.hypot(dx, dy, dz),
      empty: st.remaining <= 0,
      kind: st.kind,
    };
  }

  /** Harvest right now, ignoring reach and the swing. The probe path. */
  harvestNow(index: number, tick: number): boolean { return this.grant(index, tick); }

  report(): unknown {
    return {
      swings: this.swings, swingKinds: this.swingKinds,
      grants: this.grants, granted: this.granted,
      misses: this.misses, target: this.target, last: this.last,
      refusals: this.refusals, lastRefusal: this.lastRefusal,
    };
  }
}
