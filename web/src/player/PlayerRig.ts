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
import { attachSurface, familyForMaterial }
  from '../render/instancing/Surfaces.js';
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
  /**
   * Slot name -> the PRIMITIVES currently on the body. A-10 / GP-42.
   *
   * A LIST, not a mesh, and that is the whole trap: `Armour_Chest` is four
   * primitives in four materials, so GLTFLoader gives a Group whose children are
   * `Armour_Chest_0` to `_3`. Taking one match per slot bound 284 of the set's
   * 904 triangles and looked entirely correct, because every slot still had
   * SOMETHING on it. This is the same defect the belt-cargo loader hit when an
   * exact-name match loaded fifteen item meshes, registered one, and drew
   * nothing while reporting `meshes: 15`.
   */
  private readonly worn = new Map<string, THREE.SkinnedMesh[]>();
  /** Slot -> the node name the CALLER asked for, published so a probe can
   *  assert it is /core's `armourNode(slot)` and not a second derivation. */
  private readonly requested = new Map<string, string>();
  /** The rig's own skeleton, which armour pieces are rebound onto. */
  private skeleton: THREE.Skeleton | null = null;
  loaded = false;
  boneCount = 0;
  clipCount = 0;

  /**
   * Materials already registered with Surfaces, so a material shared between
   * primitives is registered ONCE.
   *
   * `attachSurface` appends to its own list unconditionally, so registering the
   * same material twice binds identical maps twice (harmless) and double-counts
   * it in `surfaceReport` (not harmless: that report is what a probe asserts
   * against). The body ships 8 materials across 3 LOD nodes and the tool atlas
   * is shared between both rigs and every instance of them, so this is a real
   * duplicate and not a theoretical one.
   */
  private readonly surfaced = new Set<THREE.Material>();

  /** `fparms` or `body`, from the asset filename: the surface-registry label
   *  prefix that keeps the two rigs' identically-named roles apart. */
  private readonly tag: string;

  private constructor(private readonly opts: RigOptions) {
    this.group.name = `rig:${opts.url}`;
    this.tag = opts.url.includes('fp_arms') ? 'fparms' : 'body';
  }

  /**
   * Give every material on `o` its surface family. RN-648.
   *
   * WHY THIS DID NOT EXIST UNTIL NOW, because the omission is more interesting
   * than the fix. `surfaces.json` has mapped `Suit`, `SuitDark` and `Plate` to
   * a family since DW-35, `surface_preview.py` honours that mapping, and every
   * studio render of the player since then has therefore shown maps THE GAME
   * DID NOT APPLY: this file never imported Surfaces at all. The four
   * consumers were `PropLibrary`, `MachineBatch`, `NodeBatch` and
   * `SpiderFlock`, which is to say every batched path and no per-object one.
   * The player is the only rendered asset in the game that is neither batched
   * nor merged, so it fell through the one gap in the coverage.
   *
   * `familyForMaterial` is used rather than a local role table for the reason
   * ASSET-SPECS 2.9 gives: the manifest is the authority, and a second copy of
   * the mapping on the client is a copy that goes stale. It reports an unknown
   * role as a `console.error`, which is a failed smoke run, so a material this
   * pass has not thought about announces itself rather than drawing untextured.
   *
   * Costs ZERO DW-10 slots: these are stock `MeshStandardMaterial` map slots
   * and the textures are the shared ones every other consumer already holds.
   */
  private surface(o: THREE.Object3D, tag: string): void {
    const m = (o as THREE.Mesh).material;
    if (m === undefined || m === null) return;
    for (const one of Array.isArray(m) ? m : [m]) {
      if (this.surfaced.has(one)) continue;
      this.surfaced.add(one);
      attachSurface(one as THREE.MeshStandardMaterial,
        familyForMaterial(one), `${tag}:${one.name}`);
    }
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
        // AFTER selectLod, so the LOD nodes this rig does not draw are not
        // registered: the FP arms ship LOD0 only, and registering a hidden
        // LOD1 would put a material in `surfaceReport` that never rasterises.
        //
        // The tag carries WHICH RIG, because the body and the FP arms are two
        // PlayerRig instances loading two .glb files that share every role
        // name. Tagging both `player:` gives two registry rows called
        // `player:OF_Suit` holding two genuinely different material objects,
        // which is indistinguishable in the report from the real defect of one
        // material registered twice. The first version of this did exactly
        // that and the probe reported six duplicates that were not duplicates.
        this.surface(m, this.tag);
      }
      if ((m as THREE.SkinnedMesh).isSkinnedMesh === true && this.skeleton === null) {
        this.skeleton = (m as THREE.SkinnedMesh).skeleton;
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
  async holdTool(url: string, lod = '_LOD0', carryTilt: THREE.Euler | null = null): Promise<boolean> {
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
        // The held tool too: in first person a pickaxe haft crosses more of
        // the frame than either glove does.
        this.surface(m, `${this.tag}:tool`);
      }
    });
    // carryTilt is a VIEW decision, not an asset offset. The FP arms' bind pose
    // is the view-model rest (ASSET-SPECS 4.2), so a tool mated at identity
    // stands the haft straight up through the middle of the screen. The body's
    // T-pose socket needs no tilt at all and gets none, which is why this is a
    // parameter rather than a per-tool table that would go stale.
    if (carryTilt !== null) tool.rotation.copy(carryTilt);
    if (this.held !== null) this.held.removeFromParent();
    socket.add(tool);
    this.held = tool;
    this.heldName = url;
    return true;
  }

  /**
   * Put an armour piece on this rig, or take it off (A-10, GP-42).
   *
   * The four node names in `armour_set.glb` are SLOT names, not set names
   * (`Armour_Head`, `Armour_Chest`, `Armour_Legs`, `Armour_Feet`), which is what
   * makes a second set a second FILE and nothing here move. /core's
   * `armourNode(EquipSlot)` returns the same four strings, so the lookup is an
   * array index and never a string built at runtime.
   *
   * The mesh is skinned to the BODY's own 44-bone rig, so it must be rebound to
   * THIS rig's skeleton: a `SkinnedMesh` cloned out of another glTF carries its
   * own `Skeleton` and would animate on a T-posed copy standing at the origin.
   * `bindMatrix` comes from the piece, not from the body, because the two files
   * share a bind pose by construction and asserting that is cheaper than
   * assuming it. Frustum culling is off for the same reason it is off on the
   * body: a `SkinnedMesh`'s bounds are the bind pose.
   */
  async equip(slot: string, url: string,
              node: string = `Armour_${slot}_LOD0`): Promise<boolean> {
    const skel = this.skeleton;
    if (skel === null) return false;
    if (this.worn.has(slot)) return true;
    const gltf = await loadGlb(url);
    // THE NODE NAME IS THE CALLER'S, and /core is the caller that matters
    // (H-4). `progression.h`'s `armourNode(EquipSlot)` publishes these four
    // strings and `Progression.armourNode` hands them straight through, so the
    // client does not hold a second derivation of a name the header owns. The
    // default keeps the debug surface and its slot-name call working, and
    // `armourDrift().requested` publishes which one was actually used so a
    // probe can assert the two agree instead of assuming it.
    //
    // `Armour_Head_LOD0`, optionally plus glTF's `_<n>` primitive suffix. An
    // anchored match rather than `startsWith`, which would also take a future
    // `Armour_HeadLamp`, and it is built with string concatenation because
    // inside a template literal `\d` is not an escape and silently becomes `d`,
    // giving a regex that matches nothing and an equip that returns false.
    const re = new RegExp('^' + node + '(_\\d+)?$');
    const src: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh === true && re.test(m.name)) src.push(m);
    });
    if (src.length === 0) return false;
    this.requested.set(slot, node);
    const pieces: THREE.SkinnedMesh[] = [];
    for (const one of src) {
      const piece = one.clone();
      piece.bind(skel, one.bindMatrix);
      piece.frustumCulled = false;
      piece.castShadow = this.opts.castShadow;
      piece.receiveShadow = this.opts.receiveShadow;
      // `clone()` SHARES the material with the source mesh, so the `surfaced`
      // set is what stops an armour set equipped, unequipped and re-equipped
      // from registering the same five materials over and over.
      this.surface(piece, `${this.tag}:armour:${slot}`);
      if (this.opts.layer !== null) piece.layers.set(this.opts.layer);
      this.group.add(piece);
      pieces.push(piece);
    }
    this.worn.set(slot, pieces);
    return true;
  }

  unequip(slot: string): boolean {
    const had = this.worn.get(slot);
    if (had === undefined) return false;
    for (const piece of had) piece.removeFromParent();
    this.worn.delete(slot);
    this.requested.delete(slot);
    return true;
  }

  get wornSlots(): string[] { return [...this.worn.keys()]; }

  /**
   * What `equip` CLAIMS, in a form a test can fail (standing rule 11).
   *
   * The claim is not "the armour looks right", it is "the piece is driven by
   * THIS rig's skeleton". `sameSkeleton` is an object identity, so it is exact
   * and it is the thing that breaks: a `SkinnedMesh` cloned out of another glTF
   * keeps its OWN skeleton, renders a T-posed shell that never moves, and looks
   * plausible in any still frame where the character happens to be standing.
   * `bones` against `bodyBones` catches the other failure, an armour file
   * authored against a different rig, which binds without error and deforms to
   * nothing. `triangles` is what the frame counter should go up by, which is
   * the only one of the three that is visible on screen.
   */
  armourDrift(): {
    slot: string; requested: string; nodes: string[]; primitives: number;
    sameSkeleton: boolean; bones: number; bodyBones: number; triangles: number;
  }[] {
    const out = [];
    for (const [slot, pieces] of this.worn) {
      let tris = 0;
      for (const p of pieces) {
        const idx = p.geometry.getIndex();
        tris += Math.floor((idx?.count ?? p.geometry.getAttribute('position').count) / 3);
      }
      out.push({
        slot, requested: this.requested.get(slot) ?? '',
        nodes: pieces.map((p) => p.name), primitives: pieces.length,
        sameSkeleton: pieces.every((p) => p.skeleton === this.skeleton),
        bones: pieces[0]?.skeleton?.bones.length ?? 0,
        bodyBones: this.skeleton?.bones.length ?? 0,
        triangles: tris,
      });
    }
    return out;
  }

  socket(name: string): THREE.Object3D | null { return this.sockets.get(name) ?? null; }
  get socketNames(): string[] { return [...this.sockets.keys()]; }
  get holding(): string { return this.heldName; }
  get playing(): string { return this.anim?.playing ?? ''; }

  clipTimings(): { name: string; duration: number; firstKeyT: number; tracks: number }[] {
    return this.anim?.timings() ?? [];
  }

  unmappedStates(): string[] { return this.anim?.unmapped() ?? []; }

  setAnim(state: PlayerAnim, speedMps: number): void { this.anim?.set(state, speedMps); }
  update(dt: number): void { this.anim?.update(dt); }
}
