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
import { InventoryPanel } from '../ui/InventoryPanel.js';
import { FurnacePanel } from '../ui/FurnacePanel.js';
import { Machines, type Machine } from './Machines.js';
import { CameraKick, Debris } from './HarvestFx.js';
import { Factory, type Placed } from './Factory.js';
import { FactoryView } from './FactoryView.js';
import { BuildMode } from './BuildMode.js';
import { furnaceView, nodeDump, readable, recipeRows, slotRows } from './GameplayViews.js';
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
  readonly debris = new Debris();
  readonly kick = new CameraKick();
  /** W6 automation: the plan, its art, and the build menu that edits it. */
  readonly factory: Factory;
  readonly factoryView: FactoryView;
  readonly build: BuildMode;
  nodesPlaced = 0;
  placements = 0;
  /** Ingots taken out of automated machines by hand, for the HUD and probes. */
  autoCollected = 0;
  private simSecs = 0;
  private panelHeld = false;
  private placeHeld = false;
  private mineHeld = false;
  private openMachine: Machine | null = null;
  private aimedMachine: Machine | null = null;
  private aimedBuild: Placed | null = null;

  private constructor(private readonly d: GameplayDeps) {
    this.game = new GameCore(d.core);
    this.field = new NodeField(this.game, d.origin);
    this.interact = new Interact(this.game, this.field, d.player, d.avatar);
    this.hud = new GameHud(d.host);
    this.panel = new InventoryPanel(d.host, (i) => this.craft(i));
    this.machines = new Machines(d.core, this.game, d.origin, d.bodyHandle);
    this.furnacePanel = new FurnacePanel(
      d.host, (item) => this.loadFurnace(item), () => this.takeFurnace());
    // The factory ticks on the SIM clock, like everything else that is a rule.
    this.factory = new Factory(d.core, this.game, d.bodyHandle, 1 / 60);
    this.factoryView = new FactoryView(d.origin);
    this.build = new BuildMode(d.core, d.bodyHandle, this.factory, this.factoryView);
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await Promise.all([g.field.load(), g.machines.load(), g.factoryView.load()]);
    d.scene.add(g.machines.group);
    d.scene.add(g.field.group);
    d.scene.add(g.debris.mesh);
    d.scene.add(g.factoryView.group);
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
    // ONE tick of the automation network, on the same clock. This is the line
    // that makes "walk away and iron accumulates" true: nothing here waits on a
    // frame, a panel or the player being anywhere near the machines.
    this.factory.tick(1);

    // ONE edge for the mine key, read once. It used to be edge-detected inside
    // the "panel is open" branch and taken as a LEVEL inside the "aiming at a
    // machine" branch, and the two disagreed: pressing E to close a furnace you
    // are standing in front of closed it on that tick and the still-held key
    // reopened it on the next, so the panel could not be closed by the key that
    // opened it. A press is a press wherever it is read.
    const minePressed = f.mine && !this.mineHeld;
    this.mineHeld = f.mine;

    if (this.panel.isOpen) {
      this.interact.target = null;
      return false;
    }

    if (this.furnacePanel.isOpen) {
      if (minePressed) this.openFurnace(null);
      this.interact.target = null;
      return false;
    }

    // Placement, and the machine prompt, both want the aim ray.
    const ray = this.d.player.aimRay();
    // BUILD MODE FIRST, and it takes the place key while it is armed. A player
    // holding a belt in hand who presses G means the belt, not the furnace, and
    // guessing wrong is the sort of thing that makes a game feel unlistening.
    const built = this.build.step((c) => this.d.input.held(c), f.place, ray);
    if (built) this.hud.flash(`placed ${this.build.label}`);
    else if (this.build.selected === null) {
      if (f.place && !this.placeHeld) this.placeMachine(ray);
    } else if (f.place && !this.placeHeld && this.build.target?.ok === false) {
      this.hud.flash(this.build.target.reason);
    }
    this.placeHeld = f.place;

    this.aimedMachine = this.machines.pick(ray.origin, ray.dir, 3.5);
    this.aimedBuild = this.aimedMachine !== null ? null
      : this.factory.pick(ray.origin, ray.dir, 3.5);

    // A machine under the crosshair takes the key: you cannot harvest a furnace.
    if (this.aimedMachine !== null) {
      if (minePressed) this.openFurnace(this.aimedMachine);
      this.interact.target = null;
      return false;
    }
    // An automated machine hands over its finished stock instead of a panel:
    // there is nothing to load, so a screen would be a screen about nothing.
    if (this.aimedBuild !== null) {
      if (minePressed) this.collectFrom(this.aimedBuild);
      this.interact.target = null;
      return false;
    }

    const got = this.interact.step(f.mine, tick);
    if (got && this.interact.last !== null) this.impact(this.interact.last);
    // The kick runs on the FIXED tick and is applied through the same additive
    // Controller.look the mouse uses, so a driven tape kicks exactly as often as
    // a human does and the offsets still sum to zero.
    const [ky, kp] = this.kick.step(this.d.player.view.pitch);
    if (kp !== 0 || ky !== 0) this.d.player.look(ky, kp);
    return got;
  }

  /**
   * Everything a landed swing does that is not the grant itself: the node
   * reacts, chips fly in the resource's own colour, the camera kicks, and the
   * gain is read out beside the crosshair. All of it hangs off the authored
   * impact frame (17 of 33) because that is when the tool visibly connects.
   */
  private impact(l: { granted: number; name: string; usedTool: boolean; index: number }): void {
    const hit = this.field.hitPoint(l.index);
    if (hit !== null) {
      const e = this.d.player.aimRay().origin;
      // Back towards the eye, flattened into the ground plane, so chips come at
      // the player rather than through the node they were struck from.
      const b = new THREE.Vector3(e.x - hit.pos.x, e.y - hit.pos.y, e.z - hit.pos.z);
      const u = new THREE.Vector3(hit.up.x, hit.up.y, hit.up.z);
      b.addScaledVector(u, -b.dot(u));
      if (b.lengthSq() < 1e-9) b.set(u.y, -u.x, 0);
      b.normalize();
      // More chips on a bigger pull, so a tooled swing visibly hits harder.
      const n = Math.min(22, 8 + Math.round(Math.min(30, l.granted) * 0.45));
      this.debris.burst({ pos: hit.pos, up: hit.up, back: b, colour: hit.colour, count: n });
      this.hud.gain(`+${l.granted} ${l.name}`, readable(hit.colour));
    } else {
      this.hud.gain(`+${l.granted} ${l.name}`, '#e8eef3');
    }
    this.kick.fire(this.interact.swings);
    this.panel.invalidate();
  }

  /** Per frame: node transforms, depletion variants, effects, HUD, panels. */
  frame(dt: number): void {
    this.simSecs += dt;
    this.field.update(dt);
    this.machines.update();
    this.machines.updateFx(dt);
    this.debris.update(dt, this.d.origin);
    // The belt scroll is driven by SIM seconds, not performance.now(), for the
    // same reason the terrain cross-dissolve is: a headless driven run then
    // scrolls at exactly the rate a real one does and a capture is reproducible.
    this.factoryView.sync(this.factory, this.simSecs);
    if (this.openMachine !== null) {
      this.furnacePanel.render(
        furnaceView(this.game, this.openMachine.handle, this.openMachine.tier));
    }
    if (this.aimedBuild !== null && !this.panel.isOpen && !this.furnacePanel.isOpen) {
      this.hud.render(dt, this.buildPrompt(this.aimedBuild),
        this.game.carried().map((c) => ({ name: c.name, count: c.count })));
      return;
    }
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
    if (this.panel.isOpen) this.panel.render(slotRows(this.game), recipeRows(this.game));
  }

  /** What an automated machine says about itself under the crosshair. */
  private buildPrompt(b: Placed) {
    const out = b.build < 0 ? 0 : this.factory.line.outputBuffer(b.build);
    const item = this.factory.outputItemOf(b);
    const name = item > 0 ? this.game.itemName(item) : b.kind;
    if (b.kind === 'miner') {
      const left = b.build < 0 ? 0 : this.factory.line.minerRemaining(b.build);
      const n = this.game.node(b.nodeIndex);
      return {
        name: `miner  ${Math.round(left)} ${name} left`,
        fraction: n !== null && n.initial > 0 ? left / n.initial : 0,
        empty: left <= 0, distanceM: 0,
      };
    }
    return {
      name: out > 0 ? `${b.kind}  E to take ${out} ${name}` : `${b.kind}  empty`,
      fraction: b.build < 0 ? 0 : this.factory.line.progress01(b.build),
      empty: out <= 0, distanceM: 0,
    };
  }

  /** Take an automated machine's finished stock into the pack. */
  private collectFrom(b: Placed): void {
    const n = this.factory.collect(b);
    if (n <= 0) { this.hud.flash('nothing to take yet'); return; }
    this.autoCollected += n;
    this.hud.flash(`took ${n} ${this.game.itemName(this.factory.outputItemOf(b))}`);
    this.panel.invalidate();
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
    if (m !== null) this.furnacePanel.render(furnaceView(this.game, m.handle, m.tier));
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

  private craft(index: number): void {
    const ok = this.game.craft(index);
    this.panel.invalidate();
    this.panel.render(slotRows(this.game), recipeRows(this.game));
    if (!ok) return;
    const r = this.game.recipes()[index];
    if (r !== undefined) this.hud.flash(`crafted ${this.game.itemName(r.output)}`);
  }

  /** Every node with its world position, nearest first. The probe's eyes. */
  nodes(): unknown[] {
    return nodeDump(this.game, this.field.placed, this.d.player.aimRay().origin);
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
      // W6 automation. `factory` is the plan and what /core says about it;
      // `build` is the menu and the ghost; `view` is what is actually drawn.
      factory: this.factory.report(),
      build: this.build.report(),
      view: this.factoryView.stats(),
      autoCollected: this.autoCollected,
      fx: {
        debrisLive: this.debris.live, debrisSpawned: this.debris.spawned,
        smokeLive: this.machines.smoke.live, smokePuffs: this.machines.smoke.emitted,
        gains: this.hud.gains, kicking: this.kick.active, kickTicks: this.kick.applied,
      },
      interact: this.interact.report(),
      carried: this.game.carried(),
      recipes: this.game.recipes().map((r) => ({
        name: this.game.itemName(r.output), craftable: r.craftable,
      })),
    };
  }
}
