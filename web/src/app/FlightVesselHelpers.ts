// The stateless half of FlightVessels.ts (see that file's header for the
// promote/demote engine's own rules). Split out at the 400-line cap: every
// function here touches no module-level mutable state, only its own
// parameters, so all six were free to move without an export-prefix
// exemption beyond making them `export` (they were module-private before).

import { RAILS_DT, fitConic, poseFrom, v3 } from '../sim/VesselRegistry.js';
import type { VesselRecord, VesselWhere } from '../sim/VesselRegistry.js';
import type { DesignJson } from '../game/VesselDesign.js';
import type { FlightMode } from './FlightMode.js';

export function baseOffsetOf(m: FlightMode): number {
  let minY = 0;
  for (const q of m.session.partRows) minY = Math.min(minY, q.originM[1]);
  return -minY;
}

export function makeRecord(m: FlightMode, id: number, design: DesignJson,
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
export function modeOf(m: FlightMode): VesselRecord['mode'] {
  const s = m.session;
  if (s.status === 'CLAMPED' || s.status === 'DOWN') return 'parked';
  return s.onRails() ? 'rails' : 'frozen';
}

export function whereOf(m: FlightMode, rec: VesselRecord): VesselWhere {
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
export function designIndex(rec: VesselRecord): Map<number, number> {
  const out = new Map<number, number>();
  rec.handles.forEach((h, i) => out.set(h, i));
  return out;
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
export function primeParkedTelemetry(s: FlightMode['session'], throttle: number): void {
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
