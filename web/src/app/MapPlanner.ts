// =============================================================================
// MapPlanner.ts - the map's autopilot planner: pick a target, see the cost
// against DEPARTURE TIME, and schedule the one you can actually fly.
//
// GP-271. Reid's asks 3, 4 and 5, from the chair: "open a menu from the map
// where you can either select targets from a list or click on targets from the
// map and a rendezvous planned path should show up. A chart should also show up
// showing how optimal the current time would be to launch vs waiting later in
// terms of fuel burn."
//
// THIS FILE HOLDS STATE AND ASKS QUESTIONS. It computes nothing: the cost curve
// is `of_ap_departure_curve`, the burn is `of_ap_plan`, and the drawn arc is
// `of_mn_path` fed with `of_ap_plan`'s own post-burn state. Three calls, no
// arithmetic, which is why the map's transfer arc and its manual-node arc
// cannot disagree about what a planned orbit looks like.
//
// THE TARGET LIST IS THE BAY'S LIST. `AutopilotTargets` sources are shared with
// `VabDest`, so the rows a player saw before launch are the rows they see in
// flight, in the same order, with the same ids. A body arriving later changes
// neither screen.
//
// WHY THE CURVE IS RECOMPUTED ON A LATCH AND NOT EVERY FRAME. A curve is
// `samples` Lambert solves; at 64 samples and 60 fps that is 3,840 transfer
// solves a second to redraw a picture that changes on the scale of minutes. It
// is rebuilt when the target, the window or the vessel's own state changes
// enough to matter, and `curveAgeS` is published so a probe can prove the latch
// is a latch rather than a frame counter.
// =============================================================================
import {
  bestIndex, bodyDepartureCurve, bodyReach, departureCurve, legSumErrorMS,
  planTransfer, scheduleFor,
} from '../game/Autopilot.js';
import type { Curve, Schedule, TransferPlan } from '../game/Autopilot.js';
import {
  armFor, burnProgress01, cancelRun, dvLeftInProgramMS, idleStatus,
  phaseWord, runNote, runStatus, waitingToDepart,
} from '../game/AutopilotRun.js';
import type { ArmResult, CancelResult, RunStatus } from '../game/AutopilotRun.js';
import {
  bodySource, collect, findTarget, registrySource, requestedOrbit,
} from '../game/AutopilotTargets.js';
import type { AutopilotTarget, HomeBody } from '../game/AutopilotTargets.js';
import { registry, stateOf } from '../sim/VesselRegistry.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** How far ahead the chart looks, and how finely. One orbit of the target is
 *  the interesting scale for a rendezvous, so the default window is generous
 *  enough to contain a phase cycle without being so long that the dip the
 *  player is looking for is one pixel wide. */
export const CURVE_WINDOW_S = 3 * 3600;
export const CURVE_SAMPLES = 64;
/** Rebuild the curve at most this often. See the header. */
const CURVE_MAX_AGE_S = 5;

export interface PlannerPorts {
  M: OfCoreModule;
  /** The live flight handle, or 0 when the player is not flying. */
  flightHandle(): number;
  home(): HomeBody;
  /** The registry id of the vessel being flown, excluded from its own list. */
  flyingId(): number;
  /** Seconds, the map's own clock, for the curve latch. */
  nowS(): number;
  /** GP-273. The flown vessel's inertial position and velocity, body-centred,
   *  as /core published them this frame. Used ONLY for the range and closing
   *  rate to the target, which is a subtraction of two states /core produced
   *  and not a second physics: see AutopilotRun.ts's named ask. */
  shipState(): { pos: readonly number[]; vel: readonly number[] } | null;
  /** The registry's clock, for `stateOf`. */
  tick(): number;
}

export class MapPlanner {
  /** '' is "nothing picked", a real state and not a default. */
  selectedId = '';
  /** Which sample of the curve the player has chosen to depart at. */
  chosen = 0;
  altKm = 100;
  incDeg = 0;
  /** True while the planner block is expanded. The map is useful without it. */
  open = false;

  private curve: Curve = { waitingOn: '', samples: [] };
  private plan: TransferPlan | null = null;
  private builtAtS = -1e9;
  private builtKey = '';
  /** Counted so a probe can prove the latch holds rather than trusting it. */
  curveBuilds = 0;
  private planKey = '';
  /** The cheaper of the two rebuilds: one Lambert solve, once per press. */
  planBuilds = 0;

  // --- GP-273: the EXECUTION half -------------------------------------------
  /** The executor's own 18 words, re-read every frame. THE CLIENT KEEPS NO
   *  SHADOW OF THIS. There is no `armed` boolean here, no phase mirror and no
   *  progress counter, because every one of them would be a second place a
   *  fact is true (DW-26) and would go stale the instant the executor aborted
   *  on its own, which it does: it refuses a burn it cannot pay for. */
  private run: RunStatus = idleStatus();
  /** Physics' own sentence, printed verbatim and never parsed. */
  private note = '';
  /** What the LAST arm press answered. Kept only so a refusal stays on screen
   *  after the press, since a refused program is erased from the executor by
   *  the next successful arm and the player would otherwise see the refusal
   *  flash for one frame. */
  lastArm: ArmResult | null = null;
  lastCancel: CancelResult | null = null;
  /** Counted so a probe can prove the press reached the verb. */
  armPresses = 0;
  /** GP-295. The moon's reach row for the chosen departure, or null. */
  bodyRow: import('../game/Autopilot.js').Reach | null = null;
  /** GP-280. WHAT THE CHART SAID THIS TRIP COST, at the instant the button was
   *  pressed. Kept so the panel can show it BESIDE the executor's own
   *  programme cost rather than choosing between them. The two are different
   *  quantities (the chart prices the mission including the policy reserve;
   *  the programme is the burns) and they are both true, so a screen that drew
   *  one and called it "the cost" would be picking. Physics found a 232 m/s
   *  disagreement between a planned capture and the burn actually flown by
   *  keeping exactly this kind of pair visible instead of reconciling it. */
  armedQuoteMS = NaN;
  /** GP-351. HOW LONG THE CHART SAID THE TRIP WOULD TAKE, latched at the same
   *  instant and for the same reason as `armedQuoteMS`. The executor's 18 words
   *  carry a countdown to the NEXT ignition and nothing about the voyage, so
   *  once a programme is armed this is the only place the scale of it exists.
   *  Kept as a DURATION rather than as an arrival clock, because a clock would
   *  need this client to run a second timer beside the sim's and the two would
   *  drift under warp; a duration is a fact about the plan and cannot. */
  armedTripS = NaN;

  constructor(private readonly p: PlannerPorts) {}

  get currentRun(): RunStatus { return this.run; }
  get currentNote(): string { return this.note; }

  /**
   * ARM THE CHOSEN DEPARTURE. Returns the executor's answer, refusal included.
   *
   * THE GATE IS NOT REPEATED HERE. `scheduleFor` already decides whether this
   * departure is affordable and the button is disabled when it is not (GP-271);
   * the executor decides again, on its own numbers, and if the two ever
   * disagree the executor wins and its sentence is what the player reads. Two
   * gates is not duplication when the second one is the authority and the first
   * one exists to keep the player away from it.
   */
  arm(): ArmResult {
    this.armPresses += 1;
    const t = this.target();
    const f = this.p.flightHandle();
    const s = this.curve.samples[this.chosen];
    const r = t === null
      ? { armed: false, waitingOn: '', note: 'no destination is selected.',
          via: 'none' as const }
      : armFor(this.p.M, f, t, s?.tS ?? 0);
    this.lastArm = r;
    this.armedQuoteMS = s === undefined ? NaN : s.dvRequiredMS;
    this.armedTripS = s === undefined || !Number.isFinite(s.dvRequiredMS)
      ? NaN : s.arrivalFromNowS - s.tS;
    this.refreshRun();
    return r;
  }

  /** Cancel, mid-burn included. The residual is sampled BEFORE the call,
   *  because afterwards there is no row left to read it from. */
  cancel(): CancelResult {
    const c = cancelRun(this.p.M, this.p.flightHandle());
    this.lastCancel = c;
    this.lastArm = null;
    this.refreshRun();
    return c;
  }

  /** JUST THE EXECUTOR, for the frames the map is shut. One wasm call and a
   *  scratch read; the curve and the Lambert solve stay behind the open gate. */
  frameRun(): void { this.refreshRun(); }

  /**
   * GP-281. HOW MANY CONSECUTIVE FRAMES THE BURN HAS SPENT NOTHING.
   *
   * Found by driving: the executor commanded full throttle in `Phase::Burn`
   * for 900 consecutive polls having spent 0.0000 of a planned 144.9070 m/s,
   * with the orbit unmoved, because the vehicle's next engine had never been
   * STAGED and the executor has no verb for that. A burn is terminated on
   * measured delta-v, so a burn producing no thrust never terminates and the
   * program hangs for ever with every field reading healthy.
   *
   * This client cannot and must not fix that: staging is the vehicle's and the
   * abort is the executor's. What it CAN do is notice, which is a statement
   * about a published number failing to move and not a second physics.
   */
  private stallFrames = 0;

  private refreshRun(): void {
    const f = this.p.flightHandle();
    const prev = this.run;
    this.run = runStatus(this.p.M, f);
    this.note = this.run.answered ? runNote(this.p.M, f) : '';
    this.stallFrames = this.run.burningNow
      && this.run.dvThisBurnMS === prev.dvThisBurnMS
      && this.run.burnIndex === prev.burnIndex
      ? this.stallFrames + 1 : 0;
  }

  /** True once a commanded burn has produced nothing for long enough that it
   *  cannot be a rounding artefact. Two seconds at 60 Hz. */
  get burnStalled(): boolean { return this.stallFrames > 120; }

  /**
   * RANGE AND CLOSING RATE TO THE SELECTED TARGET.
   *
   * The two numbers that say whether a rendezvous WORKED, and the two the 18
   * status words do not carry (AutopilotRun.ts's named ask). Computed as a
   * SUBTRACTION of two states /core itself produced: the flight state off
   * `of_fl_state`, the target off the registry's own `of_orb_resume`. Nothing
   * is propagated, fitted or integrated here.
   *
   * Null when there is no phased target, which is the honest answer for a
   * requested orbit: a ring has no position to be a distance from.
   */
  closing(): { rangeM: number; closingMS: number } | null {
    const t = this.target();
    if (t === null || t.kind !== 'vessel') return null;
    const rec = registry.list().find((r) => `v:${r.id}` === t.id);
    const me = this.p.shipState();
    if (rec === undefined || me === null) return null;
    const them = stateOf(this.p.M, registry, rec, this.p.tick());
    const dx = (them.pos[0] ?? 0) - (me.pos[0] ?? 0);
    const dy = (them.pos[1] ?? 0) - (me.pos[1] ?? 0);
    const dz = (them.pos[2] ?? 0) - (me.pos[2] ?? 0);
    const rangeM = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const vx = (them.vel[0] ?? 0) - (me.vel[0] ?? 0);
    const vy = (them.vel[1] ?? 0) - (me.vel[1] ?? 0);
    const vz = (them.vel[2] ?? 0) - (me.vel[2] ?? 0);
    // POSITIVE IS CLOSING. The sign is the whole information: 100 m out at
    // +0.2 m/s is arriving and 100 m out at -0.2 m/s is drifting away while the
    // program believes it is finished, and a screen that drew the magnitude
    // would call both of those a success.
    const closingMS = rangeM > 0
      ? -((dx * vx + dy * vy + dz * vz) / rangeM) : 0;
    return { rangeM, closingMS };
  }

  rows(): AutopilotTarget[] {
    const h = this.p.home();
    const out = collect([registrySource(h, this.p.flyingId()), bodySource()]);
    out.push(requestedOrbit(h, this.altKm * 1000, this.incDeg));
    return out;
  }

  target(): AutopilotTarget | null {
    return findTarget(this.rows(), this.selectedId);
  }

  select(id: string): void {
    this.selectedId = this.selectedId === id ? '' : id;
    this.chosen = 0;
    this.invalidate();
  }

  /** GP-271. Click-to-select on the 3D map. The picker hands back a REGISTRY
   *  id (GP-211's raycast), and the planner turns it into a target row id, so
   *  clicking a marker and clicking its row are the same act. */
  selectVesselId(recordId: number): void {
    if (recordId <= 0) return;
    const id = `v:${recordId}`;
    if (findTarget(this.rows(), id) === null) return;
    this.selectedId = id;
    this.chosen = 0;
    this.invalidate();
  }

  setOrbit(altKm: number, incDeg: number): void {
    this.altKm = altKm;
    this.incDeg = incDeg;
    this.invalidate();
  }

  /** Move the chosen departure along the curve. Clamped, never wrapped: a
   *  player nudging past the end must stop at the end rather than jump to now. */
  nudge(delta: number): void {
    const n = this.curve.samples.length;
    if (n === 0) return;
    this.chosen = Math.max(0, Math.min(n - 1, this.chosen + delta));
  }

  /** Jump to the cheapest departure. The one-press version of reading the
   *  chart, and it is a DIFFERENT button from "the earliest I can fly". */
  pickCheapest(): void {
    const b = bestIndex(this.curve);
    if (b >= 0) this.chosen = b;
  }

  pickEarliestFlyable(): void {
    const e = this.schedule().earliest;
    if (e >= 0) this.chosen = e;
  }

  invalidate(): void { this.builtAtS = -1e9; this.builtKey = ''; }

  schedule(): Schedule { return scheduleFor(this.curve, this.chosen); }

  /** Rebuild the curve and the plan if the latch says it is time. Called once
   *  per frame while the map is open; cheap when nothing moved. */
  frame(): void {
    const f = this.p.flightHandle();
    // FIRST, AND OUTSIDE EVERY EARLY RETURN BELOW. A program keeps flying
    // whether or not a destination is still selected, and the executor can
    // abort on its own between two frames, so the status read may not be
    // conditional on anything this panel happens to have chosen.
    this.refreshRun();
    const t = this.target();
    // GP-295, R74. A WORLD HAS A CHART NOW, and it comes from its own export
    // because a body cannot be described in nine orbit words. Same latch, same
    // key, same sample count: the only thing that differs is which export is
    // asked, so every consumer below (the schedule, the drawn SVG, the arm
    // gate) is unchanged.
    if (f > 0 && t !== null && t.body !== null) {
      const now = this.p.nowS();
      const key = `${this.selectedId}|${f}|body`;
      if (key !== this.builtKey || now - this.builtAtS >= CURVE_MAX_AGE_S) {
        this.builtKey = key;
        this.builtAtS = now;
        this.curveBuilds += 1;
        this.curve = bodyDepartureCurve(this.p.M, f, 0, CURVE_WINDOW_S,
                                        CURVE_SAMPLES, t.body.bodyId,
                                        t.body.captureAltitudeM);
        if (this.chosen >= this.curve.samples.length) this.chosen = 0;
      }
      // The reach row for the CHOSEN departure, so the panel can show the legs
      // and so `legSumErrorMS` can be asserted on the client side too.
      const s2 = this.curve.samples[this.chosen];
      this.bodyRow = s2 === undefined ? null
        : bodyReach(this.p.M, f, s2.tS, t.body.bodyId, t.body.captureAltitudeM);
      this.plan = null;
      return;
    }
    this.bodyRow = null;
    if (f <= 0 || t === null || t.orbit === null) {
      this.curve = { waitingOn: this.curve.waitingOn, samples: [] };
      this.plan = null;
      return;
    }
    const now = this.p.nowS();
    // TWO LATCHES, BECAUSE THE TWO THINGS DEPEND ON DIFFERENT INPUTS.
    //
    // The CURVE is a function of the target and the vessel; the PLAN is a
    // function of those AND of which departure is chosen. The first version
    // keyed both on the target alone, so pressing 'later' moved the chart
    // marker and the verdict while the drawn transfer arc went on describing
    // the departure before it (the probe caught it as plannedPoints 0). Folding
    // `chosen` into the one key fixed that and made every press re-solve all 64
    // samples to redraw a curve that had not changed. Splitting them costs ONE
    // Lambert solve per press, which is what a press should cost.
    const curveKey = `${this.selectedId}|${f}|${this.altKm}|${this.incDeg}`;
    if (curveKey !== this.builtKey || now - this.builtAtS >= CURVE_MAX_AGE_S) {
      this.builtKey = curveKey;
      this.builtAtS = now;
      this.curveBuilds += 1;
      this.curve = departureCurve(this.p.M, f, 0, CURVE_WINDOW_S, CURVE_SAMPLES,
                                  t.orbit);
      if (this.chosen >= this.curve.samples.length) this.chosen = 0;
      this.planKey = '';
    }
    const planKey = `${curveKey}|${this.chosen}`;
    if (planKey === this.planKey) return;
    this.planKey = planKey;
    this.planBuilds += 1;
    const s = this.curve.samples[this.chosen];
    this.plan = s === undefined ? null
      : planTransfer(this.p.M, f, s.tS, t.orbit);
  }

  get currentCurve(): Curve { return this.curve; }
  get currentPlan(): TransferPlan | null { return this.plan; }

  /** Seconds since the curve was last built, for a probe to assert the latch. */
  curveAgeS(): number { return this.p.nowS() - this.builtAtS; }

  report(): unknown {
    const t = this.target();
    const sch = this.schedule();
    const c = this.curve;
    const finite = c.samples.filter((s) => Number.isFinite(s.dvRequiredMS));
    return {
      open: this.open,
      selectedId: this.selectedId,
      // GP-277. The requested orbit's own two numbers, published so a probe
      // asserts the buttons MOVED them rather than trusting the press.
      altKm: this.altKm,
      incDeg: this.incDeg,
      rowIds: this.rows().map((r) => r.id),
      targetName: t === null ? '' : t.name,
      waitingOn: c.waitingOn,
      samples: c.samples.length,
      // NaN IS A REAL ANSWER HERE and is counted separately: physics publishes
      // NaN for a departure with no solution rather than 0, because a zero
      // would draw as the CHEAPEST point on the chart, which is the exact
      // opposite of the truth.
      solved: finite.length,
      unsolved: c.samples.length - finite.length,
      chosen: this.chosen,
      chosenDvMS: c.samples[this.chosen]?.dvRequiredMS ?? NaN,
      chosenTS: c.samples[this.chosen]?.tS ?? NaN,
      // GP-351. THE TRIP LENGTH, published so a probe asserts the number the
      // screen draws against /core's own word 3 rather than against a second
      // copy of the subtraction.
      chosenArriveTS: c.samples[this.chosen]?.arrivalFromNowS ?? NaN,
      chosenTripS: (c.samples[this.chosen]?.arrivalFromNowS ?? NaN)
        - (c.samples[this.chosen]?.tS ?? NaN),
      verdict: sch.verdict,
      earliest: sch.earliest,
      cheapest: sch.cheapest,
      chosenFeasible: sch.chosenFeasible,
      curveBuilds: this.curveBuilds,
      planBuilds: this.planBuilds,
      // A FLAT curve is the correct answer for a ring: a circular target has no
      // phase, so there is no window and no cheapest moment. Published so the
      // probe can assert that rather than infer it.
      spreadMS: finite.length === 0 ? NaN
        : Math.max(...finite.map((s) => s.dvRequiredMS))
          - Math.min(...finite.map((s) => s.dvRequiredMS)),
      plan: this.plan === null ? null : {
        valid: this.plan.valid, deltaVMS: this.plan.deltaVMS,
        feasible: this.plan.feasible, burnDurationS: this.plan.burnDurationS,
        timeToNodeS: this.plan.timeToNodeS,
        apoapsisAltM: this.plan.apoapsisAltM,
        periapsisAltM: this.plan.periapsisAltM,
      },
      // GP-273. THE EXECUTION HALF, published so a probe asserts the executor's
      // own words and never this panel's reading of them.
      run: {
        answered: this.run.answered,
        waitingOn: this.run.waitingOn,
        armed: this.run.armed,
        running: this.run.running,
        phase: this.run.phase,
        phaseWord: phaseWord(this.run),
        mode: this.run.mode,
        burnIndex: this.run.burnIndex,
        burnCount: this.run.burnCount,
        timeToIgnitionS: this.run.timeToIgnitionS,
        dvSpentTotalMS: this.run.dvSpentTotalMS,
        dvThisBurnMS: this.run.dvThisBurnMS,
        currentBurnDvMS: this.run.currentBurnDvMS,
        programDvMS: this.run.programDvMS,
        dvLeftMS: dvLeftInProgramMS(this.run),
        burnProgress01: burnProgress01(this.run),
        pointingErrorDeg: this.run.pointingErrorDeg,
        rateDegS: this.run.rateDegS,
        burningNow: this.run.burningNow,
        throttleNow: this.run.throttleNow,
        targetRadiusM: this.run.targetRadiusM,
        waitingToDepart: waitingToDepart(this.run),
        note: this.note,
        armPresses: this.armPresses,
        quotedAtArmMS: this.armedQuoteMS,
        quotedTripS: this.armedTripS,
        stalled: this.burnStalled,
        stallFrames: this.stallFrames,
        lastArm: this.lastArm,
        lastCancel: this.lastCancel,
        closing: this.closing(),
        // GP-295. The five legs and whether they ADD UP, published so a probe
        // asserts the sum rather than trusting it: two exports in one commit
        // disagreed by 53.1 m/s about one trip and this is the check that
        // found it.
        bodyLegsMS: this.bodyRow === null ? null : this.bodyRow.legsMS,
        bodyRequiredMS: this.bodyRow === null ? NaN : this.bodyRow.dvRequiredMS,
        bodyLegSumErrMS: this.bodyRow === null ? NaN : legSumErrorMS(this.bodyRow),
        bodyOk: this.bodyRow === null ? null : this.bodyRow.ok,
      },
    };
  }
}
