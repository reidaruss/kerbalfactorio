// THE FLIGHT MODE: roll out, board, fly, come back. Wiring only.
//
// It owns the session (the sim), the observer (the eye), the view (the meshes)
// and the navball (the readout), and it owns exactly one decision of its own:
// what the `board` key means right now. That decision is spelled out in
// `FlightDoors.ts` (GP-1085); everything else is a hand-off.
//
// WHY THERE IS NO THIRD RENDER MODE. `Frame.vabActive` swaps the four passes for
// one because a rocket on a stand and a planet at 600 km share no depth range.
// Flight is the OPPOSITE case: the whole point of the milestone is that the
// vessel is in the same near 1:1 scene the walker is, so the scaled-space rig
// carries it from the pad to orbit continuously. A flight pass would have been a
// second seam to maintain and would have deleted the feature it was meant to
// serve. `vabActive` therefore stays a boolean.

// WHERE THE REST OF IT WENT (GP-1085). The class stays the orchestrator and every
// public method keeps its name; two cohesive lumps moved out under it.
//   `FlightDoors.ts`  the board key and its three meanings, plus the two ways
//                     out: roll out, climb in, take control remotely, spacewalk,
//                     climb down. The range constants live there because nothing
//                     else reads them.
//   `FlightFrame.ts`  the per-frame update and the drawn-stack rebuild.
// They take the mode as an explicit first argument, which is the shape this
// directory already used for FlightPad/FlightDock/FlightAuto/FlightRecover.

import * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import { FlightSession } from '../sim/FlightSession.js';
import type { Vec3 } from '../sim/FlightAbi.js';
import { VesselObserver } from '../player/VesselObserver.js';
import type { ViewRouter } from '../player/ViewRouter.js';
import type { Input } from '../player/Input.js';
import type { Controller } from '../player/Controller.js';
import { VesselView } from '../render/VesselView.js';
import { Navball } from '../ui/Navball.js';
import type { NavballReadout } from '../ui/Navball.js';
import { readout as computeReadout } from './FlightReadout.js';
import type { NavPublication, NavTarget, NodeBurn } from './FlightNav.js';
import { dockReport, toggleDock } from './FlightDock.js';
import { toggleApproach } from './FlightAuto.js';
import type { DockTarget } from './FlightDock.js';
import { padReport, stepPadClamps as stepPad } from './FlightPad.js';
import { recoverVessel } from './FlightRecover.js';
import { labelOf } from '../player/Bindings.js';
import { readCatalogue } from '../game/VesselCatalogue.js';
import type { LaunchPads, PadPart } from '../game/LaunchPad.js';
import type { PartRow } from '../game/VesselCatalogue.js';
import { evaActive } from '../game/VesselGravity.js';
// A NAMESPACE IMPORT, not named ones, and that is deliberate: every delegate
// below shares its name with the function it forwards to, and `doors.board(this)`
// says which one is meant where a bare `board(this)` inside `board()` would read
// like recursion to anyone skimming it.
import * as doors from './FlightDoors.js';
import * as perFrame from './FlightFrame.js';

export interface FlightDeps {
  M: OfCoreModule;
  bodyHandle: number;
  bodyRadiusM: number;
  oracle: SurfaceOracle;
  origin: FloatingOrigin;
  router: ViewRouter;
  input: Input;
  player: Controller;
  scene: THREE.Scene;
  host: HTMLElement;
  /** The live design handle from the assembly bay, or 0 when there is none. */
  designHandle(): number;
  /** GP-57: the world's launch pads, or null in a boot with no gameplay. A
   *  THUNK, so a world reloaded from a save hands back the RESTORED pads. */
  pads?(): LaunchPads | null;
  /**
   * PH-383. HAS THE PLAYER EARNED THIS MILESTONE? A PREDICATE AND NOT THE
   * RESEARCH TREE, on `pads`'s own precedent and for a stronger reason: flight
   * needs to ask one yes/no question (R99's auto-approach is gated on
   * `StationBoarded`), and handing it the tree would let it grow opinions about
   * progression that belong to gameplay. Absent in a boot with no gameplay, in
   * which case the gate reads SHUT -- see `approachUnlocked`.
   */
  milestone?(id: number): boolean;
  /** Hide the on-foot HUD and the build ghost while strapped in. */
  setWorldUi(visible: boolean): void;
}

export class FlightMode {
  readonly session: FlightSession;
  readonly observer: VesselObserver;
  readonly view: VesselView;
  readonly navball: Navball;

  aboard = false;
  /** The node's burn direction, inertial, or null. Written by MapMode so the
   *  ball's marker and the map's are ONE direction from one plan. */
  nodeDir: Vec3 | null = null;
  /** PH-350. The node's CLOCK and its countdown, written by MapNode on exactly
   *  the precedent `nodeDir` set, so the ball's burn timer and the map's are
   *  one computation. null when there is no node. */
  nodeBurn: NodeBurn | null = null;
  /** PH-350 / R90. The selected target's range and closing rate, written by
   *  MapMode every frame whether the map is open or shut. null when nothing is
   *  selected, which is a different claim from "range 0". */
  navTarget: NavTarget | null = null;
  /** PH-360. The port this vessel could latch to, recomputed every frame from
   *  the host's LIVE pose. Written by `frame()` through `FlightDock.ts`, which
   *  owns every docking decision; this field is the handle the readout and the
   *  key press both read, on `nodeDir`'s own precedent. */
  dockTarget: DockTarget | null = null;
  /** The host id the /core rig is currently armed against, or 0. Held here and
   *  not inside `armDock` because `of_fl_dock_arm` RESETS the running closest
   *  approach, so it must fire once per target and not once per frame. */
  dockArmedFor = 0;
  /** The /core flight handle that memo was taken against. Both halves, or a
   *  rebuilt FlightSim keeps a memo for a rig that no longer exists. */
  dockArmedHandle = 0;
  /** PH-366. Latches made and released, beside `boardings`/`evas` rather than
   *  on a surface of their own, so the report can tell the doors apart. */
  docks = 0;
  undocks = 0;
  /** PH-382. Auto-approach programs ARMED, beside `docks` for the same reason
   *  those sit beside `boardings`: a counter is how a probe proves a press
   *  arrived rather than inferring it from a vessel that happened to move. */
  approaches = 0;
  rollouts = 0;
  /** PH-110: spacewalks begun. Beside `boardings` and `disembarks`, so the
   *  report can tell the three doors apart. */
  evas = 0;
  /** GP-57. Roll-outs that landed on a real pad rather than on R12's stand-in
   *  patch of ground, the pad the LIVE vessel stands on, and the measured gap
   *  between the vessel's own base and that pad's published `socket_vessel`
   *  (-1 when the last roll-out was not on a pad). Public because FlightPad.ts
   *  writes them; see that file for what each one is measured against. */
  padRollouts = 0;
  padInUse: PadPart | null = null;
  padSocketGapM = -1;
  boardings = 0;
  disembarks = 0;
  /** GP-74. Vessels taken back out of the world. FlightRecover.ts writes it. */
  recoveries = 0;
  refusals = 0;
  message = '';

  private catalogue: PartRow[] = [];
  /** Public: `FlightFrame.ts` asks it which parts are engines, and
   *  `rebuild` hands it to the view as the catalogue lookup. */
  byId = new Map<number, PartRow>();
  private loaded = false;
  /** Public: FlightPad.ts rebuilds the drawn stack on a pad roll-out. */
  drawnRevision = -1;
  /** These five are public for ONE reader, `FlightFrame.ts`, which owns the
   *  per-frame update; the clock pair is still written only by `flash` and
   *  `frame`. The three vectors stay `readonly` scratch: written in place every
   *  frame, never replaced, never handed out. */
  msgUntilS = 0;
  lastSimSecs = 0;
  readonly pos = new THREE.Vector3();
  readonly fwd = new THREE.Vector3();
  readonly rgt = new THREE.Vector3();

  /** `d` is public because the pad half of the roll-out lives in FlightPad.ts,
   *  and handing over the bundle beats copying four ports onto the class. */
  constructor(readonly d: FlightDeps) {
    this.session = new FlightSession({
      M: d.M, bodyHandle: d.bodyHandle, bodyRadiusM: d.bodyRadiusM,
      surfaceRadius: (x, y, z) => d.oracle.surfaceRadius(x, y, z),
      recoverKeyLabel: labelOf('recover'),
    });
    this.observer = new VesselObserver(this.session, d.oracle, d.input);
    this.view = new VesselView(d.scene);
    this.navball = new Navball(d.host);
    this.navball.setVisible(false);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.catalogue = readCatalogue(this.d.M);
    for (const p of this.catalogue) this.byId.set(p.id, p);
    await this.view.load(this.catalogue);
    this.loaded = true;
  }

  // --- the doors, decided in FlightDoors.ts ----------------------------------
  //
  // ONE key, three meanings, and two ways out. The reasoning for each is in
  // FlightDoors.ts beside the code it is about; these are the names the rest of
  // the project, DebugFlight.ts and the probe corpus call.

  /** The board key: roll out, climb in, or say how far away the rocket is. */
  board(): void { doors.board(this); }
  /** GP-54. The bay's launch control, shared by its button and its key. */
  fromBay(leaveBay: () => void): void { doors.fromBay(this, leaveBay); }
  /** Put the designed vessel on the ground, on a pad if there is one. */
  rollOut(): void { doors.rollOut(this); }
  /** PH-76. Take the promoted vessel from any distance, through `resumeControl`
   *  only; the 18 m board gate is NOT loosened. */
  takeControlRemote(): boolean { return doors.takeControlRemote(this); }
  /** PH-110, R54. May the player push off from here? Cheap and read-only. */
  canEva(): boolean { return doors.canEva(this); }
  /** PH-110, R54. Get out here, and keep the rocket. */
  evaOut(): boolean { return doors.evaOut(this); }
  /** Climb down onto the ground. Refused only while actually moving. */
  disembark(): void { doors.disembark(this); }
  /** PH-32. To the vessel's BASE, not its origin. */
  distanceToVessel(): number { return doors.distanceToVessel(this); }

  /** GP-74. Clear the pad / revert / recover: one op, in FlightRecover.ts. */
  recover(): boolean { return recoverVessel(this); }

  /** PH-360. THE LATCH KEY: dock when the envelope is open, undock when
   *  latched. One verb, two meanings decided by state, on `board`'s precedent.
   *  Every decision behind it is in FlightDock.ts. */
  dock(): boolean { return toggleDock(this); }

  /** PH-382 / R99. THE AUTO KEY: arm the auto-approach when it is off, hand the
   *  vehicle back when it is on. One verb, two meanings decided by state, on
   *  `dock`'s precedent. Every decision behind it is in FlightDock.ts, and the
   *  flight law itself is `of::approach::guide` in /core. */
  approach(): boolean { return toggleApproach(this); }

  /** The catalogue row for a part id, or undefined. Published because
   *  FlightDock.ts needs a port's class and height and must not build a second
   *  catalogue index to get them. */
  partRow(id: number): PartRow | undefined { return this.byId.get(id); }

  /** Public for FlightRecover.ts, which refuses in this mode's own voice. */
  refuse(why: string): void { this.refusals += 1; this.flash(why); }
  /** Six seconds on the LOOP's clock, the only clock `frame`'s expiry sees
   *  (PH-35: the session's used mission time against it). */
  flash(m: string): void {
    this.message = m;
    this.msgUntilS = this.lastSimSecs + 6;
  }

  // --- per frame, in FlightFrame.ts -------------------------------------------

  /** Once per RENDERED frame, from `Systems`. */
  frame(simSecs: number): void { perFrame.frame(this, simSecs); }
  /** Re-draw the stack and re-frame the camera on what is LEFT. Public because
   *  FlightPad.ts, FlightRecover.ts and FlightVessels.ts all call it. */
  rebuild(): void { perFrame.rebuild(this); }

  /** The navball's whole readout, composed in FlightReadout.ts. Kept as a
   *  method because probes and DebugFlight.ts call it. */
  readout(): NavballReadout & NavPublication { return computeReadout(this); }

  /** GP-57: once per FIXED tick, from `Systems`. Why, and what the tick is
   *  compared against, is in FlightPad.ts. */
  stepPadClamps(tick: number): void { stepPad(this, tick); }

  vesselPosition(out: Vec3d): Vec3d { return this.observer.vesselPosition(out); }

  report(): unknown {
    return {
      aboard: this.aboard, rollouts: this.rollouts, boardings: this.boardings,
      disembarks: this.disembarks, recoveries: this.recoveries,
      refusals: this.refusals,
      // PH-110. The spacewalk's three observables, beside the other doors'
      // counters rather than on a surface of their own: how many were begun,
      // whether one is live right now, and whether one COULD be from here. The
      // last is what lets a probe prove the refusal fired rather than infer it.
      evas: this.evas, evaActive: evaActive(), canEva: this.canEva(),
      // PH-368. The docking control's whole state, including WHY it is dark.
      dock: dockReport(this),
      ...padReport(this),
      distanceToVesselM: this.session.live
        ? Math.round(this.distanceToVessel() * 100) / 100 : -1,
      boardRangeM: doors.BOARD_RANGE_M,
      message: this.message, loaded: this.loaded,
      catalogue: this.catalogue.length,
      flight: this.session.report(),
      observer: this.observer.report(),
      view: this.view.report(),
      navball: this.navball.report(),
    };
  }

}
