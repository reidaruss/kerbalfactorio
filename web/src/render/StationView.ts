// RN-821. THE STATION, DRAWN. The 57 proxies have held a player up 400 km above
// the terrain since PH-105 and no mesh was ever added to any scene, so Reid has
// been standing in an invisible room with a planet under it. This is the mesh.
//
// IT IS ONE INSTANCE OF A `MachineBatch`, WHICH IS THE PRECEDENT AND NOT A
// CONVENIENCE. Everything else this project draws is scattered, batched or
// harvested; a station is a single large static object and the temptation is to
// add its GLTF scene to `scenes.near` and be done. That path is refused for
// three reasons, all of them things `MachineBatch` already solves:
//
//   THE LADDER. `space_station.glb` ships `Station_LOD0/1/2` and
//   `StationInt_LOD0/1`, and the asset lane authored them shadow-safe from the
//   first build rather than measuring afterwards (RN-761). `gatherTiers` plus
//   `addLadder` plus `attachShadowLod` is the only code in this project that
//   turns an authored ladder into a cascade actually drawing a cruder rung. A
//   raw `THREE.Group` would take the full 4.0x and the authoring would be
//   decoration.
//
//   THE DRAW COUNT. The five render nodes carry eight glTF primitives each
//   against eleven materials. As plain meshes that is sixteen draws for the two
//   resident tiers plus three shadow cascades apiece. Merged per tier into one
//   material it is TWO, however many materials the file was authored with.
//
//   THE REBASE. `sync` recomposes the engine transform from the f64 body-frame
//   pose every frame, exactly as `LaunchPadView.sync` and `StructureView.sync`
//   do, and `staleness()` below re-derives it a second way and asserts a hard
//   zero. The world-gen lane measured a cached engine transform left behind by
//   4,000.089191 m of rebase delta; a 67 m object 400 km out is the single
//   easiest place in this codebase to make that mistake invisibly.
//
// WHAT THE MERGE COSTS, STATED RATHER THAN HIDDEN: eleven authored materials
// collapse to one `panel` surface carrying colour and (RN-491) authored
// roughness and metalness per vertex. `OF_Glass` loses its transparency and
// `OF_EmissiveState` becomes the batch's status role driven by a flat texel.
// The interior is unskinned by design and the texturing pass is owed, so every
// one of those values is a placeholder today and the merge discards placeholder
// nuance. It is named here so the skin pass knows what it is buying back.
//
// WHEN IT DRAWS, AND THE RULE IS THE CAMERA'S OWN RATHER THAN A NUMBER I PICKED.
// The near camera's far plane is 100 km on reversed or log depth and 30 km on
// plain (`DepthPolicy.nearFarPlaneM`). A station 400 km below the player's usual
// anchor is BEHIND that plane: it could not rasterise a fragment if it tried,
// and the only thing drawing it would buy is 32k triangles of vertex work per
// pass times four passes, on a surface frame that already runs 555k to 1.0 M.
// So the gate is "is any part of it inside the near camera's far plane", which
// is `eyeDistM <= farPlaneM + boundM`, and both terms are read rather than
// chosen: the far plane from the depth policy, the bound from the batch's own
// merged geometry. There is no tunable constant in this file and therefore
// nothing to quietly tune when something looks wrong.
//
// IT CANNOT VANISH WHILE THE PLAYER IS INSIDE IT, which is the other half of the
// requirement and is why whole-mesh frustum culling is left OFF as `MachineBatch`
// sets it. A `BatchedMesh` bounding sphere is maintained across `setMatrixAt`
// calls by three rather than by this file, and a stale one culls; the failure
// mode of trusting it is the station disappearing from around a player standing
// in it, which is strictly worse than one draw call issued while looking away.

import * as THREE from 'three';
import { MachineBatch } from '../game/MachineBatch.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

/** The two render stems, and the contract's own names for them. `Station_*` is
 *  the pressure hulls and appendages, `StationInt_*` is the fitout. They are
 *  separate templates rather than one because their ladders are different
 *  depths (three rungs against two) and a ladder is measured per geometry. */
const HULL = 'station_hull';
const INT = 'station_int';
const HULL_NODES = ['Station_LOD0', 'Station_LOD1', 'Station_LOD2'];
const INT_NODES = ['StationInt_LOD0', 'StationInt_LOD1'];

/** Two instances, and there is exactly one station in the world. `MachineBatch`
 *  grows and shouts when it cannot (FS-16), so this is a starting size like
 *  every other pool and not a claim that a second station is illegal. */
const CAPACITY = 2;

/** The station carries no simulation state, so every instance gets a flat
 *  texel, exactly as a structural part and a launch pad do. */
const FLAT = { flow: 0, density: 0, state: 3, level: 0 };

/** Body-frame f64 metres. Matches `FloatingOrigin.toEngine`'s argument shape. */
interface Vec3d { x: number; y: number; z: number }

export class StationView {
  readonly group = new THREE.Group();
  readonly batch = new MachineBatch(CAPACITY, 'station');
  /** Body-frame pose, f64, the ONLY thing this view stores about where the
   *  station is. There is deliberately no engine-space field anywhere. */
  private pos: Vec3d | null = null;
  private quat = new THREE.Quaternion();
  private readonly slots = new Map<string, number>();
  /** Bound radius of the merged hull, metres, read off the geometry rather
   *  than off the contract, so the two cannot disagree. */
  private boundM = 0;
  private built = false;
  private lastEyeM = Infinity;
  private lastFarM = 0;
  private readonly p = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly origin: FloatingOrigin) {
    this.group.name = 'station';
    this.group.add(this.batch.group);
    // Absent until `place` has been told where the station is. A station that
    // failed to install must draw nothing rather than draw at the body centre.
    this.group.visible = false;
  }

  /**
   * Build the two templates from the GLTF scene `Boot` has already parsed.
   *
   * The nodes are gathered BY NAME into a holder rather than by handing
   * `gatherTiers` the whole root, because `LOD_MATCH` tier 0 is
   * `/_LOD0(?:_\d+)?$/` and both stems answer to it: one holder would merge the
   * hull and the fitout into a single rung and there would be no interior
   * ladder at all. Splitting them is what keeps `StationInt_LOD1`'s measured
   * 52.80 mm, and the cascade 1 it earns, from being averaged away against the
   * hull's 139.87.
   *
   * Every one of the five nodes is authored at identity under the `Station`
   * root (verified against the shipped glb, not assumed), so a clone flattened
   * to identity IS the geometry in the station's own local frame and the pose
   * lives entirely in the instance matrix where `sync` can rebuild it.
   */
  build(root: THREE.Object3D | null): boolean {
    if (root === null || this.built) return false;
    const hull = holder(root, HULL_NODES);
    if (hull === null) return false;
    const templates = new Map<string, { def: { url: string; root: string };
      scene: THREE.Object3D }>();
    templates.set(HULL, { def: { url: HULL, root: HULL }, scene: hull });
    const int = holder(root, INT_NODES);
    if (int !== null) templates.set(INT, { def: { url: INT, root: INT }, scene: int });
    this.batch.build(templates);
    const g = this.batch.geometryFor(HULL);
    if (g !== null) {
      g.computeBoundingSphere();
      this.boundM = g.boundingSphere?.radius ?? 0;
    }
    this.built = this.batch.geometryFor(HULL) !== null;
    return this.built;
  }

  /**
   * Where the station is, in the BODY frame, taken once at install.
   *
   * `pos` is the same `stateOf` answer the collision solid was built from and
   * the quaternion is `stationQuat`'s, so the drawn hull and the boxes a player
   * stands on are posed from ONE number. Deriving a second pose here, however
   * obviously correct the derivation looked, is the two-authority trap that put
   * `orbitdeck.js`'s corridor upside down while every assertion passed.
   */
  place(pos: readonly [number, number, number], quat: THREE.Quaternion): void {
    this.pos = { x: pos[0], y: pos[1], z: pos[2] };
    this.quat.copy(quat);
  }

  /** Forget the station. A teardown; a fresh boot places it again. */
  clear(): void { this.pos = null; this.group.visible = false; }

  /**
   * One pass: decide whether the station is inside the near camera's reach and,
   * if it is, recompose its engine transform from the f64 body-frame pose.
   *
   * `eyeM` is the near camera's world position and `farPlaneM` its far plane,
   * both handed in rather than reached for, so this file holds no opinion about
   * either and a probe can drive it with whatever it likes.
   */
  sync(eye: THREE.Vector3, farPlaneM: number): void {
    const pos = this.pos;
    if (pos === null || !this.built) { this.group.visible = false; return; }
    this.origin.toEngine(pos, this.p);
    this.lastEyeM = this.p.distanceTo(eye);
    this.lastFarM = farPlaneM;
    const near = this.lastEyeM <= farPlaneM + this.boundM;
    this.group.visible = near;
    if (!near) return;
    this.m.compose(this.p, this.quat, this.one);
    for (const key of [HULL, INT]) {
      let slot = this.slots.get(key);
      if (slot === undefined) {
        slot = this.batch.acquire(key);
        if (slot < 0) continue;
        this.slots.set(key, slot);
      }
      this.batch.place(slot, this.m);
      this.batch.setFx(slot, FLAT);
    }
    this.batch.flush();
  }

  stats(): unknown {
    return {
      ...this.batch.stats(),
      placed: this.pos !== null,
      visible: this.group.visible,
      keys: [...this.slots.keys()],
      boundM: +this.boundM.toFixed(3),
      // THE GATE, AS ITS TWO TERMS RATHER THAN AS ITS VERDICT. "visible: false"
      // is equally consistent with a correct cull, a station that never
      // installed and a pose that never arrived, and the three want opposite
      // fixes. Published as numbers, the reason is never in doubt.
      eyeDistM: Number.isFinite(this.lastEyeM) ? +this.lastEyeM.toFixed(3) : null,
      farPlaneM: this.lastFarM,
      // RN-1951. THE POSE `staleness()` BELOW CANNOT SEE.
      //
      // `staleness()` differences `m[12..14]` against `origin.toEngine(pos)`,
      // i.e. the TRANSLATION only. The drawn hull's ORIENTATION is never
      // compared with anything, so a hull posed at any roll whatsoever reports
      // `staleMaxM: 0` and `drawnParts: 2` and reads perfectly correct.
      //
      // THAT IS A FINDING ABOUT THE INSTRUMENT, NOT ABOUT ANY BUG. It is why
      // the OLD pose certificate for the `station` canonical shot was worthless:
      // CE-115..117's "the pose is fixed and holding" rested on a check that
      // could not have failed for a wrong roll, so it was never evidence.
      //
      // MEASURED THROUGH THE FIELDS BELOW, THE POSE IS FINE AND IS RULED OUT AS
      // A CAUSE: `quat`, `posB` and `posE` are bit-identical across a MODAL and
      // an EXCURSION capture of that shot, so the drawn hull's orientation does
      // not explain its residual and the pose fix stands with evidence behind
      // it. See rendering.md section 2.1.7 for what the residual actually is
      // (open), and for this lane's own refuted conclusions about it.
      //
      // Published as the raw quaternion and as the f64 body-frame position it
      // is composed with, because those two ARE the pose `sync` uses and a
      // derived Euler triple would be a second convention to get wrong.
      posB: this.pos === null ? null : [this.pos.x, this.pos.y, this.pos.z],
      quat: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      // RN-1955. AND THE SAME POINT IN ENGINE METRES, which is the one the
      // camera is actually differenced against. `posB` is f64 body frame and is
      // pinned by the orbital clock; `posE` is `posB` minus the FLOATING ORIGIN,
      // and the origin is not part of any pin this shot performs. Publishing
      // both is what makes "the hull is where the clock says" and "the hull is
      // where the camera will see it" two separate, checkable claims.
      posE: [this.p.x, this.p.y, this.p.z],
      ...this.staleness(),
    };
  }

  /**
   * IS THE STATION DRAWN WHERE IT ACTUALLY IS, in metres, and the answer is a
   * hard zero rather than a tolerance.
   *
   * PH-77 established the shape of this on the launch pad: a cached engine
   * transform is left behind by the whole floating-origin rebase delta, and the
   * symptom is not a wrong-looking object but an ABSENT one. The station is the
   * worst case in the project for it. Nothing about it moves, it is the only
   * thing in the world at 400 km, and "the station is gone" reads identically
   * whether the cause is a rebase, a refused slot, or the visibility gate above.
   *
   * The comparison is made in FLOAT32 through `Math.fround` for the reason
   * PH-77 gives: a `BatchedMesh` stores its matrices in a float32 DataTexture,
   * so differencing the read-back against the f64 original measures the storage
   * rather than the placement, and at 400 km float32's relative epsilon is
   * 2^-23 x 4e5 = 0.048 m. Rounding the expectation the way the GPU rounded the
   * reality is what keeps the zero exact instead of buying a 5 cm tolerance
   * that would then have to cover whatever it was next asked to.
   *
   * It reads the matrix the `BatchedMesh` will really draw with, never a mirror
   * of `sync`'s own decision, because a check recomputed out of the same
   * assumptions as the thing it checks agrees with it by construction.
   */
  private staleness(): { staleMaxM: number; drawnParts: number } {
    const out = { staleMaxM: 0, drawnParts: 0 };
    const pos = this.pos;
    if (pos === null) return out;
    this.origin.toEngine(pos, this.p);
    const f = Math.fround;
    for (const slot of this.slots.values()) {
      const m = this.batch.matrixAt(slot);
      if (m === null) continue;
      out.drawnParts++;
      const d = Math.hypot(m[12] - f(this.p.x), m[13] - f(this.p.y),
                           m[14] - f(this.p.z));
      if (d > out.staleMaxM) out.staleMaxM = d;
    }
    return out;
  }
}

/**
 * The named nodes in a holder at identity, which is the shape
 * `MachineBatch.build` traverses, or null when the file ships none of them.
 *
 * Cloned, so the source scene is never re-parented out from under the caller:
 * `Boot` hands over the SAME cached GLTF that `learnStationProxies` read the
 * collision boxes off, and `loadGlb` dedupes by path, so anything this function
 * did in place would be done to the physics lane's copy as well.
 */
function holder(root: THREE.Object3D, names: readonly string[]):
THREE.Object3D | null {
  const out = new THREE.Group();
  let n = 0;
  for (const name of names) {
    const node = root.getObjectByName(name);
    if (node === undefined) continue;
    const clone = node.clone(true);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    out.add(clone);
    n++;
  }
  return n === 0 ? null : out;
}
