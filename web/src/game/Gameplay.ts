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
// frame; closing it must take the lock back without the mouse having "moved".
// Input.setUiCapture does both halves, including clearing the accumulated
// deltas, because a frame of unlocked movement applied on re-lock reads as a
// bug.
//
// GP-1076. AND THE SENTENCE ABOVE IS NOW STRUCTURAL. Six siblings hold what
// this file used to inline and each is the answer to one question:
// GameplayDeps.ts what a world is made of, GameplayCompose.ts what the
// constructor builds and in what order, GameplayCreate.ts bring-up and the
// regrown clearing, GameplayStep.ts the fixed tick and the swing,
// GameplayFrame.ts the frame, GameplayRaze.ts taking something down. What is
// left in this class is exactly what the header always claimed: the fields,
// the order they are built in, and the pointer.

import type * as THREE from 'three';
import { GameCore } from './GameCore.js';
import { NodeField } from './NodeField.js';
import { RockField } from './RockField.js';
import { TreeField } from './TreeField.js';
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
import { ModeRules, sandboxCombatFromUrl } from './GameMode.js';
import { GameplayInput } from './GameplayInput.js';
import { Structures, type StructurePart } from './Structures.js';
import { StructureView } from './StructureView.js';
import { LaunchPads, type PadPart } from './LaunchPad.js';
import { LaunchPadView } from './LaunchPadView.js';
import { ResearchStations, type ResearchStation } from './ResearchStations.js';
import { Antennas, type ScanAntenna } from './Antennas.js';
import { RuinSites } from './RuinSites.js';
import type { AimedInvestigate } from './RuinInteract.js';
import { nodeDump } from './GameplayViews.js';
import { ItemIcons } from './ItemIcons.js';
import { Ambience } from './Ambience.js';
import { Objectives, showGoals } from './Objectives.js';
import { ObjectivePanel } from '../ui/ObjectivePanel.js';
import { gameplayReport } from './GameplayReport.js';
import { HealthBook } from './Health.js';
import { Wreckage, type RubbleRow } from './Wreckage.js';
import { PlayerVitals } from './PlayerVitals.js';
import { Gunnery } from './Gunnery.js';
import { Enemies } from './Enemies.js';
import { pickAim, type AimRayLike } from './GameplayAim.js';
import type { Hittable } from './Weapon.js';
import type { HurtSource } from './PlayerHealth.js';
import { openMachinePanel, setPackPanel } from './GameplayChrome.js';
import type { ProgressUi } from './ProgressUi.js';
import { loadSlot, saveSlot, type RestoreLedger, type WorldPorts } from './Persist.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Controller } from '../player/Controller.js';
import type { Avatar } from '../player/Avatar.js';
import type { Input } from '../player/Input.js';
import {
  composeBuildings, composeChrome, composeGround, composeMachines,
} from './GameplayCompose.js';
import { bringUp, growClearing } from './GameplayCreate.js';
import { lookAngles, stepFixed, stepSwing } from './GameplayStep.js';
import { frameOf } from './GameplayFrame.js';
import {
  applyDamage, hasRazeTarget, razeAimed, razeTargetName,
} from './GameplayRaze.js';
import type { GameplayDeps } from './GameplayDeps.js';

export type { GameplayDeps } from './GameplayDeps.js';

export class Gameplay {
  /** DW-31: what a placement costs, what the catalogue offers, and what the
   *  save slot is keyed by. ONE authority, in game/GameMode.ts. */
  readonly mode: ModeRules;
  readonly game: GameCore;
  readonly field: NodeField;
  /** WG-67: the rocks of the world, streamed as real stone harvest nodes. */
  readonly rocks: RockField;
  /** WG-116: the trees of the world, on the same contract. There are no
   *  scenery trees; every tree the player can walk to gives wood. */
  readonly trees: TreeField;
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
  /** GP-57 / DW-29: the launch pads, and the batch that draws them with their
   *  clamps. The space half of the game's entrance into the ground half. */
  readonly pads: LaunchPads;
  readonly padView: LaunchPadView;
  /** D-019: the research stations. The machine the J key now asks about, and
   *  the first building in this game whose whole purpose is a screen. */
  readonly stations: ResearchStations;
  /** GP-533: the scanning antennas. Placement fires the one-shot POI reveal
   *  (`placeAntenna` in GameplayActions.ts); this class owns only where and
   *  how one stands. */
  readonly antennas: Antennas;
  /** WG-166: the ruins the world actually SHOWS. Drawn from the site table
   *  `/core` generates from the seed, solid through the same `structures.bodies`
   *  everything else is solid through, and garrisoned through the seam
   *  `EnemyGarrison.ts` built for it. */
  readonly ruins: RuinSites;
  /** GP-65 / GP-79: what every placed thing can take, and what the PLAYER can.
   *  `Gameplay` is its own `HealthPopulations`, the four lists being fields
   *  already. Reasoning in Health.ts / PlayerHealth.ts. */
  readonly health = new HealthBook();
  /** D1 (GP-745 to GP-759): what is left where a building fell. Not a save row,
   *  not a target, no `Solid`; Wreckage.ts's header says why for all three. */
  readonly wreckage: Wreckage;
  readonly vitals = new PlayerVitals(() => this.mode.hostile);
  /** GP-86: the gun. Its rule, its pictures and its sound, composed in
   *  Gunnery.ts so this file grows by lines rather than by responsibilities. */
  readonly gun = new Gunnery();
  /** GP-87 to GP-93: the enemies. It OWNS `shootables` and `hurtSources`, which
   *  were declared empty here until the wave lane filled them, and everything
   *  the swarm does; the two getters below are what the weapon and the vitals
   *  already read, so nothing downstream of them moved. */
  readonly enemies: Enemies;
  get shootables(): readonly Hittable[] { return this.enemies.shootables; }
  get hurtSources(): readonly HurtSource[] { return this.enemies.hurtSources; }
  /** W11: the three screens that show what the player has EARNED, over
   *  research.h, power.h and progression.h. Built in `create` because the grid
   *  panel needs the factory's own network. */
  progress!: ProgressUi;
  /** The DOM parent, so the progression panels share the pack's host. */
  readonly host: HTMLElement;
  nodesPlaced = 0;
  patchesPlaced = 0;
  placements = 0;
  /** Ingots taken out of automated machines by hand, for the HUD and probes. */
  autoCollected = 0;
  /** GP-1076: was private. `GameplayFrame.ts` accumulates it, so the
   *  field is now the class's own published clock rather than a secret. */
  simSecs = 0;
  /** Where the clearing was grown. Fixed on the first populate (see below). */
  /** GP-1076: was private, for the reason `simSecs` gives.
   *  `GameplayCreate.growClearing` is what fixes it. */
  spawnDir: THREE.Vector3 | null = null;
  /** DW-17 autosave: slots written, and what the last load brought back. */
  saves = 0;
  restored: RestoreLedger | null = null;
  /** GP-1076: was private, for the reason `simSecs` gives. */
  sinceSaveTicks = 0;
  openMachine: Machine | null = null;
  /** GP-61: the factory building the machine screen is showing, or null. */
  openBuild: Placed | null = null;
  aimedMachine: Machine | null = null;
  aimedBuild: Placed | null = null;
  aimedPart: StructurePart | null = null;
  /** D-019: the research station under the crosshair, or null. */
  aimedStation: ResearchStation | null = null;
  /** GP-533: the scanning antenna under the crosshair, or null. */
  aimedAntenna: ScanAntenna | null = null;
  /** L7 (GP-546 to GP-549): a ruin's investigate socket under the crosshair,
   *  or null. Picked after every player-placed thing, before the pad. */
  aimedInvestigate: AimedInvestigate | null = null;
  /** D1: the pile of rubble under the crosshair, or null. Picked after every
   *  live player-placed thing, before the ruin socket. */
  aimedRubble: RubbleRow | null = null;
  /** GP-57: the launch pad under the crosshair, or null. Picked LAST. */
  aimedPad: PadPart | null = null;
  suspended = false;   // W9: strapped in. Gates fixedStep's ON-FOOT tail ONLY.

  /** GP-268. The body the starter table was keyed on, for the report. */
  get starterBodyId(): number { return this.d.bodyId; }

  /** What a save needs: the module handle, the seed, and the voxel handles,
   * which live in Services and are null in a scenario with no character. */
  get core(): OfCoreModule { return this.d.core; }
  get seed(): number { return this.d.seed; }
  /** PS-40: WHICH BODY THIS WORLD IS ON, for the save. It is the same `d.bodyId`
   *  `starterBodyId` reads and is exposed under its own name rather than through
   *  that one, because "the body the starter table was keyed on" and "the body
   *  this slot describes" are two claims that happen to share a number today and
   *  a reader of either should not have to know that. Fixed for the lifetime of
   *  this Gameplay: a runtime `WorldSession.reboot` rebuilds the body scope and
   *  deliberately does NOT rebuild gameplay, so this stays what boot built and
   *  the save follows it. That residue is measured by `staleHolders()` and is
   *  core-engine's, not this getter's, to close. */
  get bodyId(): number { return this.d.bodyId; }
  /** WG-151: the body HANDLE the POI/site bridge keys its per-body
   *  catalog on (`of_poi_*`'s `body` argument) -- NOT `bodyId` above, which is
   *  `/core`'s `BodyParams::bodyId` and numbers a body KIND, not a live
   *  handle. `WaterOracle`/`RockField`/`TreeField` all take this same
   *  `d.bodyHandle`; the save follows the same one. */
  get bodyHandle(): number { return this.d.bodyHandle; }
  /** H-4: the body the armour goes on. Null with no character. */
  get avatar(): Avatar | null { return this.d.avatar; }
  get ports(): WorldPorts {
    const p = this.d.ports;
    return { voxels: p?.voxels ?? null, voxelMesh: p?.voxelMesh ?? null,
      terrain: p?.terrain ?? null };
  }

  /**
   * The four phases, in the order the constructor always ran them, with their
   * fields taken here so every one of them stays `readonly` and strictly
   * definite-assigned. GameplayCompose.ts holds the wiring and says why the
   * phases return rather than assign.
   */
  private constructor(private readonly d: GameplayDeps) {
    this.mode = new ModeRules(d.mode,
      sandboxCombatFromUrl(typeof location === 'undefined' ? '' : location.href));
    this.host = d.host;
    const w = composeGround(d);
    this.game = w.game; this.field = w.field; this.oreField = w.oreField;
    this.rocks = w.rocks; this.trees = w.trees; this.interact = w.interact;
    const c = composeChrome(d, this);
    this.hud = c.hud; this.hotbarBar = c.hotbarBar; this.fx = c.fx;
    this.panel = c.panel; this.goalPanel = c.goalPanel;
    showGoals(this, this.goals.wasVisible());
    const m = composeMachines(d, this);
    this.machines = m.machines; this.furnacePanel = m.furnacePanel;
    const b = composeBuildings(d, this);
    this.ambience = b.ambience; this.structures = b.structures;
    this.factory = b.factory; this.factoryView = b.factoryView;
    this.structView = b.structView; this.pads = b.pads; this.padView = b.padView;
    this.stations = b.stations; this.antennas = b.antennas; this.ruins = b.ruins;
    this.wreckage = b.wreckage; this.build = b.build; this.enemies = b.enemies;
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await bringUp(g, d);
    return g;
  }

  /** Write the autosave slot (DW-17), and restore it over a fresh clearing. */
  save(): Promise<unknown> { return saveSlot(this); }
  load(): Promise<RestoreLedger | null> { return loadSlot(this); }

  /** Grow the clearing around wherever the player currently stands. The rule,
   *  and why it does not follow the player, are in GameplayCreate.ts. */
  populate(): void { growClearing(this, this.d); }

  /** True while the pointer is locked to the canvas. */
  get pointerLocked(): boolean { return this.d.input.pointerLocked; }
  get input(): Input { return this.d.input; }

  /** True while a panel owns the pointer, so the dig action stands down. */
  get uiOpen(): boolean {
    return this.panel.isOpen || this.furnacePanel.isOpen || this.progress.isOpen;
  }

  /**
   * True when the left button should reach the DIGGING tool: no panel up, and
   * the selected slot is the HAND.
   *
   * "no part in hand" is the wrong test and was a bug: a hand furnace is not a
   * `PartKind`, so holding the button with the furnace slot selected placed the
   * furnace on the press and then dug a crater under it for as long as the
   * button was held. An empty slot must do nothing at all for the same reason.
   */
  get digAllowed(): boolean {
    return !this.uiOpen && this.hotbar.handInHand;
  }

  /** Fixed tick. Returns true on the tick a harvest actually granted items. */
  fixedStep(tick: number): boolean { return stepFixed(this, this.d, tick); }

  /** GP-59: what the PLAYER is doing, which is what tells a held click apart
   *  from a drag (GameplayStep.ts). */
  get lookAngles(): { yaw: number; pitch: number; moving: boolean } {
    return lookAngles(this.d);
  }

  /** Re-pick what the crosshair is on. The ORDER is the rule: GameplayAim.ts. */
  aim(ray: AimRayLike): void { pickAim(this, ray); }

  /** GP-86's named seam, FILLED (GP-91): a round arriving is the swarm's
   *  business, and nothing in the weapon path learns what an enemy is. */
  onShotHit(ref: unknown, damage: number): void { this.enemies.onShotHit(ref, damage); }
  /** The walker, for the two things outside this file that need its aim: the
   *  trigger (Gunnery.pullTrigger) and nothing else yet. A getter rather than
   *  making `d` public, so the surface stays one name wide. */
  get walker(): Controller { return this.d.player; }

  /** The bare hand. Returns true on the tick a harvest granted items. */
  swing(use: boolean, tick: number,
        ray: { origin: { x: number; y: number; z: number } }): boolean {
    return stepSwing(this, this.d, use, tick, ray);
  }

  /** GP-605. Anything under the crosshair that `demolish` would take? One
   *  list, four readers, and why: GameplayRaze.ts. */
  get hasDemolishTarget(): boolean { return hasRazeTarget(this); }

  /** What that thing is CALLED, for the sentence. '' when there is none. */
  get demolishTargetName(): string { return razeTargetName(this); }

  /** Remove whatever the crosshair is on. Returns true if something went. */
  demolish(): boolean { return razeAimed(this); }

  /** D1. The one door into a building's health, and therefore the one place a
   *  building can fall down. Why here and not in the swarm: GameplayRaze.ts. */
  damage(key: string, amount: number): { applied: number; destroyed: boolean } {
    return applyDamage(this, key, amount);
  }

  /** Per frame: node transforms, depletion variants, effects, HUD, panels. */
  frame(dt: number): void { frameOf(this, this.d, dt); }

  /** THE two pointer transitions. `GameplayChrome` owns both halves of each. */
  setPanel(open: boolean): void { setPackPanel(this, open); }
  openFurnace(m: Machine | null): void { openMachinePanel(this, m); }
  openBuildPanel(b: Placed | null): void { openMachinePanel(this, null, b); }

  /** Every node with its world position, nearest first. The probe's eyes. */
  nodes(): unknown[] {
    return nodeDump(this.game, this.field.placed, this.d.player.aimRay().origin);
  }

  report(): unknown { return gameplayReport(this); }
}
