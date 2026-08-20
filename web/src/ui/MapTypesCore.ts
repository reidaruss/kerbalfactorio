// The core scene/readout half of MapTypes.ts (see that file's header for the
// map's own design rules: plain data, no three.js, the orthographic
// projection, the centre-as-parameter, the no-zoom-threshold family). Split
// out at the 400-line cap: this file holds the primitives (V3), what a frame
// draws (MapConic/MapOre/MapTerrainGrid/MapMarker/MapScene), the node/
// discovery/vessel readouts, and MapReadout, which is the one type that
// reaches across to MapPlannerTypes.ts for its `planner` field.

import type { MapPlannerReadout } from './MapPlannerTypes.js';

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
