// The VESSEL half of the /core bridge (ABI 6): vessel.h, atmosphere.h, flight.h.
//
// It lives in its own file rather than in heap.ts for one reason and it is not
// tidiness: heap.ts is at the 400-line cap and this surface is 60 exports. The
// wasm module is still ONE object; `vesselAbi(M)` is the single place the wider
// face is named, so there is exactly one cast in the client and every caller
// downstream of it is fully typed.
//
// Standing rule 5 applies here as everywhere: call the producing export FIRST,
// then take the scratch view through heap.ts's helpers, and copy out before the
// next call into WASM.
import type { OfCoreModule } from './heap.js';

/** Attach::StackTop / StackBottom / Radial, matching vessel.h §1 exactly. */
export const ATTACH_TOP = 1;
export const ATTACH_BOTTOM = 2;
export const ATTACH_RADIAL = 3;

/** Propellant kinds, vessel.h §1. */
export const PROP_LIQUID = 1;
export const PROP_SOLID = 2;
export const PROP_MONO = 3;

/** Fixed strides of the scratch rows this ABI writes. Named so a caller never
 *  types a magic number and a change here fails to compile rather than to run. */
export const PART_INFO_WORDS = 35;
/** ABI 22: thirteen, not twelve. The thirteenth is `fullThrustS`, the FIRST
 *  flameout of a stage that lights more than one propellant kind; index 11
 *  `burnTimeS` is unmoved and is now the LAST. They are equal on a single-kind
 *  stage. Shared by `_of_vs_stage_performance` (the design) and
 *  `_of_fl_stage_performance` (the craft actually flying), which write the
 *  same row from the same function in of_staging_api.inc. */
export const STAGE_PERF_WORDS = 13;
export const MASS_PROPS_WORDS = 15;
/** PH-157. The autopilot EXECUTION status row. Additive at ABI 22 and detected
 *  by symbol presence, the same way `Autopilot.ts::apMissing` detects the
 *  planning half, so a client built before these existed keeps working and can
 *  name what it is waiting for. See of_ap_api.inc section 21.5 for the full
 *  field list, which is the specification. */
export const AP_STATUS_WORDS = 18;
/** PH-161. `[px,py,pz,vx,vy,vz]` in the PARENT body's frame, metres and m/s. */
export const BODY_STATE_WORDS = 6;
/** PH-161. `[radiusM, muM3S2, soiRadiusM, orbitPeriodS]`. */
export const BODY_FACTS_WORDS = 4;
/** ABI 20: nine, not eight. The ninth is `radialOffsetM` (0 for a part that is
 *  not radially attached), appended so every existing index is unmoved. Shared
 *  by `_of_vs_transforms` and `_of_fl_transforms`, which write the same row. */
export const TRANSFORM_WORDS = 9;
export const PART_ROW_WORDS = 5;
/** 18 since PH-168: word 17 is /core's OWN sas mode, appended, so 0..16 are
 *  unmoved. `FlightAbi.flightState` treats this as a MINIMUM and not an
 *  equality, so a wasm built before the word existed still yields a correct
 *  state row with `sasMode` reported as -1 rather than yielding nothing. */
export const FLIGHT_STATE_WORDS = 18;
/** What word 17 reads on a build that does not publish it. */
export const SAS_MODE_UNKNOWN = -1;
export const TELEMETRY_WORDS = 12;
export const ORBIT_WORDS = 6;
/** PH-301. `[deliveredN, availableN, monopropKg, commandT]`. */
export const RCS_WORDS = 4;
/** PH-303. `[armed, captured, separationM, closestApproachM, closingMS,
 *  coneErrorRad, reason, tests, bestReason, bestClosingMS, bestConeErrorRad]`.
 *  Read as a MINIMUM and not an equality, for FLIGHT_STATE_WORDS's reason. */
export const DOCK_STATUS_WORDS = 11;
/** PH-362 (ABI 26). `[armed, available, verdict, separationM, closingMS,
 *  coneErrorRad, captureRadiusM, captureConeRad, maxClosingMS]`. The three
 *  LIMITS ride with the three measurements on purpose: they come off the part
 *  and a client-side copy would go stale the day a second port class ships. */
export const DOCK_CANDIDATE_WORDS = 9;
/** PH-360 (ABI 26). `[posX,Y,Z, faceX,Y,Z, rollX,Y,Z]`. */
export const PORT_POSE_WORDS = 9;
export const ORBIT_META_WORDS = 18;
export const NODE_PLAN_WORDS = 26;
/** ABI 18: [a, e, i, lan, argp, nu, m0, epoch, mu]. */
export const ORBIT_ELEMENT_WORDS = 9;

export interface VesselAbi {
  // --- §11.1 the part catalogue (content: valid before any init) -------------
  /** 24. Asserted in core/tests/test_vessel.cpp, so checking it against a
   *  literal is a stale-wasm check. */
  _of_vs_part_count(): number;
  /** Catalogue index of a PartId, or -1. */
  _of_vs_part_index_of(partId: number): number;
  /** f64 scratch, PART_INFO_WORDS. See of_vessel_api.inc for the field order. */
  _of_vs_part_info(i: number): number;
  /** u8 scratch, UTF-8, NOT null terminated. Returns the byte count. */
  _of_vs_part_name(i: number): number;
  /** u8 scratch: the glb NODE NAME exactly (ASSET-SPECS §3.3). */
  _of_vs_part_asset(i: number): number;
  /** The ItemId of the part's item form, block 0x0050..0x006A. */
  _of_vs_part_item(i: number): number;
  /** i32 scratch [item, inN, (itemId, count)*inN]. Returns the word count. */
  _of_vs_part_cost_info(i: number): number;
  _of_vs_part_can_afford(i: number): number;
  /** All-or-nothing, adds NO item. Commit the placement only on 1. */
  _of_vs_part_pay(i: number): number;
  /** Give the cost back. Returns the number of input stacks fully returned. */
  _of_vs_part_refund(i: number): number;

  // --- §11.2 the tree --------------------------------------------------------
  _of_vs_create(): number;
  _of_vs_destroy(v: number): void;
  _of_vs_clear(v: number): number;
  /** -> the new part handle, or -1. A vessel has exactly one root. */
  _of_vs_add_root(v: number, partId: number): number;
  /** how = ATTACH_TOP | ATTACH_BOTTOM | ATTACH_RADIAL. -> handle, or -1. */
  _of_vs_attach(v: number, parentHandle: number, partId: number, how: number,
                radialAngleRad: number, radialOffsetM: number): number;
  /** Removes the part AND everything below it. -> parts removed. */
  _of_vs_remove(v: number, handle: number): number;
  _of_vs_count(v: number): number;
  /** i32 scratch, PART_ROW_WORDS per part:
   *  [handle, partId, parentHandle (-1 = root), attach, stage]. */
  _of_vs_parts(v: number): number;
  /** f64 scratch, TRANSFORM_WORDS per part, SAME row order as _of_vs_parts:
   *  [oX,oY,oZ, cX,cY,cZ, radialAngleRad, propellantKg, radialOffsetM].
   *  ABI 20 appended word 8; it is 0 unless attach === ATTACH_RADIAL. */
  _of_vs_transforms(v: number): number;
  _of_vs_length(v: number): number;
  /** ONE part. stage < 0 means kNeverDecoupled (payload). What a restore uses. */
  _of_vs_set_part_stage(v: number, handle: number, stage: number): number;
  /** stage < 0 means kNeverDecoupled (payload). Applies to the whole subtree. */
  _of_vs_assign_stage(v: number, handle: number, stage: number): number;

  // --- §12.1 staging ---------------------------------------------------------
  _of_vs_stage_count(v: number): number;
  /** i32 scratch [nAct, nDec, activate..., decouple...]. */
  _of_vs_stage_info(v: number, k: number): number;
  _of_vs_stage_clear(v: number): number;
  _of_vs_stage_add(v: number): number;
  /** which: 0 = activate, 1 = decouple. */
  _of_vs_stage_push(v: number, k: number, which: number, handle: number): number;
  /** Derive the whole stage table from the tree. -> the stage count. */
  _of_vs_autostage(v: number): number;
  /** Reorder, renumbering every part's stage group through the same
   *  permutation. Moving the rows alone would leave the delta-v filter
   *  describing a vessel that does not exist. */
  _of_vs_stage_move(v: number, from: number, to: number): number;
  _of_vs_fire_stage(v: number): number;
  _of_vs_next_stage_index(v: number): number;

  // --- §12.2 the derived figures (DW-30 item 4) ------------------------------
  /** f64 scratch, STAGE_PERF_WORDS per stage. Returns the STAGE COUNT:
   *  [index, m0, m1, propellantKg, ispVac, ispSl, thrustVacN, thrustSlN,
   *   massFlowKgS, dVVacMS, dVSlMS, burnTimeS, fullThrustS].
   *  THE DESIGN, which is a blueprint that never burns a gram. For the craft
   *  that is actually flying use `_of_fl_stage_performance` (§13.2). */
  _of_vs_stage_performance(v: number): number;

  // --- section 21.5: AUTOPILOT EXECUTION (PH-157) ----------------------------
  // PUBLISHED BY THE PHYSICS LANE, which owns execution. Three calls and NO
  // per-frame tick: the autopilot is driven from inside `_of_fl_step` and
  // `_of_fl_step_n`, so a client ARMS a program and then steps the flight
  // exactly as it already does. There is no ordering to get wrong and a warped
  // step flies the program identically to a real-time one, which is what makes
  // a departure scheduled hours out reachable at all.
  //
  // MEASURED through this bridge with the client only calling `_of_fl_step`:
  // hold-orbit from 680 km to a requested 800 km lands at a 799997.2,
  // e 0.000000, having spent exactly its planned 177.5676 m/s. Under
  // `_of_fl_step_n` at 200 ticks a call the result is identical.

  /** Arm "take it to this orbit": a circular orbit at `targetRadiusM` from the
   *  body's CENTRE, not an altitude. Returns 1 armed, 0 refused. A refusal is
   *  an answer and `_of_ap_note` says why in words a screen can print. */
  _of_ap_arm_hold_orbit(f: number, targetRadiusM: number): number;
  /** Arm a transfer to a target orbit, departing `tDepartFromNowS` from now.
   *  A FUTURE departure needs no separate mechanism: the program simply coasts
   *  until its first ignition, so scheduling is a number in the plan rather
   *  than a state in the executor. Target words are the same nine, in the same
   *  order, as `_of_ap_flight_reach`, and the time-of-flight search is the
   *  same one, so a player is armed with the transfer the chart quoted. */
  _of_ap_arm_transfer(f: number, tDepartFromNowS: number, sma: number,
                      ecc: number, inc: number, lan: number, argp: number,
                      ta: number, epoch: number): number;
  /** Disarm, and CUT THE THROTTLE, because leaving the engine lit is the worst
   *  possible reading of the word. Returns 1 if something was armed. */
  _of_ap_cancel(f: number): number;
  /** f64 scratch, AP_STATUS_WORDS. Returns 18, or 0 when nothing is armed:
   *  [running, phase, mode, burnIndex, burnCount, timeToIgnitionS,
   *   dvSpentTotalMS, dvThisBurnMS, currentBurnDvMS, pointingErrorDeg,
   *   rateDegS, burningNow, throttleNow, programDvMS, targetRadiusM,
   *   dirX, dirY, dirZ].
   *  phase: 0 Idle, 1 Coast, 2 Orient, 3 Burn, 4 Done, 5 Aborted.
   *  mode:  0 Off, 1 HoldOrbit, 2 Transfer.
   *  `running` is 0 once the program is Done or Aborted, so it is the word an
   *  arm button reads; the COUNT is what says whether anything is armed at all,
   *  and a REFUSED arm returns 18 with running 0 and phase 5 so the screen can
   *  show the refusal rather than forgetting it happened.
   *  `timeToIgnitionS` goes NEGATIVE when a burn is overdue, which is exactly
   *  what a vehicle still slewing onto its attitude looks like.
   *  dir is the current burn's direction, unit, inertial, and it is the SAME
   *  vector the executor is holding, so a navball marker and the ship cannot
   *  disagree. */
  _of_ap_status(f: number): number;
  /** u8 scratch, UTF-8, NOT null terminated; returns the byte count. Why it
   *  refused, or what it is doing. Same convention as `_of_vs_part_name`. */
  _of_ap_note(f: number): number;

  // --- section 21.6: WHERE A BODY IS (PH-161) --------------------------------
  // PHYSICS OWNS THIS, for the same reason DW-18 says physics owns mu. A
  // renderer that computed a moon's position would be a second ephemeris, and
  // the first thing to disagree with it would be an autopilot flying to a moon
  // that is not drawn where it is.
  //
  // `kCinderOrbitRadiusM` used to be a private static in `sim_world.h`, which
  // is not in the wasm build, so of 207 exports not one could say where the
  // moon was. It now lives in `orbital.h` and `sim_world.h` aliases it.

  /** f64 scratch, BODY_STATE_WORDS, or 0 for an unknown body. bodyId 0 is
   *  Forge, 1 is Cinder.
   *  Forge returns zeros and that is the TRUTH rather than a stub: Forge is the
   *  parent frame, so its position in its own frame is the origin.
   *  Cinder is phased so `simTimeS` 0 is EXACTLY the (1.2e7, 0, 0) the frame
   *  graph installs, verified `=== 1.2e7`. Pass 0 for today's world, which does
   *  not advance the moon; pass a real clock for the orbit `transfer.h` plans
   *  against. That disagreement is R70 and it is Admin's to route. */
  _of_body_state(bodyId: number, simTimeS: number): number;
  /** f64 scratch, BODY_FACTS_WORDS, or 0. `orbitPeriodS` is 0 for a body that
   *  orbits nothing in this build. Measured: Cinder 138984.4 s. */
  _of_body_facts(bodyId: number): number;
  _of_vs_total_dv_vacuum(v: number): number;
  _of_vs_remaining_dv_vacuum(v: number): number;
  /** f64 scratch, MASS_PROPS_WORDS:
   *  [dryKg, propKg, totalKg, comXYZ, copXYZ, normalCdA, axialCdA,
   *   normalForceSlope, Ixx, Iyy, Izz]. */
  _of_vs_mass_properties(v: number): number;
  /** Negative is STABLE (centre of pressure behind centre of mass). */
  _of_vs_static_margin(v: number): number;
  /** `body` is an of_body_create* handle: gravity is its mu and nothing else. */
  _of_vs_twr(v: number, stageIndex: number, body: number, altitudeM: number): number;
  _of_vs_propellant_aboard(v: number, kind: number): number;
  _of_vs_crew_capacity(v: number): number;

  // --- §13.1 atmosphere (pure; bodyId 0 = Forge, anything else airless) ------
  _of_atmo_density(bodyId: number, altM: number): number;
  _of_atmo_density_raw(bodyId: number, altM: number): number;
  _of_atmo_pressure_ratio(bodyId: number, altM: number): number;
  _of_atmo_space_altitude(bodyId: number): number;
  _of_atmo_in_space(bodyId: number, altM: number): number;
  _of_atmo_dynamic_pressure(densityKgM3: number, airspeedMS: number): number;
  _of_atmo_lapse(seaLevelValue: number, vacuumValue: number, pRatio: number): number;
  /** The Isp reference constant. PH-18: a UNIT CONVERSION, never a gravity. */
  _of_atmo_g0(): number;

  // --- §13.2 the flight sim (for the flight lane; the VAB does not use it) ---
  /** COPIES the design out of vessel handle `v`. A rocket on the pad is not a
   *  blueprint, so editing the design afterwards does not touch the vehicle. */
  _of_fl_create(v: number, body: number): number;
  _of_fl_destroy(f: number): void;
  _of_fl_set_pos_vel(f: number, px: number, py: number, pz: number,
                     vx: number, vy: number, vz: number): number;
  _of_fl_set_attitude(f: number, fx: number, fy: number, fz: number,
                      rx: number, ry: number, rz: number): number;
  _of_fl_set_ang_vel(f: number, x: number, y: number, z: number): number;
  _of_fl_set_throttle(f: number, t: number): number;
  /** 0 Off, 1 Hold, 2 Prograde, 3 Retrograde, 4 Command. DW-30 ships Hold.
   *  ABI 11 appends 5 Normal, 6 Antinormal, 7 RadialIn, 8 RadialOut. There is
   *  no Node mode: a node's direction is fixed in inertial space, so Command
   *  plus _of_fl_set_sas_command IS hold-node. */
  _of_fl_set_sas(f: number, mode: number): number;
  _of_fl_set_sas_command(f: number, x: number, y: number, z: number): number;
  _of_fl_capture_hold(f: number): number;
  _of_fl_step(f: number, dt: number): number;
  _of_fl_step_n(f: number, dt: number, n: number): number;
  _of_fl_stage(f: number): number;
  _of_fl_next_stage_index(f: number): number;
  _of_fl_on_rails_eligible(f: number): number;
  /** f64 scratch, FLIGHT_STATE_WORDS. */
  _of_fl_state(f: number): number;
  /** f64 scratch, TELEMETRY_WORDS. */
  _of_fl_telemetry(f: number): number;
  /** f64 scratch, ORBIT_WORDS. Unbound reports apoapsis 1e308, bound 0. */
  _of_fl_orbit(f: number): number;
  _of_fl_remaining_dv_vacuum(f: number): number;
  /** ABI 22 / R44b. f64 scratch, STAGE_PERF_WORDS per stage, the SAME row as
   *  `_of_vs_stage_performance` writes. Returns the STAGE COUNT. The subject is
   *  the craft that is flying, whose tanks actually drain, rather than the
   *  design it was copied out of, which never does. */
  _of_fl_stage_performance(f: number): number;
  _of_fl_parts(f: number): number;
  _of_fl_transforms(f: number): number;
  /** ABI 18 / PH-66. Set ONE part's propellant, CLAMPED to its own capacity.
   *  Exists for one caller: putting a half-empty tank back after a reload. The
   *  clamp is the safety property, because a save file is untrusted input. */
  _of_fl_set_propellant(f: number, partHandle: number, kg: number): number;
  /** PH-251. Where the ground is, absolute radius, 0 to switch the rule off.
   *  MUST be the same radius the caller's own arrest uses, or two authorities
   *  pin the vehicle to two heights. A refusal, not a contact model: the
   *  velocity is kept because `landing.h` reads it to classify the arrival. */
  _of_fl_set_surface(f: number, radiusM: number): number;
  /** PH-251. f64 scratch, 3: [groundRefusals, deepestRefusalM, onGround]. */
  _of_fl_ground(f: number): number;
  /**
   * R87 / PH-250. The guidance ribbon, and it TAKES A BODY now.
   *
   * It replaces `_of_fl_guidance_pitch(altitudeM)`, which built a default
   * Forge gravity turn and was handed one number: off an airless moon whose
   * whole parking orbit is 20 km that ribbon was still 33 degrees from
   * horizontal at 20 km and did not level out until 45 km. PH-201 put a key on
   * it, so it stopped being decoration and became an instruction.
   *
   * A RENAME, NOT A WIDENING. Adding arguments to the old name would let a new
   * client call an old binary with the flight handle sitting where an altitude
   * used to be: a small integer, a plausible altitude, a pitch of 0, and no
   * error anywhere. The new name fails by symbol instead, which is detectable.
   *
   * `targetApoapsisM` is ignored on a body with air and REQUIRED without one.
   * f64 scratch, 5: [pitchFromVerticalRad, schedulePitchRad, apoapsisAltM,
   *                  atmospheric, usable].
   */
  _of_fl_ascent_guidance(f: number, targetApoapsisM: number,
                         altitudeAglM: number): number;

  /**
   * PH-301. TRANSLATIONAL RCS. An INERTIAL direction whose magnitude is the
   * throttle, 0 to 1, of the vehicle's total RCS thrust.
   *
   * INERTIAL and not vessel-frame, deliberately: this side already reads
   * `forward` and `right` off `_of_fl_state` every tick, and a vessel-frame
   * argument would put a second derivation of the vessel basis inside the
   * bridge. Two of those is how a press of "right" comes out as a drift left.
   *
   * IT IS STATE, LIKE THE THROTTLE, so a client that stops writing it does not
   * stop thrusting. Write it every tick, zero included.
   */
  _of_fl_rcs_translate(f: number, x: number, y: number, z: number): number;
  /** PH-301. f64 scratch, 4: [deliveredN, availableN, monopropKg, commandT].
   *  DELIVERED is not the command: a vehicle out of monopropellant is
   *  commanded and delivering nothing, and those must be tellable apart. */
  _of_fl_rcs(f: number): number;

  /**
   * PH-303 / R77. THE CAPTURE TEST, ARMED HERE AND RUN INSIDE THE STEP.
   *
   * It cannot be a call this side makes once a frame: `docking::sweptCapture`
   * needs the poses at both ends of a TICK, and under `_of_fl_step_n` a frame
   * is up to a thousand ticks. Same argument that refused `of_ap_tick`.
   *
   * The vessel's own port is given in the VESSEL'S LOCAL FRAME, which is the
   * frame `_of_fl_transforms` already reports part origins in. Pass 0 for any
   * limit to take `docking::Limits`'s own default.
   */
  _of_fl_dock_arm(f: number, capRadiusM: number, coneRad: number,
                  maxClosingMS: number,
                  px: number, py: number, pz: number,
                  fx: number, fy: number, fz: number,
                  rx: number, ry: number, rz: number): number;
  /** PH-303. Where the other port is, body-centred inertial, plus its velocity
   *  so the sweep can carry it across ticks this side is not present for. */
  _of_fl_dock_target(f: number, px: number, py: number, pz: number,
                     fx: number, fy: number, fz: number,
                     rx: number, ry: number, rz: number,
                     vx: number, vy: number, vz: number): number;
  _of_fl_dock_clear(f: number): number;
  /** PH-303. f64 scratch, DOCK_STATUS_WORDS. Words 2 and 4..6 are THIS TICK;
   *  words 3 and 8..10 are the BEST PASS, because every tick after a failed
   *  pass reports the vehicle flying away and its reason is always 1. */
  _of_fl_dock_status(f: number): number;

  // --- §13.2b THE DOCKING COMMAND SURFACE (ABI 26, PH-360..366, D-015). -----
  //
  // R93: "there is no `of_dk_*` symbol in the wasm at all, so the client cannot
  // even ask". The block above arms a MECHANISM that latches inside the step;
  // these five are the CONTROL, and every one delegates its judgement to
  // `of/docking.h`. Optional (`?`) on the readers so a client running against
  // an older wasm degrades to "no dock available" instead of throwing, which is
  // the same shape `_of_fl_dock_status` already uses.
  /** PH-360. `docking::portAt`, pure. A port's LOCAL pose (vessel frame: +Y
   *  forward, +X right) carried into world space by an origin and an attitude.
   *  f64 scratch, PORT_POSE_WORDS. It exists so the composition happens ONCE,
   *  in C++, rather than a second time in TypeScript with its own opinion about
   *  which axis is forward. */
  _of_dk_port_at?(px: number, py: number, pz: number,
                  fx: number, fy: number, fz: number,
                  rx: number, ry: number, rz: number,
                  lpx: number, lpy: number, lpz: number,
                  lfx: number, lfy: number, lfz: number,
                  lrx: number, lry: number, lrz: number): number;
  /** PH-364. 1: latch on contact inside the step (the shipped behaviour, and
   *  what the auto-approach autopilot will want). 0: ADVISORY, which is what
   *  makes a hand-flown dock possible at all -- under auto-latch the sim docks
   *  itself the tick before a player could press anything. Reset to 1 by every
   *  `_of_fl_dock_arm`. */
  _of_dk_latch?(f: number, latchOnContact: number): number;
  /** PH-362. Would a capture succeed RIGHT NOW, and if not which gate is shut.
   *  f64 scratch, DOCK_CANDIDATE_WORDS. `selfId`/`targetId` are the client's
   *  own registry ids and are compared only to refuse a self-dock; pass 0 for
   *  both to skip that rule. */
  _of_dk_candidate?(f: number, selfId: number, targetId: number): number;
  /** PH-364. DOCK. -> 1 captured, 0 no rig, else MINUS the verdict code
   *  (-1 out of range, -2 not facing, -3 too fast, -4 already docked,
   *  -5 self-dock). */
  _of_dk_capture?(f: number, selfId: number, targetId: number): number;
  /** PH-363. UNDOCK, pushing straight out of the vessel's own port face at
   *  `sepMS` (0 takes `docking::kReleaseSepMS`, 0.20 m/s). -> 1 or 0. */
  _of_dk_release?(f: number, sepMS: number): number;

  // --- §13.3 ON RAILS (ABI 18). Pure, handle-free; nothing is stored. --------
  /** Fit a conic to a state vector. f64 scratch, ORBIT_ELEMENT_WORDS:
   *  [a, e, i, lan, argp, nu, m0, epoch, mu]. */
  _of_orb_park(px: number, py: number, pz: number,
               vx: number, vy: number, vz: number,
               mu: number, simTimeS: number): number;
  /** Evaluate that conic at `simTimeS`. f64 scratch, 6: [rX,Y,Z, vX,Y,Z].
   *  A function of the ELEMENTS and the TIME ASKED FOR and of nothing else, so
   *  one jump of an hour and 216,000 jumps of a tick are bit-identical. */
  _of_orb_resume(a: number, e: number, i: number, lan: number, argp: number,
                 nu: number, m0: number, epoch: number, mu: number,
                 simTimeS: number): number;

  // --- §17 MANEUVER NODES (ABI 11). Pure functions; nothing is stored. -------
  /** The conic through (p, v) as a polyline. mu and the body radius come off
   *  the FLIGHT HANDLE, never from JS: a JS-supplied mu would be a second
   *  gravity authority, which is the bug DW-18 exists to have already fixed.
   *  -> point count; f64 scratch holds count*3 doubles [x,y,z]. */
  _of_mn_path(f: number, px: number, py: number, pz: number,
              vx: number, vy: number, vz: number, samples: number): number;
  /** f64 scratch, ORBIT_META_WORDS. Same conic, the scalars beside it. */
  _of_mn_orbit_meta(f: number, px: number, py: number, pz: number,
                    vx: number, vy: number, vz: number): number;
  /** f64 scratch, NODE_PLAN_WORDS. What the burn costs, which way to point,
   *  when to light it, how long for, and the orbit it produces. */
  _of_mn_plan(f: number, tFromNowS: number, dvProgradeMS: number,
              dvNormalMS: number, dvRadialMS: number): number;
}

export type OfVesselModule = OfCoreModule & VesselAbi;

/** The ONE place the wasm module is widened to the vessel surface. */
export function vesselAbi(M: OfCoreModule): OfVesselModule {
  return M as OfVesselModule;
}
