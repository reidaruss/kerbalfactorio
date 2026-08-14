// =============================================================================
// FlightDock.ts - MANUAL DOCKING: the client half of D-015's first layer.
//
// PH-360 to PH-368. R93's finding was blunt: "there is no `of_dk_*` symbol in
// the wasm at all, so the client cannot even ask". ABI 26 added the five that
// answer it, and this file is the only thing in `web/src` that calls them.
//
// -----------------------------------------------------------------------------
// WHAT THIS OWNS AND WHAT IT REFUSES TO OWN.
//
// It owns the WIRING: which two ports are candidates, where they are in the
// body frame, and turning a key press into a `/core` command. It owns NO
// physics. Every judgement -- is it in range, is it lined up, is it too fast,
// where does a mated vessel end up -- is `of/docking.h`'s, reached through the
// bridge. There is no arithmetic in this file that /core could have done, and
// that is deliberate: `docking::portAt` is EXPORTED (`of_dk_port_at`) precisely
// so this file does not grow a second opinion about which local axis is
// forward, which is the failure R93 named in advance.
//
// -----------------------------------------------------------------------------
// WHY THE STATION'S PORT STILL COMES OFF ITS SOCKET AND NOT OFF THE DESIGN'S
// `DockingPort` PART, UPDATED FOR PH-380 (D-015).
//
// D-015's rule is uniform: "a vessel can dock if its design contains a port",
// and it said `mintStation` should give Anchorage a real design containing a
// `DockingPort` rather than `emptyDesign()`. THAT HALF HAS NOW LANDED --
// `SpaceStation.mintStation` mints a one-part design (`stationDesign`, PH-380)
// and `promoteVessel` refuses the station BY NAME rather than by its part
// count being zero, so "has a port" is decidable off Anchorage's design the
// same way it is off a flown vessel's.
//
// WHAT HAS NOT CHANGED, AND WHY THAT IS THE RIGHT ANSWER RATHER THAN THE REST
// OF THE FIX. The design's `DockingPort` part sits at the design's own origin
// (0, 0, 0) with no attachment to anything, and this file still reads
// `socket_dock`, authored geometry measured at station-local (30.40, 2.20, 0)
// with face +X and roll +Y, checked against `contracts.json` by both
// `validate_glb` and `probes/stationdock.js`. Those two positions have no
// natural correspondence -- a design's coordinates are a rocket-stack's own
// local frame and the station's are the shipped mesh's -- and inventing a
// mapping between them would manufacture a SECOND authority for one physical
// fact (where the port really is), which is the exact failure this project
// keeps finding under a different name (D-014, CE-83, GP-284's own header).
// The asset is measured and gated; the design part is not. So this file keeps
// reading the socket, keyed off `isStation`, and that special case is now
// about WHERE THE POSE COMES FROM, not about WHETHER THE STATION HAS A PORT
// AT ALL -- the design settles that question uniformly, same as D-015 asked.
//
// THE JOIN IS A RELATION, NOT A MERGE. See `VesselDock` in VesselRegistry.ts
// for the argument and the save shape. `SAVE_VERSION` does not move.
// =============================================================================
import * as THREE from 'three';
import { dockCandidate, dockVerdictText, dockCaptureText, len }
  from '../sim/FlightAbi.js';
import type { DockCandidateRow, Vec3 } from '../sim/FlightAbi.js';
import { registry, stateOf } from '../sim/VesselRegistry.js';
import type { VesselDock, VesselRecord, Vec3n } from '../sim/VesselRegistry.js';
import { vesselAbi } from '../sim/wasm/vesselabi.js';
import {
  findStation, isStation, lastStationSolid, stationSocketFrame,
} from '../game/SpaceStation.js';
import type { PartRow } from '../game/VesselCatalogue.js';
import type { FlightMode } from './FlightMode.js';

/**
 * `vessel.h` `PartClass::Docking`, the ninth member (Pod, Tank, Engine,
 * Decoupler, Aero, Structural, Control, Power, Docking, Utility).
 *
 * THE CLASS AND NOT THE PART ID, so "this vessel has a port" stays a property
 * of the catalogue rather than a hardcoded 0x0115 that a second port class
 * would silently fall out of. `core/tests/test_docking.cpp` pins the other half
 * of the same claim: exactly one part in the shipped catalogue carries a
 * non-zero `dockCaptureRadiusM`, so today the two agree by construction and the
 * day they stop, the ctest says so.
 */
const CLASS_DOCKING = 8;

/** Is this catalogue row a docking port? */
export function isPortRow(p: PartRow | undefined): boolean {
  return p !== undefined && p.cls === CLASS_DOCKING;
}

/**
 * How far up the port's own body the mating plane sits, metres.
 *
 * `PartInstance::originM` is a part's BOTTOM mating plane (vessel.h says so in
 * as many words), and the docking port is 0.30 m tall with its socket on the
 * top face. The number is therefore the part's `heightM`, read off the
 * catalogue rather than typed here -- see `vesselPortLocal`. This constant is
 * only the FALLBACK for a boot with no catalogue row, and it matches the
 * fixture `core/tests/test_docking.cpp` measured off the shipped mesh:
 * `DockingPort/socket_dock` at local (0, 0.30, 0).
 */
const PORT_SOCKET_UP_M = 0.30;

/** The host's port, in the body frame, with the host's own motion. */
export interface DockTarget {
  /** The record the guest would latch to. */
  hostId: number;
  hostName: string;
  /** '' when the port is a part instance rather than a named asset socket. */
  hostPort: string;
  posM: Vec3;
  faceAxis: Vec3;
  rollAxis: Vec3;
  velMS: Vec3;
}

/** What the flight UI needs to draw the DOCK control truthfully. */
export interface DockPublication {
  /** There is something to dock to. FALSE is "nothing selected", which is a
   *  different sentence from "you cannot dock", and the chip says so. */
  hasTarget: boolean;
  targetName: string;
  /** Latched right now. */
  docked: boolean;
  /** The press would succeed. */
  available: boolean;
  /** The sentence for the state, whatever the state. NEVER '': a control that
   *  is dark for no stated reason is the defect this whole file's UI half is
   *  about (GP-56: "a disabled control that names its reason is a promise"). */
  why: string;
  separationM: number;
  /** Positive is closing. */
  closingMS: number;
  coneErrorDeg: number;
  /** The three limits, from /core, so the chip quotes one authority. */
  captureRadiusM: number;
  coneLimitDeg: number;
  maxClosingMS: number;
}

const DEG = 180 / Math.PI;

const NO_DOCK: DockPublication = {
  hasTarget: false, targetName: '', docked: false, available: false,
  why: 'no docking target', separationM: -1, closingMS: 0, coneErrorDeg: 0,
  captureRadiusM: 0, coneLimitDeg: 0, maxClosingMS: 0,
};

// =============================================================================
// WHERE THE TWO PORTS ARE.
// =============================================================================

/**
 * Does this design carry a port at all? D-015's uniform rule, asked of the
 * DESIGN and not of a table of which vessels are special.
 *
 * `core/tests/test_docking.cpp` asserts that exactly one part in the whole
 * catalogue carries a non-zero `dockCaptureRadiusM`, so "has a port" is a
 * decidable property of the parts list with no second list to maintain.
 */
export function vesselPortLocal(m: FlightMode)
    : { posM: Vec3; faceAxis: Vec3; rollAxis: Vec3 } | null {
  // THE PARTS THAT ARE ON THE VEHICLE, not the parts in the design. A design is
  // a blueprint and a rocket that has staged is not it: a port on a jettisoned
  // section would still be in `design.parts` and is emphatically not available
  // to dock with. R44b paid for this distinction once already, on the per-stage
  // delta-v table that was read off the design and reported a stage whose
  // engine had physically left the vehicle.
  const row = m.session.partRows.find((r) => isPortRow(m.partRow(r.partId)));
  if (row === undefined) return null;
  const heightM = m.partRow(row.partId)?.heightM || PORT_SOCKET_UP_M;
  const o = row.originM;
  // The mating plane is the part's TOP face: `originM` is the bottom one.
  // Face +Y is the stack axis toward the nose, so a port on the top node points
  // where the nose points and the approach is flown nose first, which is what
  // `test_docking.cpp` pins against the shipped mesh.
  return {
    posM: [o[0], o[1] + heightM, o[2]],
    faceAxis: [0, 1, 0],
    rollAxis: [1, 0, 0],
  };
}

const q = new THREE.Quaternion();
const v = new THREE.Vector3();

function rot(quat: THREE.Quaternion, a: readonly [number, number, number]): Vec3 {
  v.set(a[0], a[1], a[2]).applyQuaternion(quat);
  return [v.x, v.y, v.z];
}

/** The station's port in the body frame, off the LIVE solid pose. */
function stationPort(M: Parameters<typeof stateOf>[0], rec: VesselRecord,
                     tick: number): DockTarget | null {
  const socket = stationSocketFrame('socket_dock');
  const solid = lastStationSolid();
  if (socket === null || solid === null) return null;
  // THE LIVE POSE, not the install record. `CarrierMount.syncAt` re-poses this
  // solid every fixed tick, and reading the boot pose instead would aim the
  // dock at where the station was 4,888 m ago -- which is precisely the
  // staleness `stationArrivalBody` was written to fix one layer up.
  q.copy(solid.quat);
  const p = rot(q, socket.pos);
  const st = stateOf(M, registry, rec, tick);
  return {
    hostId: rec.id,
    hostName: rec.name,
    hostPort: 'socket_dock',
    posM: [solid.pos.x + p[0], solid.pos.y + p[1], solid.pos.z + p[2]],
    faceAxis: rot(q, socket.face),
    rollAxis: rot(q, socket.roll),
    velMS: [st.vel[0], st.vel[1], st.vel[2]],
  };
}

/**
 * WHAT THIS VESSEL COULD DOCK TO RIGHT NOW.
 *
 * Today that is the station and only the station, because it is the only record
 * in the game with a port of any kind (see the header). The signature is
 * already the general one -- it returns a candidate, not "the station" -- so
 * the day a second port exists this grows a nearest-of search and no caller
 * changes.
 */
export function dockTargetOf(m: FlightMode, tick: number): DockTarget | null {
  const me = registry.promoted;
  const st = findStation();
  if (st === null) return null;
  // The self-dock rule is /core's and is enforced there; this is the same rule
  // asked one layer earlier so a vessel is never even OFFERED itself.
  if (me !== null && me.id === st.id) return null;
  if (!isStation(st)) return null;
  return stationPort(m.d.M, st, tick);
}

// =============================================================================
// ARMING, ASKING, AND THE TWO COMMANDS.
// =============================================================================

/**
 * Point the rig at the target, every frame.
 *
 * `of_fl_dock_arm` RESETS the rig (including its running closest approach), so
 * it is called once per target rather than per frame; `of_fl_dock_target` is
 * the per-frame call and the step advances the target in between.
 *
 * ARMED IN ADVISORY MODE, WHICH IS THE WHOLE OF THE MANUAL RUNG. Under the
 * shipped auto-latch the step would join the instant the ports touched and the
 * DOCK control would never once be pressable: the game would dock itself the
 * tick before the player could. `of_dk_latch(f, 0)` leaves the identical swept
 * test running and publishing every tick and makes the JOIN a command. The
 * auto-approach autopilot, when it arrives, arms with 1 and needs nothing else.
 */
export function armDock(m: FlightMode, t: DockTarget | null): void {
  const V = vesselAbi(m.d.M);
  const f = m.session.handle;
  if (f <= 0) return;
  const local = t === null ? null : vesselPortLocal(m);
  if (t === null || local === null) {
    if (m.dockArmedFor !== 0) {
      V._of_fl_dock_clear(f);
      m.dockArmedFor = 0;
      m.dockArmedHandle = 0;
    }
    return;
  }
  // THE MEMO IS KEYED ON THE /core HANDLE AS WELL AS THE HOST, and that is a
  // FIX rather than belt and braces. The rig lives in the bridge's `g_docks`
  // keyed by FLIGHT HANDLE, and `dockrcs.mjs` asserts in as many words that a
  // recycled handle does not inherit a latched docking. Keyed on the host alone,
  // the first arm on the pad memoised "armed for Anchorage" and every later
  // flight -- a new roll-out, a promote after a load, anything that destroys and
  // rebuilds the FlightSim -- kept that memo against a handle with no rig at
  // all. Measured: the whole control read `no docking target` in orbit while
  // `dockTarget` published a perfectly good port pose 1879 m/s away, which is
  // the two-authority shape wearing a memo.
  if (m.dockArmedFor !== t.hostId || m.dockArmedHandle !== f) {
    // 0,0,0 for the three limits takes the PART'S own numbers through
    // `docking::Limits`'s defaults, which `test_docking.cpp` pins equal to the
    // catalogue's `dockCaptureRadiusM` / `dockCaptureConeRad`. Passing our own
    // would be a fourth copy of two numbers that already have one authority.
    V._of_fl_dock_arm(f, 0, 0, 0,
                      local.posM[0], local.posM[1], local.posM[2],
                      local.faceAxis[0], local.faceAxis[1], local.faceAxis[2],
                      local.rollAxis[0], local.rollAxis[1], local.rollAxis[2]);
    V._of_dk_latch?.(f, 0);
    m.dockArmedFor = t.hostId;
    m.dockArmedHandle = f;
  }
  V._of_fl_dock_target(f, t.posM[0], t.posM[1], t.posM[2],
                       t.faceAxis[0], t.faceAxis[1], t.faceAxis[2],
                       t.rollAxis[0], t.rollAxis[1], t.rollAxis[2],
                       t.velMS[0], t.velMS[1], t.velMS[2]);
}

/** The live verdict, composed for a screen. Pure and side-effect free, so the
 *  chip, the report and the key press all ask the same question. */
export function dockPublication(m: FlightMode): DockPublication {
  const t = m.dockTarget;
  const rec = registry.promoted;
  if (t === null || m.session.handle <= 0) {
    // TWO DIFFERENT NOTHINGS, and they get different sentences. No port fitted
    // is a fact about the vehicle the player built and it is actionable ("go
    // and put one on"); no target is a fact about where they are.
    const why = m.session.live && vesselPortLocal(m) === null
      ? 'no docking port on this vessel'
      : 'no docking target';
    return { ...NO_DOCK, why };
  }
  const c: DockCandidateRow = dockCandidate(m.d.M, m.session.handle,
                                            rec?.id ?? 0, t.hostId);
  const latched = rec?.docked !== undefined;
  return {
    hasTarget: true,
    targetName: t.hostName,
    docked: latched,
    // A latched vessel's control is UNDOCK and it is always available; /core
    // reports `AlreadyDocked` for the dock direction, which is correct and is
    // not what the control is offering.
    available: latched ? true : c.available,
    why: latched ? 'docked' : dockVerdictText(c.verdict),
    separationM: latched ? 0 : c.separationM,
    closingMS: latched ? 0 : c.closingMS,
    coneErrorDeg: c.coneErrorRad * DEG,
    captureRadiusM: c.captureRadiusM,
    coneLimitDeg: c.captureConeRad * DEG,
    maxClosingMS: c.maxClosingMS,
  };
}

/**
 * THE LATCH KEY: dock when the envelope is open, undock when latched.
 *
 * One verb with two meanings decided by state, on `FlightMode.board`'s own
 * precedent ("ONE key, three meanings, decided by where you are standing").
 * Returns true when something happened; a refusal flashes its reason and is
 * counted, so a probe can prove the refusal fired rather than infer it.
 */
export function toggleDock(m: FlightMode): boolean {
  if (!m.aboard || !m.session.live) { m.refuse('not flying'); return false; }
  const rec = registry.promoted;
  if (rec === null) { m.refuse('no vessel to dock'); return false; }
  return rec.docked !== undefined ? undock(m, rec) : dock(m, rec);
}

function dock(m: FlightMode, rec: VesselRecord): boolean {
  const t = m.dockTarget;
  if (t === null) { m.refuse(dockPublication(m).why); return false; }
  const V = vesselAbi(m.d.M);
  const code = V._of_dk_capture?.(m.session.handle, rec.id, t.hostId) ?? 0;
  if (code !== 1) {
    // /core returns MINUS the verdict, so the refusal is the same sentence the
    // chip has been showing. One vocabulary, from one authority.
    m.refuse(`cannot dock: ${dockCaptureText(code)}`);
    return false;
  }
  // THE SIM HAS MOVED THE VEHICLE ONTO THE PORT. Read it back rather than
  // recomputing where it should be: `docking::matedPose` already answered that
  // and a second answer here is the two-authority shape this project keeps
  // paying for.
  m.session.sample();
  rec.docked = latchFrom(m, t);
  m.docks += 1;
  m.flash(`docked with ${t.hostName}`);
  return true;
}

/** The guest's pose expressed in the HOST'S local frame. See `VesselDock`:
 *  this is what stops the two records propagating apart. */
function latchFrom(m: FlightMode, t: DockTarget): VesselDock {
  const solid = lastStationSolid();
  const st = m.session.state;
  const inv = solid === null ? new THREE.Quaternion()
    : q.copy(solid.quat).invert().clone();
  const o: Vec3n = solid === null
    ? [st.pos[0], st.pos[1], st.pos[2]]
    : (() => {
        v.set(st.pos[0] - solid.pos.x, st.pos[1] - solid.pos.y,
              st.pos[2] - solid.pos.z).applyQuaternion(inv);
        return [v.x, v.y, v.z] as Vec3n;
      })();
  const f = rot(inv, st.forward as Vec3);
  const r = rot(inv, st.right as Vec3);
  return {
    hostId: t.hostId, hostPort: t.hostPort, localPos: o,
    localFwd: [f[0], f[1], f[2]], localRight: [r[0], r[1], r[2]],
  };
}

function undock(m: FlightMode, rec: VesselRecord): boolean {
  const V = vesselAbi(m.d.M);
  // 0 takes `docking::kReleaseSepMS`, 0.20 m/s, derived beside it. This side
  // does not pick a separation rate: it is a physics number and it has a home.
  const ok = (V._of_dk_release?.(m.session.handle, 0) ?? 0) === 1;
  if (!ok) { m.refuse('not docked'); return false; }
  delete rec.docked;
  m.session.sample();
  m.undocks += 1;
  m.flash(`undocked from ${m.dockTarget?.hostName ?? 'the port'}: `
    + 'backing off, watch the range');
  return true;
}

/** PH-368. The probe surface. Every number the chip draws plus the two counters
 *  and the raw candidate, so a probe can prove the CONTROL agrees with /core
 *  rather than checking one of them twice. */
export function dockReport(m: FlightMode): Record<string, unknown> {
  const p = dockPublication(m);
  const rec = registry.promoted;
  return {
    ...p,
    docks: m.docks, undocks: m.undocks,
    armedFor: m.dockArmedFor,
    hasPort: m.session.live ? vesselPortLocal(m) !== null : false,
    hostId: rec?.docked?.hostId ?? 0,
    hostPort: rec?.docked?.hostPort ?? '',
    /** The distance from the guest's origin to the host's port, which is a
     *  DIFFERENT number from `separationM` (port to port) and is here so a
     *  probe cannot mistake one for the other. */
    originToPortM: m.dockTarget === null || !m.session.live ? -1
      : len([m.session.state.pos[0] - m.dockTarget.posM[0],
             m.session.state.pos[1] - m.dockTarget.posM[1],
             m.session.state.pos[2] - m.dockTarget.posM[2]]),
  };
}
