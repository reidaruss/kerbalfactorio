// The shapes the assembly panel consumes, lifted out of `VabPanel.ts` so that
// file stays a controller and stays under the 400-line cap. DW-2 holds: plain
// data in, callbacks out, and nothing here knows about three.js or the model.
/** One row of the part catalogue. `index` is the catalogue index and the only
 *  identity this panel knows; every callback hands it straight back. */
export interface VabPartRow {
  index: number;
  name: string;
  /** 'Command' | 'Fuel' | 'Engines' | 'Coupling' | 'Aero' | 'Control' |
   *  'Power' | 'Utility'. Unknown groups sort to the end rather than vanish. */
  group: string;
  /** 'S' (1.25 m) | 'L' (2.50 m) | 'radial'. */
  cls: string;
  /** Preformatted, e.g. '8 Iron + 2 Copper', or 'free' in sandbox. */
  cost: string;
  /** False renders greyed and marks the cost as a problem, but the row STAYS
   *  clickable: the caller owns the refusal and reports it through `message`. */
  affordable: boolean;
  selected: boolean;
  /** Preformatted, e.g. '1.25 x 2.50 m, 800 kg' or '200 kN vac, Isp 264/330 s'. */
  detail: string;
}

export interface VabStageRow {
  index: number; deltaV: number; twr: number; burnS: number;
  thrustKN: number; engines: number; decouplers: number; partCount: number;
  /** GP-118: the stage that actually lifts the vehicle off the pad. Its TWR is
   *  the one number that decides whether this design can launch at all, so it is
   *  drawn differently from the five stages that merely have a TWR. */
  lifts: boolean;
  /** GP-118: this stage carries a named fault. Drawn as a fault, not a figure. */
  fault: boolean;
}

/** GP-118. The pre-flight verdict, already reduced to text by `VabCheck.ts`.
 *  The panel renders it and holds no opinion of its own about flyability. */
export interface VabVerdict {
  ok: boolean;
  faults: readonly { code: string; text: string }[];
  warnings: readonly { code: string; text: string }[];
  liftBurn: number;
  liftTwr: number;
  summary: string;
}

export interface VabStats {
  totalDeltaV: number; massKg: number; dryKg: number; propellantKg: number;
  parts: number; lengthM: number; padTwr: number; staticMarginM: number;
  stable: boolean; crew: number;
}

export interface VabPanelHooks {
  pick(index: number): void;
  stageUp(index: number): void;
  stageDown(index: number): void;
  autostage(): void;
  clear(): void;
  save(name: string): void;
  load(name: string): void;
  remove(name: string): void;
  symmetry(n: number): void;
  /** GP-54. Leave the bay and put the rocket on the ground in front of you.
   *  The same thing the launch key does, because a key nobody can see is not a
   *  way in: Reid built a rocket and had to ask how to fly it. */
  rollOut(): void;
  /** GP-121 / R11. Clear the pad from inside the bay. */
  recover(): void;
  exit(): void;
}

