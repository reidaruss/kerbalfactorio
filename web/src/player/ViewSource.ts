// The one contract the frame loop consumes for "where is the eye and which way
// is it looking". Both the W1 free/orbit camera and the W2 walking character
// implement it, so Loop.ts owns ORDER and never branches on player mode.
//
// step() advances on the fixed 60 Hz tick; interpolate() is called once per
// RENDERED frame with of::SimClock's alpha. Splitting them is not decoration:
// sampling a 60 Hz position at vsync without interpolation is a much larger
// source of visible jitter than any float32 quantization (see JitterProbe).

import type * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';
import type { InputFrame } from './Input.js';

export interface ObserverState {
  latDeg: number;
  lonDeg: number;
  altM: number;
  yawDeg: number;
  pitchDeg: number;
  /** 'FP' | 'TP' for the character; 'FLY' for the free camera. */
  mode: string;
  grounded: boolean;
  speedMps: number;
}

export interface ViewSource {
  /** Body-frame f64 eye position. The RENDER value: interpolate() writes it. */
  readonly position: Vec3d;
  readonly orientation: THREE.Quaternion;
  /** Local up (radial) at the eye. */
  readonly up: THREE.Vector3;
  /** Altitude of the eye above the designed surface, metres. */
  readonly altM: number;
  step(inp: InputFrame, dt: number): void;
  /** Aim, in radians, relative to the current yaw/pitch. */
  look(dYaw: number, dPitch: number): void;
  interpolate(alpha: number): void;
  teleport(latDeg: number, lonDeg: number, altM: number): void;
  state(): ObserverState;
}

/** Right-handed tangent frame at a radial direction. Poles are not special. */
export function tangentFrame(
  up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3,
): void {
  // POLAR x up degenerates only exactly at the pole, where any east will do.
  east.set(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(up, east).normalize();
}
