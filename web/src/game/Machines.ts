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
import { findNode, loadGlb, selectLod } from '../assets/Loaders.js';
import { MachineGlow, Smoke } from './MachineFx.js';
import { scratchF64, scratchI32, type OfCoreModule } from '../sim/wasm/heap.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { GameCore } from './GameCore.js';

/**
 * `card` is the emissive fire object the .glb ships for exactly this purpose;
 * the smoke position comes from the file's own `socket_smoke`, so the smelter's
 * offset flue smokes from the flue and not from the middle of the machine.
 */
const FILES: Record<number, { url: string; root: string; card: string }> = {
  0: {
    url: 'assets/machines/primitive_furnace.glb', root: 'PrimitiveFurnace',
    card: 'Furnace_FireCard',
  },
  1: {
    url: 'assets/machines/survival_smelter.glb', root: 'SurvivalSmelter',
    card: 'SurvivalSmelter_Glow',
  },
};

/** Seconds between smoke puffs while a machine is actually burning. */
const PUFF_SECS = 0.30;

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
  /** Ground normal AND the yaw that turns the mouth towards whoever placed it. */
  quat: THREE.Quaternion;
  group: THREE.Group;
  glow: MachineGlow;
  /** Body-frame point the flue smokes from, derived from the file's socket. */
  smokeAt: { x: number; y: number; z: number };
  puffIn: number;
  burning: boolean;
}

export class Machines {
  readonly group = new THREE.Group();
  readonly list: Machine[] = [];
  readonly smoke = new Smoke();
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly M: OfCoreModule,
    private readonly core: GameCore,
    private readonly origin: FloatingOrigin,
    private readonly bodyHandle: number,
  ) {
    this.group.name = 'machines';
    this.group.add(this.smoke.mesh);
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
    const stand = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    // THE MOUTH FACES THE PLAYER WHO PUT IT THERE. Standing local +Y on the
    // ground normal is only half a placement: the fire card is recessed in the
    // mouth, so a machine dropped at an arbitrary yaw shows a player its blank
    // back and the one signal that says "this thing is working" is invisible.
    // The mouth is Blender -Y, which glTF's Z-up conversion makes local +Z.
    this.q.setFromUnitVectors(this.yAxis, stand);
    const quat = this.faceMouth(this.q, stand, eye, pos);
    // The socket is authored in the machine's own frame, so rotating the socket
    // offset by that same quaternion is the whole transform. Falling back to the
    // asset height keeps a machine smoking even if a file ever drops the socket.
    const socket = findNode(clone, 'socket_smoke');
    this.v.copy(socket?.position ?? new THREE.Vector3(0, 1.4, 0)).applyQuaternion(quat);
    const m: Machine = {
      handle, tier, pos, group: g, up: stand, quat,
      glow: new MachineGlow(clone, f.card),
      smokeAt: { x: pos.x + this.v.x, y: pos.y + this.v.y, z: pos.z + this.v.z },
      puffIn: 0, burning: false,
    };
    this.list.push(m);
    return m;
  }

  /** Yaw `stand` about the ground normal until local +Z points back at the eye. */
  private faceMouth(stand: THREE.Quaternion, up: THREE.Vector3,
                    eye: { x: number; y: number; z: number },
                    pos: { x: number; y: number; z: number }): THREE.Quaternion {
    const want = new THREE.Vector3(eye.x - pos.x, eye.y - pos.y, eye.z - pos.z);
    want.addScaledVector(up, -want.dot(up));
    if (want.lengthSq() < 1e-9) return stand.clone();
    want.normalize();
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(stand);
    face.addScaledVector(up, -face.dot(up));
    if (face.lengthSq() < 1e-9) return stand.clone();
    face.normalize();
    const cross = new THREE.Vector3().crossVectors(face, want);
    const angle = Math.atan2(cross.dot(up), face.dot(want));
    return new THREE.Quaternion().setFromAxisAngle(up, angle).multiply(stand);
  }

  /** Advance every machine by `ticks`. Returns the smelts completed. */
  tick(ticks: number): number {
    let done = 0;
    for (const m of this.list) done += this.core.furnaceRun(m.handle, ticks);
    return done;
  }

  /**
   * Drive the fire card and the flue from /core's furnace state.
   *
   * `smelting` is only true on a tick that actually PROGRESSED, and the tick that
   * completes a smelt clears it, so reading that flag alone makes the fire blink
   * off for one frame every 180 ticks. The state that matters visually is "has
   * ore and has fuel", which is precisely the condition gameplay.h's tick uses to
   * decide whether to progress at all.
   */
  updateFx(dt: number): void {
    for (const m of this.list) {
      const st = this.core.furnaceState(m.handle);
      const hasFuel = st !== null && st.fuelTicks > 0;
      m.burning = st !== null && hasFuel && st.oreCount > 0;
      m.glow.update(dt, { burning: m.burning, hasFuel });
      m.puffIn -= dt;
      if (m.burning && m.puffIn <= 0) {
        m.puffIn = PUFF_SECS;
        this.smoke.emit(m.smokeAt, m.up);
      }
    }
    this.smoke.update(dt, this.origin);
  }

  /** World-anchored re-place, exactly like the nodes. */
  update(): void {
    for (const m of this.list) {
      this.origin.toEngine(m.pos, this.p);
      m.group.position.copy(this.p);
      m.group.quaternion.copy(m.quat);
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
      burning: m.burning, lit: Number(m.glow.lit.toFixed(3)),
      smokePuffs: this.smoke.live,
    }));
  }
}
