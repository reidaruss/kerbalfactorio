// =============================================================================
// MapTypes.ts - the data a map view is handed. Plain data, no three.js.
//
// The map DRAWS; it does not compute. Every number below came out of /core
// through ManeuverAbi (conic polylines, apsides, the orbit pole, the node
// plan). Nothing in src/ui/ re-derives a trajectory: check-limits.mjs enforces
// the no-three.js half of that mechanically, and standing rule 1 is the rest.
//
// THE PROJECTION. The map is an ORTHOGRAPHIC view looking down the orbit
// normal, which is exact rather than a simplification: patched conics (D-002)
// put the whole trajectory in one plane, and a sphere projects to a circle, so
// nothing about the body or the current orbit is distorted. A trajectory in a
// DIFFERENT plane (what a normal burn produces) is genuinely foreshortened,
// and the view says so with a number rather than pretending otherwise.
//
// `planeU` / `planeV` are the two in-plane world axes the projection uses.
// They are the VIEW's choice and are deliberately not published by /core:
// keeping "which way is right on screen" stable frame to frame is a
// presentation problem, and the orbit pole it is built from is /core's.
// =============================================================================

export type V3 = readonly [number, number, number];

/** One drawable trajectory. */
export interface MapConic {
  /** Flat [x,y,z, x,y,z, ...] in body-centred inertial metres, in order.
   *  Empty means there is nothing to draw, which is a real state (a vessel on
   *  the pad has a degenerate conic) and not an error. */
  readonly points: Float64Array;
  readonly bound: boolean;
  readonly periodS: number;
  readonly eccentricity: number;
  readonly apoapsis: V3;
  readonly periapsis: V3;
  /** NOT FINITE when `bound` is false: an unbound trajectory has no apoapsis
   *  and /core reports 1e308 there, which is flight.h's own convention rather
   *  than a sentinel invented here. `NavballReadout.apoapsisM` says the same.
   *  The PERIAPSIS is real either way, and is drawn either way. */
  readonly apoapsisAltM: number;
  readonly periapsisAltM: number;
  /** Seconds, or -1 when there is no such time. */
  readonly timeToApoapsisS: number;
  readonly timeToPeriapsisS: number;
}

/** Everything the canvas needs for one frame. */
export interface MapScene {
  readonly bodyRadiusM: number;
  /** Where drag stops mattering (atmosphere.h's ceiling, PH-11). Drawn because
   *  "is my periapsis inside the air" is the question a player is asking. */
  readonly atmosphereCeilingM: number;
  readonly planeU: V3;
  readonly planeV: V3;
  readonly shipPos: V3;
  readonly current: MapConic;
  /** The trajectory the node would produce, or null when there is no node. */
  readonly planned: MapConic | null;
  readonly nodePos: V3 | null;
  /** Metres across the SHORT screen axis. The view owns this, not the sim. */
  readonly spanM: number;
}

/**
 * What a node PUBLISHES. Plain numbers, straight out of /core's Plan through
 * ManeuverAbi, restated here so `src/ui/` depends on no simulation module.
 *
 * These five are the contract Reid asked for, in his words: "how much delta v /
 * what direction / when to burn to reach a certain trajectory", plus the burn's
 * LENGTH, which is the one that tells a player to start EARLY rather than at
 * the node. The flight lane measured what happens without it: a circularisation
 * burn started AT apoapsis instead of led by half caps the vehicle at 121 x 33 km.
 */
export interface MapNodeReadout {
  progradeMS: number;
  normalMS: number;
  radialMS: number;
  deltaVMS: number;
  timeToNodeS: number;
  /** Negative means the burn should already have started. */
  timeToBurnStartS: number;
  burnDurationS: number;
  deltaVAvailableMS: number;
  shortfallMS: number;
  feasible: boolean;
  stagesUsed: number;
  burnFractionOfPeriod: number;
  apoapsisAltM: number;
  periapsisAltM: number;
  eccentricity: number;
  periodS: number;
  boundAfter: boolean;
  /** True while SAS is pointed at this node's burn direction. */
  holding: boolean;
}

/** One frame of everything the panel shows. */
export interface MapReadout {
  scene: MapScene;
  node: MapNodeReadout | null;
  /** FlightSession.status: CLAMPED / ASCENT / COAST / ORBIT / DOWN. */
  status: string;
  sas: string;
  /** Mission elapsed seconds, or -1 on the pad. */
  metS: number;
  altitudeM: number;
  speedMS: number;
  deltaVRemainingMS: number;
  /** True when nothing flight.h models is acting, so the conic is EXACT rather
   *  than a prediction. `of_fl_on_rails_eligible`, not a threshold re-guessed
   *  in the client. */
  onRails: boolean;
  /** FlightMode / FlightSession's message line, drawn here too so that a key
   *  pressed while the map is up has somewhere to answer. */
  message: string;
}

/** What the painter says it actually drew. Not a second opinion: these are the
 *  counts taken inside the paint pass, so a map that is present but never fed
 *  is distinguishable from a live one (the navball lane's lesson). */
export interface MapDrawReport {
  currentPoints: number;
  plannedPoints: number;
  markers: string[];
  pixelsPerMetre: number;
}
