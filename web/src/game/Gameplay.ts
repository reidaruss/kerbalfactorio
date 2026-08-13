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

import * as THREE from 'three';
import { GameCore, harvestRefusalText } from './GameCore.js';
import { bodyIsAirless } from './StarterContent.js';
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
import { ModeRules, sandboxCombatFromUrl, type GameMode } from './GameMode.js';
import { GameplayInput } from './GameplayInput.js';
import { labelOf } from '../player/Bindings.js';
import { Structures, type StructurePart } from './Structures.js';
import { StructureView } from './StructureView.js';
import { LaunchPads, type PadPart } from './LaunchPad.js';
import { LaunchPadView } from './LaunchPadView.js';
import { padPrompt } from './LaunchPadPlacement.js';
import { ResearchStations, type ResearchStation } from './ResearchStations.js';
import { Antennas, type ScanAntenna } from './Antennas.js';
import { RuinSites } from './RuinSites.js';
import { Sites } from '../world/Sites.js';
import { aimPrompt, ghostMachinePrompt } from './FactoryReport.js';
import { ghostPrompt } from './StructurePlacement.js';
import { nodeDump } from './GameplayViews.js';
import { assignToBar, craft, raze, recipes, slots, switchMode } from './GameplayActions.js';
import { loadInto, screenView, setRecipe, takeInput,
  takeOut } from './MachineScreen.js';
import { ItemIcons } from './ItemIcons.js';
import { Ambience } from './Ambience.js';
import { Objectives, showGoals, stepGoals } from './Objectives.js';
import { ObjectivePanel } from '../ui/ObjectivePanel.js';
import { gameplayReport } from './GameplayReport.js';
import { HealthBook } from './Health.js';
import { reconcile } from './HealthCensus.js';
import { PlayerVitals } from './PlayerVitals.js';
import { Gunnery } from './Gunnery.js';
import { Enemies } from './Enemies.js';
import { pickAim, type AimRayLike } from './GameplayAim.js';
import type { Hittable } from './Weapon.js';
import type { HurtSource } from './PlayerHealth.js';
import { attachProgress, openMachinePanel, setPackPanel } from './GameplayChrome.js';
import type { ProgressUi } from './ProgressUi.js';
import { loadSlot, saveSlot, type RestoreLedger, type WorldPorts } from './Persist.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { WaterOracle } from '../world/WaterOracle.js';
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
  /** GP-268. /core BodyParams::bodyId. Keys the starter table AND indexes
   *  the atmosphere (atmosphere.h section 2), so one id answers both. */
  bodyId: number;
  seed: number;
  /** DW-31: which mode created this world. Fixed for its whole lifetime. */
  mode: GameMode;
  /** DW-17: the voxel, mesh and terrain handles a whole-world save needs. */
  ports?: Partial<WorldPorts>;
  /** WG-69: body radius, the rock lattice's datum. READ from PlanetBody and
   *  never transcribed (the DW-18 rule that cost a walker a wrong gravity). */
  bodyRadiusM: number;
  /** WG-69: the water authority for the rocks' wet gate, or null when dry. */
  water: WaterOracle | null;
  /** WG-69: `?rocks=0` is the negative control; density is the measurement
   *  ladder's knob and 1 in play. */
  rocks?: { enabled: boolean; density: number };
  /** WG-116: `?trees=0` is the negative control; the radius is the measurement
   *  ladder's knob and the shipping reach in play. */
  trees?: { radiusM: number; density: number };
  /** WG-118: `?nodelod=0` draws every node at LOD0 as before, `?nodecull=0`
   *  turns per-instance frustum culling off. Two claims, two controls. */
  nodeArt?: { lod?: boolean; cull?: boolean };
}

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
  private simSecs = 0;
  /** Where the clearing was grown. Fixed on the first populate (see below). */
  private spawnDir: THREE.Vector3 | null = null;
  /** DW-17 autosave: slots written, and what the last load brought back. */
  saves = 0;
  restored: RestoreLedger | null = null;
  private sinceSaveTicks = 0;
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

  private constructor(private readonly d: GameplayDeps) {
    this.mode = new ModeRules(d.mode,
      sandboxCombatFromUrl(typeof location === 'undefined' ? '' : location.href));
    this.host = d.host;
    this.game = new GameCore(d.core);
    this.field = new NodeField(this.game, d.origin, d.nodeArt);
    this.oreField = new OreField(d.core, d.bodyHandle, this.field, d.origin);
    // WG-67: the rocks of the world, streamed as REAL harvest nodes. The edits
    // handle is a thunk for the same reason the scatter's is: voxels are
    // created after this and a rock streaming in over a dug pit must seat on
    // the edited surface.
    this.rocks = new RockField(d.core, this.game, this.field, d.bodyHandle,
      d.seed, d.rocks?.enabled ?? true, d.rocks?.density ?? 1,
      d.bodyRadiusM, d.water,
      () => d.ports?.voxels?.handle ?? 0);
    // WG-116: the trees, on the rocks' lattice contract and their edits thunk.
    this.trees = new TreeField(d.core, this.game, this.field, d.bodyHandle,
      d.seed, d.trees?.radiusM ?? 0, d.trees?.density ?? 1,
      d.bodyRadiusM, d.water,
      () => d.ports?.voxels?.handle ?? 0);
    this.interact = new Interact(this.game, this.field, d.player, d.avatar);
    // The badge is handed in rather than read, so the one place that decides
    // what a mode is called stays GameMode.ts.
    this.hud = new GameHud(d.host, this.mode.badge);
    this.hotbarBar = new HotbarBar(d.host);
    // Arranging the bar is a POINTER gesture, so it only works while the pack is
    // open: during play the pointer is locked to the canvas and there is no
    // cursor to click a slot with.
    this.hotbarBar.onSelect = (i) => { this.hotbar.select(i); this.hotbarBar.invalidate(); };
    this.hotbarBar.onSwap = (a, b) => { this.hotbar.swap(a, b); this.hotbarBar.invalidate(); };
    this.fx = new Feedback(this.hud, this.field, this.sfx);
    this.panel = new InventoryPanel(d.host, this.modals, (i) => craft(this, i),
      this.mode, (m) => switchMode(this, m), (item) => assignToBar(this, item));
    this.panel.closer = () => this.setPanel(false);
    this.goalPanel = new ObjectivePanel(d.host);
    showGoals(this, this.goals.wasVisible());
    // GP-39: the site registry is handed over LAZILY, because `structures` is
    // built further down this constructor and a machine only asks at placement
    // time. That is also what lets a hand furnace land on a foundation.
    this.machines = new Machines(d.core, this.game, d.origin, d.bodyHandle,
      () => d.ports?.voxels?.handle ?? 0, this.mode, () => this.structures);
    this.furnacePanel = new FurnacePanel(d.host, this.modals,
      (item) => loadInto(this, item), () => takeOut(this), () => takeInput(this),
      (output) => setRecipe(this, output));   // FS-56's fourth verb.
    this.furnacePanel.closer = () => this.openFurnace(null);
    // THE HAND IS A MODAL TOO, and registering it here rather than special-casing
    // it in the Escape handler is what keeps the guarantee derived: the probe
    // walks `modals.all()` and would catch a menu, or a mode, that skipped it.
    const hotbar = this.hotbar;
    this.modals.register({
      modalName: 'hand',
      get isOpen(): boolean { return hotbar.partInHand !== null; },
      // GP-604. IT SAYS WHAT IT PUT DOWN.
      //
      // Measured in the QOL sweep (GP-557): with a foundation in hand the FIRST
      // Escape returned the hand to `hands` with the menu still shut and the
      // SECOND opened the menu, and NEITHER press drew a single character. The
      // modal stack is behaving exactly as GP-100 designed it and the design is
      // right; what was missing is that a destructive, invisible action was
      // also a SILENT one, so the commonest reason to press Escape mid-build
      // (reach the menu) cost the player their pick with no explanation and no
      // hint that a second press was now needed.
      //
      // THE LABEL IS READ BEFORE THE HAND IS CLEARED, which is the only order
      // that works: `hotbar.label` is derived from what is held, so reading it
      // after `clearHand()` reports `hands` every time. That is the same class
      // as GP-557's own harness bug and it is worth the comment, because the
      // wrong order still compiles, still runs, and still prints a sentence.
      //
      // GP-25 IS NOT WEAKENED. Escape still empties the hand on the first press
      // and still opens the menu on the second; the derivation is untouched.
      // Only the silence goes.
      requestClose: () => {
        const what = hotbar.label;
        if (hotbar.clearHand()) {
          this.hud.flash(`put the ${what} down  (${labelOf('cancel')} again `
            + 'for the menu)', 1.8);
        }
      },
    });
    this.ambience = new Ambience(d.core, d.bodyHandle);
    // The factory ticks on the SIM clock, like everything else that is a rule.
    // DW-24: the edits handle is read LIVE, so a pad flattened with Q reads as
    // flat on the very next tick and the invalid ghost turns valid in the frame
    // the player levels it.
    this.structures = new Structures(d.core, this.game, d.bodyHandle,
      () => d.ports?.voxels?.handle ?? 0, this.mode);
    this.factory = new Factory(d.core, this.game, d.bodyHandle, 1 / 60,
      this.oreField.patches, this.structures);
    this.factoryView = new FactoryView(d.origin);
    this.structView = new StructureView(d.origin);
    this.pads = new LaunchPads(this.game, this.mode, this.structures.bodies);
    this.padView = new LaunchPadView(d.origin);
    // D-019. The same argument list `machines` takes, and for the same reasons:
    // the LIVE edits handle so a station put down in a pit belongs in the pit,
    // and the site registry LAZILY so a station can stand on a foundation.
    this.stations = new ResearchStations(d.core, this.game, d.origin,
      d.bodyHandle, () => d.ports?.voxels?.handle ?? 0, this.mode,
      () => this.structures);
    // GP-533. The same argument list the station takes, and for the same
    // reasons.
    this.antennas = new Antennas(d.core, this.game, d.origin,
      d.bodyHandle, () => d.ports?.voxels?.handle ?? 0, this.mode,
      () => this.structures);
    // WG-166. Its own `origin` port and nothing else from this composition: a
    // ruin is world content, not a building, so it takes no `GameCore`, no mode
    // and no site registry. The solid set and the enemy loop are handed to it
    // at the two call sites that need them (`create` and `Persist.apply`),
    // which is what keeps this class out of the placement's business.
    this.ruins = new RuinSites(d.core, d.bodyHandle, d.origin);
    this.build = new BuildMode(this.factory, this.factoryView,
      this.structures, this.structView, this.pads, this.padView);
    // A hand furnace marks its ingots AT the furnace (GP-64: no roaming toast).
    // Merge note: both lanes wrote this independently and agreed on the
    // behaviour; only the constructor's argument list differed, because the
    // pad lane had added `pads`/`padView` alongside.
    this.enemies = new Enemies(d.core, d.bodyHandle, d.origin, this.mode);
    this.machines.onSmelt = (m, n) => this.fx.ingot(n, m.pos, m.up,
      this.game.itemName(this.game.furnaceState(m.handle)?.outItem ?? 0));
  }

  static async create(d: GameplayDeps): Promise<Gameplay> {
    const g = new Gameplay(d);
    await Promise.all([g.field.load(), g.machines.load(), g.factoryView.load(),
      g.structures.load(), g.pads.load(), g.stations.load(), g.antennas.load(),
      g.structures.load(), g.pads.load(), g.stations.load(), g.ruins.load(),
      g.icons.load()]);
    g.structView.build(g.structures);
    g.padView.build(g.pads);
    g.progress = attachProgress(g);
    g.hotbarBar.invalidate();
    d.scene.add(g.structView.group);
    d.scene.add(g.padView.group);
    // The walker learns about the base through a PORT and not an import: a
    // structure rests on the terrain and must never become a second definition
    // of it (DW-24, plus DW-26's lesson about what a fifth surface costs).
    // A PAD JOINS THAT SAME SET rather than getting a walker port of its own,
    // which is what makes its deck, its tower and its launch table walkable for
    // free and, more to the point, means there is still exactly one answer to
    // "what is holding the player up".
    d.player.body.solids = g.structures.bodies;
    d.scene.add(g.machines.group);
    d.scene.add(g.stations.group);
    d.scene.add(g.antennas.group);
    d.scene.add(g.ruins.group);
    d.scene.add(g.field.group);
    d.scene.add(g.oreField.group);
    d.scene.add(g.fx.debris.mesh);
    d.scene.add(g.gun.fx.group);
    d.scene.add(g.enemies.view.group);
    d.scene.add(g.factoryView.group);
    // Browsers refuse audio until the player has interacted; the listener arms
    // itself on the first pointer or key event and then removes itself.
    g.sfx.attach();
    g.populate();
    g.enemies.init(g, g.walker.body.feet);
    // WG-166 / WG-168. THE RUINS, AFTER `enemies.init` AND BEFORE `load`, AND
    // BOTH HALVES OF THAT ORDER ARE LOAD-BEARING.
    //
    // After init, because `spawnGarrison` is gated by `Enemies.enabled` and a
    // garrison posted before the loop came up would be silently refused with
    // every counter still reading healthy.
    //
    // Before `load`, because `restoreStructures` calls `Structures.reset()`,
    // which calls `bodies.clear()` and throws away every solid in the world
    // including this one. `Persist.apply` puts it back through `ruins.reseat`
    // the moment the restore is done. Placing AFTER the load would work today
    // and would leave that reseat unexercised on the ordinary boot, so the
    // first person to hit it would be a player loading a save.
    g.ruins.build(new Sites(d.core, d.bodyHandle), g.structures.bodies);
    g.ruins.garrison(g.enemies, g);
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
    // GP-268 / R16. AIRLESS IS /core's ANSWER, not "is it a moon": of_atmo_*
    // is indexed by the same BodyParams::bodyId, and atmosphere.h says a body
    // that is not Forge returns exactly 0. A moon WITH air would keep its
    // trees, which `kind === 'moon'` could never express.
    const airless = bodyIsAirless(this.d.core, this.d.bodyId);
    this.nodesPlaced = this.field.populate(this.d.bodyHandle, 0, dir, this.d.seed,
                                           this.d.bodyId, airless);
    this.patchesPlaced = this.oreField.populate(dir, 0);
    // The rocks LAST: populate cleared the whole /core node array, so every
    // index the rock stream held is stale. Everything regrows from seed on the
    // next update, which is the same regenerate-then-diff order the load uses.
    this.rocks.reset();
    // The trees AFTER the rocks, for the same staleness reason, and after
    // `field.populate` because `TreeField.reset` snapshots the clearing's own
    // spiral to keep streamed trees out of it.
    this.trees.reset();
    this.nodesPlaced = this.field.placed.length;
  }

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
  fixedStep(tick: number): boolean {
    this.keys.chrome(this);
    // H-5 closed: the three progression screens are ACTIONS, so a remap moves
    // them. Gated on `suspended` because `equipment` shares KeyK with
    // `throttleDown`, and you are either walking or strapped in.
    if (!this.suspended) this.progress.step((a) => this.d.input.act(a));

    // Machines and the automation network tick on the SIM clock, like
    // everything else that is a rule: a furnace on a synthetic-clock probe
    // smelts in exactly the tick count gameplay.h says it does, and "walk away
    // and iron accumulates" waits on no frame, panel or player proximity.
    this.machines.tick(1);
    this.factory.tick(1);
    // GP-65/GP-79. After the ticks (a commit replaces the whole plan) and every
    // tick rather than on an event, because an event is a thing a future call
    // site can forget to raise. HealthCensus.ts says why registering never heals.
    reconcile(this.health, this);
    // BEFORE the vitals, and the order is the rule: this rebuilds hurtSources,
    // and a tick that ran them the other way round would spend damage against
    // the previous tick's list (Enemies.ts says why that shows as a corpse
    // still biting).
    this.enemies.step(1 / 60, this);
    this.gun.step(1 / 60);
    this.vitals.step(1 / 60, this.hurtSources,
      { player: this.d.player, hud: this.hud });
    this.fx.watchSmelters(this.factory, this.game);
    // AUTOSAVE on the sim clock too, so a driven run saves as often as a played
    // one does.
    if (++this.sinceSaveTicks >= AUTOSAVE_TICKS) { this.sinceSaveTicks = 0; void this.save(); }

    // GP-79. A dead player does not swing, place or dig. The panels stay open
    // to them, deliberately: locking somebody out of the UI mid-blackout is a
    // punishment nobody asked for, and reading your own pack is harmless.
    if (this.uiOpen || this.suspended || this.vitals.health.dead) {
      // A machine screen closes with the key that opened it; the pack is handled
      // by `chrome`. Either way nothing in the world is aimed at.
      this.keys.closeWithInteract(this);
      this.interact.target = null;
      return false;
    }
    return this.keys.world(this, this.d.player.aimRay(), tick);
  }

  /** GP-59: what the PLAYER is doing, which is what tells a held click apart
   *  from a drag. A foundation appearing under the feet moves the aim RAY and
   *  leaves all three of these untouched. */
  get lookAngles(): { yaw: number; pitch: number; moving: boolean } {
    const v = this.d.player.view;
    const f = this.d.input.frame;
    return { yaw: v.yaw, pitch: v.pitch,
      moving: f.fwd !== 0 || f.right !== 0 || f.up !== 0 };
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
    const got = this.interact.step(use, tick);
    if (got && this.interact.last !== null) {
      this.fx.impact(this.interact.last, ray.origin, this.interact.swings);
      this.panel.invalidate();
    }
    // GP-506. THE REFUSAL, SHOWN: a gated swing never reaches `interact.last`
    // (it was turned away before it was ever attempted), so the reason has to
    // be read off `lastRefusal` here instead of off a grant that never
    // happened.
    const lr = this.interact.lastRefusal;
    if (lr !== null && lr.tick === tick) this.hud.flash(harvestRefusalText(lr.code), 1.2);
    // The kick runs on the FIXED tick and is applied through the same additive
    // Controller.look the mouse uses, so a driven tape kicks exactly as often as
    // a human does and the offsets still sum to zero.
    const [ky, kp] = this.fx.kick.step(this.d.player.view.pitch);
    if (kp !== 0 || ky !== 0) this.d.player.look(ky, kp);
    return got;
  }

  /**
   * GP-605. IS THERE ANYTHING UNDER THE CROSSHAIR THAT `demolish` WOULD TAKE?
   *
   * DERIVED FROM THE SAME FOUR FIELDS `demolish` PASSES TO `raze`, and that is
   * the point of it existing at all rather than the caller testing them: two
   * lists of "what counts as a demolish target" would agree today and disagree
   * the first time a fifth buildable kind arrives, and the failure mode is a
   * right click that says "press X to remove the pad" about a thing X will not
   * remove. One list, both readers.
   */
  get hasDemolishTarget(): boolean {
    return this.aimedMachine !== null || this.aimedBuild !== null
      || this.aimedPart !== null || this.aimedStation !== null
      || this.aimedAntenna !== null || this.aimedPad !== null;
  }

  /** What that thing is CALLED, for the sentence. '' when there is none. */
  get demolishTargetName(): string {
    if (this.aimedMachine !== null) {
      return this.aimedMachine.tier === 1 ? 'smelter' : 'furnace';
    }
    if (this.aimedBuild !== null) return this.aimedBuild.kind;
    if (this.aimedPart !== null) return this.aimedPart.kind;
    if (this.aimedStation !== null) return 'research station';
    if (this.aimedAntenna !== null) return 'scanning antenna';
    return this.aimedPad !== null ? 'launch pad' : '';
  }

  /** Remove whatever the crosshair is on. Returns true if something went. */
  demolish(): boolean {
    const gone = raze(this, this.aimedMachine, this.aimedBuild, this.aimedPart,
      this.aimedPad, this.aimedStation, this.aimedAntenna);
    if (gone) {
      this.aimedMachine = null; this.aimedBuild = null; this.aimedPart = null;
      this.aimedStation = null; this.aimedAntenna = null;
    }
    return gone;
  }

  /** Per frame: node transforms, depletion variants, effects, HUD, panels. */
  frame(dt: number): void {
    this.simSecs += dt;
    // BEFORE field.update, so a rock added this frame is composed and drawn in
    // the same frame rather than flashing in a frame late at the ring's edge.
    this.rocks.update(this.d.player.body.feet);
    this.trees.update(this.d.player.body.feet);
    // The feet, not the camera: it is the same body-frame point the streaming
    // rings use, so an LOD boundary and a ring boundary are measured from one
    // origin and cannot disagree by an eye height.
    this.field.update(dt, this.d.player.body.feet);
    this.oreField.update(dt, this.d.ports?.voxels?.handle ?? 0);
    this.machines.update();
    this.machines.updateFx(dt);
    this.stations.update();
    this.antennas.update();
    // WG-166 / WG-170. The floating-origin re-place AND the LOD rung, off the
    // same feet the two rings above use, for the reason stated at line 612.
    this.ruins.update(this.d.player.body.feet);
    this.structures.step(dt);
    this.structView.sync(this.structures);
    this.pads.step(dt);
    this.padView.sync(this.pads);
    this.fx.update(dt, this.d.origin);
    this.gun.fx.update(dt, this.d.origin);
    this.enemies.frame(this);
    const eye = this.d.player.aimRay().origin;
    this.sfx.walk(dt, this.d.player.body.speedMps, this.d.player.body.grounded);
    this.fx.beds(this.factory, this.machines, eye, (base) =>
      this.ambience.step(dt, eye, this.d.player.body.underRock, base));
    // The belt scroll is driven by SIM seconds, not performance.now(), for the
    // same reason the terrain cross-dissolve is: a headless driven run then
    // scrolls at exactly the rate a real one does and a capture is reproducible.
    this.factoryView.sync(this.factory, this.simSecs, eye);  // eye: FS-28 LOD 0
    if (this.openMachine !== null || this.openBuild !== null) {
      this.furnacePanel.render(screenView(this));
    }
    this.hud.setHealth(this.vitals.health);
    const carried = this.game.carried().map((c) => ({
      name: c.name, count: c.count, icon: this.icons.for(c.name),
    }));
    // ONE prompt decision, made in one place. It used to be four early returns
    // here, and every one of them had to remember the two panel conditions.
    this.hud.render(dt, this.uiOpen ? null : padPrompt(this.build.padTarget)
      ?? ghostPrompt(this.build.structTarget)
      ?? ghostMachinePrompt(this.build.label, this.build.target)
      ?? aimPrompt(this.factory, this.game, this.aimedBuild, this.aimedMachine,
        this.interact.target), carried);
    this.hotbarBar.render(this.hotbar.rows((n) => this.icons.for(n)));
    this.progress.frame();
    stepGoals(this, dt);
    if (this.panel.isOpen) this.panel.render(slots(this), recipes(this));
  }

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
