// THE NEAR CREATURES, SKINNED AND WALKING: a small pool of rigged spider
// instances that the closest members of the swarm are promoted into.
//
// RN-122 / RN-123. WHY A THIRD MIXER SITE EXISTS AND WHY IT IS NOT A DW-8
// VIOLATION. DW-8 bans per-object AnimationMixers for the FACTORY, where the
// entity count is O(100k) and the whole render design is the O(items) to
// O(lines) collapse. A swarm is not that: /core caps a wave at 100 and this
// pool is capped at MAX_RIGS bodies, each of which is on screen, near, and
// the subject of the player's attention. The far swarm stays in EnemyView's
// one BatchedMesh exactly as before, so the LOD ladder is: skinned rig near,
// one-draw-call batch far, which is this domain's own thesis (RN-3,
// abstract-when-unobserved) applied to creatures.
//
// WHAT A RIG COSTS, so the cap is priced rather than vibes: one SkinnedMesh
// with ONE material (the authored primitives are merged at load, their
// material colours baked into a vertex-colour attribute), drawn in the main
// pass and three shadow cascades: 4 draw calls per claimed creature, ~28
// matrix bone updates per frame. MAX_RIGS 8 is therefore at most +32 draw
// calls in a fight, and stats() publishes the live number.
//
// CLAIMING IS STICKY. Claim inside CLAIM_M, release beyond RELEASE_M, so a
// creature orbiting the boundary does not flicker between representations.
// The batch slot of a claimed creature is released while the rig holds it
// (Enemies.frame owns that seam) and lazily re-acquired on release, which is
// the existing lazy-acquire path and costs nothing new.
//
// THE MIXERS TICK FROM THE SIM CLOCK. update(dt) is called from Enemies.step
// with the fixed 1/60 dt, never from a wall clock, for the same reason
// Avatar.animate runs on loop.simSecs: a headless capture must reproduce.
// ?anim=0 (Config.anim, RN-121) freezes them: rigs stand in rest pose and
// the negative-control property holds for creatures exactly as for the
// player. The flag is re-read here from the URL rather than plumbed through
// Gameplay's constructor chain; Config.anim stays the documented owner and
// GameMode.ts:174 is the precedent for a mode-changing flag read at point of
// use.
//
// NAMED FAILURE MODES (INSTRUMENTS.md, before measuring): rest pose on
// screen means the mixer is not ticking; a spider collapsed to a point at
// the armature origin is a bind-matrix mismatch from re-binding the merged
// geometry to the cloned skeleton; a spider that animates in place but
// slides over the ground is a timeScale that ignores the instance scale.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGlb } from '../assets/Loaders.js';
import { ASSETS } from '../assets/Registry.js';
import { attachSurface, copyUv } from '../render/instancing/Surfaces.js';
import { applyFur, furState, furUpdate } from '../render/materials/FurShader.js';
import { assertPartMatBase, bakePartMat, partMatState }
  from '../render/materials/PartMaterial.js';
import { standBasis, type OriginPort } from './EnemyView.js';
import type { Creature } from './EnemySwarm.js';
import type { Vec3 } from './EnemyLoop.js';

/** Rigged bodies at once. Priced in the header; measured in stats(). */
export const MAX_RIGS = 8;
/** Scratch for the per-frame fur motion difference. Module scope so the
 *  per-frame path allocates nothing. */
const FUR_SUM = new THREE.Vector3();
const FUR_TMP = new THREE.Vector3();
/**
 * The BASE roughness and metalness of the merged creature.
 *
 * RN-455 called these "the one roughness and the one metalness the creature
 * has" and that was true until RN-491. They are now the denominator of the
 * per-part ratio in PartMaterial.ts: a part's effective response is its own
 * AUTHORED value times the family's ORM, and these two only decide the
 * fallback when `?partmat=0` or `?fur=0` removes the channel. Both must stay
 * NON-ZERO, which assertPartMatBase checks at material construction.
 *
 * `tools/blender/render_creatures.py` no longer has to force these onto every
 * role to make a studio render honest, because the studio's own
 * "palette roughness x ORM" is now what the client computes.
 */
// RN-461: 0.80 / 0.04 was the shell. Reid: "it looks like its made of
// shiny stone." Fur has no sharp specular anywhere, so the constant goes
// to the top of the range and the `fur` family ORM takes it 0.76 to 0.95.
const FUR_ROUGHNESS = 0.95;
const FUR_METALNESS = 0.02;
/** Promote a creature inside this range of the player, metres. */
const CLAIM_M = 80;
/** Demote it only beyond this, so the boundary does not flicker. */
const RELEASE_M = 100;
/**
 * The walk clip's authored ground speed at unit scale, m/s. MUST match the
 * SPIDER_WALK_MPS constant build_spider.py prints; the probe cross-checks
 * clip duration, and a mismatch here is the "animates but slides" failure.
 */
export const SPIDER_WALK_MPS = 2.5;
/** A-13's lesson: past ~2.2x the pose is unreadable; cap and accept slip. */
const WALK_TIMESCALE_MAX = 2.2;
const WALK_CLIP = 'Spider_Walk';
const IDLE_CLIP = 'Spider_Idle';
/** How far toward the type tint the body colour moves. 1 would repaint the
 *  authored asset; 0 would make every type identical at a glance. */
const TINT_LERP = 0.45;

interface Rig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  current: THREE.AnimationAction | null;
  creatureId: number;
  typeId: number;
}

export class SpiderFlock {
  /** Added under EnemyView's group by Enemies, so no scene wiring changes. */
  readonly group = new THREE.Group();
  private template: {
    bones: THREE.Bone[]; boneNames: string[];
    inverses: THREE.Matrix4[]; bindMatrix: THREE.Matrix4;
    geometry: THREE.BufferGeometry; clips: THREE.AnimationClip[];
    armature: THREE.Object3D;
  } | null = null;
  private readonly materials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly rigs: Rig[] = [];
  /** Sim seconds, accumulated from the fixed dt Enemies.step passes in, for
   *  the same reason the mixers tick on it: a headless capture reproduces. */
  private furSecs = 0;
  private readonly furLast = new Map<number, THREE.Vector3>();
  private readonly byCreature = new Map<number, Rig>();
  private loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private loadError = '';
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly ta = new THREE.Vector3();
  private readonly tb = new THREE.Vector3();
  private readonly tc = new THREE.Vector3();

  constructor(private readonly origin: OriginPort,
              private readonly live: boolean =
                new URL(location.href).searchParams.get('anim') !== '0') {
    this.group.name = 'spiderRigs';
  }

  /**
   * Lazily start the load on first use rather than at construction, so a
   * combat-free session (every smoke run without ?combat=1) never fetches
   * the asset and cannot fail on it.
   */
  private ensureLoading(): void {
    if (this.loadState !== 'idle') return;
    this.loadState = 'loading';
    void this.load().catch((e: unknown) => {
      this.loadState = 'failed';
      this.loadError = String(e);
      // Loud once: the swarm still draws through the batch, so this is a
      // degradation and not an invisible-enemy condition (DW-28 distinction).
      console.warn('[of] spider rig load failed, swarm stays on the batch:', e);
    });
  }

  private async load(): Promise<void> {
    const gltf = await loadGlb(ASSETS.spider);
    const root = gltf.scene;
    // The one authored skin: every _LOD0 primitive shares it, so the first
    // SkinnedMesh's skeleton and bindMatrix speak for all of them.
    const prims: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh === true && /_LOD0(_\d+)?$/.test(m.name)) prims.push(m);
    });
    if (prims.length === 0) throw new Error('spider.glb has no _LOD0 skinned mesh');
    const skeleton = prims[0].skeleton;
    // Merge the primitives into ONE geometry with the material colour baked
    // into a vertex-colour attribute: a rig then costs one draw call per
    // pass instead of one per material, which is the whole cap arithmetic in
    // the header. The skin attributes ride along untouched because every
    // primitive indexes the same skin.
    // RN-498. The per-part attribute is only worth writing if a hook will
    // READ it, and the only hook this asset has is the fur one. `?fur=0`
    // removes that hook entirely, so baking anyway would leave a dead
    // ~52 KB buffer on the template geometry and the flag would stop being
    // bit-exact to the build before FurShader.ts existed. `?fur=0` is the
    // stock-program control and the perf isolator; it has to stay one.
    const furOn = furState().enabled;
    const parts: THREE.BufferGeometry[] = [];
    for (const pm of prims) {
      const g = pm.geometry.clone();
      const n = (g.getAttribute('position') as THREE.BufferAttribute).count;
      const mat = pm.material as THREE.MeshStandardMaterial;
      const c = mat.color ?? new THREE.Color(1, 1, 1);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      // RN-491. Colour was the ONLY channel this merge kept, which is why
      // RN-455 had to spend colour on things that are really material
      // properties (a near-black eye standing in for a wet specular). It now
      // keeps the authored roughness, metalness and the `of_bare` flag too,
      // in one vec3 attribute baked exactly the way the colour above is. The
      // proof that per-vertex data survives this merge was always sitting one
      // line up; this carries a second channel the same way.
      if (furOn) bakePartMat(g, n, mat, mat.name || pm.name);
      // uv SURVIVES the merge now (RN-455) and is copied through the one
      // function that does it unconditionally, for the reason that function
      // documents: mergeGeometries returns null on a mismatched attribute set
      // and the `?? list[0]` below would swallow it, so one primitive without
      // UVs would silently reduce the whole creature to its first primitive.
      // copyUv also COUNTS, so `surfaceReport().uv.byConsumer.spider` is the
      // evidence the map reached the geometry rather than an assumption.
      //
      // THE NAMED FAILURE MODE, before measuring: this file used to DELETE uv
      // here, so a chitin map bound to the material would have sampled uv 0,0
      // on every vertex and the whole creature would draw one flat texel. That
      // is the flora lane's grey-white silent drop with a different colour: a
      // map is bound, a probe asking "hasMap" says yes, and nothing is
      // textured.
      copyUv(pm.geometry, g, n, 'spider');
      for (const drop of ['uv1', 'uv2', 'tangent']) {
        if (g.getAttribute(drop) !== undefined) g.deleteAttribute(drop);
      }
      parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    if (merged === null) {
      throw new Error('spider.glb primitives did not merge (attribute mismatch)');
    }
    // The armature subtree WITHOUT the meshes is the clone template: bones
    // only, so a clone is ~28 nodes.
    for (const pm of prims) pm.removeFromParent();
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh === true) m.visible = false;
    });
    this.template = {
      bones: skeleton.bones,
      boneNames: skeleton.bones.map((b) => b.name),
      inverses: skeleton.boneInverses,
      bindMatrix: prims[0].bindMatrix.clone(),
      geometry: merged,
      clips: gltf.animations,
      armature: root,
    };
    this.loadState = 'ready';
  }

  private materialFor(typeId: number, tint: number): THREE.MeshStandardMaterial {
    let m = this.materials.get(typeId);
    if (m === undefined) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xffffff).lerp(new THREE.Color(tint), TINT_LERP),
        vertexColors: true, metalness: FUR_METALNESS,
        roughness: FUR_ROUGHNESS,
      });
      m.name = `spider:type${typeId}`;
      // RN-455. The merge above collapses six authored materials into one, so
      // THESE TWO NUMBERS ARE THE ONLY ROUGHNESS AND METALNESS THE WHOLE
      // CREATURE HAS, and every per-part material response the .glb declares
      // (a fang at 0.30, an eye at 0.10) is thrown away here. What survives is
      // colour, baked to the vertex attribute above. The `chitin` family's ORM
      // is therefore the only thing that can vary the response across the
      // body, which is why it was authored to a p05..p95 band and not to a
      // pretty number. RN-461 moved that band to the top of the range
      // rather than the middle of it: fur, not shell.
      //
      // RN-491 RETRACTS THE SENTENCE ABOVE, and leaves it standing because
      // the reasoning it produced is still why the ORM is authored the way it
      // is. These two numbers are no longer the only response the creature
      // has: they are now the BASE that PartMaterial's per-vertex channel
      // divides against, so the effective response of a part is its own
      // authored roughness times the family's ORM. They must both be non-zero
      // for that ratio to carry, which is asserted rather than hoped for; a
      // zero base is a total, silent loss of the channel.
      assertPartMatBase(m);
      attachSurface(m, 'fur', m.name);
      // RN-463: the pelt's rim scatter, wind sway and motion lag. One shared
      // hook object across every creature material, so three's program cache
      // key stays identical and they still share one program. `?fur=0` skips
      // it entirely and the material keeps its stock program, which is what
      // makes that flag a bit-exact control rather than a zeroed amplitude.
      applyFur(m, m.name);
      this.materials.set(typeId, m);
    }
    return m;
  }

  private makeRig(c: Creature): Rig | null {
    const t = this.template;
    if (t === null) return null;
    // Clone the bone hierarchy, then rebuild the Skeleton in the ORIGINAL
    // joint order by name: skinIndex indexes that order, and a skeleton
    // assembled in traversal order animates the wrong limbs with the right
    // clips, which looks like a creature knitting itself.
    const root = t.armature.clone(true);
    const byName = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone === true) byName.set(o.name, o as THREE.Bone);
    });
    const bones: THREE.Bone[] = [];
    for (const name of t.boneNames) {
      const b = byName.get(name);
      if (b === undefined) return null;
      bones.push(b);
    }
    const skeleton = new THREE.Skeleton(bones, t.inverses.map((mm) => mm.clone()));
    const mesh = new THREE.SkinnedMesh(t.geometry, this.materialFor(c.typeId, c.type.tint));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A SkinnedMesh's bounds are the bind pose (PlayerRig's lesson): a walk
    // clip moves vertices outside them and three would cull mid-stride.
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton, t.bindMatrix.clone());
    const mixer = new THREE.AnimationMixer(root);
    const walkClip = THREE.AnimationClip.findByName(t.clips, WALK_CLIP);
    const idleClip = THREE.AnimationClip.findByName(t.clips, IDLE_CLIP);
    const rig: Rig = {
      root, mixer,
      walk: walkClip !== null ? mixer.clipAction(walkClip) : null,
      idle: idleClip !== null ? mixer.clipAction(idleClip) : null,
      current: null, creatureId: c.id, typeId: c.typeId,
    };
    this.group.add(root);
    return rig;
  }

  /**
   * Decide which creatures the rigs represent this frame and pose them.
   * Returns the claimed ids; Enemies.frame hides those from the batch.
   */
  assign(liveList: readonly Creature[], playerPos: Vec3): Set<number> {
    const claimed = new Set<number>();
    if (liveList.length > 0) this.ensureLoading();
    if (this.loadState !== 'ready') return claimed;

    const alive = new Map<number, Creature>();
    for (const c of liveList) alive.set(c.id, c);

    // Release: dead, or drifted past the sticky boundary.
    for (const [id, rig] of [...this.byCreature]) {
      const c = alive.get(id);
      if (c !== undefined && dist(c.pos, playerPos) <= RELEASE_M) continue;
      this.byCreature.delete(id);
      rig.creatureId = -1;
      rig.root.visible = false;
    }

    // Claim: nearest unclaimed inside CLAIM_M while rigs remain.
    if (this.byCreature.size < MAX_RIGS) {
      const candidates = liveList
        .filter((c) => !this.byCreature.has(c.id))
        .map((c) => ({ c, d: dist(c.pos, playerPos) }))
        .filter((x) => x.d <= CLAIM_M)
        .sort((a, b) => a.d - b.d);
      for (const { c } of candidates) {
        if (this.byCreature.size >= MAX_RIGS) break;
        let rig = this.rigs.find((r) => r.creatureId < 0) ?? null;
        if (rig === null) {
          if (this.rigs.length >= MAX_RIGS) break;
          rig = this.makeRig(c);
          if (rig === null) break;
          this.rigs.push(rig);
        }
        rig.creatureId = c.id;
        rig.typeId = c.typeId;
        this.byCreature.set(c.id, rig);
      }
    }

    // Pose every held rig.
    for (const [id, rig] of this.byCreature) {
      const c = alive.get(id);
      if (c === undefined) continue;
      claimed.add(id);
      rig.root.visible = true;
      const mesh = rig.root.children.find(
        (o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
      if (mesh !== undefined) mesh.material = this.materialFor(c.typeId, c.type.tint);
      const scale = c.type.radiusM;
      const l = Math.hypot(c.pos.x, c.pos.y, c.pos.z) || 1;
      standBasis(this.m, { x: c.pos.x / l, y: c.pos.y / l, z: c.pos.z / l },
        c.facing, scale, this.ta, this.tb, this.tc);
      this.origin.toEngine(c.pos, this.p);
      this.m.setPosition(this.p);
      this.m.decompose(rig.root.position, rig.root.quaternion, rig.root.scale);
      this.pose(rig, c, scale);
    }
    return claimed;
  }

  /** Walk while marching, idle while stopped or biting (an attack clip is
   *  named follow-up work, not pretended). */
  private pose(rig: Rig, c: Creature, scale: number): void {
    const marching = c.biting === '';
    const want = marching ? rig.walk : rig.idle;
    if (want === null) return;
    if (rig.current !== want) {
      want.reset();
      want.setLoop(THREE.LoopRepeat, Infinity);
      want.enabled = true;
      want.setEffectiveWeight(1);
      want.play();
      if (rig.current !== null) want.crossFadeFrom(rig.current, 0.12, false);
      rig.current = want;
    }
    if (marching && rig.walk !== null) {
      // The clip covers SPIDER_WALK_MPS metres per second AT UNIT SCALE, and
      // the instance is drawn at `scale`, so its feet cover scale times that.
      // Ignoring the scale here is the "animates but slides" failure named in
      // the header.
      const ts = c.type.speedMps / (SPIDER_WALK_MPS * scale);
      rig.walk.timeScale = Math.min(WALK_TIMESCALE_MAX, Math.max(0.4, ts));
    }
  }

  /** Tick every mixer. Fixed-step dt from Enemies.step; frozen by ?anim=0. */
  update(dt: number): void {
    if (!this.live) return;
    for (const rig of this.rigs) {
      if (rig.creatureId >= 0) rig.mixer.update(dt);
    }
    this.furSecs += dt;
    // THE FLOCK'S OWN MOTION, measured rather than asked for. `Creature` does
    // not publish a velocity, and adding one would be a sim change for a
    // rendering want, so the lag is differenced off the rig roots this class
    // already positions. It is the MEAN over claimed rigs and not per rig: the
    // cheap version, with its limit written down in FurShader.furUpdate.
    let n = 0;
    FUR_SUM.set(0, 0, 0);
    for (const rig of this.rigs) {
      if (rig.creatureId < 0) continue;
      const was = this.furLast.get(rig.creatureId);
      if (was !== undefined) {
        FUR_SUM.add(FUR_TMP.copy(rig.root.position).sub(was));
        n++;
      }
      (was ?? this.furLast.set(rig.creatureId, new THREE.Vector3())
        .get(rig.creatureId) as THREE.Vector3).copy(rig.root.position);
    }
    if (n > 0 && dt > 1e-6) {
      FUR_SUM.divideScalar(n * dt);
      const sp = FUR_SUM.length();
      if (sp > 1e-4) furUpdate(this.furSecs, FUR_SUM.normalize(), sp);
      else furUpdate(this.furSecs, FUR_SUM.set(0, 0, 0), 0);
    } else {
      furUpdate(this.furSecs, FUR_SUM.set(0, 0, 0), 0);
    }
  }

  /** RN-463. Published so a probe can assert the hook is INSTALLED and the
   *  `?fur=0` boot default is what it claims, rather than inferring either
   *  from a pixel (RN-150: an unexercised default ships off silently). */
  furStats(): unknown { return furState(); }

  /** RN-491. Published separately from furStats so "the hook is installed"
   *  and "the per-part channel reached the geometry" are two assertions and
   *  not one: the first can hold while the second is inert, and that pair of
   *  states is exactly failure mode 1 in PartMaterial.ts. */
  partMatStats(): unknown { return partMatState(); }

  stats(): unknown {
    return {
      state: this.loadState,
      error: this.loadError,
      animLive: this.live,
      rigsBuilt: this.rigs.length,
      claimed: this.byCreature.size,
      maxRigs: MAX_RIGS,
      claimM: CLAIM_M,
      releaseM: RELEASE_M,
      walkMps: SPIDER_WALK_MPS,
      playing: [...this.byCreature.values()].map((r) => ({
        creature: r.creatureId,
        clip: r.current?.getClip().name ?? '',
        timeScale: r.current?.timeScale ?? 0,
        t: +(r.current?.time ?? 0).toFixed(3),
      })),
    };
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
