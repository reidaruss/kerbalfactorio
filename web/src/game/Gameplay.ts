// The gameplay layer, assembled: the pack, the clearing, the swing, the HUD, the
// hotbar and the panels, plus the one thing none of them can own alone, which is
// who has the pointer.
//
// It is a COMPOSITION, not a god object: every rule lives in `/core` behind
// GameCore, every mesh in NodeField, every pixel in src/ui, the reach and impact
// timing in Interact, and WHAT A PRESS MEANS in GameplayInput. What is left here
// is order and the pointer.
//
// THE POINTER TRANSITION is the part worth being careful about. Opening a panel
// must release the lock, show the cursor and stop the camera dead in the same
// frame; closing it must take the lock back without the mouse having "moved"
// while the cursor was free. Input.setUiCapture does both halves, including
// clearing the accumulated deltas, because a frame's worth of unlocked movement
// applied on re-lock is a visible snap and reads as a bug.

import * as THREE from 'three';
import { GameCore } from './GameCore.js';
import { NodeField } from './NodeField.js';
import { OreField } from './OreField.js';
import { Interact } from '../player/Interact.js';
import { GameHud } from '../ui/GameHud.js';
import { HotbarBar } from '../ui/HotbarBar.js';
import { ModalStack } from '../ui/ModalStack.js';
import { InventoryPanel } from '../ui/InventoryPanel.js';
import { FurnacePanel } from '../ui/FurnacePanel.js';
import { Machines, type Machine } from './Machines.js';
import { Feedback } from './Feedback.js';
import { Sfx } from '../audio/Sfx.js';
import { Factory, type Placed } from './Factory.js';
import { FactoryView } from './FactoryView.js';
import { BuildMode } from './BuildMode.js';
import { Hotbar } from './Hotbar.js';
import { GameplayInput } from './GameplayInput.js';
import { Structures, type StructurePart } from './Structures.js';
import { StructureView } from './StructureView.js';
import { aimPrompt } from './FactoryReport.js';
import { ghostPrompt } from './StructurePlacement.js';
import { nodeDump } from './GameplayViews.js';
import { craft, loadFurnace, machineView, raze, recipes, slots,
  takeFurnace } from './GameplayActions.js';
import { ItemIcons } from './ItemIcons.js';
import { Ambience } from './Ambience.js';
import { Objectives, showGoals, stepGoals } from './Objectives.js';
import { ObjectivePanel } from '../ui/ObjectivePanel.js';
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
  /** The ore in the ground: the patches, their skin and their outcrops. */
  readonly oreField: OreField;
  readonly interact: Interact;
  readonly hud: GameHud;
  /** THE derived list of menus, so Escape cannot miss one (GP-25). */
  readonly modals = new ModalStack();
  readonly panel: InventoryPanel;
  readonly machines: Machines;
  readonly furnacePanel: FurnacePanel;
  /** Nine slots, the wheel, and therefore what the left button does (GP-26). */
  readonly hotbar = new Hotbar();
  readonly hotbarBar: HotbarBar;
  readonly keys = new GameplayInput();
  /** Chips, kick, captions and sound: everything an event does but the rule. */
  readonly fx: Feedback;
  readonly sfx = new Sfx();
  /** W7: one baked picture per item, so a slot is not a word in a box. */
  readonly icons = new ItemIcons();
  /** W7: the world's own sound bed. A silent planet reads as a tech demo. */
  readonly ambience: Ambience;
  /** W7: the first minute. A checklist that watches, never a tutorial. */
  readonly goals = new Objectives();
  readonly goalPanel: ObjectivePanel;
  /** W6 automation: the plan, its art, and the build mode that edits it. */
  readonly factory: Factory;
  readonly factoryView: FactoryView;
  readonly build: BuildMode;
  /** Base building: the parts, their bodies and the batch that draws them. */
  readonly structures: Structures;
  readonly structView: StructureView;
  nodesPlaced = 0;
  patchesPlaced = 0;
  placements = 0;
  /** Ingots taken out of automated machines by hand, for the HUD and probes. */
  autoCollected = 0;
  private simSecs = 0;
  /** Where the clearing was grown. Fixed on the first populate (see below). */
  private spawnDir: THREE.Vector3 | null = null;
  /** DW-17 autosave: slots written, and what the last load brought back. */
  saves = 0;
  restored: RestoreLedger | null = null;
  private sinceSaveTicks = 0;
  private openMachine: Machine | null = null;
  aimedMachine: Machine | null = null;
  aimedBuild: Placed | null = null;
  aimedPart: StructurePart | null = null;

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
    this.oreField = new OreField(d.core, d.bodyHandle, this.field, d.origin);
    this.interact = new Interact(this.game, this.field, d.player, d.avatar);
    this.hud = new GameHud(d.host);
    this.hotbarBar = new HotbarBar(d.host);
    this.fx = new Feedback(this.hud, this.field, this.sfx);
    this.panel = new InventoryPanel(d.host, this.modals, (i) => craft(this, i));
    this.panel.closer = () => this.setPanel(false);
    this.goalPanel = new ObjectivePanel(d.host);
    showGoals(this, this.goals.wasVisible());
    this.machines = new Machines(d.core, this.game, d.origin, d.bodyHandle);
    this.furnacePanel = new FurnacePanel(
      d.host, this.modals, (item) => loadFurnace(this, this.openMachine, item),
      () => takeFurnace(this, this.openMachine));
    this.furnacePanel.closer = () => this.openFurnace(null);
    // THE HAND IS A MODAL TOO, and registering it here rather than special-casing
    // it in the Escape handler is what keeps the guarantee derived: the probe
    // walks `modals.all()` and would catch a menu, or a mode, that skipped it.
    const hotbar = this.hotbar;
    this.modals.register({
      modalName: 'hand',
      get isOpen(): boolean { return hotbar.partInHand !== null; },
      requestClose: () => { hotbar.clearHand(); },
    });
    this.ambience = new Ambience(d.core, d.bodyHandle);
    // The factory ticks on the SIM clock, like everything else that is a rule.
    // DW-24: the edits handle is read LIVE, so a pad flattened with Q reads as
    // flat on the very next tick and the invalid ghost turns valid in the frame
    // the player levels it.
    this.structures = new Structures(d.core, this.game, d.bodyHandle,
      () => d.ports?.voxels?.handle ?? 0);
    this.factory = new Factory(d.core, this.game, d.bodyHandle, 1 / 60,
      this.oreField.patches, this.structures);
    this.factoryView = new FactoryView(d.origin);
    this.structView = new StructureView(d.origin);
    this.build = new BuildMode(d.core, d.bodyHandle, this.factory, this.factoryView,
      this.structures, this.structView);
    // A hand furnace announces its own ingots, at the furnace that made them.
    this.machines.onSmelt = (m, n) => {
      this.fx.ingot(n, m.pos, m.up,
        this.game.itemName(this.game.furnaceState(m.handle)?.outItem ?? 0));
    };
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await Promise.all([g.field.load(), g.machines.load(), g.factoryView.load(),
      g.structures.load(), g.icons.load()]);
    g.structView.build(g.structures);
    g.hotbarBar.invalidate();
    d.scene.add(g.structView.group);
    // The walker learns about the base through a PORT and not an import: a
    // structure rests on the terrain and must never become a second definition
    // of it (DW-24, plus DW-26's lesson about what a fifth surface costs).
    d.player.body.solids = g.structures.bodies;
    d.scene.add(g.machines.group);
    d.scene.add(g.field.group);
    d.scene.add(g.oreField.group);
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

  /** Write the autosave slot (DW-17), and restore it over a fresh clearing. */
  save(): Promise<unknown> { return saveSlot(this); }
  load(): Promise<RestoreLedger | null> { return loadSlot(this); }

  /**
   * Grow the clearing around wherever the player currently stands.
   *
   * The edits handle is 0 on purpose: nodes are placed before anything has been
   * dug, so the oracle's designed base IS the surface at that moment, and
   * passing an empty edit set would say the same thing more expensively.
   */
  populate(): void {
    // THE CLEARING DOES NOT FOLLOW THE PLAYER. The direction is remembered from
    // the first call, so regrowing from the seed reproduces the SAME world
    // rather than a new one centred wherever the player happens to be standing.
    if (this.spawnDir === null) {
      const p = this.d.player.body.feet;
      this.spawnDir = new THREE.Vector3(p.x, p.y, p.z).normalize();
    }
    const dir = this.spawnDir;
    // NodeField FIRST: it clears the whole node array, and the ore field's
    // outcrops are nodes in that same array.
    this.nodesPlaced = this.field.populate(this.d.bodyHandle, 0, dir, this.d.seed);
    this.patchesPlaced = this.oreField.populate(dir, 0);
    this.nodesPlaced = this.field.placed.length;
  }

  /** True while the pointer is locked to the canvas. */
  get pointerLocked(): boolean { return this.d.input.pointerLocked; }
  get input(): Input { return this.d.input; }

  /** True while a panel owns the pointer, so the dig action stands down. */
  get uiOpen(): boolean { return this.panel.isOpen || this.furnacePanel.isOpen; }

  /** True when the left button should reach the DIGGING tool: no panel up, and
   *  the hand is empty of parts. A player carrying a wall is not digging. */
  get digAllowed(): boolean {
    return !this.uiOpen && this.hotbar.partInHand === null;
  }

  /** Fixed tick. Returns true on the tick a harvest actually granted items. */
  fixedStep(tick: number): boolean {
    this.keys.chrome(this);

    // Machines and the automation network tick on the SIM clock, like
    // everything else that is a rule: a furnace on a synthetic-clock probe
    // smelts in exactly the tick count gameplay.h says it does, and "walk away
    // and iron accumulates" waits on no frame, panel or player proximity.
    this.machines.tick(1);
    this.factory.tick(1);
    this.fx.watchSmelters(this.factory, this.game);
    // AUTOSAVE on the sim clock too, so a driven run saves as often as a played
    // one does.
    if (++this.sinceSaveTicks >= AUTOSAVE_TICKS) { this.sinceSaveTicks = 0; void this.save(); }

    if (this.uiOpen) {
      // A machine screen closes with the key that opened it; the pack is handled
      // by `chrome`. Either way nothing in the world is aimed at.
      this.keys.closeWithInteract(this);
      this.interact.target = null;
      return false;
    }
    return this.keys.world(this, this.d.player.aimRay(), tick);
  }

  /** Re-pick what the crosshair is on. Machine, then building, then structure. */
  aim(ray: { origin: { x: number; y: number; z: number };
             dir: { x: number; y: number; z: number } }): void {
    this.aimedMachine = this.machines.pick(ray.origin, ray.dir, 3.5);
    // Belts ARE included here, because a belt is demolishable even though it is
    // not interactive; `collectFrom` on one is a no-op with its own message.
    this.aimedBuild = this.aimedMachine !== null ? null
      : this.factory.pick(ray.origin, ray.dir, 3.5, true);
    this.aimedPart = this.aimedMachine !== null || this.aimedBuild !== null ? null
      : this.structures.pick(ray.origin, ray.dir, 3.5);
  }

  /** The bare hand. Returns true on the tick a harvest granted items. */
  swing(use: boolean, tick: number,
        ray: { origin: { x: number; y: number; z: number } }): boolean {
    const got = this.interact.step(use, tick);
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

  /** Remove whatever the crosshair is on. Returns true if something went. */
  demolish(): boolean {
    const gone = raze(this, this.aimedMachine, this.aimedBuild, this.aimedPart);
    if (gone) { this.aimedMachine = null; this.aimedBuild = null; this.aimedPart = null; }
    return gone;
  }

  /** Per frame: node transforms, depletion variants, effects, HUD, panels. */
  frame(dt: number): void {
    this.simSecs += dt;
    this.field.update(dt);
    this.oreField.update(dt, this.d.ports?.voxels?.handle ?? 0);
    this.machines.update();
    this.machines.updateFx(dt);
    this.structures.step(dt);
    this.structView.sync(this.structures);
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
      this.furnacePanel.render(machineView(this, this.openMachine));
    }
    const carried = this.game.carried().map((c) => ({
      name: c.name, count: c.count, icon: this.icons.for(c.name),
    }));
    // ONE prompt decision, made in one place. It used to be four early returns
    // here, and every one of them had to remember the two panel conditions.
    this.hud.render(dt, this.uiOpen ? null : ghostPrompt(this.build.structTarget)
      ?? aimPrompt(this.factory, this.game, this.aimedBuild, this.aimedMachine,
        this.interact.target), carried);
    this.hotbarBar.render(this.hotbar.rows((n) => this.icons.for(n)));
    stepGoals(this, dt);
    if (this.panel.isOpen) this.panel.render(slots(this), recipes(this));
  }

  /** THE pointer transition. One place, both halves. */
  setPanel(open: boolean): void {
    this.panel.setOpen(open);
    if (open) this.modals.touch(this.panel);
    this.d.input.setUiCapture(open);
    this.hud.setVisible(!open);
    this.hotbarBar.setVisible(!open);
    if (open) this.panel.invalidate();
  }

  /** Open the furnace UI on `m`, or close it with null. THE pointer transition. */
  openFurnace(m: Machine | null): void {
    this.openMachine = m;
    this.furnacePanel.setOpen(m !== null);
    if (m !== null) this.modals.touch(this.furnacePanel);
    this.d.input.setUiCapture(m !== null);
    this.hud.setVisible(m === null);
    this.hotbarBar.setVisible(m === null);
    if (m !== null) this.furnacePanel.render(machineView(this, m));
  }

  /** Every node with its world position, nearest first. The probe's eyes. */
  nodes(): unknown[] {
    return nodeDump(this.game, this.field.placed, this.d.player.aimRay().origin);
  }

  report(): unknown { return gameplayReport(this); }
}
