// WHICH ViewSource is the streaming observer right now.
//
// `Loop` owns ORDER and must never branch on player mode (ViewSource.ts), so a
// player boarding a rocket cannot be a conditional inside the loop. It is a
// swap of the ONE object the loop already talks to, and everything downstream,
// the floating origin, the terrain request, the regime band, the sky and the
// shadow fit, follows the vessel with no further wiring. That is the whole
// reason the near-to-far handoff needs no flight-specific code: the rocket
// becomes the observer, and the observer is what the scaled-space rig was built
// around.
//
// The router holds its OWN position/orientation/up objects and copies from the
// active source, because ViewSource publishes them as readonly references that
// callers cache. Swapping the reference under a cached holder is exactly the
// class of bug the floating origin's re-derive-from-anchor rule exists to stop.

import * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';
import type { InputFrame } from './Input.js';
import type { ObserverState, ViewSource } from './ViewSource.js';

export class ViewRouter implements ViewSource {
  readonly position: Vec3d = { x: 0, y: 0, z: 0 };
  readonly orientation = new THREE.Quaternion();
  readonly up = new THREE.Vector3(0, 1, 0);
  altM = 0;
  /** How many times the eye has changed hands. A probe asserts this moved. */
  swaps = 0;

  private src: ViewSource;

  constructor(private readonly base: ViewSource) {
    this.src = base;
    this.pull();
  }

  /** The source currently driving the eye. */
  get active(): ViewSource { return this.src; }
  /** The on-foot source, whatever is currently driving. */
  get walker(): ViewSource { return this.base; }
  get onFoot(): boolean { return this.src === this.base; }

  /** Hand the eye to `s`, or back to the walker with null. */
  setSource(s: ViewSource | null): void {
    const next = s ?? this.base;
    if (next === this.src) return;
    this.src = next;
    this.swaps += 1;
    this.pull();
  }

  step(inp: InputFrame, dt: number): void {
    this.src.step(inp, dt);
    this.pull();
  }

  look(dYaw: number, dPitch: number): void { this.src.look(dYaw, dPitch); }

  interpolate(alpha: number): void {
    this.src.interpolate(alpha);
    this.pull();
  }

  teleport(latDeg: number, lonDeg: number, altM: number): void {
    this.src.teleport(latDeg, lonDeg, altM);
    this.pull();
  }

  state(): ObserverState { return this.src.state(); }

  private pull(): void {
    const s = this.src;
    this.position.x = s.position.x;
    this.position.y = s.position.y;
    this.position.z = s.position.z;
    this.orientation.copy(s.orientation);
    this.up.copy(s.up);
    this.altM = s.altM;
  }
}
