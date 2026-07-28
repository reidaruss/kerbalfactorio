// A kinematic capsule resolved against the /core surface oracle. NO physics
// engine (DW-12 / WR-7): the ground IS surfaceRadius and the walls ARE
// solidCell, so the walker, the collider and the drawn mesh are one function and
// cannot disagree. That is the entire D-011 payoff.
//
// Everything here is f64 body-frame metres. The oracle calls are synchronous and
// measured at 1.9 to 3.2 us, which is exactly what makes an in-frame character
// step affordable (ARCHITECTURE.md section 2.3).

import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { CAPSULE_SAMPLES_M, VOXEL_STEP_UP_M, VoxelCollider } from './VoxelCollision.js';
import { STRUCTURE_STEP_UP_M, type SolidBodies } from './StructurePort.js';
import { CAPSULE } from './Capsule.js';
// Re-exported so the split is invisible to the six modules that read it.
export { CAPSULE } from './Capsule.js';
import { climbGate, slopeGate } from './HeightfieldWalk.js';
import { escapeRock } from './RockEscape.js';
import type { StandTrace } from './StandTrace.js';
import type { WaterOracle } from '../world/WaterOracle.js';
import {
  dragTangentFactor, dragUpFactor, moveAccel, moveSpeed, newSwimState,
  radialAccel, readWater, SWIM, type SwimState,
} from './Swim.js';

export interface MoveIntent {
  /** Desired tangent direction, body frame, unit or zero. */
  wx: number; wy: number; wz: number;
  /** Target ground speed in m/s for that direction. */
  speed: number;
  jump: boolean;
}


/** How far below the feet a voxel floor is looked for before the player falls.
 *  Exported because `RockEscape` re-asks the SAME question about the position a
 *  refused tick falls back to, and two search depths would be two answers. */
export const VOXEL_FLOOR_SEARCH_M = 6;
/**
 * Below this much heightfield the voxels take over completely. More than one
 * voxel (so a shallow dig still walks on the reconciled heightfield) and less
 * than a capsule (so a tunnel floor is never mistaken for the surface).
 */
const DEEP_UNDERGROUND_M = 1.5;
/**
 * Step-DOWN snap while standing on a voxel floor. A dug tunnel floor is a
 * staircase of whole cells, so the walking snap (0.35 m) leaves the player
 * ballistic for a tick at every step down and the walk reads as a stutter.
 * Just over a cell, so it follows a dug floor and still falls down a shaft.
 */
const DEEP_SNAP_M = 1.1;
/**
 * How far below the feet a structural deck is looked for.
 *
 * THE OLD COMMENT HERE READ "a storey is 3 m", AND IT HAS BEEN 4 m SINCE DW-32.
 * The number survived the change; the reasoning behind it did not, so it is
 * restated against the module the game actually ships. The bound that matters
 * is that the search must never reach through the floor you are on to the one
 * below: that clearance is `storey - deckH` = 4.00 - 0.50 = 3.50 m, and 2.0 m
 * sits well inside it. The bound from the other side is that it must outreach
 * the tallest step-up (1.1 m), or a player who has just climbed onto a deck
 * would not find it underneath them. 2.0 m satisfies both with room, which is
 * why the number is unchanged even though the sentence that justified it was
 * wrong.
 */
const STRUCTURE_FLOOR_SEARCH_M = 2.0;

export class KinematicBody {
  /** Feet, on the surface. Body-frame f64 metres. */
  readonly feet: Vec3d = { x: 0, y: 0, z: 0 };
  readonly vel: Vec3d = { x: 0, y: 0, z: 0 };
  grounded = false;
  /** dot(surfaceNormal, up) under the feet. 1 is flat. */
  slopeCos = 1;
  /** Metres the feet were pushed out of solid voxels on the last step. */
  voxelPushM = 0;
  /** True while the feet rest on a VOXEL floor below the heightfield surface. */
  underRock = false;
  /** True on a tick the voxel floor query answered `buried`: the feet are in
   *  rock, which is the one state that must never be read as a fall (PH-60). */
  buried = false;
  /** Metres the last-resort radial eject lifted the capsule out of rock. */
  ejectM = 0;
  /** True on a tick where a step into solid rock was refused. */
  blockedByRock = false;
  /** True while the feet rest on a placed STRUCTURE rather than on the ground. */
  onDeck = false;
  /** True on a tick where a step into a wall was refused. */
  blockedByBuild = false;
  /** Box tests the structural port made this tick, charged to the budget. */
  structureTests = 0;
  /**
   * Placed structures, handed in by the gameplay layer (null with none).
   *
   * A base RESTS on the terrain and never edits it (DW-24), so the walker cannot
   * learn about it from the oracle: it has to compose two answers, rock from
   * `surface_field.h` and boxes from here. Keeping it a port rather than an
   * import is what stops a foundation from becoming a sixth definition of the
   * surface (DW-26 is that lesson, learned the expensive way).
   */
  solids: SolidBodies | null = null;
  /**
   * The water, if this body has any (WG-40). A SEPARATE oracle from the surface
   * one on purpose: see WaterOracle.ts. Null leaves every path below bit-for-bit
   * what it was, because `readWater` zeroes the state and every water term is
   * multiplied by a frac of 0.
   */
  water: WaterOracle | null = null;
  /** How wet the capsule is this tick, and the only place that is decided. */
  readonly swim: SwimState = newSwimState();
  speedMps = 0;
  oracleCalls = 0;
  /**
   * Per-tick record of which authority held the feet up, off unless a probe
   * turns it on. See StandTrace.ts: an oscillation between the terrain and a
   * deck is invisible in any per-FRAME reading, so it needs its own channel.
   */
  trace: StandTrace | null = null;

  /** Everything that touches the voxel lattice. See VoxelCollision.ts. */
  private readonly col: VoxelCollider;

  constructor(private readonly oracle: SurfaceOracle) {
    this.col = new VoxelCollider(oracle);
  }

  /** Drop the capsule onto the surface at a geodetic coordinate. */
  spawn(latRad: number, lonRad: number): void {
    const d = { x: 0, y: 0, z: 0 };
    this.oracle.dirFromLatLon(latRad, lonRad, d);
    const r = this.oracle.surfaceRadius(d.x, d.y, d.z);
    this.feet.x = d.x * r; this.feet.y = d.y * r; this.feet.z = d.z * r;
    this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
    this.grounded = true;
    this.speedMps = 0;
  }

  /**
   * Gravity from /core through the bridge (`of_gravity_accel`), never derived
   * here. This USED to transcribe /core's uniform-density model constant for
   * constant, which read as harmless duplication right up until DW-18 moved
   * /core to mu: the copy would have kept the browser at 0.587 m/s^2 while the
   * orbit propagator ran at 9.81 on the same planet. Standing rule 1 covers
   * gravity too.
   */
  gravityAccel(rM: number): number {
    return this.oracle.body.gravityAccel(rM);
  }

  step(dt: number, intent: MoveIntent): void {
    const p = this.feet;
    let r = Math.hypot(p.x, p.y, p.z);
    if (r < 1e-6) return;
    let ux = p.x / r, uy = p.y / r, uz = p.z / r;
    this.oracleCalls = 0;
    this.col.resetCalls();

    // Split velocity into radial and tangential once; everything below works on
    // the two halves and they are recombined at the end.
    const v = this.vel;
    let vUp = v.x * ux + v.y * uy + v.z * uz;
    let tx = v.x - ux * vUp, ty = v.y - uy * vUp, tz = v.z - uz * vUp;

    // How wet the capsule is. ONE query, at the feet, and every water term below
    // is a function of the one `frac` it produces (WG-40).
    const wet = readWater(this.swim, this.water, p, CAPSULE.heightM,
      CAPSULE.eyeHeightM, dt);

    // Steer the tangential velocity toward the intent, then apply drag.
    const accel = moveAccel(wet, this.grounded, CAPSULE.groundAccel, CAPSULE.airAccel);
    const wantSpeed = moveSpeed(wet, intent.speed);
    const gx = intent.wx * wantSpeed, gy = intent.wy * wantSpeed, gz = intent.wz * wantSpeed;
    let dx = gx - tx, dy = gy - ty, dz = gz - tz;
    const dLen = Math.hypot(dx, dy, dz);
    const dMax = accel * dt;
    if (dLen > dMax && dLen > 1e-9) { const s = dMax / dLen; dx *= s; dy *= s; dz *= s; }
    tx += dx; ty += dy; tz += dz;
    if (this.grounded && intent.speed === 0) {
      const k = Math.max(0, 1 - CAPSULE.groundDrag * dt);
      tx *= k; ty *= k; tz *= k;
    }

    // Weight, less buoyancy. Out of water `frac` is 0 and this is exactly the
    // gravity term it replaced. In water it changes sign at the float line, so
    // a swimmer rises to it and a wader is still held down by it, with no state
    // switch anywhere: the equilibrium is a fixed point, not a branch (Swim.ts).
    vUp += radialAccel(wet, this.gravityAccel(r)) * dt;
    if (wet.inWater) {
      // Held jump is SWIM UP, because what it is really for is climbing out at
      // the bank, which is a sustained push rather than a jump.
      if (intent.jump) vUp += SWIM.riseAccel * dt;
      vUp *= dragUpFactor(wet, dt);
      const k = dragTangentFactor(wet, dt);
      tx *= k; ty *= k; tz *= k;
    } else if (intent.jump && this.grounded && this.slopeCos >= CAPSULE.slopeLimitCos) {
      vUp = CAPSULE.jumpSpeedMps;
      this.grounded = false;
    }

    // Integrate in the body frame. The tangential part is a chord, not an arc;
    // over one 16.7 ms tick at 12 m/s that is 0.2 mm of sagitta on a 600 km
    // sphere, and the ground snap below re-projects it onto the surface anyway.
    let qx = p.x + (tx + ux * vUp) * dt;
    let qy = p.y + (ty + uy * vUp) * dt;
    let qz = p.z + (tz + uz * vUp) * dt;

    // 1. The oracle IS the ground -- but WHICH ground. Above the heightfield it
    //    is surfaceRadius. UNDER INTACT GROUND it cannot be: a sideways tunnel
    //    leaves the top of its column solid, so derivedLoweringAt correctly
    //    reports no lowering and surfaceRadius still names the hillside metres
    //    overhead. Measured: two strikes into a tunnel wall and the next step
    //    teleported the player out through their own ceiling, because
    //    `gap <= 0` read "below the ground, therefore landing".
    //
    //    So once the feet are DEEP below the heightfield the voxel world is the
    //    only authority: the floor is the first solid cell below (solidCell,
    //    DW-12, the same predicate the mesher drew), and walking into rock is
    //    REFUSED rather than resolved upward. Both branches read
    //    surface_field.h; neither invents a height.
    let qr = Math.hypot(qx, qy, qz);
    const askedR = qr;
    let dxn = qx / qr, dyn = qy / qr, dzn = qz / qr;
    let surfaceR = this.oracle.surfaceRadius(dxn, dyn, dzn);
    this.oracleCalls++;
    let groundR = surfaceR;
    this.underRock = false;
    this.blockedByRock = false;
    this.buried = false;
    const deep =this.oracle.editsHandle !== 0 && qr < surfaceR - DEEP_UNDERGROUND_M;
    if (!deep) {
      // The heightfield's own wall. See CAPSULE.stepUpM.
      const gate = climbGate(this.oracle, p, qx, qy, qz, r, ux, uy, uz, surfaceR);
      this.oracleCalls += gate.calls;
      if (gate.moved) {
        qx = gate.x; qy = gate.y; qz = gate.z;
        qr = Math.hypot(qx, qy, qz) || 1;
        dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
        surfaceR = gate.surfaceR;
        groundR = gate.surfaceR;
        // Velocity IS the accepted displacement over dt, so a capsule pressed
        // into a cliff does not keep a hidden into-the-wall speed that fires
        // it sideways the moment the wall runs out.
        tx = gate.tx / dt; ty = gate.ty / dt; tz = gate.tz / dt;
      }
    }
    if (deep) {
      // A refused step used to mean a refused TICK: the whole displacement was
      // undone and the tangential velocity zeroed, so brushing a tunnel wall at
      // any angle stopped the player dead and the tunnel ran on ahead of them
      // (STATUS.md, W5 remaining). Now the step is resolved: climb a ledge if
      // one is in the way, otherwise slide along the wall by dropping the
      // body-frame axis that is blocked. Voxel walls ARE axis aligned, so
      // dropping an axis is exactly sliding along the face.
      const s = this.col.resolveStep(p, qx, qy, qz, ux, uy, uz);
      qx = s.x; qy = s.y; qz = s.z;
      qr = Math.hypot(qx, qy, qz) || 1;
      dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
      if (s.blocked) { tx = 0; ty = 0; tz = 0; this.blockedByRock = true; }
      // The rise allowance is the walker's OWN first voxel rung, the reading
      // GP-53 made the structural port take and for the same reason: a floor
      // the feet have sunk into is still that floor, so seating on it corrects
      // rather than lifts, and anything bigger is a climb `resolveStep` owns.
      const floor = this.col.floorBelow(qr, dxn, dyn, dzn, VOXEL_FLOOR_SEARCH_M,
        VOXEL_STEP_UP_M[0]);
      // An open SHAFT is a fall. BEING IN ROCK IS NOT, and reading the two off
      // one null is what put the walker 29 km under the world (PH-60). Never
      // snap to the roof either way.
      groundR = floor.kind === 'floor' ? floor.r : -Infinity;
      this.underRock = floor.kind === 'floor';
      this.buried = floor.kind === 'buried';
    }
    // 1b. WHAT THE PLAYER BUILT. Resolved after the terrain and before the
    //     ground snap, in that order, because a deck is a floor ABOVE the
    //     ground: settling onto the terrain first and then discovering the
    //     foundation would drop the player through their own base for a tick.
    this.onDeck = false;
    this.blockedByBuild = false;
    this.structureTests = 0;
    const terrainR = groundR;
    let deckRaw = Number.NaN;
    const solids = this.solids;
    if (solids !== null && solids.count > 0) {
      solids.resetTests();
      const s = solids.resolveStep(p, qx, qy, qz, ux, uy, uz,
        CAPSULE_SAMPLES_M, STRUCTURE_STEP_UP_M);
      qx = s.x; qy = s.y; qz = s.z;
      qr = Math.hypot(qx, qy, qz) || 1;
      dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
      if (s.blocked) { tx = 0; ty = 0; tz = 0; this.blockedByBuild = true; }
      // A deck is only ever a metre or two under the feet: a bigger search would
      // let a player standing beside a tower be grounded on its roof.
      //
      // The rise allowance is the walker's OWN first step rung, and it is what
      // seats the feet on a floor they are standing inside rather than leaving
      // them in it. Bounded by a step because a bigger lift is a climb and
      // `resolveStep` above owns climbing; the shipped 0.50 m deck fits inside
      // one 0.55 m rung and a 4.00 m wall does not, so being inside a wall can
      // never put anybody on top of it.
      const deck = solids.deckUnder(dxn, dyn, dzn, qr, STRUCTURE_FLOOR_SEARCH_M,
        STRUCTURE_STEP_UP_M[0]);
      if (deck !== null) deckRaw = deck;
      if (deck !== null && deck > groundR) { groundR = deck; this.onDeck = true; }
      this.structureTests = solids.tests;
    }

    // The radius the walker ARRIVED at: the only witness to a floor query that
    // answers with the querier's own position (WG-31/GP-53). See StandTrace.ts.
    const preSnapR = qr;
    const gap = qr - groundR;
    const snapM = this.underRock ? DEEP_SNAP_M : CAPSULE.groundSnapM;
    const landing = gap <= 0 || (this.grounded && gap <= snapM && vUp <= 0);
    if (landing && Number.isFinite(groundR)) {
      qx = dxn * groundR; qy = dyn * groundR; qz = dzn * groundR;
      qr = groundR;
      // A FLOOR KILLS DOWNWARD MOTION, NOT UPWARD. Out of water the two are the
      // same statement because nothing but a jump makes vUp positive here, and
      // a jump has already cleared `grounded`. In water they differ and the
      // difference matters: standing on the bed under the float line, buoyancy
      // is lifting, and zeroing that every tick would pin a swimmer to the
      // bottom of the pond while the acceleration said otherwise.
      vUp = vUp > 0 && wet.floating ? vUp : 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // 2. INSIDE ROCK. Two cases with one owner (RockEscape.ts): the dig-mouth
    //    rim, which is the minimum translation out of a cell face (15.2 item
    //    48), and the capsule buried outright, which owned nothing (PH-60).
    this.voxelPushM = 0;
    this.ejectM = 0;
    let pushUpM = 0;
    if (this.oracle.editsHandle !== 0) {
      // `buried AND nothing is holding me up`. A deck built inside a hillside
      // is a legal floor, so the rescue must not undo the tick of a player
      // standing on one. `grounded` is this tick's own snap answer.
      const e = escapeRock(this.col, this.oracle, p, r, qx, qy, qz,
        dxn, dyn, dzn, this.buried && !this.grounded);
      qx = e.x; qy = e.y; qz = e.z;
      qr = Math.hypot(qx, qy, qz) || 1;
      dxn = qx / qr; dyn = qy / qr; dzn = qz / qr;
      this.voxelPushM = e.pushM; pushUpM = e.pushUpM; this.ejectM = e.ejectM;
      if (e.grounded) { if (vUp < 0) vUp = 0; this.grounded = true; }
      // A refused tick must lose the velocity that was driving into the rock,
      // or the refusal fires again every tick and the walker grinds.
      if (e.refused) { tx = 0; ty = 0; tz = 0; vUp = 0; this.blockedByRock = true; }
    }

    // 3. Slope: stand or slide. Both halves live in HeightfieldWalk.ts (WG-41).
    ux = qx / qr; uy = qy / qr; uz = qz / qr;
    const sl = slopeGate(this.oracle, tx, ty, tz, ux, uy, uz, surfaceR, qr,
      CAPSULE.slopeLimitCos, this.grounded, this.underRock, this.onDeck);
    this.slopeCos = sl.cos;
    this.oracleCalls += sl.calls;
    if (sl.cut > 0) { tx -= ux * sl.cut; ty -= uy * sl.cut; tz -= uz * sl.cut; }

    p.x = qx; p.y = qy; p.z = qz;
    // Re-project the tangential velocity onto the NEW tangent plane, or walking
    // round a 600 km sphere slowly accumulates a radial component.
    const tDotU = tx * ux + ty * uy + tz * uz;
    tx -= ux * tDotU; ty -= uy * tDotU; tz -= uz * tDotU;
    v.x = tx + ux * vUp; v.y = ty + uy * vUp; v.z = tz + uz * vUp;
    this.speedMps = Math.hypot(tx, ty, tz);
    // The collider does most of the oracle work now; fold it in or the tick
    // budget this reports is only the half of it that stayed here.
    this.oracleCalls += this.col.calls;
    if (this.trace !== null) {
      this.trace.push({
        tick: this.trace.total, feetR: qr, terrainR, deckR: deckRaw, groundR,
        fallM: askedR - r, onDeck: this.onDeck, grounded: this.grounded,
        blockedByBuild: this.blockedByBuild,
        underRock: this.underRock, preSnapR, pushM: this.voxelPushM, pushUpM,
        buried: this.buried, ejectM: this.ejectM,
      });
    }
  }

  /** Eye position for a given feet position. */
  eye(out: Vec3d): Vec3d {
    const p = this.feet;
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const k = (r + CAPSULE.eyeHeightM) / r;
    out.x = p.x * k; out.y = p.y * k; out.z = p.z * k;
    return out;
  }
}
