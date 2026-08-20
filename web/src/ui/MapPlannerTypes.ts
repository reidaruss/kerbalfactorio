// The autopilot-planner half of MapTypes.ts (see that file's header for the
// map's own design rules). Split out at the 400-line cap: this file holds the
// planner block only (GP-271's row/sample/readout), self-contained and
// referenced by MapTypesCore.ts's `MapReadout.planner` field.

/** GP-271. One frame of the autopilot planner, for `plannerBlock`. */
export interface MapPlannerRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly detail: string;
  readonly blocked: string;
}

export interface MapPlannerSample {
  readonly tS: number;
  /** NaN for a departure with no solution. Drawn as a GAP, never as zero. */
  readonly dvMS: number;
  readonly feasible: boolean;
  /** GP-351. WHEN THE TRIP ENDS, seconds from now: `of_ap_departure_curve`'s
   *  own word 3, which this readout dropped on the floor from GP-271 until
   *  tonight. It is the only number in the client that says how long a transfer
   *  takes, and a moon transfer is hours. */
  readonly arriveTS: number;
}

export interface MapPlannerReadout {
  /** '' when the solver is on the bridge, else the exports it waits for. */
  readonly waitingOn: string;
  /** The planner only plans for a vessel you are flying. */
  readonly aboard: boolean;
  readonly rows: readonly MapPlannerRow[];
  readonly selectedId: string;
  /** Non-empty when the selected row cannot be planned for at all. */
  readonly blockedWhy: string;
  /** GP-291. The selected destination is a WORLD. It can be flown and it
   *  cannot yet be priced against departure time, and those are different
   *  facts, so the panel needs to know which row it is drawing. */
  readonly isBody: boolean;
  /** GP-291. The capture orbit a body arm would aim for, metres above the
   *  surface. Drawn so the player knows what they are being taken to. */
  readonly bodyCaptureAltM: number;
  readonly curve: readonly MapPlannerSample[];
  readonly windowS: number;
  readonly chosen: number;
  readonly cheapest: number;
  readonly earliest: number;
  readonly chosenTS: number;
  /** GP-351. Seconds from now that the chosen departure ARRIVES, and how long
   *  it is under way. NaN when the sample has no solution, which is the one
   *  case where "how long" has no answer. */
  readonly chosenArriveTS: number;
  readonly chosenTripS: number;
  readonly chosenDvMS: number;
  readonly chosenFeasible: boolean;
  readonly dvAvailableMS: number;
  readonly verdict: string;
  readonly why: string;
  // --- GP-273: the EXECUTOR. A SEPARATE SEAM from `waitingOn` above, because
  // planning and execution are two export sets and a build can have one and
  // not the other. Every build before tonight was exactly that build.
  readonly runWaitingOn: string;
  /** Something is armed: the status row came back at all. NOT `running`. */
  readonly runArmed: boolean;
  /** Still going. 0 once the program is Done or Aborted, which is why a
   *  refused arm can still be shown rather than forgotten. */
  readonly runRunning: boolean;
  readonly runPhase: number;
  readonly runPhaseWord: string;
  readonly runBurnIndex: number;
  readonly runBurnCount: number;
  /** NEGATIVE means overdue: the vehicle is still slewing. Drawn as such. */
  readonly runTimeToIgnitionS: number;
  /** Spent on the WHOLE programme. */
  readonly runDvSpentMS: number;
  /** Spent on the CURRENT burn, which is a different number from the second
   *  burn onward and was drawn as the total until a screenshot's own figures
   *  were read back against the executor's. */
  readonly runDvThisBurnMS: number;
  readonly runProgramDvMS: number;
  readonly runCurrentBurnDvMS: number;
  readonly runBurnProgress01: number;
  readonly runPointingErrorDeg: number;
  readonly runThrottle: number;
  readonly runWaitingToDepart: boolean;
  /** PHYSICS' OWN SENTENCE, printed verbatim and never parsed. */
  readonly runNote: string;
  /** GP-280. What the departure chart quoted at the moment the button went
   *  down, drawn BESIDE the executor's own programme cost rather than instead
   *  of it. NaN before anything is armed. */
  readonly runQuotedAtArmMS: number;
  /** GP-351. HOW LONG THE CHART SAID THIS TRIP WOULD TAKE, latched at the arm
   *  press beside `runQuotedAtArmMS` and for the same reason (GP-280): the
   *  executor publishes a countdown to the NEXT ignition and has no field for
   *  the whole voyage, so without this the screen can say "light it in 2:16:59"
   *  and never once say the journey is hours long. NaN before anything is
   *  armed. It is labelled as the CHART's number wherever it is drawn, because
   *  it is a plan and the executor's countdown is a measurement. */
  readonly runQuotedTripS: number;
  /** GP-281. A commanded burn that has produced nothing for two seconds. The
   *  vehicle has no lit engine, which the executor cannot see and the player
   *  can fix. */
  readonly runStalled: boolean;
  /** NaN when the target is not an object with a position. */
  readonly runRangeM: number;
  /** Signed: positive is closing. NaN when there is no object target. */
  readonly runClosingMS: number;
  /** GP-277. The requested orbit the player has dialled in, so the four
   *  buttons that move it can draw the value they are moving. */
  readonly orbitAltKm: number;
  readonly orbitIncDeg: number;
  readonly planDeltaVMS: number;
  readonly planBurnS: number;
  readonly planApoapsisAltM: number;
  readonly planPeriapsisAltM: number;
}
