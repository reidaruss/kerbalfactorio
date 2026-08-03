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
  bestIndex, departureCurve, planTransfer, scheduleFor,
} from '../game/Autopilot.js';
import type { Curve, Schedule, TransferPlan } from '../game/Autopilot.js';
import {
  bodySource, collect, findTarget, registrySource, requestedOrbit,
} from '../game/AutopilotTargets.js';
import type { AutopilotTarget, HomeBody } from '../game/AutopilotTargets.js';
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

  constructor(private readonly p: PlannerPorts) {}

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
    const t = this.target();
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
    };
  }
}
