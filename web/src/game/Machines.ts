// Placed machines: today the primitive furnace and the survival smelter.
//
// The MACHINE is a WASM handle (of_gp_furnace_*) and the tick that turns ore
// into an ingot is gameplay.h's, not ours. What lives here is where it stands,
// which mesh it is, and the one thing a placement system must never get wrong:
// the grid it snaps to and the ground it sits on.
//
// THE GRID IS /core's. `of_cell_for_pos` and `of_cell_center` are the same 1 m
// voxel lattice the digging layer uses, so a furnace and a tunnel agree about
// where a metre starts. Snapping to a grid invented in JS would put the two
// half a cell apart everywhere, which is the class of bug that only shows up
// once belts have to line up with something.
//
// THE GROUND IS THE ORACLE's. The cell centre fixes the two tangent axes; the
// RADIUS is then taken from of_surface_radius, so a machine cannot hover or
// sink even on a slope. Standing rule 1, one more time.

import * as THREE from 'three';
import { loadGlb, selectLod } from '../assets/Loaders.js';
import { scratchF64, scratchI32, type OfCoreModule } from '../sim/wasm/heap.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { GameCore } from './GameCore.js';

const FILES: Record<number, { url: string; root: string }> = {
  0: { url: 'assets/machines/primitive_furnace.glb', root: 'PrimitiveFurnace' },
  1: { url: 'assets/machines/survival_smelter.glb', root: 'SurvivalSmelter' },
};

/** Metres ahead of the eye a placement lands, before the grid snap. */
const PLACE_AHEAD_M = 2.2;
/**
 * Interaction sphere on a placed machine, and how far ABOVE the origin it sits.
 * The origin is the cell centre on the ground (ASSET-SPECS: machines pivot at
 * the ground plane) while the eye is 1.6 m up, so a sphere centred on the pivot
 * is missed by a level crosshair at any useful range: the ray passes 1.6 m over
 * a 1.1 m sphere. Aiming at a furnace has to mean aiming at the furnace.
 */
const MACHINE_RADIUS_M = 1.4;
const MACHINE_CENTRE_UP_M = 0.7;

export interface Machine {
  handle: number;
  tier: number;
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  group: THREE.Group;
}

export class Machines {
  readonly group = new THREE.Group();
  readonly list: Machine[] = [];
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly M: OfCoreModule,
    private readonly core: GameCore,
    private readonly origin: FloatingOrigin,
    private readonly bodyHandle: number,
  ) {
    this.group.name = 'machines';
  }

  async load(): Promise<void> {
    await Promise.all(Object.values(FILES).map(async (f) => {
      const g = await loadGlb(f.url);
      this.templates.set(f.url, g.scene);
    }));
  }

  /**
   * Snap a body-frame point to the 1 m cell lattice, then put it back on the
   * ground. Returns the snapped position.
   */
  snap(x: number, y: number, z: number): { x: number; y: number; z: number } {
    this.M._of_cell_for_pos(x, y, z);
    const c = scratchI32(this.M, 3);
    this.M._of_cell_center(c[0], c[1], c[2]);
    const p = scratchF64(this.M, 3);
    const cx = p[0], cy = p[1], cz = p[2];
    const r = Math.hypot(cx, cy, cz) || 1;
    const dx = cx / r, dy = cy / r, dz = cz / r;
    const ground = this.M._of_surface_radius(this.bodyHandle, 0, dx, dy, dz);
    return { x: dx * ground, y: dy * ground, z: dz * ground };
  }

  /**
   * Place `item` from the pack in front of the eye. Returns the machine, or
   * null if the pack has none. The item is only consumed on success, so a
   * failed placement can never eat a furnace.
   */
  place(item: number, tier: number, eye: { x: number; y: number; z: number },
        aim: { x: number; y: number; z: number }): Machine | null {
    if (this.core.count(item) < 1) return null;
    const up = new THREE.Vector3(eye.x, eye.y, eye.z).normalize();
    // Project the aim into the tangent plane: a machine goes on the ground in
    // front of you, not wherever the crosshair happens to be pointing at the sky.
    const flat = new THREE.Vector3(aim.x, aim.y, aim.z);
    flat.addScaledVector(up, -flat.dot(up));
    if (flat.lengthSq() < 1e-9) return null;
    flat.normalize();
    const pos = this.snap(
      eye.x + flat.x * PLACE_AHEAD_M,
      eye.y + flat.y * PLACE_AHEAD_M,
      eye.z + flat.z * PLACE_AHEAD_M,
    );
    const f = FILES[tier];
    const tpl = this.templates.get(f.url);
    if (tpl === undefined) return null;
    if (this.core.remove(item, 1) !== 1) return null;

    const handle = this.core.furnaceCreate(tier);
    const g = new THREE.Group();
    const clone = tpl.clone(true);
    selectLod(clone, '_LOD0');
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(clone);
    this.group.add(g);
    const m: Machine = {
      handle, tier, pos, group: g,
      up: new THREE.Vector3(pos.x, pos.y, pos.z).normalize(),
    };
    this.list.push(m);
    return m;
  }

  /** Advance every machine by `ticks`. Returns the smelts completed. */
  tick(ticks: number): number {
    let done = 0;
    for (const m of this.list) done += this.core.furnaceRun(m.handle, ticks);
    return done;
  }

  /** World-anchored re-place, exactly like the nodes. */
  update(): void {
    for (const m of this.list) {
      this.origin.toEngine(m.pos, this.p);
      m.group.position.copy(this.p);
      this.q.setFromUnitVectors(this.yAxis, m.up);
      m.group.quaternion.copy(this.q);
      m.group.updateMatrixWorld(true);
    }
  }

  /** Nearest machine the aim ray enters, within `reachM`. */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number): Machine | null {
    let best: Machine | null = null;
    let bestT = reachM;
    for (const m of this.list) {
      const u = MACHINE_CENTRE_UP_M;
      const ox = m.pos.x + m.up.x * u - eye.x;
      const oy = m.pos.y + m.up.y * u - eye.y;
      const oz = m.pos.z + m.up.z * u - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -MACHINE_RADIUS_M || t > bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      if (Math.hypot(cx, cy, cz) > MACHINE_RADIUS_M + 0.5) continue;
      best = m; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown {
    return this.list.map((m) => ({
      handle: m.handle, tier: m.tier, state: this.core.furnaceState(m.handle),
    }));
  }
}
