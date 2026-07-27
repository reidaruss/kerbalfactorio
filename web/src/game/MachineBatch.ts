// Every placed machine, belt tile and inserter in ONE BatchedMesh (DW-11), and
// ONE material, whose emissive is driven per instance from the section 6 stream.
//
// WHY ONE BATCH AND NOT ONE PER MATERIAL. NodeBatch already measured this for
// the clearing: a shadow cascade redraws every batch, so eight materials times
// the main pass plus three cascades gives the whole instancing saving back. The
// machine files use five roles (steel, dark steel, accent, hazard, emissive) and
// none of them is textured, so the colour bakes into a vertex attribute and the
// whole factory is one draw plus its cascades.
//
// DW-8 IS THIS FILE'S REASON TO EXIST. There is no AnimationMixer anywhere: a
// belt's motion is a per-INSTANCE flow value, uploaded as one texel, that
// scrolls a procedural band along the deck's own local axis. A thousand belt
// tiles cost one texture update and one draw, not a thousand mixers. The same
// texel carries the machine's VisualState, so idle / working / blocked / no
// power is the emissive chip the asset already ships and not a second system.
//
// The per-instance channel is a DataTexture indexed by three's own batching id
// (`getIndirectIndex(gl_DrawID)`), which is exactly the mechanism three uses for
// per-instance colour, so it cannot fall out of step with the matrix texture.
//
// FS-16: THE POOL GROWS, AND WHEN IT CANNOT IT SAYS SO. This class shipped with
// `CAPACITY = 256` and no growth path, and past it a machine existed in the
// plan, existed in /core, ticked, produced and was never drawn. The measurement
// and the argument for doubling are in `InstancePools.ts`; the fix is here.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAPACITY, MAX_CAPACITY, registerPool, type PoolReport }
  from './InstancePools.js';

/**
 * aRole: what a vertex is, so one material can serve the authored roles.
 *
 * The two ARC roles are the belt CURVES (W7). A curve's deck is a quarter
 * annulus, so scrolling the band along local Z (which is what a straight tile
 * does) would run the cargo diagonally across the corner. The role carries which
 * corner it is, because that is the only thing the fragment shader needs in
 * order to find the arc centre, and it costs no extra attribute.
 */
const ROLE_BODY = 0, ROLE_STATUS = 1, ROLE_FLOW = 2, ROLE_ARC_L = 3, ROLE_ARC_R = 4;

export interface MachineTemplate {
  url: string;
  root: string;
  flowMaterial?: string;
  /** Set on the curve tiles: which way the quarter turn goes. */
  arc?: 'l' | 'r';
  /** Which meshes of the source scene belong to this template; defaults to the
   *  `_LOD0` suffix every machine file uses. `items_atlas.glb` (FS-28) names its
   *  meshes `Item_Log` with no LOD chain at all, so belt cargo passes a pattern
   *  rather than the atlas being renamed to suit one caller. */
  nodeMatch?: RegExp;
}

/** The default: a machine file's own drawing LOD. */
const LOD0 = /_LOD0(?:_\d+)?$/;

/** Per-instance fx channels, in the order the shader reads them. */
export interface Fx { flow: number; density: number; state: number; level: number }

function roleOf(matName: string, def: MachineTemplate): number {
  if (matName.endsWith('EmissiveState')) return ROLE_STATUS;
  if (def.flowMaterial !== undefined && matName.endsWith(def.flowMaterial)) {
    return def.arc === 'l' ? ROLE_ARC_L : def.arc === 'r' ? ROLE_ARC_R : ROLE_FLOW;
  }
  return ROLE_BODY;
}

/** Bake colour and role per vertex so one material can draw every role. */
function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4,
                   tint: THREE.Color, role: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  const col = new Float32Array(pos.count * 3);
  const rol = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; ++i) {
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
    rol[i] = role;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRole', new THREE.BufferAttribute(rol, 1));
  const idx = src.getIndex();
  if (idx !== null) g.setIndex(idx.clone());
  else {
    const seq = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; ++i) seq[i] = i;
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  g.applyMatrix4(world);
  g.computeBoundingSphere();
  return g;
}

export class MachineBatch {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  /** One merged geometry per file, for the ghost preview to reuse. */
  readonly merged = new Map<string, THREE.BufferGeometry>();
  private mesh: THREE.BatchedMesh | null = null;
  private readonly geomId = new Map<string, number>();
  private fxData!: Float32Array;
  private fxTex!: THREE.DataTexture;
  private readonly uniforms = {
    uFx: { value: null as THREE.DataTexture | null },
    uFxW: { value: 1 },
    uTime: { value: 0 },
  };
  /** Slots released by demolition, reused before any new one is added. */
  private readonly free: number[] = [];
  private live = 0;
  private cap: number;
  private grows = 0;
  private refused = 0;
  private warned = false;

  /** `capacity` is a parameter because a BASE reaches many more instances than
   *  a factory does and there is no point paying for the first two doublings.
   *  It is a STARTING size, not a limit: see the header. */
  constructor(capacity = CAPACITY, private readonly name = 'factoryMachines',
              private readonly ceiling = MAX_CAPACITY) {
    this.group.name = name;
    this.cap = Math.max(1, Math.min(capacity, ceiling));
    this.allocFx(this.cap);
    this.material = this.makeMaterial();
    registerPool(this);
  }

  /** Instances this pool can currently hold. Grows; never shrinks. */
  get capacity(): number { return this.cap; }

  /** Wall-independent sim time, so a driven run scrolls at the real rate. */
  setTime(t: number): void { this.uniforms.uTime.value = t; }

  /**
   * (Re)allocate the per-instance fx texture for `cap` instances.
   *
   * Square, and the old contents are copied FLAT. That is exact, not lucky: the
   * shader reads texel (id % w, id / w), whose flat offset is id * 4 whatever
   * `w` is, so the array is indexed by instance id and a plain `set` preserves
   * every live slot across a resize.
   */
  private allocFx(cap: number): void {
    const w = Math.max(1, Math.ceil(Math.sqrt(cap)));
    const data = new Float32Array(w * w * 4);
    if (this.fxData !== undefined) data.set(this.fxData.subarray(0, data.length));
    const tex = new THREE.DataTexture(data, w, w, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.fxTex?.dispose();
    this.fxData = data;
    this.fxTex = tex;
    this.uniforms.uFx.value = tex;
    this.uniforms.uFxW.value = w;
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.55,
    });
    m.name = 'factory:machines';
    const uniforms = this.uniforms;
    m.userData.uniforms = uniforms;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFx = uniforms.uFx;
      shader.uniforms.uFxW = uniforms.uFxW;
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uFx;
uniform int uFxW;
attribute float aRole;
varying float vRole;
varying vec4 vFx;
varying vec3 vLocalPos;`)
        .replace('#include <batching_vertex>', `#include <batching_vertex>
vRole = aRole;
vLocalPos = position;
#ifdef USE_BATCHING
int fxId = int( getIndirectIndex( gl_DrawID ) );
vFx = texelFetch( uFx, ivec2( fxId % uFxW, fxId / uFxW ), 0 );
#else
vFx = vec4( 0.0 );
#endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vRole;
varying vec4 vFx;
varying vec3 vLocalPos;`)
        // AFTER the emissive map, which is where totalEmissiveRadiance is set.
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if ( vRole > 2.5 ) {
  // A BELT CURVE (W7). Same flow row, same band, but the deck is a quarter
  // annulus about a cell CORNER, so the phase is arc length and not local z.
  // The corner is (-0.5,-0.5) for a left turn and (0.5,-0.5) for a right one,
  // which is the only thing the role has to carry; the centre-line radius is
  // 0.5 m, matching the straight tile's inlet and outlet exactly.
  vec2 c = vec2( vRole > 3.5 ? 0.5 : -0.5, -0.5 );
  vec2 d = vec2( vLocalPos.x, vLocalPos.z ) - c;
  float ang = atan( d.y, d.x );
  float s = 0.5 * ( vRole > 3.5 ? ( 3.14159265 - ang ) : ang );
  float f = fract( s * 2.0 - uTime * vFx.x );
  float blob = smoothstep( 0.38, 0.14, abs( f - 0.5 ) ) * step( 0.004, vFx.y );
  float lit = 0.30 + 0.70 * vFx.y;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.47, 0.21 ), blob * 0.95 );
  totalEmissiveRadiance += vec3( 0.44, 0.25, 0.06 ) * blob * lit;
} else if ( vRole > 1.5 ) {
  // THE BELT, straight off FFactoryBeltFlowState. vFx.x is the quantized flow
  // speed turned into bands per second, vFx.y the line's fill fraction: an
  // empty line shows a bare deck and a saturated one is solid with cargo.
  float f = fract( vLocalPos.z * 2.0 - uTime * vFx.x );
  float blob = smoothstep( 0.38, 0.14, abs( f - 0.5 ) ) * step( 0.004, vFx.y );
  float lit = 0.30 + 0.70 * vFx.y;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.47, 0.21 ), blob * 0.95 );
  totalEmissiveRadiance += vec3( 0.44, 0.25, 0.06 ) * blob * lit;
} else if ( vRole > 0.5 ) {
  // THE STATUS CHIP: entityVisualState, and nothing invented on top of it.
  vec3 c = vec3( 0.14, 0.55, 0.24 );
  if ( vFx.z > 2.5 )      c = vec3( 0.32, 0.32, 0.38 );
  else if ( vFx.z > 1.5 ) c = vec3( 0.90, 0.18, 0.08 );
  else if ( vFx.z > 0.5 ) c = vec3( 0.18, 0.74, 1.00 );
  diffuseColor.rgb = c * 0.22;
  totalEmissiveRadiance += c * ( 0.22 + 0.95 * vFx.w );
}`);
    };
    return m;
  }

  /**
   * Register every template at once. Two passes, for the reason NodeBatch
   * documents: a BatchedMesh sizes its vertex and index pools at construction,
   * so the totals must be known before the first one exists.
   */
  build(templates: ReadonlyMap<string, { def: MachineTemplate; scene: THREE.Object3D }>): void {
    const per = new Map<string, THREE.BufferGeometry[]>();
    let verts = 0, idx = 0;
    for (const [key, t] of templates) {
      t.scene.updateWorldMatrix(true, true);
      const list: THREE.BufferGeometry[] = [];
      t.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh !== true || m.name.startsWith('col_')) return;
        if (!(t.def.nodeMatch ?? LOD0).test(m.name)) return;
        const src = m.material as THREE.MeshStandardMaterial;
        list.push(normalize(m.geometry, m.matrixWorld,
          src.color ?? new THREE.Color(1, 1, 1), roleOf(src.name, t.def)));
      });
      if (list.length === 0) continue;
      const g = list.length === 1 ? list[0] : (mergeGeometries(list, false) ?? list[0]);
      g.computeBoundingSphere();
      per.set(key, [g]);
      this.merged.set(key, g);
      verts += (g.getAttribute('position') as THREE.BufferAttribute).count;
      idx += g.getIndex()?.count ?? 0;
    }
    if (per.size === 0) return;
    const mesh = new THREE.BatchedMesh(this.capacity, verts, idx, this.material);
    mesh.name = this.group.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The factory is always within a few tens of metres of the player, so a
    // whole-batch cull could only ever be a false negative (NodeBatch measured
    // per-instance culling as a net cost at this object count).
    mesh.frustumCulled = false;
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = false;
    for (const [key, list] of per) this.geomId.set(key, mesh.addGeometry(list[0]));
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /**
   * A slot drawing `key`'s geometry, or -1 when the CEILING has been reached.
   *
   * -1 used to mean "the pool is 256 and you are the 257th", which is the
   * silent wall the packaging spike measured. It now only ever means the
   * template is unknown or the hard ceiling is exhausted, and the second of
   * those is counted and shouted.
   */
  acquire(key: string): number {
    const g = this.geomId.get(key);
    if (this.mesh === null || g === undefined) return -1;
    // A FREED SLOT IS REUSED rather than a new one added. Demolition made this
    // load bearing: addInstance only ever grows, so a player who put down and
    // pulled up belts for a while would exhaust the pool with invisible slots
    // and the next real building would silently fail to draw.
    const reuse = this.free.pop();
    if (reuse !== undefined) {
      this.live++;
      this.mesh.setGeometryIdAt(reuse, g);
      return reuse;
    }
    if (this.live >= this.cap && !this.grow()) return -1;
    this.live++;
    const slot = this.mesh.addInstance(g);
    this.mesh.setGeometryIdAt(slot, g);
    return slot;
  }

  /**
   * Double the pool. False only at the ceiling, and then LOUDLY.
   *
   * `setInstanceCount` keeps every live instance: it copies the indirect and
   * matrix texture data across, so no slot is re-added and no transform is
   * lost. The geometry pools are untouched because growth adds instances of
   * geometry that is already resident.
   */
  private grow(): boolean {
    if (this.mesh === null) return false;
    const next = Math.min(this.ceiling, this.cap * 2);
    if (next <= this.cap) {
      this.refused++;
      if (!this.warned) {
        this.warned = true;
        console.error(`[of] instance pool '${this.name}' is FULL at ${this.cap}`
          + ' instances: buildings past this exist and tick but are NOT DRAWN');
      }
      return false;
    }
    this.mesh.setInstanceCount(next);
    this.cap = next;
    this.allocFx(next);
    this.grows++;
    return true;
  }

  /**
   * Re-point a live slot at a different template's geometry. Returns false when
   * the key is unknown, so a caller can keep whatever was already drawn.
   *
   * A belt tile becomes a CURVE the moment a neighbour is laid beside it, which
   * is a change of mesh with no change of instance, so re-acquiring the slot
   * would churn the batch and lose the transform for a frame.
   */
  setGeometry(slot: number, key: string): boolean {
    const g = this.geomId.get(key);
    if (this.mesh === null || g === undefined || slot < 0) return false;
    this.mesh.setGeometryIdAt(slot, g);
    return true;
  }

  /** Hide a slot and give it back to the pool. Idempotent. */
  release(slot: number): void {
    if (this.mesh === null || slot < 0 || this.free.includes(slot)) return;
    this.mesh.setVisibleAt(slot, false);
    this.setFx(slot, { flow: 0, density: 0, state: 0, level: 0 });
    this.free.push(slot);
    this.live = Math.max(0, this.live - 1);
  }

  place(slot: number, m: THREE.Matrix4): void {
    if (this.mesh === null || slot < 0) return;
    this.mesh.setMatrixAt(slot, m);
    this.mesh.setVisibleAt(slot, true);
  }

  /** Stop drawing a slot without giving it back. For churny link instances. */
  hide(slot: number): void {
    if (this.mesh === null || slot < 0) return;
    this.mesh.setVisibleAt(slot, false);
  }

  /** ONE texel per instance. This is the whole of DW-8's per-instance channel. */
  setFx(slot: number, fx: Fx): void {
    if (slot < 0 || slot >= this.cap) return;
    const i = slot * 4;
    this.fxData[i] = fx.flow;
    this.fxData[i + 1] = fx.density;
    this.fxData[i + 2] = fx.state;
    this.fxData[i + 3] = fx.level;
  }

  /** One upload per frame, however many instances changed. */
  flush(): void { if (this.live > 0) this.fxTex.needsUpdate = true; }

  geometryFor(key: string): THREE.BufferGeometry | null {
    return this.merged.get(key) ?? null;
  }

  /**
   * What this pool is doing. `refused` is the number that matters: it is the
   * count of buildings that exist, tick and produce and are NOT on screen, and
   * it is what the HUD budget line and `probes/scale.js` assert on.
   */
  stats(): PoolReport {
    return {
      name: this.name, batches: this.mesh === null ? 0 : 1,
      instances: this.live, capacity: this.cap, ceiling: this.ceiling,
      grows: this.grows, refused: this.refused,
    };
  }
}
