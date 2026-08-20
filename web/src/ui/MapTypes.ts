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
//
// BT-295 line-cap batch 3: this file crossed 400 lines itself and became a
// pure barrel, split three ways with zero behaviour to preserve (every
// declaration here is a type or interface, nothing executes): MapTypesCore.ts
// holds V3 and the scene/readout family (MapConic through MapReadout);
// MapPlannerTypes.ts holds the GP-271 autopilot-planner block; MapDrawTypes.ts
// holds what the painter reports it drew (MapDrawReport, TerrainContrast).
// Every one of the nineteen call sites still imports from this path unchanged.
// =============================================================================

export type { V3, MapConic, MapOre, MapTerrainGrid, MapMarker, MapScene,
  MapNodeReadout, MapDiscoveryReadout, MapVesselRow, MapReadout } from './MapTypesCore.js';
export type { MapPlannerRow, MapPlannerSample, MapPlannerReadout } from './MapPlannerTypes.js';
export type { MapDrawReport, TerrainContrast } from './MapDrawTypes.js';
