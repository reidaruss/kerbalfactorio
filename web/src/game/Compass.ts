// GP-700. THE ON-FOOT COMPASS: the player's own body-frame heading, plus a
// bearing to every KNOWN marker (MarkerRegistry, GP-520) and to the player's
// own pad(s) (LaunchPad.ts). This file computes plain numbers only, the
// same split GameplayReport/GameplayChrome already draw between "game/
// derives it" and "ui/ draws it" (DW-2: src/ui imports zero three.js).
//
// THE BEARING MATH is Controller.ts's own convention, not a new one:
// `forward = north*cos(yaw) + east*sin(yaw)`, i.e. yaw 0 is north and yaw
// increases CLOCKWISE through east. A marker's bearing is computed the same
// way: project its unit direction onto the player's own (east, north)
// tangent plane (`tangentFrame`, the one basis both the walker and the map
// use) and take `atan2(east, north)`. Two vectors, no plan and no absolute
// position needed, so this needs no body radius and stays honest for a
// marker of any distance on the sphere.
//
// FRAMES: every direction here (the player's own `up`, a marker's `dirBody`,
// a pad's `pos`) is BODY-FRAME on the CURRENT body, and this file draws all
// of it as if it belongs to that body. `MapMarker` (ui/MapTypes.ts) carries
// no `bodyId` -- AntennaSave.ts's own header names the same gap ("a stale
// marker left standing on the wrong body would be the GP-650 defect class
// again") -- so there is no field here to check a marker against. That is
// an inherited gap in the registry, not one this file can honestly close;
// today it is harmless because nothing populates the registry except sites
// scanned or reloaded for the body the player is actually standing on
// (AntennaSave.rebuildRevealMarkers clears and rebuilds the whole registry
// per body/load). A marker left over from a body switch mid-session would
// draw here exactly as wrongly as it already draws on both maps.
//
// DISTANCE IS DELIBERATELY NOT COMPUTED. Bearing needs only unit directions;
// an honest metre figure would need the body radius Gameplay does not
// publish today (`GameplayDeps.bodyRadiusM` is private to the class), and
// adding that surface for a "nice to have" label was refused rather than
// wired in under time pressure -- see docs/controllers/gameplay.md GP-700.

import * as THREE from 'three';
import type { Gameplay } from './Gameplay.js';
import { markerRegistry } from './MarkerRegistry.js';
import { tangentFrame } from '../player/ViewSource.js';
import type { CompassChip, CompassReadout } from '../ui/GameHud.js';

const upV = new THREE.Vector3();
const eastV = new THREE.Vector3();
const northV = new THREE.Vector3();
const dirV = new THREE.Vector3();
const tanV = new THREE.Vector3();

/** Bearing, in degrees 0..360, from the (east, north) tangent frame already
 *  seated in `eastV`/`northV`/`upV` to the unit direction `(x, y, z)`. `null`
 *  for a degenerate input (zero length, or dead overhead/underfoot with no
 *  tangent component to read a bearing off) rather than a fabricated 0,
 *  because a marker at the player's own zenith is a real case (GP-520's
 *  own `markerPosM` comment notes ruins can sit on terrain the scan never
 *  measured) and a silent "north" reading would be a wrong bearing on
 *  screen, not an honestly-absent one. */
function bearingOf(x: number, y: number, z: number): number | null {
  const l = Math.hypot(x, y, z);
  if (!(l > 1e-9)) return null;
  dirV.set(x / l, y / l, z / l);
  const alongUp = dirV.dot(upV);
  tanV.copy(dirV).addScaledVector(upV, -alongUp);
  const tl = tanV.length();
  if (tl < 1e-6) return null;
  tanV.divideScalar(tl);
  const e = tanV.dot(eastV);
  const n = tanV.dot(northV);
  let deg = THREE.MathUtils.radToDeg(Math.atan2(e, n));
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * The compass's own snapshot, or `null` when there is no walker to take a
 * bearing from (`position` at the origin, which `ObserverState` never
 * reports for a live walker -- the same degenerate guard `Controller.state`
 * uses for lat/lon).
 *
 * Computed UNCONDITIONALLY: this file has no idea whether the player is
 * strapped into a rocket or the map is open (`Gameplay` holds neither fact
 * -- `aboard` lives in `FlightMode`/`Systems.ts`, `open` in `MapMode`), so
 * the mode gate is the caller's, exactly as `GameHud.setVisible` already
 * gates the crosshair and the carry panel off the SAME two facts through
 * `setWorldUi`. See `GameHud.render`'s own comment.
 */
export function computeCompass(g: Gameplay): CompassReadout | null {
  const w = g.walker;
  const pos = w.position;
  if (!(Math.hypot(pos.x, pos.y, pos.z) > 0)) return null;
  upV.copy(w.up);
  tangentFrame(upV, eastV, northV);
  const heading = ((w.state().yawDeg % 360) + 360) % 360;

  const chips: CompassChip[] = [];
  // MARKERS. `known` is the ONLY gate MapMarker documents itself (GP-520);
  // honoured again here rather than trusted, the same defensive read GP-533's
  // `markerFor` callers already assume of the registry.
  for (const m of markerRegistry.list()) {
    if (!m.known) continue;
    const bearing = bearingOf(m.dirBody[0], m.dirBody[1], m.dirBody[2]);
    if (bearing === null) continue;
    chips.push({ key: m.key, label: m.label, kind: m.kind, bearingDeg: bearing });
  }
  // THE PLAYER'S OWN BASE. `LaunchPads.list` is the one store a built pad
  // already lives in (GP-57); read directly rather than through a second
  // "home" concept. A fresh spawn with no pad yet draws no chip at all --
  // refused rather than fabricating a spawn-point chip: nothing tracks
  // "where you started" as a place worth walking back to once you have
  // moved on, and inventing one here would be a second, UI-only authority
  // on what "home" means.
  const multi = g.pads.list.length > 1;
  for (const p of g.pads.list) {
    const bearing = bearingOf(p.pos.x, p.pos.y, p.pos.z);
    if (bearing === null) continue;
    chips.push({
      key: `pad:${p.id}`, label: multi ? `Pad ${p.id}` : 'Pad',
      kind: 'pad', bearingDeg: bearing,
    });
  }
  return { headingDeg: heading, chips };
}
