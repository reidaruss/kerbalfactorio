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
export const PART_INFO_WORDS = 34;
export const STAGE_PERF_WORDS = 12;
export const MASS_PROPS_WORDS = 15;
export const TRANSFORM_WORDS = 8;
export const PART_ROW_WORDS = 5;
export const FLIGHT_STATE_WORDS = 17;
export const TELEMETRY_WORDS = 12;
export const ORBIT_WORDS = 6;
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
   *  [oX,oY,oZ, cX,cY,cZ, radialAngleRad, propellantKg]. */
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
   *   massFlowKgS, dVVacMS, dVSlMS, burnTimeS]. */
  _of_vs_stage_performance(v: number): number;
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
  _of_fl_parts(f: number): number;
  _of_fl_transforms(f: number): number;
  /** ABI 18 / PH-66. Set ONE part's propellant, CLAMPED to its own capacity.
   *  Exists for one caller: putting a half-empty tank back after a reload. The
   *  clamp is the safety property, because a save file is untrusted input. */
  _of_fl_set_propellant(f: number, partHandle: number, kg: number): number;
  /** f64 scratch, 2: [pitchFromVerticalRad, pastTheVerticalHold]. */
  _of_fl_guidance_pitch(altitudeM: number): number;

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
