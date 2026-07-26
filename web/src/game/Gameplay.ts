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
import { Feedback } from './Feedback.js';
import { Sfx } from '../audio/Sfx.js';
import { Factory, type Placed } from './Factory.js';
import { FactoryView } from './FactoryView.js';
import { BuildMode } from './BuildMode.js';
import { demolishAimed } from './Demolition.js';
import { aimPrompt } from './FactoryReport.js';
import { furnaceView, nodeDump, recipeRows, slotRows } from './GameplayViews.js';
import { ItemIcons } from './ItemIcons.js';
import { Ambience } from './Ambience.js';
import { gameplayReport } from './GameplayReport.js';
import { loadSlot, saveSlot, type RestoreLedger, type WorldPorts } from './Persist.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Controller } from '../player/Controller.js';
import type { Avatar } from '../player/Avatar.js';
import type { Input } from '../player/Input.js';

/** Ticks between autosaves. 20 seconds: often enough to matter, rare enough
 * that a slot write is invisible against a 16 ms frame. */
const AUTOSAVE_TICKS = 20 * 60;

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
  /** DW-17: the voxel, mesh and terrain handles a whole-world save needs. */
  ports?: Partial<WorldPorts>;
}

export class Gameplay {
  readonly game: GameCore;
  readonly field: NodeField;
  readonly interact: Interact;
  readonly hud: GameHud;
  readonly panel: InventoryPanel;
  readonly machines: Machines;
  readonly furnacePanel: FurnacePanel;
  /** Chips, kick, captions and sound: everything an event does but the rule. */
  readonly fx: Feedback;
  readonly sfx = new Sfx();
  /** W7: one baked picture per item, so a slot is not a word in a box. */
  readonly icons = new ItemIcons();
  /** W7: the world's own sound bed. A silent planet reads as a tech demo. */
  readonly ambience: Ambience;
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
  /** DW-17 autosave: slots written, and what the last load brought back. */
  saves = 0;
  restored: RestoreLedger | null = null;
  private sinceSaveTicks = 0;
  private razeHeld = false;
  private muteHeld = false;
  private openMachine: Machine | null = null;
  private aimedMachine: Machine | null = null;
  private aimedBuild: Placed | null = null;

  /** What a save needs: the module handle, the seed, and the voxel handles,
   * which live in Services and are null in a scenario with no character. */
  get core(): OfCoreModule { return this.d.core; }
  get seed(): number { return this.d.seed; }
  get ports(): WorldPorts {
    const p = this.d.ports;
    return { voxels: p?.voxels ?? null, voxelMesh: p?.voxelMesh ?? null,
      terrain: p?.terrain ?? null };
  }

  private constructor(private readonly d: GameplayDeps) {
    this.game = new GameCore(d.core);
    this.field = new NodeField(this.game, d.origin);
    this.interact = new Interact(this.game, this.field, d.player, d.avatar);
    this.hud = new GameHud(d.host);
    this.fx = new Feedback(this.hud, this.field, this.sfx);
    this.panel = new InventoryPanel(d.host, (i) => this.craft(i));
    this.machines = new Machines(d.core, this.game, d.origin, d.bodyHandle);
    this.furnacePanel = new FurnacePanel(
      d.host, (item) => this.loadFurnace(item), () => this.takeFurnace());
    // The factory ticks on the SIM clock, like everything else that is a rule.
    this.ambience = new Ambience(d.core, d.bodyHandle);
    this.factory = new Factory(d.core, this.game, d.bodyHandle, 1 / 60);
    this.factoryView = new FactoryView(d.origin);
    this.build = new BuildMode(d.core, d.bodyHandle, this.factory, this.factoryView);
    // A hand furnace announces its own ingots, at the furnace that made them.
    this.machines.onSmelt = (m, n) => {
      this.fx.ingot(n, m.pos, m.up,
        this.game.itemName(this.game.furnaceState(m.handle)?.outItem ?? 0));
    };
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await Promise.all([g.field.load(), g.machines.load(), g.factoryView.load(),
      g.icons.load()]);
    d.scene.add(g.machines.group);
    d.scene.add(g.field.group);
    d.scene.add(g.fx.debris.mesh);
    d.scene.add(g.factoryView.group);
    // Browsers refuse audio until the player has interacted; the listener arms
    // itself on the first pointer or key event and then removes itself.
    g.sfx.attach();
    g.populate();
    // DW-17. The clearing is grown from the seed FIRST and then the diff is
    // applied on top, because the layout is regenerated and only what the
    // player changed is saved.
    await g.load();
    // pagehide, not beforeunload: a mobile browser may never fire beforeunload
    // and the tab that gets frozen is exactly the one whose save matters.
    window.addEventListener('pagehide', () => { void g.save(); });
    return g;
  }

  /** Write the autosave slot. Returns what was written, or null (DW-17). */
  save(): Promise<unknown> { return saveSlot(this); }

  /** Restore the autosave slot over a freshly generated clearing. */
  load(): Promise<RestoreLedger | null> { return loadSlot(this); }

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

  /** True while the pointer is locked to the canvas, for the report. */
  get pointerLocked(): boolean { return this.d.input.pointerLocked; }

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
    this.fx.watchSmelters(this.factory, this.game);
    // AUTOSAVE on the sim clock, like everything else that is a rule, so a
    // driven run saves exactly as often as a played one does.
    if (++this.sinceSaveTicks >= AUTOSAVE_TICKS) { this.sinceSaveTicks = 0; void this.save(); }

    // M mutes. Edge-detected here like every other open-ended key, so a driven
    // tape that holds it for ten frames toggles once.
    const mute = this.d.input.held('KeyM');
    if (mute && !this.muteHeld) {
      this.hud.flash(this.sfx.bus.toggleMute() ? 'sound off  (M)' : 'sound on  (M)');
    }
    this.muteHeld = mute;

    // ONE edge for the mine key, read once. It used to be edge-detected inside
    // the "panel is open" branch and taken as a LEVEL inside the "aiming at a
    // machine" branch, and the two disagreed: pressing E to close a furnace you
    // are standing in front of closed it on that tick and the still-held key
    // reopened it on the next, so the panel could not be closed by the key that
    // opened it. A press is a press wherever it is read.
    const minePressed = f.mine && !this.mineHeld;
    this.mineHeld = f.mine;

    if (this.uiOpen) {
      // A machine screen closes with the key that opened it; the Tab panel is
      // handled above. Either way nothing in the world is aimed at.
      if (minePressed && this.furnacePanel.isOpen) this.openFurnace(null);
      this.interact.target = null;
      return false;
    }

    const ray = this.d.player.aimRay();
    // BUILD MODE FIRST, and it takes the place key while it is armed. A player
    // holding a belt in hand who presses G means the belt, not the furnace, and
    // guessing wrong is the sort of thing that makes a game feel unlistening.
    const built = this.build.step((c) => this.d.input.held(c), f.place, ray);
    if (built) { this.hud.flash(`placed ${this.build.label}`); this.sfx.confirm(); }
    else if (this.build.selected === null) {
      if (f.place && !this.placeHeld) this.placeMachine(ray);
    } else if (f.place && !this.placeHeld && this.build.target?.ok === false) {
      this.hud.flash(this.build.target.reason);
    }
    this.placeHeld = f.place;

    this.aimedMachine = this.machines.pick(ray.origin, ray.dir, 3.5);
    // Belts ARE included here, because a belt is demolishable even though it is
    // not interactive; `collectFrom` on one is a no-op with its own message.
    this.aimedBuild = this.aimedMachine !== null ? null
      : this.factory.pick(ray.origin, ray.dir, 3.5, true);

    // X pulls up whatever is under the crosshair, and it is read BEFORE the mine
    // key so that "remove" can never be mistaken for "open".
    const raze = this.d.input.held('KeyX');
    const razePressed = raze && !this.razeHeld;
    this.razeHeld = raze;
    if (razePressed && this.demolish()) return false;

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
    if (got && this.interact.last !== null) {
      this.fx.impact(this.interact.last, ray.origin, this.interact.swings);
      this.panel.invalidate();
    }
    // The kick runs on the FIXED tick and is applied through the same additive
    // Controller.look the mouse uses, so a driven tape kicks exactly as often as
    // a human does and the offsets still sum to zero.
    const [ky, kp] = this.fx.kick.step(this.d.player.view.pitch);
    if (kp !== 0 || ky !== 0) this.d.player.look(ky, kp);
    return got;
  }

  /**
   * Remove whatever the crosshair is on. Returns true if something went.
   * The machine is tried first for the same reason it takes the mine key: it is
   * the nearer, larger object and a belt tile behind it must not steal the press.
   */
  private demolish(): boolean {
    const r = demolishAimed(this, this.aimedMachine, this.aimedBuild);
    if (r === null) { this.hud.flash('nothing to remove'); return false; }
    this.aimedMachine = null;
    this.aimedBuild = null;
    this.fx.forgetSmelters();
    this.hud.flash(r.message, 2.2);
    this.sfx.undo();
    this.panel.invalidate();
    return true;
  }

  /** Per frame: node transforms, depletion variants, effects, HUD, panels. */
  frame(dt: number): void {
    this.simSecs += dt;
    this.field.update(dt);
    this.machines.update();
    this.machines.updateFx(dt);
    this.fx.update(dt, this.d.origin);
    const eye = this.d.player.aimRay().origin;
    this.sfx.walk(dt, this.d.player.body.speedMps, this.d.player.body.grounded);
    this.fx.beds(this.factory, this.machines, eye, (base) =>
      this.ambience.step(dt, eye, this.d.player.body.underRock, base));
    // The belt scroll is driven by SIM seconds, not performance.now(), for the
    // same reason the terrain cross-dissolve is: a headless driven run then
    // scrolls at exactly the rate a real one does and a capture is reproducible.
    this.factoryView.sync(this.factory, this.simSecs);
    if (this.openMachine !== null) {
      this.furnacePanel.render(
        furnaceView(this.game, this.openMachine.handle, this.openMachine.tier));
    }
    const carried = this.game.carried().map((c) => ({
      name: c.name, count: c.count, icon: this.icons.for(c.name),
    }));
    // ONE prompt decision, made in one place. It used to be four early returns
    // here, and every one of them had to remember the two panel conditions.
    this.hud.render(dt, this.uiOpen ? null : aimPrompt(this.factory, this.game,
      this.aimedBuild, this.aimedMachine, this.interact.target), carried);
    if (this.panel.isOpen) this.panel.render(this.slots(), this.recipes());
  }

  /** Take an automated machine's finished stock into the pack. */
  private collectFrom(b: Placed): void {
    const n = this.factory.collect(b);
    if (n <= 0) { this.hud.flash('nothing to take yet'); return; }
    this.autoCollected += n;
    this.hud.flash(`took ${n} ${this.game.itemName(this.factory.outputItemOf(b))}`);
    this.sfx.confirm();
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
    const ids = this.game.ids;
    const tier = this.game.count(ids.furnace) > 0 ? 0
      : this.game.count(ids.smelter) > 0 ? 1 : -1;
    if (tier < 0) { this.hud.flash('nothing to place  (craft a furnace)'); return; }
    const item = tier === 0 ? ids.furnace : ids.smelter;
    if (this.machines.place(item, tier, ray.origin, ray.dir) === null) {
      this.hud.flash('cannot place there');
      return;
    }
    this.placements++;
    this.hud.flash(`placed ${this.game.itemName(item)}`);
    this.sfx.confirm();
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
    const h = this.openMachine?.handle;
    if (h === undefined) return;
    const n = this.game.furnaceInsert(h, item, 5);
    if (n > 0) { this.hud.flash(`loaded ${n} ${this.game.itemName(item)}`); this.sfx.confirm(); }
  }

  private takeFurnace(): void {
    const h = this.openMachine?.handle;
    if (h === undefined) return;
    const n = this.game.furnaceCollect(h, 99);
    if (n > 0) { this.hud.flash(`took ${n}`); this.sfx.confirm(); }
  }

  private craft(index: number): void {
    const ok = this.game.craft(index);
    this.panel.invalidate();
    this.panel.render(this.slots(), this.recipes());
    const r = ok ? this.game.recipes()[index] : undefined;
    if (r === undefined) return;
    this.hud.flash(`crafted ${this.game.itemName(r.output)}`);
    this.sfx.confirm();
  }

  /** The two panel views, with the item pictures bound in one place. */
  private slots() { return slotRows(this.game, (n) => this.icons.for(n)); }
  private recipes() { return recipeRows(this.game, (n) => this.icons.for(n)); }

  /** Every node with its world position, nearest first. The probe's eyes. */
  nodes(): unknown[] {
    return nodeDump(this.game, this.field.placed, this.d.player.aimRay().origin);
  }
  report(): unknown { return gameplayReport(this); }
}
