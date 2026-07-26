// The gameplay layer, assembled: the pack, the clearing, the swing, the HUD and
// the Tab panel, plus the one thing none of them can own alone, which is who has
// the pointer.
//
// It is a COMPOSITION, not a god object: every rule lives in `/core` behind
// GameCore, every mesh in NodeField, every pixel in src/ui, and the reach and
// impact timing in Interact. What is left here is order and the pointer.
//
// THE POINTER TRANSITION is the part worth being careful about. Opening the
// panel must release the lock, show the cursor and stop the camera dead in the
// same frame; closing it must take the lock back without the mouse having
// "moved" while the cursor was free. Input.setUiCapture does both halves,
// including clearing the accumulated deltas, because a frame's worth of
// unlocked movement applied on re-lock is a visible snap and reads as a bug.

import * as THREE from 'three';
import { GameCore } from './GameCore.js';
import { NodeField } from './NodeField.js';
import { Interact } from '../player/Interact.js';
import { GameHud } from '../ui/GameHud.js';
import { InventoryPanel, type RecipeRow, type SlotRow } from '../ui/InventoryPanel.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Controller } from '../player/Controller.js';
import type { Avatar } from '../player/Avatar.js';
import type { Input } from '../player/Input.js';

export interface GameplayDeps {
  core: OfCoreModule;
  origin: FloatingOrigin;
  player: Controller;
  avatar: Avatar | null;
  input: Input;
  host: HTMLElement;
  scene: THREE.Object3D;
  bodyHandle: number;
  seed: number;
}

export class Gameplay {
  readonly game: GameCore;
  readonly field: NodeField;
  readonly interact: Interact;
  readonly hud: GameHud;
  readonly panel: InventoryPanel;
  nodesPlaced = 0;
  private panelHeld = false;

  private constructor(private readonly d: GameplayDeps) {
    this.game = new GameCore(d.core);
    this.field = new NodeField(this.game, d.origin);
    this.interact = new Interact(this.game, this.field, d.player, d.avatar);
    this.hud = new GameHud(d.host);
    this.panel = new InventoryPanel(d.host, (i) => this.craft(i));
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await g.field.load();
    d.scene.add(g.field.group);
    g.populate();
    return g;
  }

  /**
   * Grow the clearing around wherever the player currently stands.
   *
   * The edits handle is 0 on purpose: nodes are placed before anything has been
   * dug, so the oracle's designed base IS the surface at that moment, and
   * passing an empty edit set would say the same thing more expensively. A node
   * placed after digging starts must pass the live handle.
   */
  populate(): void {
    const p = this.d.player.body.feet;
    const dir = new THREE.Vector3(p.x, p.y, p.z).normalize();
    this.nodesPlaced = this.field.populate(this.d.bodyHandle, 0, dir, this.d.seed);
  }

  /** Fixed tick. Returns true on the tick a harvest actually granted items. */
  fixedStep(tick: number): boolean {
    const f = this.d.input.frame;
    // Tab is edge-detected here rather than in Input, so a driven tape that
    // holds Tab for ten frames toggles once, exactly like a key press.
    if (f.panel && !this.panelHeld) this.setPanel(!this.panel.isOpen);
    this.panelHeld = f.panel;

    if (this.panel.isOpen) { this.interact.target = null; return false; }
    const got = this.interact.step(f.mine, tick);
    if (got && this.interact.last !== null) {
      const l = this.interact.last;
      this.hud.flash(`+${l.granted} ${l.name}${l.usedTool ? '  (tool)' : ''}`);
      this.panel.invalidate();
    }
    return got;
  }

  /** Per frame: node transforms, depletion variants, HUD, panel. */
  frame(dt: number): void {
    this.field.update(dt);
    const t = this.interact.target;
    this.hud.render(dt, t === null ? null : {
      name: t.name, fraction: t.fraction, empty: t.empty, distanceM: t.distanceM,
    }, this.game.carried().map((c) => ({ name: c.name, count: c.count })));
    if (this.panel.isOpen) this.panel.render(this.slotRows(), this.recipeRows());
  }

  /** THE pointer transition. One place, both halves. */
  setPanel(open: boolean): void {
    this.panel.setOpen(open);
    this.d.input.setUiCapture(open);
    this.hud.setVisible(!open);
    if (open) this.panel.invalidate();
  }

  private craft(index: number): void {
    const ok = this.game.craft(index);
    this.panel.invalidate();
    this.panel.render(this.slotRows(), this.recipeRows());
    if (!ok) return;
    const r = this.game.recipes()[index];
    if (r !== undefined) this.hud.flash(`crafted ${this.game.itemName(r.output)}`);
  }

  private slotRows(): SlotRow[] {
    return this.game.inventory().map((s) => ({
      name: s.count > 0 ? this.game.itemName(s.item) : '', count: s.count,
    }));
  }

  private recipeRows(): RecipeRow[] {
    return this.game.recipes().map((r) => ({
      index: r.index,
      name: this.game.itemName(r.output),
      outputCount: r.outputCount,
      craftable: r.craftable,
      inputs: r.inputs.map((i) => ({
        name: this.game.itemName(i.item), have: i.have, need: i.need,
      })),
    }));
  }

  report(): unknown {
    return {
      nodes: this.field.stats(),
      placed: this.nodesPlaced,
      panelOpen: this.panel.isOpen,
      pointerLocked: this.d.input.pointerLocked,
      interact: this.interact.report(),
      carried: this.game.carried(),
      recipes: this.game.recipes().map((r) => ({
        name: this.game.itemName(r.output), craftable: r.craftable,
      })),
    };
  }
}
