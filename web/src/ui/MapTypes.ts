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
//
// THE CENTRE IS A PARAMETER (DW-36, physics R17). It used to be the body, by
// assumption rather than by decision: `toPx` projected absolute body-centred
// metres and `paintBody` stamped its arc at the canvas middle, so the two agreed
// only because both meant "the planet is the origin". `centreM` names the origin
// instead, the body is drawn wherever it projects to, and FOCUS SWITCHING is
// then not a feature at all — it is which number is written into this field.
//
// ONE MAP, AND WHAT IS DRAWN IS A FUNCTION OF SCALE. DW-36's reasoning is the
// engine's own premise applied to its map: this project's claim is surface to
// orbit with no loading screen, so a map that hard-cut from a local view into a
// separate orbital mode would contradict in the interface the thing the engine
// spent a year making true. There is therefore NO zoom threshold anywhere in
// this family of files. A layer is not switched on at a span; a FEATURE becomes
// legible as its own size in pixels grows, through the one ramp in MapPaint's
// `sizeAlpha`. An ore patch is 9 m across and fades in when 9 m is a few pixels;
// a survey cell is 9.4 km and fades in when 9.4 km is. Continuity is therefore a
// property of the code rather than a claim about it, and `MapDrawReport.alphas`
// publishes what was actually painted so a probe can sweep the zoom and check.
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

/** One ore body on the map: Factorio's model, which is what Reid asked for.
 *  `remaining` is `/core`'s own `OrePatch::RemainingAmount` carried across
 *  unrounded; the panel formats it, nothing re-derives it. */
export interface MapOre {
  /** Body-frame metres, on the snapped surface. */
  readonly centre: V3;
  /** Nominal patch radius. The lobe modulates it; the map draws the nominal
   *  circle, because at any zoom where the map is useful a 9 m patch is a few
   *  pixels and the lobe is invisible. */
  readonly radiusM: number;
  readonly remaining: number;
  readonly initial: number;
  /** Peak richness in (0,1]. Tints the marker, so a rich patch reads richer. */
  readonly grade: number;
  /** The gameplay ItemId, opaque here, and its display name. World-gen never
   *  interprets the id (WG-11); the port that fills this in supplies the name. */
  readonly resource: number;
  readonly name: string;
}

/**
 * A buffer of SURFACE CELLS to paint, ready to project. `corners` is flat
 * [x,y,z]*4 per cell in body-frame UNIT directions; the painter scales by the
 * body radius. Four corners rather than a centre and a size because the
 * projection is orthographic and a cell near the limb foreshortens to a sliver,
 * so a stamped square would paint one cell's ground over its neighbour's.
 *
 * NAMED FOR THE SHAPE, NOT FOR DISCOVERY, deliberately. `discovery.h`'s grid is
 * the same raw-gnomonic cube lattice as `enemies.h`'s `PollutionField` (that
 * agreement is asserted cell-for-cell in `discovery_tests`), so the pollution
 * overlay the enemies branch already publishes `pollution_cells` for is this
 * exact buffer with a different producer and a different fill: window the cells,
 * hand them over as corners, take an alpha from `sizeAlpha` on `cellSizeM`, and
 * `MapLayers.strokeDiscovered`'s projection, back-face cull and clip apply
 * unchanged. It is an added producer and a second fill style, not a new layer
 * type and not a rewrite. Left as a seam rather than built, because the enemies
 * branch is unmerged and a consumer for an unlanded export is speculation.
 */
export interface MapDiscovered {
  readonly corners: Float64Array;
  readonly count: number;
  /** The window hit its row cap and some discovered ground is NOT in this
   *  buffer. Surfaced rather than swallowed (DW-28): a layer that silently drops
   *  work when full cannot be found by looking at the thing it degrades. */
  readonly truncated: boolean;
  /** Metres across one cell, for the legibility ramp. */
  readonly cellSizeM: number;
}

/** Everything the canvas needs for one frame. */
export interface MapScene {
  readonly bodyRadiusM: number;
  /** Where drag stops mattering (atmosphere.h's ceiling, PH-11). Drawn because
   *  "is my periapsis inside the air" is the question a player is asking. */
  readonly atmosphereCeilingM: number;
  readonly planeU: V3;
  readonly planeV: V3;
  /** THE PROJECTION ORIGIN, body-centred inertial metres. Every drawn thing is
   *  measured from here. [0,0,0] is the old body-centred behaviour exactly. */
  readonly centreM: V3;
  /** What the centre is following, for the readout: 'you', a vessel's name, or
   *  the body's. The map says what it is looking at rather than leaving the
   *  player to infer it from the picture. */
  readonly focusName: string;
  /** WHICH WAY THE PROJECTION LOOKS, in words, because the axis rides on the
   *  focus now and the footer used to state one answer for every case. Centred
   *  on a vessel it is that vessel's orbit normal and the conic is EXACT;
   *  centred on you it is your own radial, a plan view of the ground, and a
   *  conic drawn on it is genuinely foreshortened. This header's whole opening
   *  argument is that the view says so rather than pretending otherwise, and a
   *  hard-coded footer saying "down the orbit normal" over a plan view is
   *  exactly the pretending. Caught by looking at the picture, which is DW-7's
   *  lesson: structural validation cannot replace looking at the thing. */
  readonly axisName: string;
  readonly shipPos: V3 | null;
  /** Where the player is standing, or null when they are not on the surface. */
  readonly playerPos: V3 | null;
  readonly current: MapConic | null;
  /** The trajectory the node would produce, or null when there is no node. */
  readonly planned: MapConic | null;
  readonly nodePos: V3 | null;
  /** Metres across the SHORT screen axis. The view owns this, not the sim. */
  readonly spanM: number;
  /** The discovered world, or null when there is nothing to shade. */
  readonly discovered: MapDiscovered | null;
  /** Ore bodies to draw. ALREADY GATED by discovery upstream: an undiscovered
   *  patch is absent from this array rather than present-and-hidden, so there is
   *  no way for a drawing bug to leak one. */
  readonly ore: readonly MapOre[];
  /** True when the MODE says the whole world is visible (DW-31, asked of
   *  `ModeRules`, never of a raw sandbox boolean). Drawn as a badge, because a
   *  player who forgot they were in sandbox is the failure being guarded
   *  against; it does NOT gate anything here. The gating happened upstream. */
  readonly revealAll: boolean;
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

/** How much of the world has been seen. Two layers because DW-36's rule reads
 *  at two resolutions: height buys EXTENT and costs RESOLUTION, so orbit fills
 *  in the shape of the world and walking fills in its detail. */
export interface MapDiscoveryReadout {
  /** Cells held, and the fraction of the whole body they are. */
  surveyCells: number;
  exploreCells: number;
  surveyFraction: number;
  exploreFraction: number;
  /** The ground chord the last observation swept, per layer. */
  lastSurveyRadiusM: number;
  lastExploreRadiusM: number;
  cellSizeM: number;
  /** The mode's answer, asked once and carried, so the panel and the painter
   *  cannot disagree about it. */
  revealAll: boolean;
}

/** One frame of everything the panel shows. */
export interface MapReadout {
  scene: MapScene;
  node: MapNodeReadout | null;
  /** FlightSession.status: CLAMPED / ASCENT / COAST / ORBIT / DOWN, or ON FOOT
   *  when the map is open and the player is walking. The map is no longer the
   *  flight map (DW-36): M opens it wherever you are. */
  status: string;
  sas: string;
  /** Mission elapsed seconds, or -1 on the pad. */
  metS: number;
  altitudeM: number;
  speedMS: number;
  deltaVRemainingMS: number;
  /** Null only before the first observation has been taken. */
  discovery: MapDiscoveryReadout | null;
  /** What the view is centred on, and what it COULD be centred on, so the panel
   *  can offer the switch. Focus switching and re-centring are one mechanism. */
  focusName: string;
  focusOptions: readonly string[];
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
  /** The opacity each scale-dependent layer was painted at, THIS frame. The
   *  zoom continuum is proven off these rather than off the code: sweep the
   *  span and every one of them must move smoothly and monotonically. A `if
   *  (span > X) return` anywhere would show up here as a 1 -> 0 step. */
  alphas: { ore: number; discovered: number; body: number };
  /** Cells and patches that reached the canvas, counted in the paint pass. */
  discoveredQuads: number;
  oreDrawn: number;
  /** The RAW numbers each drawn ore marker carried, in paint order, so a probe
   *  compares integers against /core's `OrePatch::RemainingAmount` field by
   *  field (the way the power panel was proven) instead of parsing "2.4k" back
   *  into a number. `oreDrawn` is this array's length by construction. */
  oreDrawnRows: { resource: number; remaining: number; initial: number }[];
  /** True when the body's disc provably covers every canvas corner, so it was
   *  filled rather than stroked as an arc. Not a mode: the two paths produce the
   *  same pixels by construction, and `MapPaint.bodyCovers` is the proof. */
  bodyFilled: boolean;
}
