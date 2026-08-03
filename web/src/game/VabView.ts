// The assembly bay, in three.js. Builds the rocket out of the SHIPPED meshes and
// nothing else, so a part that mates in the picture mates in the sim.
//
// Two rules it obeys, both learned elsewhere in this project:
//   * A part node is CLONED before its sockets are read. Twenty parts in the
//     glb publish a node called `socket_stack_top`, so `getObjectByName` on the
//     file root returns an arbitrary one of them (build_rocket_parts.py:38).
//   * A missing mesh is DRAWN, not skipped. `EngineVacuumSmall` has no model
//     yet, and a part that silently fails to appear is a part the player thinks
//     they did not place. It gets a wireframe proxy at its true envelope, which
//     is honest about being a placeholder and is still exactly the right size.
import * as THREE from 'three';
import { loadGlb } from '../assets/Loaders.js';
import { findSocket, glow, paint } from './VabPaint.js';
import type { PartRow } from './VesselCatalogue.js';
import type { DesignPart } from './VesselDesign.js';
import type { AttachNode } from './VesselNodes.js';
import { ATTACH_RADIAL, ATTACH_TOP } from '../sim/wasm/vesselabi.js';

const GLB = 'assets/rocket/rocket_parts.glb';
const ROOT_NODE = 'RocketParts';

/**
 * TWO parts are named differently by `vessel.h` and by the shipped glb, and this
 * table is the whole reconciliation. It is NOT a second naming authority: it is
 * a named, bounded, ASSERTED debt, which is what DW-26 asks for when one fact
 * has two shapes. `probes/vab.js` fails if it has more than these two entries,
 * so it cannot grow quietly, and the fix is one string each in `vessel.h`
 * (raised to the physics lane; `PartDef::asset` is documented as "the glb node
 * name, EXACTLY", so the header is the side that is wrong).
 *
 * Measured against `web/public/assets/rocket/rocket_parts.glb`: 24 catalogue
 * assets, 24 glb group nodes, 22 agree by name.
 */
const ASSET_RENAMES: Record<string, string> = {
  LiquidEngineVacuumSmall: 'EngineVacuumSmall',
  DecouplerRadial: 'RadialDecoupler',
};

export interface PickHit { handle: number; point: THREE.Vector3 }

export class VabView {
  /** Parts that have no shipped mesh, by asset name. Reported, never hidden. */
  readonly missing = new Set<string>();
  /** Which catalogue names had to be routed through ASSET_RENAMES to resolve. */
  readonly renamed = new Set<string>();
  readonly assembly = new THREE.Group();

  private templates = new Map<string, THREE.Object3D>();
  private readonly ghost = new THREE.Group();
  private readonly markers = new THREE.Group();
  private readonly bodies = new Map<number, THREE.Object3D>();
  private readonly ray = new THREE.Raycaster();
  private pad!: THREE.Mesh;
  private grid!: THREE.GridHelper;
  private ready = false;
  /** GP-141. The three things the floor has to stay out of the way of: the
   *  committed assembly, the node markers, and the ghost. See `applyFloor`. */
  private assemblyBaseY = 0;
  private markerBaseY: number | null = null;
  private ghostBaseY: number | null = null;
  /** GP-297. The last ghost drawn was an INSERT preview. */
  ghostInsert = false;

  constructor(private readonly scene: THREE.Scene) {
    this.assembly.name = 'vabAssembly';
    this.ghost.name = 'vabGhost';
    this.markers.name = 'vabNodes';
    scene.add(this.assembly, this.ghost, this.markers);
    this.buildRoom();
  }

  get loaded(): boolean { return this.ready; }
  get partCount(): number { return this.bodies.size; }
  /** The size of the rename debt, so a probe can assert it does not grow. */
  static get renameCount(): number { return Object.keys(ASSET_RENAMES).length; }

  /** Load the catalogue's meshes once. Every part is a CLONE of a template. */
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
      if (node) this.templates.set(p.asset, node);
      else this.missing.add(p.asset);
    }
    this.ready = true;
  }

  // --- the room -------------------------------------------------------------

  private buildRoom(): void {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0x8899aa, 1.1));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
    key.position.set(6, 14, 9);
    s.add(key);
    const fill = new THREE.DirectionalLight(0x6688cc, 0.8);
    fill.position.set(-8, 4, -6);
    s.add(fill);

    // The pad and the grid are FLOOR, and a vessel is built downward from its
    // pod at the origin, so a floor pinned to y = 0 ends up cutting the rocket
    // in half. They follow the base of whatever is assembled instead
    // (setFloor), which is also what makes the bay read as a room.
    this.pad = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.6, 0.35, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.85, metalness: 0.1 }),
    );
    this.pad.name = 'vabPad';
    s.add(this.pad);

    this.grid = new THREE.GridHelper(60, 60, 0x4a5560, 0x2a3038);
    s.add(this.grid);
    this.applyFloor();

    // A backdrop rather than a clear colour, so the silhouette of a tall rocket
    // reads against something and a screenshot is not a black rectangle.
    const back = new THREE.Mesh(
      new THREE.SphereGeometry(180, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x0d1218, side: THREE.BackSide }),
    );
    back.name = 'vabBackdrop';
    s.add(back);
  }

  // --- the rocket -----------------------------------------------------------

  /** Rebuild the whole assembly. Tens of parts, so a rebuild is cheaper than a
   *  diff and cannot leave a stale mesh behind, which a diff can. */
  rebuild(parts: readonly DesignPart[], byId: (id: number) => PartRow | undefined): void {
    for (const o of [...this.assembly.children]) this.assembly.remove(o);
    this.bodies.clear();
    for (const p of parts) {
      const def = byId(p.partId);
      if (!def) continue;
      const obj = this.instance(def);
      obj.position.set(p.originM[0], p.originM[1], p.originM[2]);
      if (p.attach === ATTACH_RADIAL) obj.rotation.y = -p.radialAngleRad;
      obj.userData.handle = p.handle;
      this.assembly.add(obj);
      this.bodies.set(p.handle, obj);
    }
    let base = 0;
    for (const p of parts) {
      const def = byId(p.partId);
      if (def !== undefined) base = Math.min(base, p.originM[1]);
    }
    this.assemblyBaseY = base;
    this.applyFloor();
  }

  /**
   * GP-141. THE FLOOR STAYS OUT OF THE WAY OF WHAT IS BEING PREVIEWED, not just
   * of what is already built.
   *
   * The pad is an opaque 4.2 m disc whose top face sat EXACTLY on the lowest
   * committed part, and a downward attachment is by definition below that. So
   * the preview of every downward attachment was drawn entirely underneath it
   * and reached the screen as **zero pixels**, measured, on two stacks and two
   * node heights, against 625 for the same part going on top and 1259 for the
   * same part going on the side. The snap search answered `bottom` the whole
   * time. A player pointing at the base of their rocket saw nothing happen and
   * concluded, correctly from the evidence, that you can only build upward.
   *
   * `showNodes` already carries the argument in its own comment ("an invisible
   * snap is indistinguishable from a broken one"); this is that rule applied to
   * the thing standing in front of it. The floor now sits under the LOWEST of
   * the assembly, the drawn node markers and the ghost, so it opens downward
   * exactly as far as the preview needs and closes again when the hand empties.
   */
  private applyFloor(): void {
    let y = this.assemblyBaseY;
    if (this.markerBaseY !== null) y = Math.min(y, this.markerBaseY);
    if (this.ghostBaseY !== null) y = Math.min(y, this.ghostBaseY);
    this.pad.position.y = y - 0.175;
    this.grid.position.y = y - 0.35;
  }

  /** Where the floor is, so a probe asserts against the scene and not a copy of
   *  this arithmetic. */
  get floorTopY(): number { return this.pad.position.y + 0.175; }
  /** The base of the ghost currently previewed, or null if there is none. */
  get ghostBase(): number | null { return this.ghostBaseY; }

  /**
   * A clone of the shipped node, or a labelled wireframe if there is none.
   *
   * The clone keeps the AUTHORED materials. Recolouring a part by its stage was
   * tried and is the wrong trade: it throws away every material the art lane
   * shipped in order to say something the stage list says better, and it makes
   * a screenshot of the assembly bay look like coloured tubes rather than like
   * a rocket. Stage membership is communicated by the panel and by
   * `highlight()`, which is additive and reversible.
   */
  private instance(def: PartRow): THREE.Object3D {
    const t = this.templates.get(def.asset);
    if (t) {
      const c = t.clone(true);
      c.position.set(0, 0, 0);
      c.rotation.set(0, 0, 0);
      c.visible = true;
      // `col_*` is a broadphase proxy authored into the same file. Cloning the
      // subtree brings it along, and adding it to a scene draws a grey box
      // through the middle of the part (ASSET-SPECS 2.5).
      c.traverse((o) => { if (o.name.startsWith('col_')) o.visible = false; });
      return c;
    }
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.CylinderGeometry(def.diameterM * 0.5, def.diameterM * 0.5,
                                 def.heightM, 16),
      new THREE.MeshBasicMaterial({ color: 0xff5bd0, wireframe: true }),
    );
    box.position.y = def.heightM * 0.5;
    g.add(box);
    g.userData.placeholder = def.asset;
    return g;
  }

  // --- the ghost and the node markers ---------------------------------------

  showGhost(def: PartRow, origin: [number, number, number],
            angleRad: number, radial: boolean, ok: boolean,
            insert = false): void {
    this.clearGhost();
    const o = this.instance(def);
    o.position.set(origin[0], origin[1], origin[2]);
    if (radial) o.rotation.y = -angleRad;
    // GP-8's colour code: green valid, red hard-invalid, and GP-297 adds amber
    // for a valid INSERT. That is a third thing rather than a shade of either:
    // the placement is valid AND it is a different operation, and the arriving
    // part is drawn at the seam either way so the picture cannot otherwise say
    // that the stack is about to grow. `ghostInsert` is published so a probe
    // reads the state the painter was given rather than sampling a pixel.
    this.ghostInsert = ok && insert;
    paint(o, ok ? (insert ? 0xffa040 : 0x66ff99) : 0xff5555, 0.6);
    this.ghost.add(o);
    // A part's local origin is its own base (`instance` puts the placeholder
    // cylinder at `heightM * 0.5`), so the ghost's lowest point is its origin.
    // Taken from the definition rather than from a Box3, which would also
    // measure the `col_*` proxies this method has just hidden.
    this.ghostBaseY = origin[1];
    this.applyFloor();
  }

  clearGhost(): void {
    for (const o of [...this.ghost.children]) this.ghost.remove(o);
    this.ghostBaseY = null;
    this.ghostInsert = false;
    this.applyFloor();
  }

  /** The attachment points the part in hand could take. Drawn because an
   *  invisible snap is indistinguishable from a broken one. */
  showNodes(nodes: readonly AttachNode[], active: AttachNode | null): void {
    for (const o of [...this.markers.children]) this.markers.remove(o);
    if (nodes.length === 0) { this.markerBaseY = null; this.applyFloor(); return; }
    // GP-141, the half of it that happens BEFORE the player hovers anything. A
    // stack node sits on the axis of the face it belongs to, so the lowest one
    // is buried between the pad below it and the part's own hull above it, and
    // the marker that says "you may attach here" is the one marker a player
    // building downward never sees. MARKER_R * 1.8 is the hot scale below.
    let lowest = Infinity;
    for (const n of nodes) lowest = Math.min(lowest, n.posM[1]);
    this.markerBaseY = lowest - 0.22;
    const geo = new THREE.SphereGeometry(0.09, 8, 6);
    const dim = new THREE.MeshBasicMaterial({ color: 0x55ddff, transparent: true, opacity: 0.5 });
    const hot = new THREE.MeshBasicMaterial({ color: 0xffee66 });
    // GP-297. A SEAM IS A DIFFERENT KIND OF PLACE AND IS DRAWN AS ONE.
    //
    // The markers exist because "an invisible snap is indistinguishable from a
    // broken one" (this method's own comment), and the same argument decides
    // the colour: a seam that looks exactly like a free face is a place the
    // player has no reason to believe in until they happen to hover it. Amber
    // rather than cyan means the joints of a finished rocket are visibly
    // somewhere you can put something, which is the discoverable half of
    // GP-296. The HOT colour is deliberately shared, because what is under the
    // crosshair is one idea and should not have two highlights.
    const seam = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.6 });
    for (const n of nodes) {
      const isHot = active !== null && n.parent === active.parent
        && n.kind === active.kind && Math.abs(n.angleRad - active.angleRad) < 1e-9
        && Math.abs(n.offsetM - active.offsetM) < 1e-9;
      const m = new THREE.Mesh(geo,
        isHot ? hot : (n.kind === 'insert' ? seam : dim));
      m.position.set(n.posM[0], n.posM[1], n.posM[2]);
      if (isHot) m.scale.setScalar(1.8);
      this.markers.add(m);
    }
    this.applyFloor();
  }

  clearNodes(): void {
    for (const o of [...this.markers.children]) this.markers.remove(o);
    this.markerBaseY = null;
    this.applyFloor();
  }

  /**
   * Make a set of parts glow: the selection, or every part of one stage when
   * the player touches a stage row. Additive, so the authored materials survive
   * and clearing it restores them exactly.
   */
  highlight(handles: readonly number[], colour = 0x66ccff): void {
    for (const [h, o] of this.bodies) {
      const on = handles.includes(h);
      glow(o, on ? colour : 0x000000, on ? 0.55 : 0);
    }
  }

  // --- picking --------------------------------------------------------------

  /** Which part is under normalised device coords (x, y in [-1, 1])? */
  pick(cam: THREE.Camera, ndcX: number, ndcY: number): PickHit | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const hits = this.ray.intersectObject(this.assembly, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.handle === undefined) o = o.parent;
      if (o && typeof o.userData.handle === 'number') {
        return { handle: o.userData.handle, point: h.point.clone() };
      }
    }
    return null;
  }

  /** The aim ray in world space: origin and unit direction. */
  aimRay(cam: THREE.Camera, ndcX: number, ndcY: number):
      { o: [number, number, number]; d: [number, number, number] } {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const r = this.ray.ray;
    return {
      o: [r.origin.x, r.origin.y, r.origin.z],
      d: [r.direction.x, r.direction.y, r.direction.z],
    };
  }

  /**
   * Where the cursor meets the assembly, for the snap search. Falls back to the
   * point on the vertical axis plane nearest the ray, so a part can be attached
   * by aiming just OFF the hull, which is what a player actually does.
   */
  aimPoint(cam: THREE.Camera, ndcX: number, ndcY: number): THREE.Vector3 {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const hits = this.ray.intersectObject(this.assembly, true);
    const first = hits[0];
    if (first) return first.point.clone();
    // The plane through the stack axis facing the camera.
    const n = new THREE.Vector3();
    cam.getWorldDirection(n);
    n.y = 0;
    if (n.lengthSq() < 1e-9) n.set(0, 0, 1);
    n.normalize();
    const plane = new THREE.Plane(n, 0);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, out) ? out : new THREE.Vector3(0, 0, 0);
  }

  /**
   * MEASURE every mated stack joint on the DRAWN scene.
   *
   * For each stack-attached part this walks the three.js graph to the parent's
   * mating socket and the child's own, and returns the world-space distance
   * between them. It deliberately does not consult the layout it was built from:
   * a check that reads the model it drew would agree with itself whatever the
   * renderer did, and the whole question is whether the picture and the sim
   * agree. This is the same move `probes/buildtol.js` makes for foundations.
   *
   * `gapM` is null when a part has no shipped mesh, because a wireframe
   * placeholder publishes no sockets. That is reported, never counted as zero.
   */
  jointGaps(parts: readonly DesignPart[]): {
    child: number; parent: number; kind: string; gapM: number | null;
  }[] {
    this.assembly.updateMatrixWorld(true);
    const out: { child: number; parent: number; kind: string; gapM: number | null }[] = [];
    const pw = new THREE.Vector3(), cw = new THREE.Vector3();
    for (const p of parts) {
      if (p.parent < 0 || p.attach === ATTACH_RADIAL) continue;
      const parentObj = this.bodies.get(p.parent);
      const childObj = this.bodies.get(p.handle);
      if (!parentObj || !childObj) continue;
      // Going ON the parent's top, the child presents its own bottom, and the
      // other way round. Sockets are looked up on the CLONE, never on the file
      // root, because twenty parts publish a node called socket_stack_top.
      const onTop = p.attach === ATTACH_TOP;
      const pSock = findSocket(parentObj, onTop ? 'socket_stack_top' : 'socket_stack_bottom');
      const cSock = findSocket(childObj, onTop ? 'socket_stack_bottom' : 'socket_stack_top');
      const kind = onTop ? 'top' : 'bottom';
      if (!pSock || !cSock) {
        out.push({ child: p.handle, parent: p.parent, kind, gapM: null });
        continue;
      }
      pSock.getWorldPosition(pw);
      cSock.getWorldPosition(cw);
      out.push({ child: p.handle, parent: p.parent, kind, gapM: pw.distanceTo(cw) });
    }
    return out;
  }

  /**
   * Every attachment node with the SCREEN position it is drawn at, in
   * normalised device coords. This is what lets a driven probe put the cursor
   * on the pixel a player would aim at, rather than teleporting the snap: the
   * hit test, the snap search and the ghost all still run for real, and only
   * the eye is replaced.
   */
  projectNodes(cam: THREE.Camera, nodes: readonly AttachNode[]): {
    parent: number; kind: string; cls: number; angleRad: number; offsetM: number;
    /** GP-296. INSERT NODES: the part that would be displaced downward, -1 on
     *  every other kind. Reported because a seam with no child is an attach
     *  node wearing a different name and the splice would have nothing to move,
     *  and a probe that could not read it would have to infer it from a
     *  refusal. */
    child: number;
    pos: [number, number, number]; ndc: [number, number]; onScreen: boolean;
  }[] {
    const v = new THREE.Vector3();
    return nodes.map((n) => {
      v.set(n.posM[0], n.posM[1], n.posM[2]).project(cam);
      return {
        // GP-115: `cls` is REPORTED. The class a face presents is the one fact
        // in a node that can be silently wrong, and a diagnosis that cannot read
        // it has to infer it from a refusal string.
        parent: n.parent, kind: n.kind, cls: n.cls, child: n.child ?? -1,
        angleRad: n.angleRad, offsetM: n.offsetM,
        pos: n.posM, ndc: [v.x, v.y] as [number, number],
        onScreen: v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 && v.z < 1,
      };
    });
  }

  /** The world-space centre of the assembly's bounding box, and its size. */
  bounds(): { centre: THREE.Vector3; size: THREE.Vector3 } {
    const b = new THREE.Box3().setFromObject(this.assembly);
    if (b.isEmpty()) {
      return { centre: new THREE.Vector3(0, 2, 0), size: new THREE.Vector3(4, 4, 4) };
    }
    const centre = new THREE.Vector3(), size = new THREE.Vector3();
    b.getCenter(centre);
    b.getSize(size);
    return { centre, size };
  }
}
