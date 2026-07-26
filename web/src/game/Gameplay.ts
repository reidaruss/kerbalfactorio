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
import { FurnacePanel } from '../ui/FurnacePanel.js';
import { Machines, type Machine } from './Machines.js';
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
  readonly machines: Machines;
  readonly furnacePanel: FurnacePanel;
  nodesPlaced = 0;
  placements = 0;
  private panelHeld = false;
  private placeHeld = false;
  private mineHeld = false;
  private openMachine: Machine | null = null;
  private aimedMachine: Machine | null = null;

  private constructor(private readonly d: GameplayDeps) {
    this.game = new GameCore(d.core);
    this.field = new NodeField(this.game, d.origin);
    this.interact = new Interact(this.game, this.field, d.player, d.avatar);
    this.hud = new GameHud(d.host);
    this.panel = new InventoryPanel(d.host, (i) => this.craft(i));
    this.machines = new Machines(d.core, this.game, d.origin, d.bodyHandle);
    this.furnacePanel = new FurnacePanel(
      d.host, (item) => this.loadFurnace(item), () => this.takeFurnace());
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await Promise.all([g.field.load(), g.machines.load()]);
    d.scene.add(g.machines.group);
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

  /** True while any panel owns the pointer, so the dig action stands down. */
  get uiOpen(): boolean { return this.panel.isOpen || this.furnacePanel.isOpen; }

  /** Fixed tick. Returns true on the tick a harvest actually granted items. */
  fixedStep(tick: number): boolean {
    const f = this.d.input.frame;
    // Tab is edge-detected here rather than in Input, so a driven tape that
    // holds Tab for ten frames toggles once, exactly like a key press.
    if (f.panel && !this.panelHeld) this.setPanel(!this.panel.isOpen);
    this.panelHeld = f.panel;

    // Machines tick on the SIM clock, like everything else that is a rule: a
    // furnace on a synthetic-clock probe smelts in exactly the tick count
    // gameplay.h says it does, which is what makes the timing assertable.
    this.machines.tick(1);

    if (this.panel.isOpen) {
      this.mineHeld = f.mine;
      this.interact.target = null;
      return false;
    }

    if (this.furnacePanel.isOpen) {
      if (f.mine && !this.mineHeld) this.openFurnace(null);
      this.mineHeld = f.mine;
      this.interact.target = null;
      return false;
    }
    this.mineHeld = f.mine;

    // Placement, and the machine prompt, both want the aim ray.
    const ray = this.d.player.aimRay();
    this.aimedMachine = this.machines.pick(ray.origin, ray.dir, 3.5);
    if (f.place && !this.placeHeld) this.placeMachine(ray);
    this.placeHeld = f.place;

    // A machine under the crosshair takes the key: you cannot harvest a furnace.
    if (this.aimedMachine !== null) {
      if (f.mine) this.openFurnace(this.aimedMachine);
      this.interact.target = null;
      return false;
    }

    const got = this.interact.step(f.mine, tick);
    if (got && this.interact.last !== null) {
      const l = this.interact.last;
      this.hud.flash(`+${l.granted} ${l.name}${l.usedTool ? '  (tool)' : ''}`);
      this.panel.invalidate();
    }
    return got;
  }

  /** Per frame: node transforms, depletion variants, HUD, panels. */
  frame(dt: number): void {
    this.field.update(dt);
    this.machines.update();
    if (this.openMachine !== null) this.furnacePanel.render(this.furnaceView(this.openMachine));
    if (this.aimedMachine !== null && !this.panel.isOpen && !this.furnacePanel.isOpen) {
      const st = this.game.furnaceState(this.aimedMachine.handle);
      this.hud.render(dt, {
        name: st !== null && st.smelting ? 'furnace (smelting)' : 'furnace',
        fraction: st === null ? 0 : st.progress / Math.max(1, st.ticksPerSmelt),
        empty: false, distanceM: 0,
      }, this.game.carried().map((c) => ({ name: c.name, count: c.count })));
      return;
    }
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

  /** Put a furnace or a smelter from the pack on the 1 m grid ahead of the eye. */
  private placeMachine(ray: { origin: { x: number; y: number; z: number };
                              dir: { x: number; y: number; z: number } }): void {
    const tier = this.game.count(this.game.ids.furnace) > 0 ? 0
      : this.game.count(this.game.ids.smelter) > 0 ? 1 : -1;
    if (tier < 0) { this.hud.flash('nothing to place  (craft a furnace)'); return; }
    const item = tier === 0 ? this.game.ids.furnace : this.game.ids.smelter;
    const m = this.machines.place(item, tier, ray.origin, ray.dir);
    if (m === null) { this.hud.flash('cannot place there'); return; }
    this.placements++;
    this.hud.flash(`placed ${this.game.itemName(item)}`);
  }

  /** Open the furnace UI on `m`, or close it with null. THE pointer transition. */
  openFurnace(m: Machine | null): void {
    this.openMachine = m;
    this.furnacePanel.setOpen(m !== null);
    this.d.input.setUiCapture(m !== null);
    this.hud.setVisible(m === null);
    if (m !== null) this.furnacePanel.render(this.furnaceView(m));
  }

  private loadFurnace(item: number): void {
    if (this.openMachine === null) return;
    const n = this.game.furnaceInsert(this.openMachine.handle, item, 5);
    if (n > 0) this.hud.flash(`loaded ${n} ${this.game.itemName(item)}`);
  }

  private takeFurnace(): void {
    if (this.openMachine === null) return;
    const n = this.game.furnaceCollect(this.openMachine.handle, 99);
    if (n > 0) this.hud.flash(`took ${n}`);
  }

  /** What the pack can feed this machine: the ores it smelts and the fuels. */
  private furnaceView(m: Machine) {
    const st = this.game.furnaceState(m.handle);
    const I = this.game.ids;
    const loadable = [];
    for (const [item, fuel] of [[I.rawIron, false], [I.rawCopper, false],
      [I.coal, true], [I.wood, true]] as [number, boolean][]) {
      const c = this.game.count(item);
      if (c > 0) loadable.push({ item, name: this.game.itemName(item), count: c, fuel });
    }
    return {
      title: m.tier === 1 ? 'Smelter' : 'Primitive furnace',
      oreName: st === null ? '' : this.game.itemName(st.oreItem),
      oreCount: st?.oreCount ?? 0,
      outName: st === null || st.outItem === 0 ? '' : this.game.itemName(st.outItem),
      outCount: st?.outCount ?? 0,
      fuelTicks: st?.fuelTicks ?? 0,
      progress: st?.progress ?? 0,
      ticksPerSmelt: st?.ticksPerSmelt ?? 180,
      smelting: st?.smelting ?? false,
      loadable,
    };
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

  /**
   * Every node with its 64-bit body-frame position, sorted by distance from the
   * eye. This is the probe's eyes: without world positions a driven run cannot
   * tell "I aimed at nothing" from "the pick is broken", which is exactly the
   * silent success DW-20 is about.
   */
  nodes(): unknown[] {
    const e = this.d.player.aimRay().origin;
    const out = [];
    for (const pl of this.field.placed) {
      const st = this.game.node(pl.index);
      if (st === null) continue;
      out.push({
        index: pl.index,
        x: st.x, y: st.y, z: st.z,
        name: this.game.itemName(st.resource),
        kind: st.kind,
        remaining: st.remaining,
        initial: st.initial,
        fraction: st.initial > 0 ? st.remaining / st.initial : 0,
        distanceM: Math.hypot(st.x - e.x, st.y - e.y, st.z - e.z),
      });
    }
    out.sort((a, b) => a.distanceM - b.distanceM);
    return out;
  }

  report(): unknown {
    return {
      nodes: this.field.stats(),
      placed: this.nodesPlaced,
      panelOpen: this.panel.isOpen,
      furnaceOpen: this.furnacePanel.isOpen,
      placements: this.placements,
      machines: this.machines.report(),
      pointerLocked: this.d.input.pointerLocked,
      interact: this.interact.report(),
      carried: this.game.carried(),
      recipes: this.game.recipes().map((r) => ({
        name: this.game.itemName(r.output), craftable: r.craftable,
      })),
    };
  }
}
