// Placed machines: today the primitive furnace and the survival smelter.
//
// The MACHINE is a WASM handle (of_gp_furnace_*) and the tick that turns ore
// into an ingot is gameplay.h's, not ours. What lives here is where it stands,
// which mesh it is, and the one thing a placement system must never get wrong:
// the grid it snaps to and the ground it sits on.
//
// THE GRID IS THE SITE'S, and it stopped being /core's voxel lattice on the day
// this file was the last thing in the build system still using it (GP-39).
// GP-27 moved drills, belts and factory smelters onto the metric site frame
// because a unit step of `of_cell_for_pos` covers 0.59 to 1.02 m of ground
// depending on the axis; the HAND furnace and smelter were left behind, so a
// furnace and the belt running into it disagreed about where a metre starts.
// `MachinePlacement` is now the single answer for both.
//
// THE HEIGHT IS THE ORACLE's ON SOIL AND THE DECK'S ON A BASE. "Items like
// smelters dont sit ontop of the foundation" was exactly true and it was this
// line of code: a foundation deliberately writes nothing to the voxel layer
// (DW-24), so a machine that takes its radius from `of_surface_radius` stands on
// the ground UNDER a deck rather than on the deck. `anchorIn` asks the base
// whether the cell is decked and takes `socket_top`'s own height when it is.

import * as THREE from 'three';
import { addressIn, anchorIn, siteAt, type SiteHost } from './MachinePlacement.js';
import { findNode, loadGlb, selectLod } from '../assets/Loaders.js';
import { MachineGlow, Smoke } from './MachineFx.js';
import { SURVIVAL, type ModeRules } from './GameMode.js';
import { handSolid, learnProxies, tangentHalfExtentM } from './FactorySolids.js';
import type { Solidity } from './FactoryTemplates.js';
import type { Solid } from './StructureBody.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { GameCore } from './GameCore.js';

/**
 * `card` is the emissive fire object the .glb ships for exactly this purpose;
 * the smoke position comes from the file's own `socket_smoke`, so the smelter's
 * offset flue smokes from the flue and not from the middle of the machine.
 */
/**
 * `solid` is REQUIRED for the reason `FactoryTemplates.ASSETS.solid` is: R33
 * found the player walking through every machine in the game, and an answer that
 * has to be written down cannot be forgotten. What this table CANNOT give, and
 * the ASSETS one can, is exhaustiveness: `tier` is a /core ladder index rather
 * than a union, so `Record<number, ...>` will not fail to compile on a tier with
 * no row. The compiler here asks the question of every row that exists; only the
 * factory's table asks it of every kind that exists. Said plainly rather than
 * claimed.
 */
const FILES: Record<number, { url: string; root: string; card: string;
                              solid: Solidity }> = {
  0: {
    url: 'assets/machines/primitive_furnace.glb', root: 'PrimitiveFurnace',
    card: 'Furnace_FireCard', solid: 'blocks',
  },
  1: {
    url: 'assets/machines/survival_smelter.glb', root: 'SurvivalSmelter',
    card: 'SurvivalSmelter_Glow', solid: 'blocks',
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
  /** GP-39. Published because "it sits on the foundation" is a claim, and a
   *  claim needs a number: `probes/deckmount.js` reads it back against the
   *  deck's own `socket_top`. False for a machine standing on soil. */
  onDeck: boolean;
  up: THREE.Vector3;
  /** Ground normal AND the yaw that turns the mouth towards whoever placed it. */
  quat: THREE.Quaternion;
  group: THREE.Group;
  glow: MachineGlow;
  /** Body-frame point the flue smokes from, derived from the file's socket. */
  smokeAt: { x: number; y: number; z: number };
  puffIn: number;
  burning: boolean;
  /** R33: this machine in the walker's own solid set, or null when the asset is
   *  declared passable or ships no `col_*` proxy. Held so `remove` can take the
   *  exact object back out by identity rather than by a shared id. */
  solid: Solid | null;
}

export class Machines {
  readonly group = new THREE.Group();
  readonly list: Machine[] = [];
  readonly smoke = new Smoke();
  /** Demolition ledger: machines pulled up, and ore that went with them. */
  removals = 0;
  oreLost = 0;
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
    /** The LIVE voxel edit set. A furnace put down in a pit belongs in the
     *  pit, and this used to be a literal 0 (probes/beltfloat.js). */
    private readonly edits: () => number = () => 0,
    /** DW-31. A hand furnace's gate is "is it in the pack", which is the
     *  crafted-item gate; sandbox lifts it (game/GameMode.ts). */
    private readonly mode: ModeRules = SURVIVAL,
    /** GP-39. The site registry, LAZILY, because the base-building layer is
     *  built after this one and a machine only asks at placement time. Null
     *  leaves the old lattice snap in place, which is what a headless unit
     *  test of this class gets. */
    private readonly host: () => SiteHost | null = () => null,
  ) {
    this.group.name = 'machines';
    this.group.add(this.smoke.mesh);
  }

  async load(): Promise<void> {
    await Promise.all(Object.values(FILES).map(async (f) => {
      const g = await loadGlb(f.url);
      this.templates.set(f.url, g.scene);
      // The collision proxy comes off the SAME parse the mesh does (R33).
      learnProxies(f.url, g.scene);
    }));
  }

  /**
   * Snap a body-frame point to the metric site grid, then onto whatever surface
   * that cell actually has: the deck top if one is built there, the live oracle
   * surface if not.
   *
   * The fallback when no site registry is wired is the LIVE oracle at the point
   * itself, deliberately without the old lattice quantisation. A grid nothing
   * else in the build system uses any more is worse than no grid at all: it puts
   * a furnace up to 0.51 m from where the crosshair said it would go, and the
   * only consumer that could have wanted it is a headless test with no base.
   */
  snap(x: number, y: number, z: number):
  { x: number; y: number; z: number; onDeck: boolean } {
    const host = this.host();
    if (host !== null) {
      const p = { x, y, z };
      const s = siteAt(host, p);
      const a = anchorIn(host, addressIn(s.site, host.module, p, s.prospective));
      return { ...a.pos, onDeck: a.onDeck };
    }
    const r = Math.hypot(x, y, z) || 1;
    const dx = x / r, dy = y / r, dz = z / r;
    const g = this.M._of_surface_radius(this.bodyHandle, this.edits(), dx, dy, dz);
    return { x: dx * g, y: dy * g, z: dz * g, onDeck: false };
  }

  /**
   * Place `item` from the pack in front of the eye. Returns the machine, or
   * null if the pack has none. The item is only consumed on success, so a
   * failed placement can never eat a furnace.
   *
   * DW-31: in sandbox the pack is not consulted and nothing is removed. The
   * spend is `this.core.remove` further down and it is guarded by the same
   * question, so the two halves cannot drift apart.
   */
  place(item: number, tier: number, eye: { x: number; y: number; z: number },
        aim: { x: number; y: number; z: number }): Machine | null {
    if (!this.mode.freeBuild && this.core.count(item) < 1) return null;
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
    if (this.templates.get(FILES[tier].url) === undefined) return null;
    if (!this.mode.freeBuild && this.core.remove(item, 1) !== 1) return null;
    const stand = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    // THE MOUTH FACES THE PLAYER WHO PUT IT THERE. Standing local +Y on the
    // ground normal is only half a placement: the fire card is recessed in the
    // mouth, so a machine dropped at an arbitrary yaw shows a player its blank
    // back and the one signal that says "this thing is working" is invisible.
    // The mouth is Blender -Y, which glTF's Z-up conversion makes local +Z.
    this.q.setFromUnitVectors(this.yAxis, stand);
    return this.spawn(tier, pos, stand, this.faceMouth(this.q, stand, eye, pos),
      pos.onDeck);
  }

  /**
   * Put a machine back exactly where a save says it was. No item is spent and
   * no yaw is derived: a restored furnace faces the way it faced, because the
   * mouth's direction is player-authored state and not a function of where the
   * player happens to stand at load time.
   */
  restore(tier: number, pos: { x: number; y: number; z: number },
          quat: THREE.Quaternion): Machine | null {
    if (FILES[tier] === undefined) return null;
    const stand = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    // The saved POSITION is authoritative and is never re-snapped; only the
    // `onDeck` flag is re-asked, because it is a fact about the world around
    // the machine rather than about the machine, and a deck demolished while
    // the page was shut would otherwise be remembered for ever.
    return this.spawn(tier, pos, stand, quat, this.snap(pos.x, pos.y, pos.z).onDeck);
  }

  /** The half of a placement that is the same however it was asked for. */
  private spawn(tier: number, pos: { x: number; y: number; z: number },
                stand: THREE.Vector3, quat: THREE.Quaternion,
                onDeck: boolean): Machine | null {
    const f = FILES[tier];
    const tpl = this.templates.get(f.url);
    if (tpl === undefined) return null;

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
    // The socket is authored in the machine's own frame, so rotating the socket
    // offset by that same quaternion is the whole transform. Falling back to the
    // asset height keeps a machine smoking even if a file ever drops the socket.
    const socket = findNode(clone, 'socket_smoke');
    this.v.copy(socket?.position ?? new THREE.Vector3(0, 1.4, 0)).applyQuaternion(quat);
    const m: Machine = {
      handle, tier, pos, onDeck, group: g, up: stand, quat,
      glow: new MachineGlow(clone, f.card),
      smokeAt: { x: pos.x + this.v.x, y: pos.y + this.v.y, z: pos.z + this.v.z },
      puffIn: 0, burning: false,
      solid: handSolid(f.url, f.solid, pos, quat),
    };
    // R33: into the walker's EXISTING set, never a second one (DW-26). A
    // placement and a restore both land here, so a loaded furnace and a built one
    // are solid by the same line of code.
    if (m.solid !== null) this.host()?.bodies?.add(m.solid);
    this.list.push(m);
    return m;
  }

  /**
   * Pull a placed machine back up. Returns the ledger, or null if it is gone.
   *
   * The MACHINE ITEM comes back, because that is what the player paid; the
   * finished ingots come back, because they exist. The ore already loaded into
   * the pool does NOT: gameplay.h's Furnace has loadOre and no unloadOre, and
   * inventing a JS-side eject would be a second authority over the pool. It is
   * reported as `oreLost` instead, so the number is visible rather than absent.
   */
  remove(m: Machine): { item: number; refunded: number; ingots: number;
                        oreLost: number } | null {
    const at = this.list.indexOf(m);
    if (at < 0) return null;
    const st = this.core.furnaceState(m.handle);
    const ingots = this.core.furnaceCollect(m.handle, 999);
    const oreLost = st?.oreCount ?? 0;
    this.core.furnaceDestroy(m.handle);
    // clone(true) SHARES geometry and material with the template, so nothing
    // here may be disposed: doing so would blank every furnace placed after it.
    this.group.remove(m.group);
    // By IDENTITY, not by id: a factory solid carries id 0 deliberately and
    // several may share it. FactorySolids.ts has the id-space argument.
    if (m.solid !== null) this.host()?.bodies?.remove((q) => q === m.solid);
    this.list.splice(at, 1);
    const item = m.tier === 1 ? this.core.ids.smelter : this.core.ids.furnace;
    const over = this.core.add(item, 1);
    this.removals++;
    this.oreLost += oreLost;
    return { item, refunded: 1 - over, ingots, oreLost };
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

  /**
   * Advance every machine by `ticks`. Returns the smelts completed.
   * `onSmelt` fires PER MACHINE, because the cue for a finished ingot has to
   * land on the furnace that made it and a total cannot say which one that was.
   */
  onSmelt: ((m: Machine, n: number) => void) | null = null;

  tick(ticks: number): number {
    let done = 0;
    for (const m of this.list) {
      const n = this.core.furnaceRun(m.handle, ticks);
      if (n > 0) this.onSmelt?.(m, n);
      done += n;
    }
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
    let bestT = Infinity;
    for (const m of this.list) {
      const u = MACHINE_CENTRE_UP_M;
      const ox = m.pos.x + m.up.x * u - eye.x;
      const oy = m.pos.y + m.up.y * u - eye.y;
      const oz = m.pos.z + m.up.z * u - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      // FS-93: `reachM` is PICK_REACH_PAST_SURFACE_M, a reach past the HOUSING,
      // and `t` is the distance to a CENTRE, so the half-extent comes back on.
      // It is the asset's own collision proxy rather than a table, because a
      // hand machine has no FOOTPRINT row and inventing one would be a second
      // copy of a dimension the .glb already publishes.
      const reach = reachM + tangentHalfExtentM(FILES[m.tier].url);
      if (t < -MACHINE_RADIUS_M || t > reach || t >= bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      if (Math.hypot(cx, cy, cz) > MACHINE_RADIUS_M + 0.5) continue;
      best = m; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown {
    return this.list.map((m, i) => ({
      id: i,
      handle: m.handle, tier: m.tier, state: this.core.furnaceState(m.handle),
      // The POSITION is part of the report so a probe can AIM at a machine it
      // placed rather than assume where the placement put it.
      pos: [m.pos.x, m.pos.y, m.pos.z],
      onDeck: m.onDeck,
      burning: m.burning, lit: Number(m.glow.lit.toFixed(3)),
      smokePuffs: this.smoke.live,
    }));
  }
}
