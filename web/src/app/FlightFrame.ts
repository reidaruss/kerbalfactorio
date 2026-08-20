// THE PER-FRAME UPDATE, lifted out of FlightMode so the class is the wiring it
// says it is. Two functions and no state of its own: everything it touches is
// reached through the mode it is handed.
//
// The ORDER inside `frame` is the whole of it and it is unchanged: read the
// clock BEFORE the early return, tick, expire, rebuild on a revision change,
// keep a parked vessel's drawn instant equal to the sim's, place, choose the
// lit nozzles, re-aim the dock rig whether or not anyone is aboard, and only
// then draw the ball. Each of those has a comment saying what it cost to learn.

import { armDock, dockTargetOf } from './FlightDock.js';
import { syncAutoDock } from './FlightAuto.js';
import type { FlightMode } from './FlightMode.js';

export function frame(m: FlightMode, simSecs: number): void {
  // THE CLOCK IS READ BEFORE THE EARLY RETURN, AND THAT IS A FIX RATHER THAN A
  // TIDY-UP. `flash` expires a message at `lastSimSecs + 6`, and `lastSimSecs`
  // was only written on a frame with a LIVE session, so it was still 0 at the
  // moment of the very first roll-out: the expiry test on the next frame then
  // compared a six second deadline against a sim clock that had been running
  // all session, and cleared the message immediately. The victim was PH-36's
  // own claim, that a stand-in which announces itself is a stand-in: the
  // notice was discarded before a single frame drew it. Found by GP-57's probe
  // asserting the PAD's notice and getting an empty string.
  m.lastSimSecs = simSecs;
  if (!m.session.live) return;
  m.session.tick(simSecs);
  // The transient half of the message line. FlightMode's own `message` had no
  // expiry at all and the session's had one on the wrong clock: two opposite
  // bugs in one line of readout, which is why neither showed up.
  if (m.message !== '' && simSecs > m.msgUntilS) m.message = '';
  if (m.drawnRevision !== m.session.revision) m.rebuild();
  // Parked: nothing steps the observer, so keep the drawn instant equal to
  // the sim's (PH-31). Aboard, the interpolator owns it.
  if (!m.aboard) m.observer.syncToVessel();
  // The INTERPOLATED position, the one the camera was placed for. See
  // VesselObserver.renderPos: the raw sim position is a whole tick ahead.
  m.d.origin.toEngine(m.observer.renderPos, m.pos);
  const f = m.session.state.forward;
  const r = m.session.state.right;
  m.fwd.set(f[0], f[1], f[2]);
  m.rgt.set(r[0], r[1], r[2]);
  m.view.place(m.pos, m.fwd, m.rgt);
  // IN THE COCKPIT YOU ARE INSIDE THE HULL, so the hull is not drawn. Found
  // by screenshotting: looking down at the planet from an eye 1.2 m below the
  // top of the stack put a black wedge of the vessel's own interior across
  // two thirds of the frame. There is no IVA geometry (A-11), so an empty
  // cockpit is honest and a hull seen from the inside out is not.
  m.view.setVisible(!m.observer.firstPerson);
  // WHICH NOZZLES ARE LIT, and "is an engine" is not the same question
  // (PH-33). The filter used to be the catalogue's thrust figure alone, so
  // every engine on the stack drew a plume and the UPPER STAGE burned inside
  // the interstage from the moment the clamp released. It reads healthy (the
  // plume count matches the engine count) and becomes accidentally correct at
  // separation, so it is wrong only between liftoff and staging, which is the
  // window every launch screenshot is taken in.
  //
  // The rule is the LOWEST stage group still bolted on, gated on /core saying
  // the vehicle is actually producing thrust. `nextStageIndex - 1` was tried
  // first and is wrong for a measured reason: after a separation the parts do
  // not carry the stage number the flight's counter is on, so the upper stage
  // flew the whole second half of the ascent at THR 100% with no flame
  // (`view.plumes` 0 against `plumeThrottle` 1). Asking the TREE which
  // engines are lowest needs no agreement about numbering, and gating on
  // thrust makes the pad, a shut throttle and a dry tank correct for free.
  const engines = m.session.partRows
    .filter((q) => (m.byId.get(q.partId)?.thrustVacuumN ?? 0) > 0);
  let lowest = Infinity;
  for (const q of engines) if (q.stage < lowest) lowest = q.stage;
  const lit = m.session.status !== 'DOWN'
    && m.session.telemetry.thrustN > 0;
  const firing = lit ? engines.filter((q) => q.stage === lowest)
    .map((q) => q.handle) : [];
  // Not gated on the clamp: an engine lit under a hold-down IS burning
  // propellant, and drawing no flame there is the one moment the picture
  // disagrees with the propellant gauge.
  m.view.setPlume(m.session.throttleValue, firing);
  // PH-360. THE DOCK RIG IS RE-AIMED EVERY FRAME, MAP OPEN OR SHUT, on
  // `nodeDir`'s precedent. The target moves (the station really orbits, D-014
  // / PH-357), so a pose written once would aim the capture test at where the
  // port was, which is the exact staleness `stationArrivalBody` fixed one
  // layer up. It is outside the `aboard` guard because the readout is
  // composed whether or not the ball is being drawn, and a chip that only
  // told the truth while visible would be a chip nothing could measure.
  m.dockTarget = dockTargetOf(m, m.session.fixedTick);
  armDock(m, m.dockTarget);
  // PH-385. AND BOOK A JOIN THE STEP MADE ON ITS OWN. Under the auto-approach
  // the latch happens inside `of_fl_step` with nothing on this side told, so
  // without this a completed auto-dock would be latched in /core and undocked
  // in the registry, the save and the census -- one vessel with two answers.
  // Outside the `aboard` guard for the same reason `armDock` is.
  syncAutoDock(m);
  if (m.aboard) m.navball.render(m.readout());
}

export function rebuild(m: FlightMode): void {
  m.view.rebuild(m.session.partRows.map((q) => ({
    handle: q.handle, partId: q.partId, attach: q.attach,
    originM: q.originM, radialAngleRad: q.radialAngleRad,
  })), (id) => m.byId.get(id));
  // Re-frame on what is LEFT. A stage separation halves the vehicle, and a
  // camera still framed on the full stack points at empty space where the
  // booster used to be.
  m.observer.frameFor(Math.max(1, -m.view.lowestLocalY()));
  m.drawnRevision = m.session.revision;
}
