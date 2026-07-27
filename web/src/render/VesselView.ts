// The FLYING rocket, drawn into the near 1:1 scene out of the SHIPPED meshes.
//
// Sibling of game/VabView.ts: the bay draws a blueprint standing on a pad, this
// draws the same parts as a vehicle in the world. It borrows the bay's two hard
// rules verbatim, because both were learned the expensive way:
//
//   * A part node is CLONED before its sockets are read. Twenty parts in
//     rocket_parts.glb publish a node called `socket_stack_top` and most of them
//     publish `socket_stack_bottom` too, so GLTFLoader.createUniqueName renames
//     all but one of each and a `getObjectByName` against the FILE ROOT answers
//     with whichever part happened to be first, resolving the other nineteen to
//     nothing. Every socket lookup below is scoped to ONE cloned part, through
//     VabPaint.findSocket, which also tolerates the `_7`-shaped suffix.
//   * A missing mesh is DRAWN, not skipped. A part that silently vanishes is a
//     part the player believes a staging event ate. It gets a wireframe proxy at
//     its true envelope: a placeholder that is honest and the right size.
//
// Floating origin (ARCHITECTURE.md 3.6): this view holds NO 64-bit anchor and
// never applies a rebase delta. `place()` takes a position the caller already
// differenced in f64, which is what FloatingOrigin.toEngine produces.

import * as THREE from 'three';
import { loadGlb, renderMeshes } from '../assets/Loaders.js';
import { findSocket } from '../game/VabPaint.js';
import type { PartRow } from '../game/VesselCatalogue.js';
import { ATTACH_RADIAL } from '../sim/wasm/vesselabi.js';
import { VesselPlume } from './VesselPlume.js';
import type { PlumeNozzle } from './VesselPlume.js';

const GLB = 'assets/rocket/rocket_parts.glb';
const ROOT_NODE = 'RocketParts';

/**
 * MIRROR of VabView's table, and knowingly a duplicate. Two parts are named
 * differently by `vessel.h` and by the shipped glb; VabView documents that debt
 * in full and does not export the table, so the flight view restates it rather
 * than importing the whole assembly bay to read two strings. The duplication is
 * bounded by `renameCount`, which a probe can assert against
 * `VabView.renameCount`, and both copies die when `vessel.h` is corrected.
 */
const ASSET_RENAMES: Record<string, string> = {
  LiquidEngineVacuumSmall: 'EngineVacuumSmall',
  DecouplerRadial: 'RadialDecoupler',
};

/** One part of the live craft, as `of_fl_parts` + `of_fl_transforms` deliver it. */
export interface FlightPartDraw {
  handle: number; partId: number; attach: number;
  /** Part origin in the vessel's own local frame, metres. +Y is the stack axis
   *  toward the nose. */
  originM: [number, number, number];
  radialAngleRad: number;
}

export class VesselView {
  /** Parts with no shipped mesh, by asset name. Reported, never hidden. */
  readonly missing = new Set<string>();
  /** Which catalogue names had to be routed through ASSET_RENAMES to resolve. */
  readonly renamed = new Set<string>();
  /** Carries the craft's world placement. Everything else hangs off it. */
  readonly root = new THREE.Group();
  /** The parts, in the vessel's own local frame. Identity under `root`. */
  readonly assembly = new THREE.Group();

  private readonly plume: VesselPlume;
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly templateBox = new Map<string, THREE.Box3>();
  private readonly proxyGeo = new Map<string, THREE.CylinderGeometry>();
  private readonly proxyMat =
    new THREE.MeshBasicMaterial({ color: 0xff5bd0, wireframe: true });
  private readonly bodies = new Map<number, THREE.Object3D>();
  /** Each drawn part's AABB in that PART's own frame. */
  private readonly partBox = new Map<number, THREE.Box3>();
  /** Each drawn part's exhaust point, in the VESSEL's frame. */
  private readonly nozzles = new Map<number, PlumeNozzle>();
  private readonly bounds = new THREE.Box3();
  private readonly basis = new THREE.Matrix4();
  private readonly ax = new THREE.Vector3();
  private readonly ay = new THREE.Vector3();
  private readonly az = new THREE.Vector3();
  private readonly firing: PlumeNozzle[] = [];
  private ready = false;
  private rebuilds = 0;
  private lowY = 0;
  private radius = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'vessel';
    this.assembly.name = 'vesselAssembly';
    this.root.add(this.assembly);
    this.plume = new VesselPlume(this.root);
    scene.add(this.root);
  }

  get loaded(): boolean { return this.ready; }
  get partCount(): number { return this.bodies.size; }
  /** The size of the rename debt, so a probe can assert it does not grow. */
  static get renameCount(): number { return Object.keys(ASSET_RENAMES).length; }

  /** Load the part meshes once. Same glb and same rename table as VabView, and
   *  the same shared `loadGlb` cache, so having both views alive costs one
   *  fetch and one parse rather than two. */
  async load(catalogue: readonly PartRow[]): Promise<void> {
    const gltf = await loadGlb(GLB);
    const root = gltf.scene.getObjectByName(ROOT_NODE) ?? gltf.scene;
    for (const p of catalogue) {
      let node = root.getObjectByName(p.asset);
      if (!node) {
        const alt = ASSET_RENAMES[p.asset];
        if (alt !== undefined) {
          node = root.getObjectByName(alt);
          if (node) this.renamed.add(p.asset);
        }
      }
      if (node) {
        this.templates.set(p.asset, node);
        this.templateBox.set(p.asset, measure(node));
      } else {
        this.missing.add(p.asset);
      }
    }
    this.ready = true;
  }

  // --- the craft --------------------------------------------------------------

  /** Rebuild the whole assembly. Tens of parts, so a rebuild is cheaper than a
   *  diff and cannot leave a stale mesh behind, which a diff can. Called on
   *  launch and after every staging event, never per frame. */
  rebuild(parts: readonly FlightPartDraw[],
          byId: (id: number) => PartRow | undefined): void {
    for (const o of [...this.assembly.children]) this.assembly.remove(o);
    this.bodies.clear();
    this.partBox.clear();
    this.nozzles.clear();
    for (const p of parts) {
      const def = byId(p.partId);
      if (!def) continue;
      const made = this.instance(def);
      const obj = made.obj;
      // Read the nozzle while the clone is still DETACHED, so walking up from
      // the socket stops at the part and gives the socket in the part's own
      // frame. Once it is parented the same walk would drag the vessel's world
      // placement in with it.
      const nozzle = nozzleOf(obj, made.box, def);
      obj.position.set(p.originM[0], p.originM[1], p.originM[2]);
      // Same rule as the bay (VabView.rebuild): a radial part is yawed by the
      // NEGATIVE of its mount angle, so a booster the sim mounted at 90 degrees
      // is drawn facing the way the sim mounted it.
      if (p.attach === ATTACH_RADIAL) obj.rotation.y = -p.radialAngleRad;
      obj.updateMatrix();
      nozzle.pos.applyMatrix4(obj.matrix);
      this.assembly.add(obj);
      this.bodies.set(p.handle, obj);
      this.partBox.set(p.handle, made.box);
      this.nozzles.set(p.handle, nozzle);
    }
    this.rebuilds += 1;
    this.remeasure();
    this.root.updateMatrixWorld(true);
  }

  /**
   * Stand the craft in engine space.
   *
   * HANDEDNESS, stated because getting it wrong is invisible from most angles.
   * three's `Matrix4.makeBasis(x, y, z)` writes its arguments as the COLUMNS, so
   * the matrix maps local +X onto `x` and local +Y onto `y`, which is the frame
   * the part origins are authored in (+Y toward the nose, +X vessel right). The
   * third column must be X cross Y, NOT Y cross X, to keep the determinant at
   * +1: worked example, right = (1,0,0) with forward = (0,1,0) gives
   * crossVectors(right, forward) = (0,0,1), an identity basis of determinant +1,
   * while crossVectors(forward, right) = (0,0,-1) gives determinant -1, a
   * reflection, which draws a MIRRORED rocket. General case, same answer: for
   * orthonormal X and Y, det[X Y (X cross Y)] = X dot (Y cross (X cross Y))
   * = X dot X = 1. Confirmed numerically against three r185 on the axis-aligned
   * case, a nose-east case and an off-axis tilted case: determinant +1 in all
   * three, and the quaternion maps local +Y exactly onto `forward`.
   *
   * `right` is re-orthogonalised against `forward` first. The two arrive from
   * the flight state as separate rows, and an integrator that has drifted a
   * milliradian would otherwise shear the model instead of rotating it.
   */
  place(posEngine: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3): void {
    this.root.position.copy(posEngine);
    const y = this.ay.copy(forward);
    if (y.lengthSq() < 1e-12) y.set(0, 1, 0);
    y.normalize();
    const x = this.ax.copy(right);
    x.addScaledVector(y, -x.dot(y));
    if (x.lengthSq() < 1e-12) {
      // `right` was parallel to `forward`, so any perpendicular will do: the
      // roll is arbitrary but the craft is at least not degenerate.
      x.set(1, 0, 0).addScaledVector(y, -y.x);
      if (x.lengthSq() < 1e-12) x.set(0, 0, 1).addScaledVector(y, -y.z);
    }
    x.normalize();
    const z = this.az.crossVectors(x, y);
    this.basis.makeBasis(x, y, z);
    this.root.quaternion.setFromRotationMatrix(this.basis);
    this.root.updateMatrix();
    this.root.updateMatrixWorld(true);
  }

  /** Light the engines. Handles this view does not know are ignored rather than
   *  throwing: the active engine list comes from /core and can name a part a
   *  staging event has already taken off the craft. */
  setPlume(throttle: number, activeEngineHandles: readonly number[]): void {
    this.firing.length = 0;
    for (const h of activeEngineHandles) {
      const n = this.nozzles.get(h);
      if (n !== undefined) this.firing.push(n);
    }
    this.plume.set(this.firing, throttle);
  }

  setVisible(on: boolean): void { this.root.visible = on; }

  /** Local-frame Y of the LOWEST point of the assembly, metres. Negative below
   *  the origin. The caller uses this to stand the rocket on the ground. */
  lowestLocalY(): number { return this.lowY; }

  /** Bounding radius in metres, about the vessel's own origin, for framing. */
  boundingRadius(): number { return this.radius; }

  /** Engine-space world position of a part's centre, for the exhaust plume. */
  partWorldPosition(handle: number, out: THREE.Vector3): boolean {
    const obj = this.bodies.get(handle);
    const box = this.partBox.get(handle);
    if (obj === undefined || box === undefined) return false;
    box.getCenter(out);
    this.root.updateMatrixWorld(true);
    obj.localToWorld(out);
    return true;
  }

  dispose(): void {
    this.plume.dispose();
    for (const g of this.proxyGeo.values()) g.dispose();
    this.proxyGeo.clear();
    this.proxyMat.dispose();
    // The templates belong to the shared glb cache and to whoever else cloned
    // them (VabView clones the same nodes), so they are dropped, never disposed.
    this.templates.clear();
    this.templateBox.clear();
    this.bodies.clear();
    this.partBox.clear();
    this.nozzles.clear();
    for (const o of [...this.assembly.children]) this.assembly.remove(o);
    this.root.removeFromParent();
  }

  report(): unknown {
    return {
      loaded: this.ready,
      parts: this.bodies.size,
      missing: [...this.missing],
      renamed: [...this.renamed],
      visible: this.root.visible,
      rebuilds: this.rebuilds,
      lowestLocalY: this.lowY,
      boundingRadius: this.radius,
      // WHERE THE MESHES ACTUALLY ARE (PH-31), so "the rocket is not on the
      // pad" is a number and not a screenshot somebody has to notice.
      drawnEngineM: [this.root.position.x, this.root.position.y, this.root.position.z],
      plumeThrottle: this.plume.throttle,
      plumes: this.plume.count,
      templates: this.templates.size,
      nozzles: this.nozzles.size,
    };
  }

  // --- internals --------------------------------------------------------------

  /**
   * A clone of the shipped node with its own local box, or a labelled wireframe
   * at the catalogue's envelope if the part has no mesh. The clone keeps the
   * AUTHORED materials, for the same reason VabView does: recolouring by stage
   * throws away everything the art lane shipped to say something the staging
   * panel says better.
   */
  private instance(def: PartRow): { obj: THREE.Object3D; box: THREE.Box3 } {
    const t = this.templates.get(def.asset);
    if (t) {
      const c = t.clone(true);
      c.position.set(0, 0, 0);
      c.rotation.set(0, 0, 0);
      c.visible = true;
      // `col_*` is a broadphase proxy authored into the same file. Cloning the
      // subtree brings it along, and drawing it puts a grey box through the
      // middle of the part (ASSET-SPECS 2.5).
      c.traverse((o) => { if (o.name.startsWith('col_')) o.visible = false; });
      return { obj: c, box: this.templateBox.get(def.asset) ?? new THREE.Box3() };
    }
    const r = def.diameterM * 0.5;
    let geo = this.proxyGeo.get(def.asset);
    if (geo === undefined) {
      geo = new THREE.CylinderGeometry(r, r, def.heightM, 16);
      // Translated in the GEOMETRY so the shared cylinder sits on the part
      // origin and every placeholder instance is a plain mesh at zero.
      geo.translate(0, def.heightM * 0.5, 0);
      this.proxyGeo.set(def.asset, geo);
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, this.proxyMat));
    g.name = `placeholder_${def.asset}`;
    return {
      obj: g,
      box: new THREE.Box3(new THREE.Vector3(-r, 0, -r),
                          new THREE.Vector3(r, def.heightM, r)),
    };
  }

  /**
   * The assembly's extent in the VESSEL's own frame, recomputed on rebuild only.
   *
   * `Box3.setFromObject` is deliberately not used: it reads matrixWorld, so it
   * would measure the craft wherever `place()` last put it, which is the wrong
   * frame for a value the caller uses to stand the rocket on the ground, and it
   * ignores `visible`, so it would swallow the `col_*` proxies too. Composing
   * each part's cached local box through that part's own matrix is exact
   * instead: `Box3.applyMatrix4` refits over the eight transformed corners, so
   * the radial yaw is accounted for rather than approximated.
   */
  private remeasure(): void {
    this.bounds.makeEmpty();
    const tmp = new THREE.Box3();
    for (const [h, obj] of this.bodies) {
      const b = this.partBox.get(h);
      if (b === undefined || b.isEmpty()) continue;
      this.bounds.union(tmp.copy(b).applyMatrix4(obj.matrix));
    }
    if (this.bounds.isEmpty()) {
      this.lowY = 0;
      this.radius = 0;
      return;
    }
    const mn = this.bounds.min, mx = this.bounds.max;
    this.lowY = mn.y;
    // The farthest corner from the vessel ORIGIN, taken per axis. The radius is
    // about the origin and not about the box centre, because the caller frames
    // the camera on the craft's origin, which is where `place()` put it.
    this.radius = Math.hypot(
      Math.max(Math.abs(mn.x), Math.abs(mx.x)),
      Math.max(Math.abs(mn.y), Math.abs(mx.y)),
      Math.max(Math.abs(mn.z), Math.abs(mx.z)));
  }
}

/**
 * Where a part's exhaust leaves it, in that PART's own frame.
 *
 * The socket is looked up on the CLONE and never on the loaded file, which is
 * the rule at the top of this file: most parts in the glb publish
 * `socket_stack_bottom`, so the loader has renamed all but one of them and a
 * file-root lookup would answer with an arbitrary part's nozzle. `obj` must
 * still be DETACHED here, so the walk up from the socket stops at the part.
 * Falls back to the bottom centre of the part's box, where a nozzle is anyway. */
function nozzleOf(obj: THREE.Object3D, box: THREE.Box3, def: PartRow): PlumeNozzle {
  const p = new THREE.Vector3();
  const sock = findSocket(obj, 'socket_stack_bottom');
  if (sock) {
    sock.updateWorldMatrix(true, false);
    p.setFromMatrixPosition(sock.matrixWorld);
  } else if (box.isEmpty()) {
    p.set(0, 0, 0);
  } else {
    box.getCenter(p);
    p.y = box.min.y;
  }
  return { pos: p, radiusM: Math.max(0.05, def.diameterM * 0.5) };
}

/**
 * The AABB of a part's RENDER meshes, in the part's own frame.
 *
 * Measured on a DETACHED clone: an unparented Object3D's matrixWorld is its own
 * matrix, so after one `updateMatrixWorld` every mesh's matrixWorld is exactly
 * its transform relative to the part, which is what a local box needs.
 * `renderMeshes` is what drops the `col_*` broadphase boxes, which are inside
 * the same file and are roughly a part's envelope plus slop.
 */
function measure(node: THREE.Object3D): THREE.Box3 {
  const c = node.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.scale.set(1, 1, 1);
  c.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const m of renderMeshes(c)) {
    const g = m.geometry;
    if (g.boundingBox === null) g.computeBoundingBox();
    if (g.boundingBox === null) continue;
    box.union(tmp.copy(g.boundingBox).applyMatrix4(m.matrixWorld));
  }
  return box;
}
