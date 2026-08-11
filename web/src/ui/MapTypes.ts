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
// `sizeAlpha`. An ore patch is 9 m across and fades in when 9 m is a few pixels.
// THE TERRAIN LAYER TAKES THAT RULE TO ITS LIMIT (DW-37): its feature is one
// sample of ground, the grid is cut to the canvas, so a sample's ground size
// scales with the span exactly as pixels-per-metre falls and its size in PIXELS
// is the same at every zoom. Its alpha is therefore invariant rather than
// ramping, which is a stronger form of "no threshold" than a ramp is - there is
// nothing left to step - and the probe asserts exactly that over 220 notches.
// Continuity is a property of the code rather than a claim about it, and
// `MapDrawReport.alphas` publishes what was painted so a probe can sweep and
// check.
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
 * THE GROUND UNDER THE VIEW, sampled on a grid cut to the canvas (DW-37).
 *
 * WHY THIS REPLACED A BUFFER OF DISCOVERY QUADS. WG-29 shaded the map with
 * `of_disc_window`'s discovered CELLS, 9,375 m each, painted as flat quads.
 * Reid, seeing it: "cant see the terrain from the map, even in sandbox." The
 * quads were the right answer to "what have you seen" and no answer at all to
 * "what is there", and since discovery REVEALS terrain, a map with no terrain
 * has nothing to reveal. `/core`'s `of_map_sample` answers both at once: the
 * biome and the designed height say what is there, and a per-sample survey bit
 * says whether you have seen it. That bit is a FINER and simpler mask than a
 * discovery quad, which is why the quad layer is gone rather than layered under
 * this one. `of_disc_window` remains in the ABI; it is simply no longer the
 * map's shading source.
 *
 * Three parallel arrays, row-major, TOP ROW FIRST, `cols * rows` long. The
 * painter needs no knowledge of the bridge's arena layout: `discabi.ts`'s
 * `MapSample` is read once, in `world/MapTerrain.ts`, and nowhere else.
 */
export interface MapTerrainGrid {
  /** /core's `Biome` enum per sample; **-1 means OFF THE LIMB** — the line of
   *  sight misses the body and there is no ground under that sample at all. */
  readonly biome: Int8Array;
  /** `surfaceHeight`, the surface oracle ITSELF, in metres: the designed base
   *  with the player's voxel edits applied. NOT a second terrain, it is the
   *  function the mesh, the collision and the walker all read (standing rule
   *  1). It was the designed BASE for one day, which is the world before the
   *  player touched it, so nothing they built could reach the map (WG-33). */
  readonly heightM: Float64Array;
  /** 1 when this sample's SURVEY cell has been observed. THE GATE. */
  readonly seen: Uint8Array;
  readonly cols: number;
  readonly rows: number;
  /** Ground metres across ONE sample: the terrain layer's FEATURE SIZE, and
   *  what its alpha comes from, exactly as the old quad layer's came from a
   *  cell edge. No layer is switched on at a span (DW-36). */
  readonly sampleSizeM: number;
  /** Samples with ground under them, and how many of those have been seen. */
  readonly onBody: number;
  readonly seenOnBody: number;
  /** The height range over the on-body samples, for the relief ramp. A shading
   *  statistic of THIS view, not a fact about the world. */
  readonly minH: number;
  readonly maxH: number;
  /** Mean |height difference| between horizontally adjacent on-body samples:
   *  the world content at THIS view's resolution (WG-33). */
  readonly stepM: number;
}

/**
 * GP-520. ONE generic map marker, drawn by BOTH maps off ONE registry
 * (game/MarkerRegistry.ts): a source pushes a record in, neither map computes
 * its own. `dirBody` is a unit vector off the body's own centre, placed ON the
 * surface through `MapPaint.markerPosM` exactly as an ore patch's `dir` is
 * (MapWorld.ore) — tonight's only producer is a debug/dev source, so there is
 * no designed height to place it at yet; a real producer may carry one later.
 *
 * `known` GATES DRAWING, and it is the ONLY gate a marker is drawn behind: a
 * known marker draws EVEN WHERE the survey layer under it is undiscovered
 * (see MapLayers.ts's terrain gate, which this deliberately does not share),
 * because a scan revealing a marker on ground nobody has walked is the entire
 * point of a scan.
 */
export interface MapMarker {
  readonly key: string;
  readonly kind: 'ruin' | 'signal' | 'deposit';
  readonly dirBody: V3;
  readonly label: string;
  readonly known: boolean;
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
  /** The ground under this view, or null when there is none to draw. */
  readonly discovered: MapTerrainGrid | null;
  /** Ore bodies to draw. ALREADY GATED by discovery upstream: an undiscovered
   *  patch is absent from this array rather than present-and-hidden, so there is
   *  no way for a drawing bug to leak one. */
  readonly ore: readonly MapOre[];
  /** GP-520. Whatever the registry holds, drawn/gated exactly as documented on
   *  `MapMarker` above. NOT gated here or upstream: `known` is the gate. */
  readonly markers: readonly MapMarker[];
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

/**
 * One vessel of the registry, as the panel shows it (GP-210). LIVE state off
 * the record: a rails record's numbers are frozen BY the physics (on rails,
 * nothing burns and elements do not drift), so the copy is the truth. The one
 * exception is the FLYING vessel, whose record is synced only at save points:
 * its fuel reads NaN here and the flight block carries the live numbers
 * instead, because showing a stale copy of a live thing is the frozen-table
 * defect physics R44b documents.
 */
export interface MapVesselRow {
  readonly id: number;
  readonly name: string;
  /** parked | rails | frozen, or 'flying' for the promoted vessel underway. */
  readonly mode: string;
  /** NaN when this row may not claim a number (the flying vessel). */
  readonly fuelKg: number;
  /**
   * From the record's own elements AND AGAINST THE RECORD'S OWN BODY (GP-650),
   * never the observer's. NaN when the record has none (parked, frozen) or when
   * /core does not know its body.
   */
  readonly apoapsisAltM: number;
  readonly periapsisAltM: number;
  /** /core's `BodyParams::bodyId` for the body the numbers above are measured
   *  against, or -1 when it could not be resolved. */
  readonly bodyId: number;
  /** The body's name when it is NOT the one the map is showing, '' when it is.
   *  Empty is the common case and the panel prints nothing for it: a row that
   *  said "at Forge" on every line while you stand on Forge is noise. */
  readonly bodyName: string;
  readonly selected: boolean;
  readonly promoted: boolean;
}


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
  /** Every vessel the registry holds, one row each (GP-210). */
  vessels: readonly MapVesselRow[];
  /** GP-271. The autopilot planner, or null when it is not built. */
  planner: MapPlannerReadout | null;
  /** True when the picture is the 3D scene; the panel adapts its hint and the
   *  canvas hides (it keeps painting: `of.map('grid')`'s luma contract). */
  three: boolean;
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
  /** TERRAIN SAMPLES and patches that reached the canvas, counted in the paint
   *  pass. `discoveredQuads` keeps its name and its meaning — "how much ground
   *  did this frame actually draw" — while what a unit of ground IS changed
   *  from a 9,375 m discovery quad to one terrain sample (DW-37). */
  discoveredQuads: number;
  /** Samples with ground under them, painted or not. The pair is the negative
   *  control: in survival `discoveredQuads` is strictly less than this wherever
   *  the view is wider than what has been seen, and in sandbox they are equal. */
  terrainSamples: number;
  /** Ground metres across one terrain sample, the feature size `alphas.
   *  discovered` was taken from, so a probe can predict that alpha exactly. */
  sampleSizeM: number;
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
  /** HOW MUCH THE GROUND LAYER ACTUALLY SAYS (WG-33). See TerrainContrast. */
  contrast: TerrainContrast;
  /** GP-520. Each drawn marker's OWN pixel, taken inside the paint pass that
   *  placed it, same shape as `oreDrawnRows` above and for the same reason: a
   *  probe compares this against an independent `toPx` over the marker's own
   *  `dirBody` (through `proj` below) instead of trusting the paint pass a
   *  second time with no way to check it. */
  markerRows: { key: string; xPx: number; yPx: number }[];
  /** GP-520. THE PROJECTION THIS FRAME USED, verbatim (`MapPaint.Proj`):
   *  `pixelsPerMetre` above is `m2p` alone, published long before markers
   *  existed; the rest completes it so a probe can call the exact function
   *  `markerRows` was drawn with, rather than re-deriving the origin and the
   *  basis (DW-36: the centre is a parameter, so there is no fixed formula a
   *  probe could assume instead). */
  proj: { cx: number; cy: number; m2p: number; ox: number; oy: number; oz: number;
    u: V3; v: V3 };
}

/**
 * The ground layer's own contrast, measured over the bytes the painter wrote.
 *
 * WHY IT EXISTS. DW-37 shipped a map whose every structural count was green
 * (`discoveredQuads === terrainSamples`, 2,784 of 2,784) over a picture that
 * carried no information at all: at a 454 m span the surface map was a
 * featureless pale wash. `painted == onBody` was true, green and worthless, and
 * nothing in the report could tell the difference between that and a legible
 * relief map. This is the number that can, and it is deliberately taken from the
 * FINAL RGB bytes rather than from the heights, because a shading bug, a palette
 * bug and a flat world all produce the same blank picture and the player cannot
 * tell them apart either.
 *
 * Luminance is Rec. 709 over the 0..255 bytes the sample was written at, before
 * the layer's own alpha and before anything is composited over it: this measures
 * what the ground layer OFFERS, so a legible layer hidden by an alpha of 0 is a
 * different (and separately visible) defect from a layer with nothing to say.
 */
export interface TerrainContrast {
  /** Samples this was measured over, i.e. MapDrawReport.discoveredQuads. */
  painted: number;
  /** Standard deviation of luminance, 0..255. THE headline number. */
  lumaSd: number;
  /** The 5th and 95th percentile of luminance, and the gap between them: a
   *  robust spread that a handful of outlier pixels cannot manufacture. */
  lumaP5: number;
  lumaP95: number;
  lumaSpread: number;
  /** The mean absolute luminance difference between ADJACENT painted samples:
   *  LOCAL contrast, which is what the eye reads as terrain. It is the number
   *  that failed the blank frame when the global ones could not, and that is a
   *  measurement and not a preference: the featureless surface frame scored
   *  lumaSd 22.96 against the legible regional frame's 21.87, while lumaStep
   *  read 1.94 against 12.85. */
  lumaStep: number;
  /** Distinct 8-wide luminance buckets (32 across the byte range) holding at
   *  least 1% of the painted samples each. A count of the tones the picture
   *  really uses, immune to a single stray pixel widening the range. */
  buckets: number;
}
