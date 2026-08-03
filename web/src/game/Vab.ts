// The Vehicle Assembly Building: a MODE you enter and leave, not a dialog.
//
// While it is open it replaces the four render passes with its own scene
// (Frame.vabActive) and takes the pointer, and it hands both back on exit. The
// numbers are /core's and are recomputed on every structural change, because
// DW-30 item 4 makes per-stage delta-v always visible and a readout you have to
// ask for is a readout nobody reads.
//
// The pointer layer is VabInput, the panel is ui/VabPanel, the scene is VabView,
// the model is VesselDesign, the rules are VesselNodes. This file is the MODE:
// what is in hand, what a click means, and who pays.
import * as THREE from 'three';
import { VabPanel } from '../ui/VabPanel.js';
import { VabDestination } from '../ui/VabDestination.js';
import { VabDest } from './VabDest.js';
import type { ModalStack } from '../ui/ModalStack.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { ATTACH_RADIAL } from '../sim/wasm/vesselabi.js';
import type { ModeRules } from './GameMode.js';
import { offeredParts, readCatalogue } from './VesselCatalogue.js';
import type { PartRow } from './VesselCatalogue.js';
import { VesselDesign } from './VesselDesign.js';
import { insertAt } from './VesselInsert.js';
import { VabView } from './VabView.js';
import { VabCamera } from './VabCamera.js';
import { VabPointer } from './VabInput.js';
import { partRows, stageRows } from './VabRows.js';
import { vabReport, vabJointGaps, vabCatalogue } from './VabReport.js';
import {
  attachModeOf, attachNodes, fitAt, suppressedNodes, symmetryAngles,
} from './VesselNodes.js';
import {
  vabAim, vabClick, vabDropHand, vabHover, vabRightClick,
} from './VabAim.js';
import type { AttachNode } from './VesselNodes.js';
import { VabCost } from './VabCost.js';
import { RollOutGate } from './VabRollOut.js';
import { flightCheck } from './VabCheck.js';
import type { FlightVerdict } from './VabCheck.js';
import * as store from './VabStore.js';

export interface VabDeps {
  M: OfCoreModule;
  body: number;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  modals: ModalStack;
  mode: ModeRules;
  setUiCapture(on: boolean): void;    // mute the world's input
  setRenderMode(vab: boolean): void;  // flip to the bay's single pass
  rollOut(): void;                    // GP-54: leave, and put it on the ground
  setWorldUi(visible: boolean): void; // the bay is a PLACE, not an overlay, so
  /**
   * GP-121 / R11. GP-74's `recover` verb, which shipped with a key, a label and
   * every message it needs and NO BUTTON. It returns whether anything was
   * recovered so the bay can answer in its OWN message line: `setWorldUi(false)`
   * has hidden the flight HUD that `recover` normally speaks through, and a
   * refusal nobody can see is the defect the verb was written to fix.
   */
  recover(): boolean;
  /** GP-267. '' when the item is available or ungated, else the NAME of the
   *  tech that unlocks it. The bay asks the same question the build menu asks
   *  (`Buildables.lockOf`), through the same shape, so one screen cannot come
   *  to a different answer than the other about the same item. */
  lockOf?(itemId: number): string;
  /** GP-267. TRUE only when a tech gates this item AND it has been researched.
   *  Deliberately NOT `lockOf(x) === ''`: that is empty for an UNGATED item
   *  too, and offering on it put 24 of 25 parts in a survival bay that should
   *  offer 13. Two questions, two ports, neither standing in for the other. */
  unlockedByTech?(itemId: number): boolean;
}

export class Vab {
  readonly design: VesselDesign;
  readonly view: VabView;
  readonly cam: VabCamera;
  readonly panel: VabPanel;
  readonly pointer: VabPointer;
  readonly catalogue: PartRow[];
  readonly dest: VabDest;
  readonly destView: VabDestination;

  open = false;
  hand: PartRow | null = null;
  selected = -1;
  symmetry = 1;
  message = '';
  placed = 0; refused = 0; removed = 0; enters = 0;

  private readonly byIdMap = new Map<number, PartRow>();
  private readonly cost: VabCost;
  nodes: AttachNode[] = [];   // public: a probe PROJECTS these to aim at a pixel
  /** Public for VabReport, which is a VIEW of this object and never a copy. */
  active: AttachNode | null = null;
  /**
   * GP-115. THE NEAR MISS: the node the cursor is on that the part in hand
   * cannot take, and the sentence that says why. Held between the aim and the
   * click so a refusal is the real reason rather than "no attachment node
   * there", which was a false statement about a face the player was looking at.
   */
  blocked: { node: AttachNode; why: string } | null = null;
  private msgUntil = 0;
  // Once the player reorders a stage by hand the table is THEIRS: a later
  // placement must not silently rewrite it.
  handStaged = false;
  /** GP-119. The roll-out confirm. Bound to a design revision; see VabRollOut. */
  private readonly gate = new RollOutGate();
  recoveries = 0;

  private constructor(private readonly d: VabDeps) {
    this.catalogue = readCatalogue(d.M);
    this.cost = new VabCost(d.M, d.mode);
    for (const p of this.catalogue) this.byIdMap.set(p.id, p);
    this.design = new VesselDesign(d.M, d.body, (id) => this.byIdMap.get(id));
    this.view = new VabView(d.scene);
    this.cam = new VabCamera(d.camera);
    this.pointer = new VabPointer({
      canvas: d.canvas, camera: d.camera, cam: this.cam,
      onAim: (x, y) => vabAim(this, x, y),
      onClick: (x, y) => vabClick(this, x, y),
      onCancel: () => vabRightClick(this),
    });
    this.panel = new VabPanel(d.host, d.modals, {
      pick: (i) => this.takeInHand(i),
      stageUp: (i) => this.moveStage(i, i - 1),
      stageDown: (i) => this.moveStage(i, i + 1),
      autostage: () => { this.design.autostage(); this.handStaged = false; this.after('re-staged'); },
      clear: () => { this.design.clear(); this.handStaged = false; this.after('cleared'); },
      save: (n) => this.saveAs(n),
      load: (n) => this.loadNamed(n),
      remove: (n) => { store.removeDesign(n); this.after(`deleted ${n}`); },
      symmetry: (n) => { this.symmetry = n; this.render(); },
      rollOut: () => this.requestRollOut(),
      recover: () => this.recover(),
      exit: () => this.leave(),
    });
    this.panel.closer = () => this.leave();
    // GP-264/GP-265. The destination block mounts into the panel's right rail
    // and keeps its own state, because a chosen destination is not a property
    // of the design and must survive every rebuild of it.
    this.dest = new VabDest({
      M: d.M, body: d.body,
      designHandle: () => this.design.handle,
      parts: () => this.design.parts,
      catalogueIds: () => this.catalogue.map((p) => p.id),
      dvAvailableMS: () => this.design.stats.totalDeltaV,
      lockOf: d.lockOf === undefined ? undefined
        : (item) => (d.lockOf as (i: number) => string)(item),
      unlockedByTech: d.unlockedByTech === undefined ? undefined
        : (item) => (d.unlockedByTech as (i: number) => boolean)(item),
    });
    this.destView = new VabDestination(this.panel.root, {
      select: (id) => { this.dest.select(id); this.render(); },
      setOrbit: (a, i) => { this.dest.setOrbit(a, i); this.render(); },
    });
  }

  static async create(d: VabDeps): Promise<Vab> {
    const v = new Vab(d);
    await v.view.load(v.catalogue);
    const saved = store.loadCurrent();
    // GP-75. THE LATCH TRAVELS WITH THE TABLE (`DesignJson.hs`), instead of
    // being set true on every boot with a work in progress, which was a second
    // and permanent rule GP-33 never asked for.
    if (saved !== null) { v.design.fromJson(saved); v.handStaged = saved.hs === true; }
    v.rebuild();
    return v;
  }

  // --- the mode -------------------------------------------------------------
  enter(): void {
    if (this.open) return;
    this.open = true;
    this.enters += 1;
    this.d.setRenderMode(true);
    this.d.setUiCapture(true);
    this.d.setWorldUi(false);
    this.panel.setOpen(true);
    this.d.modals.touch(this.panel);
    this.pointer.bind();
    this.frameCamera();
    this.after('');
  }

  leave(): void {
    if (!this.open) return;
    this.open = false;
    this.hand = null;
    this.active = null;
    this.blocked = null;
    this.gate.clear();
    this.view.clearGhost();
    this.view.clearNodes();
    this.panel.setOpen(false);
    this.pointer.unbind();
    this.d.setUiCapture(false);
    this.d.setWorldUi(true);
    this.d.setRenderMode(false);
  }

  toggle(): void { if (this.open) this.leave(); else this.enter(); }

  /** Once per rendered frame while open. Only the message has a clock. */
  tick(nowMs: number): void {
    if (this.open && this.message !== '' && nowMs > this.msgUntil) {
      this.message = '';
      this.render();
    }
  }

  get camera(): THREE.PerspectiveCamera { return this.d.camera; }

  frameCamera(): void {
    const b = this.view.bounds();
    this.cam.frame(b.centre, b.size);
  }

  // --- what the pointer means, in VabAim.ts ---------------------------------

  /** Drive the aim from a debug caller, through the path a real move takes. */
  hoverNdc(ndcX: number, ndcY: number): void { vabHover(this, ndcX, ndcY); }
  dropHand(): void { vabDropHand(this); }

  /** Public ONLY so `VabAim.ts` can reach them; both are the bay's own verbs.
   *  `say` shows a message and persists the work in progress; `repaint` redraws
   *  the panel without touching the model. */
  say(msg: string): void { this.after(msg); }
  repaint(): void { this.render(); }

  // --- editing --------------------------------------------------------------
  private takeInHand(index: number): void {
    const p = this.catalogue[index];
    if (p === undefined) return;
    if (this.hand !== null && this.hand.index === index) { this.dropHand(); return; }
    this.hand = p;
    this.selected = -1;
    this.view.highlight([]);
    this.nodes = this.allNodes();
    this.view.showNodes(this.nodes, this.active);
    this.render();
    this.hoverNdc(this.pointer.ndcX, this.pointer.ndcY);   // GP-143, see VabAim
  }

  /**
   * GP-296. FREE FACES AND SEAMS, in one list, because a player aims at a place
   * and does not care which kind it is.
   *
   * The seams come last so that where a free face and a seam are at the same
   * distance from the aim ray, `nearestNodeToRay` keeps the free face: it
   * prefers the earlier node on a tie, and attaching to a free end is the far
   * commoner intent. Aiming AT a seam still wins, because there is no free face
   * there to tie with.
   */
  private allNodes(): AttachNode[] {
    const byId = (id: number): PartRow | undefined => this.byIdMap.get(id);
    return [...attachNodes(this.design.parts, byId),
            ...suppressedNodes(this.design.parts, byId)];
  }

  /** Commit the part in hand wherever it is currently snapped. */
  commitHere(): boolean {
    const hand = this.hand;
    if (hand === null) return this.refuse('nothing in hand');

    if (this.design.empty) {
      if (!hand.nodeBottom && !hand.nodeTop) {
        return this.refuse(`${hand.label} cannot start a stack`);
      }
      if (!this.canAfford(hand)) return this.refuse(this.costWhy(hand));
      if (!this.pay(hand)) return this.refuse(this.costWhy(hand));
      this.design.addRoot(hand.id);
      this.placed += 1;
      return this.afterPlace(hand);
    }

    const node = this.active;
    if (node === null) {
      // GP-115. The near miss speaks. Before this the only sentence reachable
      // from a mouse was the one below, and it was wrong whenever a face WAS
      // there: `nearestNodeToRay` had already filtered out everything that did
      // not fit, so `fitAt` here could never fail and every message it composes
      // was dead code. That is why "1.25 m will not mate with 2.50 m" had never
      // once appeared on screen.
      const b = this.blocked;
      if (b !== null) return this.refuse(b.why === '' ? 'that will not fit there' : b.why);
      return this.refuse('no attachment node there');
    }
    const fit = fitAt(node, hand);
    if (!fit.ok) return this.refuse(fit.why);

    // GP-296. A SEAM IS COMMITTED BY SPLICING, not by attaching. This is the
    // gesture half of Reid's complaint: the splice has existed since GP-293 and
    // had only a debug verb, so a player could still aim at a joint and find
    // nothing there. `insertAtJoint` does the paying, the stage remap, the save
    // and the redraw, so nothing about that path is duplicated here.
    if (node.kind === 'insert') {
      const kid = this.design.parts.findIndex((q) => q.handle === node.child);
      if (kid < 0) return this.refuse('that joint has moved; aim again');
      const r = this.insertAtJoint(kid, hand.id);
      if (!r.ok) return this.refuse(r.why);
      this.placed += 1;
      // `insertAtJoint` already went through `after`, which saves and rebuilds,
      // so this only has to do what afterPlace does ABOUT THE HAND.
      this.nodes = this.allNodes();
      this.view.showNodes(this.nodes, null);
      this.hoverNdc(this.pointer.ndcX, this.pointer.ndcY);
      return true;
    }

    const how = attachModeOf(node);
    const angles = how === ATTACH_RADIAL
      ? symmetryAngles(node, this.symmetry) : [node.angleRad];
    // Symmetry is ALL-OR-NOTHING on cost. A player who can afford one fin of
    // four and receives one fin has been charged for a mistake they cannot see,
    // so the whole set is checked before the first unit is spent.
    for (let i = 0; i < angles.length; ++i) {
      if (!this.canAfford(hand)) {
        return this.refuse(i === 0 ? this.costWhy(hand)
                                   : `only ${i} of ${angles.length} affordable`);
      }
      if (!this.pay(hand)) return this.refuse(this.costWhy(hand));
      this.design.attach(node.parent, hand.id, how, angles[i] ?? 0, node.offsetM);
      this.placed += 1;
    }
    return this.afterPlace(hand);
  }

  private afterPlace(hand: PartRow): boolean {
    if (!this.handStaged) this.design.autostage();
    this.after(`placed ${hand.label}`);
    this.nodes = this.allNodes();
    this.view.showNodes(this.nodes, this.active);
    return true;
  }

  /**
   * GP-293. PUT THE PART IN HAND INTO AN EXISTING JOINT.
   *
   * `childIndex` is the part SITTING ON the joint, which is what a player is
   * pointing at when they aim at a seam: the tank's own mating face, not the
   * pod above it.
   *
   * IT IS A SPLICE AND A REBUILD, not surgery on the live tree. The design is a
   * flat array with parent INDICES and `fromJson` already walks one; GP-148
   * leaned on exactly that for the re-root. So this needs no `of_vs_reparent`,
   * no ABI bump, and nothing from a lane that is live in another header
   * tonight.
   *
   * THE STAGE TABLE IS PRESERVED THE SAME WAY THE RE-ROOT PRESERVES IT: through
   * `toJson`, spliced, and back through `fromJson`, with `handStaged` carried
   * across so a player's own staging is not silently replaced by the
   * derivation (GP-75's latch).
   */
  insertAtJoint(childIndex: number, partId: number): { ok: boolean; why: string } {
    const before = this.design.toJson('insert', this.handStaged);
    const r = insertAt(before, childIndex, partId);
    if (r.design === null) return { ok: false, why: r.why };
    // THE ARRIVING PART IS PAID FOR THROUGH THE SAME GATE AS ANY OTHER, and
    // BEFORE the tree is touched: a splice that half-succeeded because the
    // player could not afford the part would leave a rebuilt design with the
    // part missing from it, which is worse than a refusal. `cost` is the one
    // authority (VabCost, through GameMode) and the sentence is its own.
    const row = this.byIdMap.get(partId);
    if (row === undefined) return { ok: false, why: 'no such part.' };
    if (!this.canAfford(row)) return { ok: false, why: this.costWhy(row) };
    if (!this.pay(row)) return { ok: false, why: this.costWhy(row) };
    this.design.fromJson(r.design);
    this.handStaged = r.design.hs === true;
    // `after` is the one place a structural change is saved and redrawn, so an
    // insert goes through it rather than saving itself.
    this.after(`inserted ${row.name}`);
    return { ok: true, why: '' };
  }

  removeAt(handle: number): boolean {
    if (this.design.find(handle) === null) return false;
    const subtree = this.design.subtree(handle);
    const n = this.design.remove(handle);
    if (n <= 0) return false;
    if (!this.d.mode.freeBuild) {
      for (const p of subtree) {
        const def = this.byIdMap.get(p.partId);
        if (def !== undefined) this.cost.refund(def);
      }
    }
    this.removed += n;
    this.selected = -1;
    if (!this.handStaged) this.design.autostage();
    this.after(`removed ${n} part${n === 1 ? '' : 's'}`);
    this.nodes = this.allNodes();
    return true;
  }

  // --- rolling out, and the one check that had to exist ---------------------

  /** The pre-flight verdict, recomputed from /core's own stage table. */
  get verdict(): FlightVerdict {
    return flightCheck(this.design.stages, this.design.stats);
  }

  /** GP-119. Roll out, unless the design cannot fly. See `VabRollOut.ts` for
   *  why this is a confirm and never a block. */
  requestRollOut(): boolean {
    const v = this.verdict;
    if (this.gate.press(v.ok, this.design.revision)) { this.d.rollOut(); return true; }
    this.refuse(`${v.summary}. Press Roll out again to launch it anyway`);
    return false;
  }

  /** Whether a second press right now would launch a refused design. */
  get rollOutArmed(): boolean { return this.gate.armed(this.design.revision); }
  get rollOutsRefused(): number { return this.gate.refused; }
  get rollOutsForced(): number { return this.gate.forced; }

  /** GP-121 / R11. The `recover` verb, reachable from the bay at last. */
  recover(): boolean {
    const ok = this.d.recover();
    this.after(ok ? 'pad cleared, the design is still here'
                  : 'nothing to recover: the pad is empty');
    if (ok) this.recoveries += 1;
    return ok;
  }

  private moveStage(from: number, to: number): void {
    if (!this.design.stageMove(from, to)) return;
    this.handStaged = true;
    this.after(`stage ${from} to ${to}`);
  }

  // --- cost, through GameMode and never through a boolean (VabCost.ts) -----

  private canAfford(p: PartRow): boolean { return this.cost.canAfford(p); }
  private pay(p: PartRow): boolean { return this.cost.pay(p); }
  private costWhy(p: PartRow): string { return this.cost.why(p); }
  private costText(p: PartRow): string { return this.cost.text(p); }
  /** /core's OWN verdict, not overridden by the mode (GP-29). */
  affordInCore(p: PartRow): boolean { return this.cost.affordInCore(p); }

  private refuse(why: string): boolean {
    this.refused += 1;
    this.after(why);
    return false;
  }

  // --- designs (GP-34: a library, NOT world state) --------------------------

  private saveAs(name: string): void {
    const ok = store.saveDesign(name, this.design.toJson(name, this.handStaged));
    this.after(ok ? `saved ${name}` : 'name the design first');
  }

  /** GP-34: loading neither charges nor refunds, a stated balance hole. GP-75:
   *  the latch travels with the table, so a blueprint whose author never touched
   *  the arrows keeps re-deriving and a hand-ordered one keeps its order. */
  private loadNamed(name: string): void {
    const d = store.loadDesign(name);
    if (d === null) { this.after(`no design ${name}`); return; }
    this.design.fromJson(d);
    this.handStaged = d.hs === true;
    this.frameCamera();
    this.after(`loaded ${name}`);
  }

  // --- rendering the state out ---------------------------------------------

  private after(msg: string): void {
    if (msg !== '') { this.message = msg; this.msgUntil = performance.now() + 3000; }
    store.saveCurrent(this.design.toJson('current', this.handStaged));
    this.rebuild();
  }

  /** GP-122. How many times the camera has had to follow a growing assembly. */
  reframes = 0;

  private rebuild(): void {
    this.view.rebuild(this.design.parts, (id) => this.byIdMap.get(id));
    // The stack may have grown past the view. Only the target follows, and only
    // when it has actually left; a full reframe would discard a chosen angle.
    if (this.open && !this.design.empty) {
      const b = this.view.bounds();
      if (this.cam.keepInView(b.centre, b.size)) this.reframes += 1;
    }
    this.view.highlight(this.selected >= 0 ? [this.selected] : []);
    this.render();
  }

  private render(): void {
    if (!this.open) return;
    const offered = this.offered();
    const v = this.verdict;
    this.panel.render(
      partRows(offered, this.hand === null ? -1 : this.hand.index,
               (p) => this.costText(p), (p) => this.canAfford(p)),
      stageRows(this.design.stages, v), this.design.stats,
      store.listDesigns(), this.symmetry, this.message, v);
    this.destView.render(this.dest.state());
  }

  // --- what a probe reads. The bodies live in VabReport.ts ------------------

  measureJointGaps(): unknown { return vabJointGaps(this); }
  catalogueReport(): unknown { return vabCatalogue(this); }

  /** The mode rules, so `VabReport` can read them without reaching into `d`. */
  get modeRules(): ModeRules { return this.d.mode; }

  /** GP-267. What this mode and this world's research actually offer. ONE
   *  place, so the panel, the report and every probe read the same list. */
  offered(): PartRow[] {
    const un = this.d.unlockedByTech;
    return offeredParts(this.catalogue, this.d.mode,
      un === undefined ? undefined : (item) => un.call(this.d, item));
  }

  report(): unknown { return vabReport(this); }
}
