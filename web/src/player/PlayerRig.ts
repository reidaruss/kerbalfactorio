// One loaded, rigged, animated character asset. The SAME class serves the
// third-person body in the near scene and the first-person arms in the view
// model pass, because ASSET-SPECS 4.2 gave them identical bone names and
// identical impact frames on purpose: they differ in clip NAMES and bind pose,
// not in how they are driven.
//
// What this owns: the loaded scene graph, the AnimationMixer, the socket lookup
// and the tool held at socket_hand_R. What it does NOT own: where the character
// stands (Avatar), what the camera does (ViewMode), or which state is playing
// (AnimGraph, from the capsule).

import * as THREE from 'three';
import { loadGlb, selectLod } from '../assets/Loaders.js';
import { AnimGraph, type ClipMap, type PlayerAnim } from './AnimGraph.js';

export interface RigOptions {
  readonly url: string;
  readonly clips: ClipMap;
  readonly layer: number | null;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  /** Which authored LOD to show. The FP arms only have LOD0. */
  readonly lod: string;
}

export class PlayerRig {
  readonly group = new THREE.Group();
  private anim: AnimGraph | null = null;
  private sockets = new Map<string, THREE.Object3D>();
  private held: THREE.Object3D | null = null;
  private heldName = '';
  loaded = false;
  boneCount = 0;
  clipCount = 0;

  private constructor(private readonly opts: RigOptions) {
    this.group.name = `rig:${opts.url}`;
  }

  static async create(opts: RigOptions): Promise<PlayerRig> {
    const rig = new PlayerRig(opts);
    await rig.load();
    return rig;
  }

  private async load(): Promise<void> {
    const gltf = await loadGlb(this.opts.url);
    const root = gltf.scene;
    selectLod(root, this.opts.lod);
    root.traverse((o) => {
      if (this.opts.layer !== null) o.layers.set(this.opts.layer);
      const m = o as THREE.Mesh;
      if (m.isMesh === true) {
        m.castShadow = this.opts.castShadow;
        m.receiveShadow = this.opts.receiveShadow;
        // A SkinnedMesh's bounds are the BIND pose, and a clip moves vertices
        // outside them, so three would frustum-cull the character mid-stride.
        m.frustumCulled = false;
      }
      if (o.name.startsWith('socket_')) this.sockets.set(o.name, o);
      if ((o as THREE.Bone).isBone === true) this.boneCount++;
    });
    this.group.add(root);
    this.anim = new AnimGraph(root, gltf.animations, this.opts.clips);
    this.clipCount = this.anim.clipCount;
    this.loaded = true;
  }

  /**
   * Put a tool in the right hand. socket_hand_R is oriented so the tool's own
   * grip-point origin mates with an identity transform (ASSET-SPECS 4.3), so
   * this is genuinely `socket.add(tool)` and no per-tool offset table exists to
   * go stale.
   */
  async holdTool(url: string, lod = '_LOD0'): Promise<boolean> {
    if (this.heldName === url) return true;
    const socket = this.sockets.get('socket_hand_R');
    if (socket === undefined) return false;
    const gltf = await loadGlb(url);
    // The tool atlas is shared between the two rigs and between instances, so
    // each holder gets its own copy of the scene graph rather than stealing it.
    const tool = gltf.scene.clone(true);
    selectLod(tool, lod);
    tool.traverse((o) => {
      if (this.opts.layer !== null) o.layers.set(this.opts.layer);
      const m = o as THREE.Mesh;
      if (m.isMesh === true) {
        m.castShadow = this.opts.castShadow;
        m.receiveShadow = this.opts.receiveShadow;
        m.frustumCulled = false;
      }
    });
    if (this.held !== null) this.held.removeFromParent();
    socket.add(tool);
    this.held = tool;
    this.heldName = url;
    return true;
  }

  socket(name: string): THREE.Object3D | null { return this.sockets.get(name) ?? null; }
  get socketNames(): string[] { return [...this.sockets.keys()]; }
  get holding(): string { return this.heldName; }
  get playing(): string { return this.anim?.playing ?? ''; }

  setAnim(state: PlayerAnim, speedMps: number): void { this.anim?.set(state, speedMps); }
  update(dt: number): void { this.anim?.update(dt); }
}
