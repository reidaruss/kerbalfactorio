// PH-64 to PH-67. THE PROMOTE / DEMOTE ENGINE, and the only place the live
// `/core` FlightSim and the registry record are allowed to meet.
//
// `VesselRegistry` decides WHAT a vessel is; this file moves one between the two
// forms. Nothing else in the client may write a record, and nothing else may
// build a FlightSim out of one, because the moment two places can do that the
// question "which one is right" has two answers again (DW-26).
//
// The promote path is `FlightCheats.refillTanks` grown up. That function already
// had to rebuild a craft from its design and replay its stagings, and it says in
// its own comment why: /core published no propellant setter, so a rebuild came
// back with full tanks and it could not do better. ABI 18 adds the setter
// (PH-66), so the same skeleton now restores the fuel that was actually aboard.
// Replaying `stage` is kept, deliberately, and no `nextStageIndex` setter was
// asked for: `fireStage` is a pure function of the tree (PH-17), so replaying k
// presses reproduces exactly the hardware k presses produced, and a setter would
// have let a save claim a stage index the tree does not agree with.
import { flightParts } from '../sim/FlightAbi.js';
import { RAILS_DT, fitConic, poseFrom, registry, v3 } from '../sim/VesselRegistry.js';
import type { VesselRecord, VesselWhere } from '../sim/VesselRegistry.js';
import { VesselDesign } from '../game/VesselDesign.js';
import type { DesignJson } from '../game/VesselDesign.js';
import type { FlightMode } from './FlightMode.js';
// PH-76. The handoff's guard, imported from where it is PUBLISHED rather than
// re-stated here. ResumeBoot.ts imports this file back, so the two form an ES
// module cycle; it is safe and it is checked: both names are function
// DECLARATIONS, so they are hoisted into the partial namespace, and neither
// module calls the other at top level. Copying the predicate to break the cycle
// would have made §5's contract have two authors, which is the failure the
// contract exists to prevent.
import { mayLeave, whyNotLeave } from './ResumeBoot.js';
// PH-380. See `promoteVessel`: the station's un-flyability used to be a side
// effect of `SpaceStation.emptyDesign()` and is a stated rule now that the
// station carries a real design.
import { isStation, stateOfDocked } from '../game/SpaceStation.js';

/** The scratch designs promoted vessels are flying, one per promoted record.
 *  Held here because `FlightSession.refreshParts` reads the per-stage table off
 *  a VESSEL handle, so the design a flight was built from has to outlive the
 *  call that built it (PH-27: the two registries both number from 1). */
const designs = new Map<number, VesselDesign>();

/** How the design gets read. Installed at boot from the assembly bay, so this
 *  file never imports the VAB and a `?vab=0` boot degrades to no snapshot
 *  rather than to a crash. */
let designSource: (() => DesignJson | null) | null = null;
export function setDesignSource(fn: (() => DesignJson | null) | null): void {
  designSource = fn;
}

let lastHandle = 0;
let refusedSnapshots = 0;
let snapshots = 0;
/** The most recent fixed tick this lane has been told about. The save path fires
 *  from a timer with no tick in hand, and a rails record's clock is measured in
 *  ticks, so the last one seen is what a sync has to fold in. */
let lastTick = 0;
let handBacks = 0;
export function currentVesselTick(): number { return lastTick; }

function baseOffsetOf(m: FlightMode): number {
  let minY = 0;
  for (const q of m.session.partRows) minY = Math.min(minY, q.originM[1]);
  return -minY;
}

/**
 * THE DESIGN SNAPSHOT, AND WHY IT IS VERIFIED RATHER THAN TIMED.
 *
 * The bay's design handle keeps being edited after a roll-out, so a snapshot
 * taken late would record a rocket the player is flying a different version of.
 * The obvious fix is to snapshot "at roll-out", which is a claim about WHEN and
 * therefore a claim nothing checks. Instead the snapshot is checked against the
 * craft it is supposed to describe: before any staging, the flight's own part
 * list is a verbatim copy of the design's (`of_fl_create` deep-copies), so the
 * ids in order must match exactly. They either do, and the snapshot is provably
 * of this vehicle, or they do not, and it is REFUSED and counted.
 *
 * Refusing is the right failure: a vessel with no design cannot be restored, and
 * saying so in a counter a probe can read is strictly better than saving a
 * plausible wrong rocket, which is this project's most expensive defect class.
 */
function snapshotDesign(m: FlightMode): DesignJson | null {
  if (designSource === null) return null;
  const d = designSource();
  if (d === null || !Array.isArray(d.parts)) { refusedSnapshots += 1; return null; }
  const live = m.session.partRows;
  if (d.parts.length !== live.length) { refusedSnapshots += 1; return null; }
  for (let i = 0; i < live.length; ++i) {
    if ((d.parts[i]?.p ?? -1) !== live[i]?.partId) { refusedSnapshots += 1; return null; }
  }
  snapshots += 1;
  return d;
}

/**
 * Called every fixed tick from `FlightPad.stepPadClamps`, which is the one
 * flight call the loop already makes whether or not anybody is aboard. It is
 * deliberately cheap: one integer compare on the common path.
 */
export function watchVessels(m: FlightMode, tick: number): void {
  lastTick = tick;
  const h = m.session.handle;
  if (h === lastHandle) return;
  lastHandle = h;
  if (h <= 0) {
    // The session was destroyed: a recover, or a roll-out replacing the last
    // one. Only the PROMOTED record goes with it; a vessel on rails is not this
    // session's to delete and must survive its own flight being torn down.
    const id = registry.promotedId;
    if (id > 0) { disposeDesign(id); registry.remove(id); }
    return;
  }
  // A roll-out over an existing vessel goes 0 -> h1 -> h2 WITHOUT passing
  // through zero, because `FlightSession.rollOut` destroys before it creates.
  // Without this line the record for h1 would survive as a vessel that exists
  // nowhere, which is the registry telling the save about a rocket the player
  // watched being replaced. Only the PROMOTED one goes: a vessel on rails is not
  // this session's to delete and must outlive the flight being torn down.
  if (registry.promotedId > 0) {
    disposeDesign(registry.promotedId);
    registry.remove(registry.promotedId);
  }
  // PH-71, and this half is NOT about restoring: a rocket that has just been
  // ROLLED OUT and never boarded reads `massKg 0` on main today, because nothing
  // steps it until the player climbs in. Measured on a freshly rolled-out
  // reference vehicle: `live true, status CLAMPED, mass 0`, for the whole walk
  // over to it. It has never blocked the clamp, because boarding steps the
  // vessel long before anyone throttles up, so it has been invisible; but it is
  // the same instrument reading zero about a real 9845 kg rocket, and the fix
  // for the restored case is the fix for this one.
  primeParkedTelemetry(m.session, m.session.throttleValue);
  const design = snapshotDesign(m);
  if (design === null) return;
  const id = registry.allocateId();
  registry.adopt(makeRecord(m, id, design, tick));
  registry.promotedId = id;
}

function makeRecord(m: FlightMode, id: number, design: DesignJson,
                    tick: number): VesselRecord {
  const s = m.session;
  return {
    id, name: design.name || `vessel ${id}`, mode: 'parked', design,
    // GP-650. THE BODY IT WAS ROLLED OUT ON, off the surface oracle, which is
    // the client's live-body authority ("the thing that answers about the
    // current body", SurfaceOracle.ts) and is RE-SEATED by `WorldSession.reboot`
    // rather than copied at boot. A rocket rolled out on the moon is the moon's
    // and the map must not draw it around Forge.
    bodyId: m.d.oracle.body.bodyId,
    fired: 0, fuel: [],
    // `of_fl_create` deep-copies the design's tree, so at THIS instant the live
    // handles ARE the design's, in the same order. Capturing them here is the
    // only moment that equality is guaranteed, because the first staging
    // removes parts and the correspondence stops being positional.
    handles: m.session.partRows.map((q) => q.handle),
    where: { kind: 'fixed', pos: v3(s.state.pos), vel: v3(s.state.vel) },
    pose: poseFrom(s.state.forward, s.state.right, s.state.angVel,
                   s.throttleValue, s.sasMode, s.commandDir),
    clockS: 0, stampedTick: tick, status: s.status, metS: s.metS,
    liftedOff: s.liftedOff, releases: s.releases, stagings: s.stagings,
    maxQPa: s.maxQPa, onPad: s.onPad, padRadiusM: s.padRadiusM,
    padUp: v3(s.padUp),
  };
}

function disposeDesign(id: number): void {
  const d = designs.get(id);
  if (d !== undefined) { d.dispose(); designs.delete(id); }
}

/**
 * BRING THE RECORD UP TO DATE FROM THE LIVE SIM. Called before every save (from
 * `VesselSave.saveVessels`, which calls it as its first statement so no caller
 * can forget) and before every demote.
 *
 * This is the mechanism half of DW-26. The record is the authority, but while a
 * vessel is promoted the truth is moving inside a `/core` FlightSim; sync is
 * what keeps the authority from going stale, and calling it from inside the
 * serialiser is what makes "you cannot save a vessel in a place it is not" a
 * property of the code rather than of somebody's memory.
 */
export function syncPromoted(m: FlightMode | null, tick: number): void {
  if (m === null) return;
  const rec = registry.promoted;
  const s = m.session;
  if (rec === null || !s.live) return;
  registry.stamp(rec, tick);
  rec.fired = Math.max(0, s.nextStageIndex());
  rec.stagings = s.stagings;
  rec.fuel = [];
  const idx = designIndex(rec);
  for (const q of flightParts(s.core, s.handle)) {
    if (q.propellantKg <= 0) continue;
    const i = idx.get(q.handle);
    if (i !== undefined) rec.fuel.push([i, q.propellantKg]);
  }
  rec.pose = poseFrom(s.state.forward, s.state.right, s.state.angVel,
                      s.throttleValue, s.sasMode, s.commandDir);
  rec.status = s.status; rec.metS = s.metS; rec.liftedOff = s.liftedOff;
  rec.releases = s.releases; rec.maxQPa = s.maxQPa;
  rec.onPad = s.onPad; rec.padRadiusM = s.padRadiusM; rec.padUp = v3(s.padUp);
  rec.mode = modeOf(m);
  rec.where = whereOf(m, rec);
}

/**
 * WHICH OF THE THREE MODES THIS VESSEL IS IN, decided by `/core`'s own predicate
 * and never by a threshold held here (PH-65).
 *
 * `on_rails_eligible` is true exactly when no air and no thrust are acting, i.e.
 * exactly when flight.h and orbital.h agree bit for bit (PH-16). Asking it means
 * the boundary at which a vessel becomes propagatable is the same boundary at
 * which the two integrators become the same arithmetic, which is the strongest
 * form this decision can take. A client-side altitude test would have been a
 * second copy of the atmosphere ceiling.
 */
function modeOf(m: FlightMode): VesselRecord['mode'] {
  const s = m.session;
  if (s.status === 'CLAMPED' || s.status === 'DOWN') return 'parked';
  return s.onRails() ? 'rails' : 'frozen';
}

function whereOf(m: FlightMode, rec: VesselRecord): VesselWhere {
  const s = m.session;
  const pos = v3(s.state.pos), vel = v3(s.state.vel);
  if (rec.mode !== 'rails') return { kind: 'fixed', pos, vel };
  const mu = m.d.M._of_body_mu(m.d.bodyHandle);
  const el = fitConic(m.d.M, pos, vel, mu, rec.clockS);
  // A conic that would not fit is not a reason to lose the vessel. Falling back
  // to the state vector holds it exactly where it is, which is FROZEN's answer,
  // and the mode is corrected to say so rather than claiming rails it does not
  // have. Silence here would be a vessel that reports on rails and never moves.
  if (el === null) { rec.mode = 'frozen'; return { kind: 'fixed', pos, vel }; }
  return { kind: 'conic', el };
}

/** live part handle -> design part index, off the record's own `handles` table.
 *  The design's part ORDER is what `fromJson` rebuilds in and is therefore what
 *  survives a save; a `/core` handle is not, so the table is the bridge between
 *  them and is refreshed whenever the design is rebuilt. */
function designIndex(rec: VesselRecord): Map<number, number> {
  const out = new Map<number, number>();
  rec.handles.forEach((h, i) => out.set(h, i));
  return out;
}

/**
 * PH-69. CONTROL LEAVES THE VESSEL. This is NOT `FlightMode.disembark`, and the
 * difference is the seam.
 *
 * `disembark` is CLIMBING OUT: the player opens the hatch and stands on the
 * ground beside the rocket, so it teleports the body to the vessel's own lat and
 * lon, and it is REFUSED above 2 m/s because a walker cannot survive stepping
 * out at 2.3 km/s. Both of those are correct for a key press.
 *
 * Both of them are wrong for a handoff. The body is not next to the rocket, it
 * is wherever it was parked (PH-68), typically at the pad two hundred kilometres
 * below; and the refusal is precisely backwards, because the ONLY vessel you are
 * allowed to walk away from is one that is moving fast enough to stay up.
 *
 * The bug this closes was found by driving it and not by reading it: `demote`
 * used to call `disembark`, the speed guard refused, `aboard` stayed true, and
 * the session was destroyed underneath it, leaving the player strapped into a
 * vessel that no longer existed. `reload.mjs` already carries a standing
 * assertion against exactly that state, which is how well known this failure is
 * in this codebase.
 *
 * The body is not moved at all. That is the decision, not an omission: it stayed
 * where it was parked and the camera simply returns to it.
 */
export function releaseControl(m: FlightMode): void {
  if (!m.aboard) return;
  m.aboard = false;
  m.d.router.setSource(null);
  m.navball.setVisible(false);
  m.d.setWorldUi(true);
  handBacks += 1;
  m.flash('control released: the vessel keeps flying itself');
}

/**
 * DEMOTE: take the vessel off the live sim and leave it as a record.
 *
 * The `/core` FlightSim is destroyed, which is the point: an unattended vessel
 * must cost nothing, and a demoted one costs one Kepler solve WHEN SOMEBODY ASKS
 * and nothing at all when nobody does. There is no per-tick rails advance
 * anywhere in this lane, deliberately, because a rails vessel's position is a
 * function of the time asked for and never of how often it was asked.
 */
export function demoteVessel(m: FlightMode, tick: number): number {
  const rec = registry.promoted;
  if (rec === null || !m.session.live) return 0;
  syncPromoted(m, tick);
  releaseControl(m);
  m.session.destroy();
  lastHandle = 0;
  disposeDesign(rec.id);
  registry.promotedId = 0;
  registry.demotions += 1;
  m.rebuild();
  return rec.id;
}

/**
 * PROMOTE: build a live FlightSim that IS this record, and hand it to the one
 * session the client owns.
 *
 * Order matters and every line of it was learned somewhere. The stagings are
 * replayed BEFORE the fuel is written, because a staging jettisons parts and
 * writing fuel to a part that is about to leave is writing to nothing. The pose
 * is written before `refreshParts`, because that call re-samples and every
 * instrument downstream reads the sample.
 */
export function promoteVessel(m: FlightMode, id: number, tick: number): boolean {
  const rec = registry.find(id);
  if (rec === null) return false;
  // PH-380. A PLACE, NOT A VEHICLE, REFUSED BY NAME.
  //
  // This used to be a side effect: `SpaceStation.emptyDesign()` gave the
  // station zero parts, `VesselDesign.fromJson([])` returns 0, and the refusal
  // three lines below caught it by accident. Now that `mintStation` gives
  // Anchorage a real design (PH-380, D-015), that accident is gone and would
  // otherwise take the "you walk into it, you do not fly it" rule with it: a
  // one-part design with no crew and no engine would build a live `FlightSim`
  // for anyone who reached `promoteVessel` by id, which both
  // `MapMode.takeControl` (the map's "take control" gesture) and the debug
  // `flight('promote', id)` surface can already do with no station guard of
  // their own. The rule is stated here instead, once, for both callers.
  if (isStation(rec)) return false;
  if (registry.promotedId === id && m.session.live) return true;
  if (registry.promotedId !== 0) demoteVessel(m, tick);

  const M = m.d.M;
  const d = new VesselDesign(M, m.d.bodyHandle);
  if (d.fromJson(rec.design) <= 0) { d.dispose(); return false; }
  const s = m.session;
  const V = s.V;
  const h = V._of_fl_create(d.handle, m.d.bodyHandle);
  if (h <= 0) { d.dispose(); return false; }
  // The rebuilt design has its own handles, so the record's table is REWRITTEN
  // from it before any fuel is written. The design part ORDER is what came off
  // disk and is the one thing that survives; the handles are new every time.
  rec.handles = d.parts.map((q) => q.handle);

  s.destroy();
  s.handle = h;
  s.design = d.handle;
  for (let i = 0; i < rec.fired; ++i) V._of_fl_stage(h);

  // PH-381, GP-866. A DOCKED RECORD'S POSE COMES FROM ITS HOST, NOT FROM ITS
  // OWN CONIC. `stateOf` alone Kepler-propagates `rec.where`, which for a
  // docked guest is the conic it had at the INSTANT of capture and which has
  // since walked away from the host's (`VesselDock`'s own header: "two conics
  // 30 m apart... walk apart, slowly and invisibly"). `stateOfDocked` is the
  // one place that reads `rec.docked` and derives host + local offset instead,
  // exactly as `FlightDock.ts`'s `latchFrom` captured it; for an undocked
  // record it is `stateOf` unchanged. See its own header in SpaceStation.ts.
  const st = stateOfDocked(M, registry, rec, tick);
  V._of_fl_set_pos_vel(h, st.pos[0], st.pos[1], st.pos[2],
                       st.vel[0], st.vel[1], st.vel[2]);
  const p = rec.pose;
  V._of_fl_set_attitude(h, p.fwd[0], p.fwd[1], p.fwd[2],
                        p.right[0], p.right[1], p.right[2]);
  V._of_fl_set_ang_vel(h, p.angVel[0], p.angVel[1], p.angVel[2]);
  V._of_fl_set_throttle(h, p.throttle);
  V._of_fl_set_sas(h, p.sasMode);
  V._of_fl_set_sas_command(h, p.command[0], p.command[1], p.command[2]);
  // AFTER the stagings, never before: a staging jettisons parts, and writing
  // fuel to a part that is about to leave is writing to nothing.
  for (const [i, kg] of rec.fuel) {
    const q = rec.handles[i];
    if (q !== undefined) V._of_fl_set_propellant(h, q, kg);
  }

  s.setThrottle(p.throttle);
  s.sasMode = p.sasMode;
  s.command = [p.command[0], p.command[1], p.command[2]];
  s.status = rec.status as typeof s.status;
  s.metS = rec.metS; s.liftedOff = rec.liftedOff; s.releases = rec.releases;
  s.stagings = rec.stagings; s.maxQPa = rec.maxQPa;
  s.onPad = rec.onPad; s.padRadiusM = rec.padRadiusM;
  s.padUp = [rec.padUp[0], rec.padUp[1], rec.padUp[2]];
  s.refreshParts();
  s.baseOffsetM = baseOffsetOf(m);
  primeParkedTelemetry(s, p.throttle);

  designs.set(id, d);
  registry.promotedId = id;
  registry.stamp(rec, tick);
  registry.promotions += 1;
  lastHandle = h;
  m.drawnRevision = -1;
  m.rebuild();
  m.observer.syncToVessel();
  return true;
}

/**
 * PH-76. THE HANDOFF, OUTWARD. `leaveVessel` is `demoteVessel` WITH THE PUBLISHED
 * GUARD IN FRONT OF IT, and the guard is the whole difference between the two.
 *
 * `demoteVessel` is the mechanism and it refuses nothing, deliberately: a reload
 * must be able to park a vessel in ANY state, including frozen, because closing a
 * browser tab is not a choice the game gets to refuse (ResumeBoot.ts §5). This is
 * the VOLUNTARY handoff, and a voluntary one may not leave a vessel that no
 * arithmetic can advance. Leaving a frozen one gives you a rocket hanging
 * motionless mid-ascent for as long as you are away.
 *
 * THE SYNC BEFORE THE GUARD IS LOAD-BEARING AND IS NOT A TIDY-UP. `rec.mode` is
 * written by `syncPromoted` and by `makeRecord`, and `makeRecord` stamps
 * `'parked'` at roll-out. So a record carried by a vessel that has since launched
 * still SAYS parked until something syncs it, and `mayLeave` reading that stale
 * word would cheerfully wave a rocket under full thrust at 12 km out of the
 * world. Sync first, then ask. `demoteVessel` syncs again and that second call is
 * free: it is the same read of the same live sim one statement later.
 */
export function leaveVessel(m: FlightMode, tick: number): boolean {
  const rec = registry.promoted;
  if (rec === null || !m.session.live) {
    m.flash('no vessel to leave');
    return false;
  }
  syncPromoted(m, tick);
  if (!mayLeave(rec)) {
    // NOTHING CHANGES on a refusal. Not the session, not `aboard`, not the
    // record. A guard that half-applies is worse than no guard, because the
    // player is then in a state neither branch was written for.
    m.flash(whyNotLeave(rec));
    return false;
  }
  return demoteVessel(m, tick) === rec.id;
}

/**
 * PH-76. THE HANDOFF, INWARD, and the inverse of `releaseControl`.
 *
 * TWO STEPS AND THEY ARE ORDERED. First the record becomes a live FlightSim
 * (`promoteVessel` restores the design, the stagings, the fuel, the state vector
 * and the pose), and ONLY THEN is the player seated in it. If the promote fails
 * the player is not seated at all: a half-seat, somebody strapped into a vessel
 * that does not exist, is the precise failure `releaseControl` was written to
 * close and that `reload.mjs` carries a standing assertion against. There is no
 * branch here where `aboard` becomes true without a live session behind it.
 *
 * IT SEATS THROUGH `takeControlRemote` AND NOT THROUGH `board`. The vessel being
 * resumed is typically a few hundred kilometres up, so the board key's range gate
 * can only refuse, and past its abandon range that same key rolls out a SECOND
 * rocket. FlightMode.ts explains why the gate stays and why this is a separate
 * verb rather than a widened one.
 *
 * IDEMPOTENT on a vessel that is already promoted AND already aboard: both halves
 * return true unchanged, so a double click costs one no-op rather than a demote
 * and a rebuild.
 */
export function resumeControl(m: FlightMode, id: number, tick: number): boolean {
  if (!promoteVessel(m, id, tick)) return false;
  return m.takeControlRemote();
}

/**
 * PH-71. GIVE A RESTORED PARKED VESSEL REAL TELEMETRY, BECAUSE OTHERWISE IT IS
 * PH-20's LAUNCH-CLAMP BUG BACK, WITH A NEW CAUSE AND THE SAME SYMPTOM.
 *
 * `FlightSim::telemetry` is written by `step` and by nothing else, and a
 * promoted vessel with nobody aboard is NEVER STEPPED: `FlightSession.step` is
 * reached only through `VesselObserver.step`, which `ViewRouter` drives only
 * while the player is strapped in. So a rocket restored onto its pad publishes
 * `massKg` 0, therefore `currentTwr()` 0, therefore a clamp that can never
 * release, and every number on the HUD reads healthy. That is exactly the wall
 * Reid spent a day behind before GP-73 to GP-76, and handing it back with a
 * different cause would be worse than never having restored the vessel.
 *
 * The obvious repair was a zero-length step and it does not work: `of_fl_step`
 * guards `!(dt > 0.0)` and returns 0, so the call is silently a no-op. That
 * guard is correct and is not worth an ABI bump to relax.
 *
 * What DOES work is the clamp's own mechanism, which was built for this exact
 * problem: `stepClamped` takes a real step, then writes the pad pose back and
 * zeroes the velocity. With the throttle shut it is free, because a step with no
 * thrust and no motion burns no propellant. It is applied to PARKED vessels only
 * (CLAMPED and DOWN), and only because they are genuinely stationary, so zeroing
 * the velocity is a no-op rather than a lie. A vessel promoted in flight is NOT
 * primed: zeroing 2.3 km/s to make an instrument read would be destroying the
 * orbit to fix the gauge, and it needs no priming anyway, because promoting one
 * is something a player does in order to fly it and the first tick aboard steps
 * it for real.
 *
 * Once, at promote, and NOT every tick. An unattended parked vessel has nothing
 * to advance, so stepping it repeatedly would be simulating a thing that cannot
 * change and would run `clampTicks` up for ticks nobody was there for.
 */
function primeParkedTelemetry(s: FlightMode['session'], throttle: number): void {
  if (s.status !== 'CLAMPED' && s.status !== 'DOWN') return;
  const was = s.status;
  // DOWN borrows the clamped path deliberately: `step` on a DOWN vessel only
  // re-samples and would leave the telemetry at zero, and an arrested vessel is
  // as stationary as a clamped one, so the restore is equally honest there.
  s.status = 'CLAMPED';
  s.setThrottle(0);
  s.step(RAILS_DT);
  s.setThrottle(throttle);
  s.status = was;
}

/**
 * BOOT: adopt the saved records, and promote AT MOST the parked one.
 *
 * A parked vessel is standing in the same world the player is standing in, so it
 * has to be drawn and boardable, and promoting it costs one FlightSim that does
 * almost nothing (a CLAMPED or DOWN session steps trivially). A vessel on rails
 * is not in the near scene at all, so promoting it would be paying for a
 * simulation nobody is looking at, which is the exact cost on-rails exists to
 * avoid. NOTHING PUTS THE PLAYER BACK INSIDE A VESSEL on a reload: that is the
 * control handoff and it is a later lane's (§5 of the seam).
 */
export function promoteOnBoot(m: FlightMode | null, tick: number): number {
  if (m === null) return 0;
  for (const rec of registry.list()) {
    if (rec.mode !== 'parked') continue;
    return promoteVessel(m, rec.id, tick) ? rec.id : 0;
  }
  return 0;
}

export function vesselEngineReport(): Record<string, unknown> {
  return { snapshots, refusedSnapshots, designsHeld: designs.size, lastHandle,
           handBacks };
}

/** Test seam: a page that boots twice in one context must not keep the previous
 *  world's cached handle, which would make the next roll-out look unchanged. */
export function resetVesselWatch(): void {
  for (const id of [...designs.keys()]) disposeDesign(id);
  lastHandle = 0;
}
