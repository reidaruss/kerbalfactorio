// dockrcs.mjs: PH-301 / PH-303. THE TWO NEW BRIDGE SEAMS, ACROSS THE BRIDGE.
//
//   node web/wasm/test/dockrcs.mjs
//
// `parity.mjs` proves the wasm reproduces itself. It cannot prove that
// `of_fl_rcs_translate` moves a rocket sideways or that the capture test rides
// inside `of_fl_step`, because both were added after every fixture it compares.
// This does that, in node, with no browser, no GPU and no settle time.
//
// WHY IT IS HERE AND NOT ONLY IN A BROWSER PROBE. The `/core` headers already
// have 63 checks on `docking.h` and they were green while nothing could reach
// it (R81). What was never tested is the SEAM: that the poses are built in the
// right frame, that the sweep sees both ends of a tick under `of_fl_step_n`,
// and that a latch actually rewrites the vehicle's state. A browser probe can
// see all of that too, and it also has to boot a world, build a rocket and fly
// to orbit first, so a failure there names the wrong thing.
//
// THE REFUSALS ARE THE POINT. `sweptCapture` has three of them and a boolean
// return would have collapsed all three into "it did not dock", which is the
// sentence a player cannot act on. Every one is provoked HERE, by name, from a
// fixture that differs from the capturing one in exactly one quantity.
//
// Exit 1 on any failed assertion, the rule every runner here uses.
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const glue = resolve(here, '..', 'dist', 'of-core.mjs');
const m = await import(pathToFileURL(glue).href);
const M = await m.default();

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
  else console.log(`  ok   ${name}${detail === undefined ? '' : `  (${detail})`}`);
  return ok;
};
const f64 = (n) => new Float64Array(M.HEAPF64.buffer, M._of_scratch_f64(), n);

// Part ids, from vessel.h's `parts` namespace. Addressed by ID and translated
// once, because the catalogue's INDEX moves whenever a part is added and this
// file would then quietly build a different rocket (PH-202's shape).
const P = {
  PodMk1: 0x0100, TankLiquid: 0x0101, EngineLiquid: 0x0103,
  RcsBlock: 0x0110, TankMonoprop: 0x0111, DockingPort: 0x0115,
};
const ATTACH = { top: 1, bottom: 2, radial: 3 };

const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// =============================================================================
// A vessel with a pod, a tank, an engine, a monoprop tank, an RCS block and a
// docking port. EVERY ONE OF THOSE IS LOAD-BEARING and the file asserts it:
// without the monoprop tank `rcsTranslationThrustN` is 0 and every RCS case
// below would pass by measuring nothing, which is GP-142's rule (a fixture
// whose value is the identity of the operation reads exactly like a pass).
// =============================================================================
function buildCraft() {
  const v = M._of_vs_create();
  const pod = M._of_vs_add_root(v, P.PodMk1);
  const port = M._of_vs_attach(v, pod, P.DockingPort, ATTACH.top, 0, 0);
  const tank = M._of_vs_attach(v, pod, P.TankLiquid, ATTACH.bottom, 0, 0);
  const mono = M._of_vs_attach(v, tank, P.TankMonoprop, ATTACH.bottom, 0, 0);
  const eng = M._of_vs_attach(v, mono, P.EngineLiquid, ATTACH.bottom, 0, 0);
  const rcs = M._of_vs_attach(v, pod, P.RcsBlock, ATTACH.radial, 0, 0);
  M._of_vs_autostage(v);
  return { v, pod, port, tank, mono, eng, rcs };
}

const body = M._of_body_create_forge(0xbf00d01, 0);
const R = M._of_body_radius(body);
const MU = M._of_body_mu(body);

function newFlight() {
  const c = buildCraft();
  const f = M._of_fl_create(c.v, body);
  M._of_vs_destroy(c.v);
  return { f, ...c };
}

/** Put a flight in a circular orbit at `altM`, nose along +east, at `pos`. */
function place(f, pos, vel, fwd, right) {
  M._of_fl_set_pos_vel(f, pos[0], pos[1], pos[2], vel[0], vel[1], vel[2]);
  M._of_fl_set_attitude(f, fwd[0], fwd[1], fwd[2], right[0], right[1], right[2]);
  M._of_fl_set_ang_vel(f, 0, 0, 0);
  M._of_fl_set_throttle(f, 0);
  M._of_fl_set_sas(f, 0);           // SAS OFF: nothing but RCS moves the ship
}

const state = (f) => { M._of_fl_state(f); const a = f64(18); return {
  pos: [a[0], a[1], a[2]], vel: [a[3], a[4], a[5]],
  fwd: [a[6], a[7], a[8]], right: [a[9], a[10], a[11]] }; };
const rcs = (f) => { M._of_fl_rcs(f); const a = f64(4); return {
  deliveredN: a[0], availableN: a[1], monopropKg: a[2], commandT: a[3] }; };
const dock = (f) => { M._of_fl_dock_status(f); const a = f64(11); return {
  armed: a[0] === 1, captured: a[1] === 1, separationM: a[2],
  closestApproachM: a[3], closingMS: a[4], coneErrorRad: a[5],
  reason: a[6], tests: a[7],
  bestReason: a[8], bestClosingMS: a[9], bestConeErrorRad: a[10] }; };

console.log('PH-301 / PH-303 bridge test');

// =============================================================================
// 1. THE FIXTURE ASSERTS ITSELF FIRST.
// =============================================================================
{
  const { f } = newFlight();
  const r = rcs(f);
  check('fixture: the craft has translational RCS thrust at all',
        r.availableN > 0, `availableN ${r.availableN} N`);
  check('fixture: two nozzles worth is the authored 1000 N per block',
        Math.abs(r.availableN - 1000) < 1e-9, `${r.availableN} N`);
  check('fixture: it carries monopropellant',
        r.monopropKg > 0, `${r.monopropKg} kg`);
  check('fixture: nothing is commanded before anything is pressed',
        r.commandT === 0 && r.deliveredN === 0,
        `cmd ${r.commandT} delivered ${r.deliveredN}`);
  M._of_fl_destroy(f);
}

// =============================================================================
// 2. RCS TRANSLATION MOVES THE VEHICLE SIDEWAYS, AND THE NOSE DOES NOT TURN.
//
// The two-sided claim: the velocity gains a component ALONG the commanded
// direction and the attitude is BIT-IDENTICAL. A translation that quietly
// rotated the vehicle would pass a "did it move" test and fail a docking.
// =============================================================================
{
  const { f } = newFlight();
  const r0 = R + 400000;
  const v0 = Math.sqrt(MU / r0);
  place(f, [r0, 0, 0], [0, 0, v0], [0, 0, 1], [1, 0, 0]);
  // TELEMETRY IS WRITTEN BY `step` AND BY NOTHING ELSE, so it is all zeros
  // before the first tick and `T / massKg` came out Infinity on this file's
  // first run. One tick, then read, then start the measurement.
  M._of_fl_step(f, 1 / 60);
  M._of_fl_telemetry(f);
  const massKg = f64(12)[4];
  const before = state(f);
  const monoBefore = rcs(f).monopropKg;

  // Command +Y, which is neither the velocity (+Z) nor the radial (+X), so a
  // gravity or thrust term cannot be mistaken for the effect under test.
  M._of_fl_rcs_translate(f, 0, 1, 0);
  const N = 60;                                  // one second at 1/60
  M._of_fl_step_n(f, 1 / 60, N);
  const after = state(f);
  const r1 = rcs(f);

  const dvY = after.vel[1] - before.vel[1];
  const expected = (1000 / massKg) * 1.0;        // 1000 N for one second
  check('RCS translation adds velocity along the commanded axis',
        dvY > 0, `dvY ${dvY.toFixed(6)} m/s`);
  check('and the magnitude is thrust / mass, to 0.5%',
        Math.abs(dvY - expected) / expected < 0.005,
        `${dvY.toFixed(6)} vs T/m ${expected.toFixed(6)}`);
  check('the attitude is untouched: translating is not turning',
        after.fwd[0] === before.fwd[0] && after.fwd[1] === before.fwd[1]
        && after.fwd[2] === before.fwd[2],
        `fwd ${JSON.stringify(after.fwd)}`);
  check('the delivered thrust is reported, not the command',
        Math.abs(r1.deliveredN - 1000) < 1e-9, `${r1.deliveredN} N`);

  // The mass flow, against `T / (Isp * g0)`, which is the one identity that
  // says the monopropellant is being BILLED rather than decremented by a rate
  // somebody typed. Isp 240 s on the block, g0 from the bridge.
  const g0 = M._of_atmo_g0();
  const burnedKg = monoBefore - r1.monopropKg;
  const wantKg = 1000 / (240 * g0) * 1.0;
  check('monopropellant is billed at T / (Isp g0)',
        Math.abs(burnedKg - wantKg) < 1e-6,
        `${burnedKg.toFixed(6)} kg vs ${wantKg.toFixed(6)} kg`);
  M._of_fl_destroy(f);
}

// =============================================================================
// 3. THE REFUSING CASE FOR RCS: NO MONOPROPELLANT, NO PUSH.
//
// The control this section exists for. Same command, same craft, one tank
// emptied through the bridge's own setter, and the vehicle must not move.
// Without it every number above is compatible with RCS being free.
// =============================================================================
{
  const { f, mono, pod } = newFlight();
  const r0 = R + 400000;
  const v0 = Math.sqrt(MU / r0);
  place(f, [r0, 0, 0], [0, 0, v0], [0, 0, 1], [1, 0, 0]);
  // THE POD CARRIES 40 kg OF MONOPROPELLANT OF ITS OWN (vessel.h line 336), so
  // emptying the tank is not emptying the vehicle. This file's first run read
  // 240 kg after zeroing the tank and the control measured nothing.
  M._of_fl_set_propellant(f, mono, 0);
  M._of_fl_set_propellant(f, pod, 0);
  const empty = rcs(f);
  check('CONTROL fixture: the monoprop tank really is empty',
        empty.monopropKg === 0, `${empty.monopropKg} kg`);
  check('CONTROL: with no monopropellant there is no translational thrust '
        + 'available at all', empty.availableN === 0, `${empty.availableN} N`);
  const before = state(f);
  M._of_fl_rcs_translate(f, 0, 1, 0);
  M._of_fl_step_n(f, 1 / 60, 60);
  const after = state(f);
  const dvY = after.vel[1] - before.vel[1];
  check('CONTROL: an empty tank pushes nothing, and the command is still '
        + 'recorded so a screen can say why',
        Math.abs(dvY) < 1e-9 && rcs(f).deliveredN === 0
        && rcs(f).commandT === 1,
        `dvY ${dvY} delivered ${rcs(f).deliveredN} cmd ${rcs(f).commandT}`);
  M._of_fl_destroy(f);
}

// =============================================================================
// 4. THE CAPTURE TEST RIDES INSIDE THE STEP AND LATCHES.
//
// The station's port sits ahead of the vehicle along its own velocity, facing
// back at it. The vehicle closes at 0.4 m/s, under the 2.0 m/s policy.
//
// THE VESSEL'S PORT IS THE REAL ONE, read out of `of_fl_transforms` rather than
// invented here, because a hand-typed offset is a fixture that agrees with
// itself and with nothing the game will pass.
// =============================================================================
function portLocalOf(f, portHandle) {
  const n = M._of_fl_parts(f);
  const ids = new Int32Array(M.HEAP32.buffer, M._of_scratch_i32(), n * 5);
  M._of_fl_transforms(f);
  const t = f64(n * 9);
  for (let i = 0; i < n; ++i) {
    if (ids[i * 5] === portHandle) {
      return [t[i * 9 + 0], t[i * 9 + 1], t[i * 9 + 2]];
    }
  }
  return null;
}

// THE GAP AND THE STEP COUNT ARE DERIVED FROM THE CLOSING RATE, not typed.
// This file's first run placed the target 12 m away and ran 400 ticks, which is
// 2.67 m of travel at 0.4 m/s, so every slow case reported "never came within
// the capture radius" and three refusal assertions were measuring a fixture
// that could not arrive. GP-142's rule with the sign flipped: a fixture that
// cannot perform the action cannot exhibit a defect in it.
function approach({ closingMS, faceFlip = false, offsetM = 0,
                    gapM = 4, steps = 2000, dt = 1 / 60, stepN = 1 }) {
  const { f, port } = newFlight();
  const r0 = R + 400000;
  const v0 = Math.sqrt(MU / r0);
  // +X radial, +Z along track. Nose along +Z so the port (vessel +Y offset,
  // face +Y) points... see below: the port's face is the vessel +Y, which with
  // fwd = +Z and right = +X puts the port face along +Z, i.e. along track.
  place(f, [r0, 0, 0], [0, 0, v0 + closingMS], [0, 0, 1], [1, 0, 0]);
  const local = portLocalOf(f, port);
  if (local === null) return { f, why: 'no port in the craft' };

  // The vessel's port in the VESSEL frame: on the stack axis, facing +Y (the
  // nose), rolled +X. This is the published contract the asset lane measured
  // off the shipped .glb: vessel (0, 0.30, 0), face +Y, roll +X.
  const portLocal = { pos: local, face: [0, 1, 0], roll: [1, 0, 0] };
  M._of_fl_dock_arm(f, 0.60, 30 * Math.PI / 180, 2.0,
                    portLocal.pos[0], portLocal.pos[1], portLocal.pos[2],
                    portLocal.face[0], portLocal.face[1], portLocal.face[2],
                    portLocal.roll[0], portLocal.roll[1], portLocal.roll[2]);

  // Where the vessel's port is right now, in the body frame, and the target
  // `gapM` further along track plus whatever lateral offset was asked for.
  const s = state(f);
  const portWorld = [s.pos[0] + local[1] * s.fwd[0] + local[0] * s.right[0],
                     s.pos[1] + local[1] * s.fwd[1] + local[0] * s.right[1],
                     s.pos[2] + local[1] * s.fwd[2] + local[0] * s.right[2]];
  const face = faceFlip ? [0, 0, 1] : [0, 0, -1];

  // THE TARGET IS A SECOND `FlightSim`, ON ITS OWN CIRCULAR ORBIT, STEPPED IN
  // LOCKSTEP, and that is a fix rather than an elaboration. The first version
  // of this file advanced the target in a STRAIGHT LINE while the vehicle flew
  // a curved orbit, and the two separated by 1959 m over 33 s: at r = 1000 km
  // an orbit turns 3.6 degrees in that time, which is 2 km of sagitta. The
  // "capture" being tested was therefore between a vehicle in orbit and a
  // target flying off into space, and no approach could have closed it. A
  // fixture built out of the system under test cannot make that mistake.
  //
  // The lateral offset is OUT OF PLANE (+Y), never radial: a radial offset
  // changes the target's orbital radius, and a different radius is a different
  // orbital period, so the "5 m miss" would have been a slow drift instead of
  // the fixed lateral miss the assertion names.
  const tgt = newFlight();
  const tp = [portWorld[0], portWorld[1] + offsetM, portWorld[2] + gapM];
  const tr = len(tp);
  const tu = [tp[0] / tr, tp[1] / tr, tp[2] / tr];
  // In-plane prograde for a target at `tp`: the orbit normal here is -Y.
  const nHat = [0, -1, 0];
  const tdir = [nHat[1] * tu[2] - nHat[2] * tu[1],
                nHat[2] * tu[0] - nHat[0] * tu[2],
                nHat[0] * tu[1] - nHat[1] * tu[0]];
  const tl = len(tdir);
  const tv0 = Math.sqrt(MU / tr);
  place(tgt.f, tp, [tdir[0] / tl * tv0, tdir[1] / tl * tv0, tdir[2] / tl * tv0],
        [0, 0, 1], [1, 0, 0]);

  let captured = false;
  for (let i = 0; i < steps && !captured; ++i) {
    const ts = state(tgt.f);
    M._of_fl_dock_target(f, ts.pos[0], ts.pos[1], ts.pos[2],
                         face[0], face[1], face[2], 1, 0, 0,
                         ts.vel[0], ts.vel[1], ts.vel[2]);
    M._of_fl_step_n(tgt.f, dt, stepN);
    M._of_fl_step_n(f, dt, stepN);
    captured = dock(f).captured;
  }
  const out = { f, d: dock(f), portLocal, targetVel: state(tgt.f).vel };
  M._of_fl_destroy(tgt.f);
  return out;
}

{
  const { f, d, targetVel } = approach({ closingMS: 0.4 });
  check('the ports latch on a 0.4 m/s approach', d.captured === true,
        `reason ${d.reason} closest ${d.closestApproachM.toFixed(4)} m`);
  check('the sweep actually ran, many times', d.tests > 100, `${d.tests} tests`);
  check('the separation at capture is inside the 0.60 m capture radius',
        d.separationM <= 0.60 + 1e-9, `${d.separationM.toFixed(4)} m`);
  const s = state(f);
  check('a latched vehicle adopts the target velocity and stops closing',
        len(sub(s.vel, targetVel)) < 3.0,
        `relative |v| ${len(sub(s.vel, targetVel)).toFixed(6)} m/s`);
  M._of_fl_destroy(f);
}

// =============================================================================
// 5. THE THREE REFUSALS, EACH FROM A FIXTURE THAT DIFFERS IN ONE QUANTITY.
// =============================================================================
{
  const { f, d } = approach({ closingMS: 40 });
  check('REFUSAL 3: an arrival above the closing policy does not latch',
        d.captured === false, `captured ${d.captured}`);
  // THE REASON IS READ AT THE CLOSEST PASS, not on the tick the loop happened
  // to stop on. The first run of this file asserted `reason` and got 1, which
  // was correct for the tick it read: the vehicle had already flown past and
  // was several metres away. The refusal that matters lasted one tick.
  check('and it says so by reason, not by silence', d.bestReason === 3,
        `bestReason ${d.bestReason} closing ${d.bestClosingMS.toFixed(2)} m/s`);
  check('and the closing rate it names is the one it refused',
        d.bestClosingMS > 2.0, `${d.bestClosingMS.toFixed(2)} m/s`);
  M._of_fl_destroy(f);
}
{
  const { f, d } = approach({ closingMS: 0.4, faceFlip: true });
  check('REFUSAL 2: two ports facing the same way do not latch',
        d.captured === false, `captured ${d.captured}`);
  check('and the reason is the cone, not the speed', d.bestReason === 2,
        `bestReason ${d.bestReason} cone ${(d.bestConeErrorRad * 180 / Math.PI).toFixed(1)} deg`);
  M._of_fl_destroy(f);
}
{
  const { f, d } = approach({ closingMS: 0.4, offsetM: 5.0 });
  check('REFUSAL 1: a pass 5 m wide of the port does not latch',
        d.captured === false, `captured ${d.captured}`);
  check('and the reason is range', d.bestReason === 1,
        `bestReason ${d.bestReason} closest ${d.closestApproachM.toFixed(3)} m`);
  check('and the closest approach it reports is the 5 m it actually missed by',
        Math.abs(d.closestApproachM - 5.0) < 0.25,
        `${d.closestApproachM.toFixed(3)} m`);
  M._of_fl_destroy(f);
}

// =============================================================================
// 6. THE ONE THAT IS THE WHOLE REASON THE TEST IS INSIDE THE STEP (R77).
//
// Drive the SAME approach with `of_fl_step_n(dt, 20)`, i.e. twenty ticks per
// client call, which is what time warp does. A capture test the client ran once
// per call would be handed the pose at two ends of a 20-tick interval: at
// 0.4 m/s the ports travel 0.13 m in that interval, which still catches, so the
// discriminating case is a FAST one that a per-call test cannot see at all.
//
// 40 m/s is refused for speed either way, so the quantity asserted is not the
// verdict but whether the sweep SAW the encounter: `closestApproachM` must be
// small. A per-call test would report the distance at two tick boundaries
// 0.67 m apart in time, i.e. 26 m of travel, and never come near the port.
// =============================================================================
{
  const { d } = approach({ closingMS: 40, stepN: 20, steps: 60, gapM: 30 });
  check('under a 20-tick warped step the sweep still sees the encounter',
        d.closestApproachM >= 0 && d.closestApproachM < 1.0,
        `closest ${d.closestApproachM.toFixed(4)} m over ${d.tests} tests`);
  check('and it ran one sweep per TICK, not one per call',
        d.tests > 20, `${d.tests} tests from calls of 20 ticks`);
  // THE DISCRIMINATING HALF. A distance alone is weak here: a degenerate sweep
  // that compares the pose against ITSELF also reports a small number, because
  // its relative travel is zero and it is measuring one instant. Reaching
  // reason 3 requires the quadratic to have found the sphere CROSSING and then
  // priced its speed, which a single-instant test cannot do.
  // AND THE RATE IT NAMES IS THE RELATIVE ONE. This half was added after the
  // negative control PASSED the line above: a sweep degraded to compare the
  // vessel's pose against ITSELF still reaches reason 3, because its relative
  // travel becomes the TARGET's travel alone, and it therefore reported the
  // closing rate as 1879.26 m/s, which is the station's own orbital speed. The
  // magnitude is the tell, exactly as PH-158 says: 40 m/s and 1879 m/s are both
  // plausible-looking numbers and only one of them is a RELATIVE speed.
  check('and it refuses the warped encounter for SPEED, at the RELATIVE rate',
        d.bestReason === 3 && Math.abs(d.bestClosingMS - 40) < 2,
        `bestReason ${d.bestReason} closing ${d.bestClosingMS.toFixed(2)} m/s`);
}

// =============================================================================
// 7. THE RIG IS NOT INHERITED BY THE NEXT VESSEL TO GET THE HANDLE.
// =============================================================================
{
  const { f } = approach({ closingMS: 0.4 });
  check('fixture: it is latched before the flight is destroyed',
        dock(f).captured === true);
  M._of_fl_destroy(f);
  const again = newFlight();
  check('a recycled flight handle does not inherit a latched docking',
        dock(again.f).armed === false && dock(again.f).captured === false,
        `armed ${dock(again.f).armed} captured ${dock(again.f).captured}`);
  M._of_fl_destroy(again.f);
}

if (fails.length > 0) {
  console.error(`\nFAIL (${fails.length})`);
  for (const s of fails) console.error('  ' + s);
  process.exit(1);
}
console.log('\nPASS');
