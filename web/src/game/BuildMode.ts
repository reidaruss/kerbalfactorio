// BUILD MODE: pick a machine, see where it will go, turn it, put it there.
//
// The whole design goal is that the answer to "will this work?" is visible
// BEFORE the key is pressed. The ghost is red when the placement would be
// refused (cell taken, no deposit under a miner, nowhere to stand) and blue when
// it would succeed, so a player learns the rules by moving the crosshair rather
// than by collecting error messages.
//
// WHERE THE GHOST LANDS is a march of the aim ray against the surface oracle,
// not a fixed distance ahead of the eye. A fixed offset is what the furnace does
// and it is fine for one object; it is wrong for a line, because laying belts
// means putting the next tile exactly where you are looking, and a metre of
// disagreement between the crosshair and the ghost makes a straight run
// impossible to lay. One authority for the ground, again: of_surface_radius.

import * as THREE from 'three';
import { quarterTurn, snapToAxes } from './Grid.js';
import { FOOTPRINT, type BuildKind, type Factory } from './Factory.js';
import type { FactoryView } from './FactoryView.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** Number keys, in menu order. 0 (or Escape) leaves build mode. */
const MENU: { key: string; kind: BuildKind; label: string }[] = [
  { key: 'Digit1', kind: 'miner', label: 'miner' },
  { key: 'Digit2', kind: 'belt', label: 'belt' },
  { key: 'Digit3', kind: 'smelter', label: 'smelter' },
];

/** Aim march: step and reach, in metres. */
const STEP_M = 0.35;
const REACH_M = 9.0;
/** Where the ghost falls back to when the aim never meets the ground. */
const FALLBACK_M = 2.6;

export interface BuildTarget {
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  cell: string;
  ok: boolean;
  reason: string;
}

export class BuildMode {
  selected: BuildKind | null = null;
  rotation = 0;
  placements = 0;
  refusals = 0;
  target: BuildTarget | null = null;
  private rotateHeld = false;
  private placeHeld = false;
  private readonly digitHeld = new Set<string>();

  constructor(private readonly M: OfCoreModule, private readonly body: number,
              private readonly factory: Factory, private readonly view: FactoryView) {}

  /** Select by menu index (1-based), or 0 to leave build mode. For probes. */
  select(index: number): BuildKind | null {
    this.selected = index >= 1 && index <= MENU.length ? MENU[index - 1].kind : null;
    if (this.selected === null) this.view.hideGhost();
    return this.selected;
  }

  get label(): string {
    if (this.selected === null) return '';
    return MENU.find((m) => m.kind === this.selected)?.label ?? '';
  }

  /**
   * One fixed tick of build mode. `held` is Input.held, so a driven tape and a
   * human keyboard are the same thing here (ARCHITECTURE 11.2).
   */
  step(held: (code: string) => boolean, place: boolean,
       ray: { origin: { x: number; y: number; z: number };
              dir: { x: number; y: number; z: number } }): boolean {
    for (let i = 0; i < MENU.length; ++i) {
      const k = MENU[i].key;
      if (held(k) && !this.digitHeld.has(k)) this.select(i + 1);
      if (held(k)) this.digitHeld.add(k); else this.digitHeld.delete(k);
    }
    if (held('Digit0') || held('Escape')) this.select(0);

    if (this.selected === null) { this.target = null; this.view.hideGhost(); return false; }

    const rot = held('KeyR');
    if (rot && !this.rotateHeld) this.rotation = (this.rotation + 1) % 4;
    this.rotateHeld = rot;

    this.target = this.resolve(ray);
    if (this.target !== null) {
      this.view.showGhost(this.selected, this.target.pos, this.target.up,
        this.target.fwd, this.target.ok);
    } else {
      this.view.hideGhost();
    }

    const pressed = place && !this.placeHeld;
    this.placeHeld = place;
    if (!pressed || this.target === null) return false;
    if (!this.target.ok) { this.refusals++; return false; }
    const made = this.factory.add(this.selected, {
      pos: this.target.pos, up: this.target.up, cell: this.target.cell,
    }, this.target.fwd);
    if (made === null) { this.refusals++; return false; }
    this.placements++;
    return true;
  }

  /**
   * March the aim ray until it is below the ground, then snap the hit to the
   * lattice and answer whether the placement would be accepted.
   */
  private resolve(ray: { origin: { x: number; y: number; z: number };
                         dir: { x: number; y: number; z: number } }): BuildTarget | null {
    const o = ray.origin, d = ray.dir;
    let hitT = -1;
    for (let t = 0.6; t <= REACH_M; t += STEP_M) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const r = Math.hypot(x, y, z) || 1;
      if (r <= this.M._of_surface_radius(this.body, 0, x / r, y / r, z / r)) {
        hitT = t; break;
      }
    }
    const t = hitT < 0 ? FALLBACK_M : hitT;
    const s = this.factory.snap(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    // The flow axis is one of the four tangent lattice directions, because the
    // grid is square: a belt at 37 degrees has no cell ahead of it to chain to.
    const flat = new THREE.Vector3(d.x, d.y, d.z);
    const east = new THREE.Vector3(-s.up.y, s.up.x, 0);
    const axis = snapToAxes(s.up, flat, east.lengthSq() < 1e-9
      ? new THREE.Vector3(1, 0, 0) : east);
    const fwd = quarterTurn(s.up, axis, this.rotation);

    let ok = true;
    let reason = '';
    if (this.factory.occupied(s.cell)) { ok = false; reason = 'cell taken'; }
    else if (this.selected === 'miner') {
      const n = this.factory.nodeUnder(s.pos);
      if (n < 0) { ok = false; reason = 'no ore deposit here'; }
      else if (this.factory.placed.some((p) => p.nodeIndex === n)) {
        ok = false; reason = 'that deposit already has a miner';
      }
    }
    return { pos: s.pos, up: s.up, fwd, cell: s.cell, ok, reason };
  }

  report(): unknown {
    return {
      selected: this.selected, label: this.label, rotation: this.rotation,
      placements: this.placements, refusals: this.refusals,
      ghost: this.target === null ? null : {
        cell: this.target.cell, ok: this.target.ok, reason: this.target.reason,
        footprint: this.selected === null ? 0 : FOOTPRINT[this.selected],
        pos: [this.target.pos.x, this.target.pos.y, this.target.pos.z],
        fwd: [this.target.fwd.x, this.target.fwd.y, this.target.fwd.z],
      },
      visible: this.view.ghostVisible,
    };
  }
}

/** The build menu, so the HUD does not restate it. */
export const BUILD_MENU = MENU;
