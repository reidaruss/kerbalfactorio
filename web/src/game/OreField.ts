// WHAT AN ORE DEPOSIT LOOKS LIKE: a patch of ore-coloured ground with pieces of
// the body breaking through it, not a scatter of pebbles.
//
// The complaint this exists to answer is that a player could not tell what they
// were looking at. Twenty-four identical boulders in a meadow read as litter,
// and nothing about them said "put a machine here". So a deposit is now an AREA
// (deposits.h §P): the ground itself is tinted the resource's colour, strongest
// where the ore is richest, fading out at the rim, with outcrops standing in it.
//
// THIS MODULE OWNS NO RULE. The outline, the coverage, the amount and the
// outcrop layout all come out of /core through OrePatches. What is decided here
// is colour, geometry and where the mesh sits this frame.
//
// ONE DRAW CALL. Every patch's skin is merged into a single BufferGeometry with
// one material, and the colours ride in a vertex attribute, so a field of ore
// costs one draw whatever its size (the DW-11 argument applied to ground).
//
// WORLD-ANCHORED, and the anchor is the FIELD, not each patch: vertices are
// stored as metres about the first patch's centre (float32 is fine over a
// hundred metres and useless over six hundred kilometres, standing rule 6), and
// the mesh's position is re-derived through FloatingOrigin every frame.
//
// SURFACE AUTHORITY (standing rule 1). Every vertex asks of_surface_radius along
// the direction /core gave it, so the skin lies on the ONE surface the walker
// and the mesher read. `resnap` re-asks it, one patch per call, so ground that
// has been dug into or levelled does not leave the ore floating.

import * as THREE from 'three';
import { GROUND_COLOUR, PATCH_KINDS, mottle } from './NodeArt.js';
import { OrePatches, type PatchState } from './OrePatches.js';
import type { NodeField } from './NodeField.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** Skin tessellation. 3 rings by 28 segments is 112 vertices for a whole patch. */
const RINGS = 3;
const SEGS = 28;
/** Metres the skin floats above the ground, so it never fights the terrain. */
const LIFT_M = 0.25;
/** How far apart the patches are laid out around the spawn point. */
const SPREAD_M = 40;

interface Skin {
  patch: PatchState;
  /** Vertex range in the merged geometry, so depletion can restain just this one. */
  first: number;
  count: number;
  /** remaining/initial the colours were last written for. */
  drawnAt: number;
  /** Every outcrop node index this patch owns, for the report and the probe. */
  outcrops: number[];
}

export class OreField {
  readonly group = new THREE.Group();
  readonly patches: OrePatches;
  readonly skins: Skin[] = [];
  /** Body-frame metres the geometry is stored about. */
  private anchor = { x: 0, y: 0, z: 0 };
  private mesh: THREE.Mesh | null = null;
  private colours: THREE.BufferAttribute | null = null;
  private positions: THREE.BufferAttribute | null = null;
  /** Unit directions per vertex, kept so a re-snap does not re-enter /core twice. */
  private dirs: Float64Array = new Float64Array(0);
  private covers: Float32Array = new Float32Array(0);
  private nextResnap = 0;
  resnaps = 0;

  constructor(M: OfCoreModule, body: number,
              private readonly field: NodeField,
              private readonly origin: FloatingOrigin) {
    this.group.name = 'oreField';
    this.patches = new OrePatches(M, body);
  }

  /**
   * Lay a field of ore patches around `dir` and build everything that draws it.
   *
   * Order matters: the patches exist first, then their outcrops are added to the
   * node array (they are /core nodes so the aim, the swing and the harvest are
   * the ones a tree already uses), then the skin is built. Call it AFTER
   * NodeField.populate, which clears the node array.
   */
  populate(dir: THREE.Vector3, edits = 0): number {
    this.patches.clear();
    this.dispose();
    const d = dir.clone().normalize();
    this.patches.layout(PATCH_KINDS, d, SPREAD_M, edits);

    const all = this.patches.all();
    if (all.length === 0) return 0;
    this.anchor = { ...all[0].centre };

    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const dirs: number[] = [];
    const covers: number[] = [];
    for (const p of all) {
      const first = pos.length / 3;
      const verts = this.patches.mesh(p.index, RINGS, SEGS);
      if (verts.length === 0) continue;
      const tint = new THREE.Color(GROUND_COLOUR[p.kind] ?? 0x8d887e);
      for (const v of verts) {
        const r = this.patches.surfaceRadius(v.x, v.y, v.z, edits) + LIFT_M;
        pos.push(v.x * r - this.anchor.x, v.y * r - this.anchor.y,
          v.z * r - this.anchor.z);
        dirs.push(v.x, v.y, v.z);
        covers.push(v.cover);
        const k = mottle(v.x, v.y, v.z);
        col.push(tint.r * k, tint.g * k, tint.b * k, 0);   // alpha: stain()
      }
      // Ring r to ring r+1, two triangles a segment. Ring 0 is the centre point
      // repeated, so half of that first band is degenerate and costs nothing.
      for (let r = 0; r < RINGS; ++r) {
        for (let s = 0; s < SEGS; ++s) {
          const a = first + r * SEGS + s;
          const b = first + r * SEGS + ((s + 1) % SEGS);
          idx.push(a, b, a + SEGS, b, b + SEGS, a + SEGS);
        }
      }
      this.skins.push({
        patch: p, first, count: verts.length, drawnAt: -1,
        outcrops: this.addOutcrops(p, edits),
      });
    }
    this.build(pos, col, idx, dirs, covers);
    this.stain();
    return this.skins.length;
  }

  /** Register every outcrop of a patch as a /core node and give it its art. */
  private addOutcrops(p: PatchState, edits: number): number[] {
    const out: number[] = [];
    for (const o of this.patches.outcrops(p.index)) {
      const index = this.patches.addOutcrop(p.index, o.x, o.y, o.z, edits);
      if (index < 0) continue;
      // `sink` is a fraction of the piece's own size, so the metres it buries
      // scale with the piece: a big outcrop sits deeper than a stub.
      if (this.field.addOutcrop(index, o.scale, o.sink * o.scale)) out.push(index);
    }
    return out;
  }

  private build(pos: number[], col: number[], idx: number[],
                dirs: number[], covers: number[]): void {
    const g = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(pos), 3);
    this.colours = new THREE.BufferAttribute(new Float32Array(col), 4);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colours.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.positions);
    g.setAttribute('color', this.colours);
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.dirs = new Float64Array(dirs);
    this.covers = new Float32Array(covers);

    // Translucent at the rim so the patch DISSOLVES into the terrain instead of
    // ending on a hard circle, which is what makes it read as ore IN the ground
    // rather than a sticker on it. depthWrite off because it is a skin lying on
    // another surface.
    //
    // DOUBLE SIDED deliberately: one flat sheet costs nothing to draw twice, and
    // a winding-order mistake in a ring mesh is otherwise invisible in the way
    // that costs an hour, because the patch simply is not there while every
    // number about it reports healthy.
    //
    // NO polygonOffset, and that is not an oversight. The depth buffer here is
    // REVERSED, so the sign of an offset means the opposite of what it means
    // everywhere else: the conventional negative factor that pulls a decal in
    // front of its surface pushes this one BEHIND. The lift is metres of real
    // geometry instead, which no depth convention can invert.
    //
    // LAMBERT, not Standard. Standard's image-based lighting term is computed
    // from the sky environment and, on a nearly flat upward-facing sheet under
    // an open sky, it swamped an albedo this dark: a deep blue-grey ore body
    // rendered as pale wash and read as snow. Ore is matte. There is nothing
    // for a physically based specular lobe to do here.
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.name = 'oreField';
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'oreField';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /**
   * Write the vertex colours from coverage and how much ore is left.
   *
   * A worked-out patch fades: the ground is still stained but the colour goes
   * thin, so a player walking up can see from a distance that somebody has
   * already been here. It is the same signal the `_Low` node silhouette gives,
   * applied to ground.
   */
  private stain(): void {
    if (this.colours === null) return;
    const c = this.colours.array as Float32Array;
    let touched = false;
    for (const s of this.skins) {
      const live = this.patches.patch(s.patch.index);
      if (live === null) continue;
      const f = live.initial > 0 ? live.remaining / live.initial : 0;
      if (Math.abs(f - s.drawnAt) < 0.02) continue;
      s.drawnAt = f;
      touched = true;
      const fade = 0.25 + 0.75 * f;
      for (let i = 0; i < s.count; ++i) {
        const at = s.first + i;
        const cover = this.covers[at];
        const k = mottle(this.dirs[at * 3], this.dirs[at * 3 + 1], this.dirs[at * 3 + 2]);
        c[at * 4 + 3] = Math.min(0.93, cover * 2.3 * k) * fade;
      }
    }
    if (touched) this.colours.needsUpdate = true;
  }

  /**
   * Re-ask the surface oracle for ONE patch's vertices.
   *
   * Deposits live in the ground and the ground moves: a player who digs a pit in
   * a patch or levels it flat must not leave the ore hanging in the air. Doing
   * every patch every frame would be a few thousand synchronous oracle calls a
   * second for nothing, so this walks them round-robin and the caller decides
   * how often. The DIRECTIONS never change, only the radius: a patch is defined
   * in direction space and terrain cannot move it, only reveal or bury it.
   */
  resnap(edits: number): void {
    if (this.positions === null || this.skins.length === 0) return;
    const s = this.skins[this.nextResnap % this.skins.length];
    this.nextResnap++;
    const p = this.positions.array as Float32Array;
    for (let i = 0; i < s.count; ++i) {
      const at = (s.first + i) * 3;
      const dx = this.dirs[at], dy = this.dirs[at + 1], dz = this.dirs[at + 2];
      const r = this.patches.surfaceRadius(dx, dy, dz, edits) + LIFT_M;
      p[at] = dx * r - this.anchor.x;
      p[at + 1] = dy * r - this.anchor.y;
      p[at + 2] = dz * r - this.anchor.z;
    }
    this.positions.needsUpdate = true;
    this.resnaps++;
  }

  /** Per frame: put the field where the floating origin says it is, and restain. */
  update(): void {
    if (this.mesh === null) return;
    this.origin.toEngine(this.anchor, this.mesh.position);
    this.stain();
  }

  /** The patch under a body-frame point, or -1. THE drill placement question. */
  patchUnder(x: number, y: number, z: number): number {
    return this.patches.find(x, y, z);
  }

  private dispose(): void {
    if (this.mesh !== null) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.skins.length = 0;
    this.positions = null;
    this.colours = null;
  }

  report(): unknown {
    // The skin is REPORTED IN NUMBERS, not as "it exists". A mesh with zero
    // vertices, zero alpha or visible=false is the failure a patch count hides.
    const c = this.colours === null ? null : (this.colours.array as Float32Array);
    let maxAlpha = 0;
    if (c !== null) for (let i = 3; i < c.length; i += 4) maxAlpha = Math.max(maxAlpha, c[i]);
    return {
      patches: this.skins.length,
      resnaps: this.resnaps,
      drawCalls: this.mesh === null ? 0 : 1,
      skin: {
        vertices: this.positions === null ? 0 : this.positions.count,
        visible: this.mesh?.visible ?? false,
        maxAlpha: +maxAlpha.toFixed(3),
        liftM: LIFT_M,
        // What the shader is actually being handed. "the patch is drawn" is not
        // the claim; "it is drawn in the resource's colour" is, and a material
        // that quietly ignored the vertex attribute would look identical to a
        // colour choice that was simply too pale.
        itemSize: this.colours?.itemSize ?? 0,
        vertexColors: (this.mesh?.material as THREE.MeshStandardMaterial | undefined)
          ?.vertexColors ?? false,
        centreRGBA: c === null ? null : [+c[0].toFixed(3), +c[1].toFixed(3),
          +c[2].toFixed(3), +c[3].toFixed(3)],
      },
      list: this.skins.map((s) => {
        const live = this.patches.patch(s.patch.index) ?? s.patch;
        return {
          index: s.patch.index,
          kind: s.patch.kind,
          resource: s.patch.resource,
          radiusM: +s.patch.radiusM.toFixed(2),
          grade: +s.patch.grade.toFixed(3),
          initial: Math.round(live.initial),
          remaining: Math.round(live.remaining),
          outcrops: s.outcrops.length,
          centre: [s.patch.centre.x, s.patch.centre.y, s.patch.centre.z],
        };
      }),
    };
  }
}
