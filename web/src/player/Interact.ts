// Aim at a harvest node, press the mine key, swing, get items.
//
// ONE responsibility: turn an aim ray plus an edge-detected key into a call to
// /core's harvestNode, at the moment the authored swing actually connects. It
// owns no yields (gameplay.h decides those from what is in the pack), no node
// state (WASM owns RemainingAmount) and no meshes (NodeField owns those).
//
// THE IMPACT FRAME IS A CONTRACT. ASSET-SPECS pins pickaxe impact at frame 17
// and axe at 18 of a 33-frame swing, identical in the body rig and the FP arms,
// so the grant fires when the tool visibly lands rather than when the key went
// down. Granting on keydown is the single clearest tell that a game is a menu
// with a camera attached.

import type { GameCore } from '../game/GameCore.js';
import type { NodeField } from '../game/NodeField.js';
import type { Avatar } from './Avatar.js';
import type { Controller } from './Controller.js';

export const HARVEST = {
  /** Metres. Slightly under the dig reach so the two never fight over one press. */
  reachM: 4.0,
  /** Bare hands, and with the assisting tool. gameplay.h applies the choice. */
  baseYield: 2,
  toolYield: 5,
  /** Ticks from keydown to the grant. Frame 17 of 33 at 60 Hz. */
  impactTicks: 17,
  /** Ticks between swings while the key is held. The clip is 33 frames long. */
  cooldownTicks: 34,
};

export interface AimTarget {
  index: number;
  /** The item this node yields, by its /core display name. */
  name: string;
  fraction: number;
  remaining: number;
  distanceM: number;
  empty: boolean;
}

export interface HarvestEvent {
  item: number;
  name: string;
  granted: number;
  usedTool: boolean;
  nodeEmpty: boolean;
  /** Sim tick the grant landed on, so a probe can prove it advanced. */
  tick: number;
}

export class Interact {
  target: AimTarget | null = null;
  /** The last grant, kept for the HUD toast and for __of.game(). */
  last: HarvestEvent | null = null;
  swings = 0;
  grants = 0;
  granted = 0;
  misses = 0;

  private cooldown = 0;
  private pending = -1;
  private pendingIndex = -1;
  private held = false;

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

    const pressed = held && !this.held;
    this.held = held;
    if (pressed && this.cooldown === 0 && this.target !== null && !this.target.empty) {
      this.cooldown = HARVEST.cooldownTicks;
      this.pending = HARVEST.impactTicks;
      this.pendingIndex = this.target.index;
      this.swings++;
      this.avatar?.swing();
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
    if (r.granted === 0) { this.misses++; return false; }
    this.field.punch(index);
    this.grants++;
    this.granted += r.granted;
    this.last = {
      item: r.resource, name: this.core.itemName(r.resource), granted: r.granted,
      usedTool: r.usedTool, nodeEmpty: r.nodeEmpty, tick,
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
    };
  }

  /** Harvest right now, ignoring reach and the swing. The probe path. */
  harvestNow(index: number, tick: number): boolean { return this.grant(index, tick); }

  report(): unknown {
    return {
      swings: this.swings, grants: this.grants, granted: this.granted,
      misses: this.misses, target: this.target, last: this.last,
    };
  }
}
