// WHICH PLACED MACHINES ARE LIGHTS, AND WHERE (RN-2385).
//
// Split out of `MachineBatch` rather than added to it, along the seam that
// file already publishes: `MachineBatch` owns the INSTANCE POOL and the
// materials, `MachineGeometry` owns the bake, and this owns the one mapping
// that is neither -- slot -> live emitter. It touches no three batching state
// and reads no template scene.
//
// It also keeps `MachineBatch` under the 400-line cap, which that file has sat
// one line under since RN-1478 and which `check:limits` has been red on
// project-wide since BT-42; adding to the count of files over it would be a
// small dishonesty in a lane whose whole subject is measured claims.
//
// THE POSITION AND THE RADIANCE ARRIVE FROM TWO DIFFERENT CALLS, which is the
// only structural thing here. `place(slot, matrix)` knows where a machine is
// and nothing about its fire; `setFx(slot, fx)` knows the fire and nothing
// about where it is. Both are called every frame by `FactoryView.sync`, in
// that order, and neither can publish an emitter alone -- so the record is
// held per slot and pushed to `EmissiveLight` in `flush`, which is the one
// call per frame that already means "this pool is done being written to".

import * as THREE from 'three';
import type { EmitterSource } from './MachineGeometry.js';
import { dropEmitter, emitterReach, fireRadiance, newEmitter, setEmitter }
  from '../render/materials/EmissiveLight.js';

interface Rec {
  /** Handle into `EmissiveLight`'s registry, or -1 while this slot has no
   *  emitting template pointed at it. */
  h: number;
  src: EmitterSource;
  /** Engine-space position of the emitting surface, from `place`. */
  x: number; y: number; z: number;
  placed: boolean;
  state: number;
  level: number;
  reach: number;
}

const P = new THREE.Vector3();
const C = new THREE.Color();

export class MachineEmitters {
  /** Template key -> the source measured off its geometry. */
  private readonly src = new Map<string, EmitterSource>();
  /** Slot -> its record, sparse. */
  private readonly rec = new Map<number, Rec>();
  /** Emitters this pool published on the last `flush`. */
  live = 0;

  /** Learn one template's measured emitter. No-op for a template with none. */
  learn(key: string, e: EmitterSource | null): void {
    if (e !== null) this.src.set(key, e);
  }

  /** True while no template in this pool emits anything, which is the common
   *  case (belts, cargo, launch pads) and is what keeps the per-frame cost of
   *  this class exactly zero for them. */
  get idle(): boolean { return this.src.size === 0; }

  /** A slot is now pointed at `key`. Drops the emitter if the new template has
   *  none, so re-pointing a smelter's slot at a belt tile cannot leave a fire
   *  burning at that slot's position for the rest of the session. */
  point(slot: number, key: string): void {
    if (this.idle) return;
    const s = this.src.get(key);
    if (s === undefined) { this.clear(slot); return; }
    const r = this.rec.get(slot);
    if (r === undefined) {
      this.rec.set(slot, { h: newEmitter(), src: s, x: 0, y: 0, z: 0,
        placed: false, state: 0, level: 0, reach: emitterReach(s.area) });
    } else {
      r.src = s;
      r.reach = emitterReach(s.area);
    }
  }

  /** Where the emitting surface actually is, this frame, in engine space. */
  place(slot: number, m: THREE.Matrix4): void {
    const r = this.rec.get(slot);
    if (r === undefined) return;
    P.set(r.src.x, r.src.y, r.src.z).applyMatrix4(m);
    r.x = P.x; r.y = P.y; r.z = P.z;
    r.placed = true;
  }

  /** The fx texel this slot was given: state and level, nothing derived. */
  fx(slot: number, state: number, level: number): void {
    const r = this.rec.get(slot);
    if (r === undefined) return;
    r.state = state;
    r.level = level;
  }

  /** Stop this slot emitting, keeping its handle: for `hide`, which keeps the
   *  slot. `release` calls `drop` instead. */
  hide(slot: number): void {
    const r = this.rec.get(slot);
    if (r === undefined) return;
    r.placed = false;
    setEmitter(r.h, null);
  }

  /** Give the handle back. For `release` and for a re-point onto a template
   *  with no fire. */
  clear(slot: number): void {
    const r = this.rec.get(slot);
    if (r === undefined) return;
    dropEmitter(r.h);
    this.rec.delete(slot);
  }

  /**
   * Publish every live record. `fireRadiance` is `EmissiveLight`'s own, which
   * is the same four constants `MachineFx`'s GLSL is generated from, so the
   * light cast and the surface drawn cannot disagree; the `* area` here is the
   * other half of that function's contract (it returns a RADIANCE and the
   * shader divides by a squared distance, so the area belongs on this side).
   */
  flush(): void {
    if (this.idle) return;
    let n = 0;
    for (const r of this.rec.values()) {
      if (!r.placed) { setEmitter(r.h, null); continue; }
      fireRadiance(r.state, r.level, C);
      if (C.r + C.g + C.b <= 0) { setEmitter(r.h, null); continue; }
      setEmitter(r.h, {
        x: r.x, y: r.y, z: r.z, radius: r.src.radius,
        r: C.r * r.src.area, g: C.g * r.src.area, b: C.b * r.src.area,
        reach: r.reach,
      });
      n++;
    }
    this.live = n;
  }

  /** What this pool contributes, for the probe surface. */
  stats(): { templates: number; slots: number; live: number } {
    return { templates: this.src.size, slots: this.rec.size, live: this.live };
  }
}
