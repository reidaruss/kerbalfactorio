// WHAT THE SHIPPED LAUNCH PAD SAYS ABOUT ITSELF: the module measured off its
// own bytes, the collision proxies read out of it, and the arithmetic that fans
// one authored clamp into four and swings them.
//
// Split from LaunchPad.ts along the seam StructureGrid.ts and Structures.ts
// already use, and for the same reason: one file answers "what does the asset
// say" and the other answers "what stands in the world". Everything here is a
// PURE FUNCTION OF THE .glb plus a couple of integers, so it can be called by a
// probe, by the placement rules and by the view without any of them holding a
// world, and none of it can go stale against the Blender build because none of
// it retypes a number the file already carries.

import * as THREE from 'three';
import { MAX_LEVEL, localOf, worldOf, type Site } from './StructureGrid.js';
import type { LocalBox } from './StructureBody.js';
import type { Structures } from './Structures.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** `survival::StructureKind::LaunchPad`. The /core enum value, which is how the
 *  pad's cost row is found: by its own `kind` FIELD and never by array
 *  position, so a sixth structural part appended in the header cannot silently
 *  re-point the client at somebody else's price. */
export const PAD_KIND = 4;

/**
 * The pad, measured off the file.
 *
 * `standM` is `socket_vessel`'s own height and is THE number the roll-out uses.
 * The socket's quaternion is byte-identical to `LiquidTankSmall/socket_stack_top`
 * in `rocket_parts.glb`: same translation, same rotation, same f32 bits, which
 * is the proof that a rocket meeting this pad is meeting the same contract it
 * meets when a tank is stacked on a tank, rather than a bespoke launch rule.
 */
export interface PadModule {
  /** Plan size, from the visual bound. 24.00 as shipped. */
  spanM: number;
  /** Height of the whole thing, tower and masts included. 28.00. */
  heightM: number;
  /** `socket_vessel.y`: how far above the pad's own base a vessel stands. */
  standM: number;
  /** `socket_clamp`'s radius from the stack axis. 1.90. */
  clampRadiusM: number;
  /** `socket_umbilical.y`. Reported so a probe can see the swing arm exists. */
  umbilicalM: number;
  /** How many clamps the client fans out. See `CLAMP_COUNT`. */
  clamps: number;
  /** `Clamp_Release`'s own duration, seconds. */
  swingSecs: number;
  /** The clip's last rotation key, radians. Negative swings the arm back. */
  swingRad: number;
  /** The clip's last translation key, as a retraction along local -Z. */
  retractM: number;
}

/**
 * FOUR CLAMPS, GENERATED HERE, AND THE FILE SHIPS ONE SOCKET.
 *
 * Measured off the bytes: `launch_pad.glb` contains exactly one `socket_clamp`,
 * at [1.9, 2, 0] facing inboard, and `contracts.json` says in prose that the
 * renderer "clones it and places four around the circle socket_clamp marks". So
 * the fan-out is the client's job by contract, and this constant is the client's
 * half of it. It is four because the arm's grip face sits 0.65 m in from its own
 * origin, which puts it at 1.90 - 0.65 = 1.25 m from the stack axis: exactly the
 * DW-29a class L hull radius, so four arms close on a class L stack by
 * construction rather than by tuning.
 */
export const CLAMP_COUNT = 4;

/** What a failed load leaves. Every field is overwritten by `measurePad`; these
 *  are only what a client whose assets did not arrive reads, and they are
 *  REPORTED so a stale one cannot pass for a measurement. */
export const PAD_FALLBACK: PadModule = {
  spanM: 24, heightM: 28, standM: 2, clampRadiusM: 1.9, umbilicalM: 13.6,
  clamps: CLAMP_COUNT, swingSecs: 0.4, swingRad: -70 * Math.PI / 180,
  retractM: 0.06,
};

/** A pad's occupancy key. Its own namespace, so it can never collide with a
 *  deck's `d:` or a wall's `w0:` however the numbers line up. */
export function padKey(siteId: number, i: number, j: number,
                       level: number): string {
  return `L${siteId}:${i},${j},${level}`;
}

/**
 * Measure the pad off the shipped bytes.
 *
 * FORWARD IS THE SOCKET'S LOCAL +Z, NOT ITS +Y, and getting that wrong is a
 * silent 90 degrees. The sockets are Blender empties whose forward is Blender
 * -Y, and the Z-up to Y-up conversion maps that to glTF +Z. It happens not to
 * matter for `socket_clamp` and `socket_umbilical`, whose quaternions are pure
 * Y rotations so their +Y is invariant, and it matters completely for
 * `socket_vessel`, whose +Y points at -Z. Nothing here reads +Y.
 */
export function measurePad(root: THREE.Object3D,
                           clips: readonly THREE.AnimationClip[]): PadModule {
  const m = { ...PAD_FALLBACK };
  root.updateWorldMatrix(true, true);
  const vessel = root.getObjectByName('socket_vessel');
  const clamp = root.getObjectByName('socket_clamp');
  const umb = root.getObjectByName('socket_umbilical');
  if (vessel !== undefined) m.standM = vessel.position.y;
  if (clamp !== undefined) m.clampRadiusM = Math.hypot(clamp.position.x,
    clamp.position.z);
  if (umb !== undefined) m.umbilicalM = umb.position.y;

  // The plan size and the height, from the DRAWN geometry only: a `col_*` box
  // is a proxy and a socket is a marker, and neither is the thing you can see.
  const box = new THREE.Box3();
  let any = false;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true || mesh.name.startsWith('col_')) return;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (bb === null) return;
    box.union(bb.clone().applyMatrix4(mesh.matrixWorld));
    any = true;
  });
  if (any) {
    m.spanM = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    m.heightM = box.max.y - box.min.y;
  }
  m.clamps = CLAMP_COUNT;

  // `Clamp_Release`, read rather than retyped, so a re-author in Blender moves
  // the arms in the browser with no code edit. The clip is never PLAYED (DW-8).
  const clip = clips.find((c) => c.name === 'Clamp_Release');
  if (clip !== undefined) {
    m.swingSecs = clip.duration;
    const rot = clip.tracks.find((t) => t.name.endsWith('.quaternion'));
    if (rot !== undefined && rot.values.length >= 4) {
      const n = rot.values.length;
      const q = new THREE.Quaternion(rot.values[n - 4], rot.values[n - 3],
        rot.values[n - 2], rot.values[n - 1]);
      m.swingRad = new THREE.Euler().setFromQuaternion(q, 'XYZ').x;
    }
    const tr = clip.tracks.find((t) => t.name.endsWith('.position'));
    if (tr !== undefined && tr.values.length >= 6) {
      const n = tr.values.length;
      // The retraction is the LAST key against the FIRST, along local Z, which
      // is the axis the arm reaches along. Differenced rather than read, so a
      // clip authored at a different rest offset still measures its own motion.
      m.retractM = tr.values[2] - tr.values[n - 1];
    }
  }
  return m;
}

/**
 * The pad's own collision proxies, EXCLUDING the clamp.
 *
 * `col_LaunchClamp` is authored at the file origin as a template for the four
 * clones (like the visual clamp), so taking it in place would put a
 * 1.6 x 2.4 x 0.7 m solid box on the launch mount exactly where the rocket
 * stands and where a player walks up to it. It is fanned out by `clampProxies`
 * instead. Everything else is used verbatim.
 *
 * ALL TWELVE OF THE OTHERS ARE TAKEN, whatever they are called and however
 * many there are, and that is the whole reason this reads the FILE. Two
 * separate omissions have already been survived by exactly that: `contracts.json`
 * listed four collision nodes for years while the file shipped five, the one it
 * omitted being `col_LaunchMount`, the launch table spanning the flame trench. A
 * client that built its proxies from the contract list would have dropped the
 * table and let a player fall down the trench.
 *
 * THE SECOND OMISSION WAS NOT SURVIVED, and it is why the count above is now
 * twelve. Reading the file is only a defence when the file HAS the thing: the
 * eight stair treads in the north-east notch were drawn and never proxied at
 * all, so the one route onto the deck on foot was 2.72 m of air ending in the
 * 2.00 m south face of `col_LaunchTrench` (measured, `probes/padstair.js`:
 * 0.000 m gained walking it, then wedged). They now ship as
 * `col_LaunchStep1` to `col_LaunchStep8` and arrive here with no code change,
 * which is this function working as intended. What was missing was a CHECK that
 * the declared set and the shipped set agree, in both directions:
 * `web/scripts/check-proxies.mjs`, wired into `npm run check`.
 *
 * NOTE THE `_\d+$` STRIP BELOW BEFORE NAMING A NEW PROXY. It exists so three's
 * split primitives of a multi-material mesh collapse back to one box, and it
 * means a set of proxies named `col_Step_1`, `col_Step_2` ... would be read as
 * ONE box. That is why the treads are `col_LaunchStep1` and not
 * `col_LaunchStep_1`, and check-proxies.mjs refuses the other spelling.
 */
export function padProxies(root: THREE.Object3D): LocalBox[] {
  const out: LocalBox[] = [];
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const mm = new THREE.Matrix4();
  const seen = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.name.startsWith('col_')) return;
    const base = mesh.name.replace(/_\d+$/, '');
    if (base === 'col_LaunchClamp' || seen.has(base)) return;
    seen.add(base);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (bb === null) return;
    const b = bb.clone().applyMatrix4(mm.multiplyMatrices(inv, mesh.matrixWorld));
    out.push({ min: [b.min.x, b.min.y, b.min.z],
      max: [b.max.x, b.max.y, b.max.z], leaf: false });
  });
  return out;
}

/**
 * The four clamps, as boxes that exist only while they are HOLDING.
 *
 * `leaf: true` is `StructureBodies`' own present-or-absent flag, read against
 * `Solid.shut`, and it is reused here exactly rather than copied: a released
 * clamp is a swung panel and DW-12 says there is no physics engine to swing it
 * with, so present-or-absent is all a kinematic walker can honestly offer. It
 * is the same answer GP-24 reached for the door leaf.
 *
 * The clone transform is `R_y(k * 90) . T(radius, 0, 0) . R_y(-90)`, which is
 * the fan-out the single shipped socket describes: `R_y(-90)` turns the arm's
 * own +Z reach INBOARD, the translation puts it on the socket's circle, and the
 * outer rotation walks it round. At k = 0 that reproduces `socket_clamp`'s own
 * position and forward exactly, which is the check that the composition is the
 * right way round rather than the mirror of it.
 */
export function clampProxies(root: THREE.Object3D, m: PadModule): LocalBox[] {
  const src = root.getObjectByName('col_LaunchClamp');
  if (src === undefined) return [];
  const mesh = src as THREE.Mesh;
  if (mesh.isMesh !== true) return [];
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  if (bb === null) return [];
  const out: LocalBox[] = [];
  const v = new THREE.Vector3();
  for (let k = 0; k < m.clamps; ++k) {
    const M = clampMatrix(k, m, 0, new THREE.Matrix4());
    // The clamp is a box in a frame that is a whole number of quarter turns
    // from the pad's, so its transformed bound IS a box and not an
    // approximation of one. That is why this can stay an AABB set.
    const b = new THREE.Box3();
    for (const [x, y, z] of corners(bb)) b.expandByPoint(v.set(x, y, z).applyMatrix4(M));
    out.push({ min: [b.min.x, b.min.y, b.min.z],
      max: [b.max.x, b.max.y, b.max.z], leaf: true });
  }
  return out;
}

function corners(b: THREE.Box3): [number, number, number][] {
  return [
    [b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z],
    [b.min.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.min.z],
    [b.min.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.max.z],
    [b.min.x, b.max.y, b.max.z], [b.max.x, b.max.y, b.max.z],
  ];
}

/**
 * Clamp `k`'s transform in the pad's own frame, at swing `t` in 0..1.
 *
 * `t` composes the authored motion INSIDE the clamp's frame: the pivot's own
 * offset out, the swing and the retraction, then the offset back. Both come off
 * the clip; nothing here decides how far a clamp opens.
 */
export function clampMatrix(k: number, m: PadModule, t: number,
                            out: THREE.Matrix4): THREE.Matrix4 {
  const step = (Math.PI * 2) / Math.max(1, m.clamps);
  out.makeRotationY(k * step);
  const place = new THREE.Matrix4().makeTranslation(m.clampRadiusM, 0, 0);
  out.multiply(place).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  if (t > 0) {
    out.multiply(new THREE.Matrix4().makeRotationX(m.swingRad * t));
    out.multiply(new THREE.Matrix4().makeTranslation(0, 0, -m.retractM * t));
  }
  return out;
}

/** Site-local (east, north, up) of a pad's origin cell block. */
export function padAnchor(site: Site, cellM: number, storeyM: number,
                          deckH: number, i: number, j: number, level: number,
                          cells: number, out: Vec3d): Vec3d {
  return worldOf(site, (i + cells * 0.5) * cellM, (j + cells * 0.5) * cellM,
    level * storeyM + deckH, out);
}

/** Which 6 x 6 block an aim point names: the block CENTRED on the cell the aim
 *  is in, so the ghost follows the crosshair rather than a corner of it. */
export function padBlockAt(s: Structures, site: Site, p: Vec3d, cells: number):
{ i: number; j: number; level: number } {
  const l = localOf(site, p, new THREE.Vector3());
  const C = s.module.cellM;
  const ci = Math.floor(l.x / C), cj = Math.floor(l.y / C);
  const half = Math.floor(cells / 2);
  const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(l.z / s.module.storey)));
  return { i: ci - half, j: cj - half, level };
}
