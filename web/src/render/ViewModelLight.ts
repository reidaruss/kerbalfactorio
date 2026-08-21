// RN-1990. THE VIEW MODEL TAKES THE WORLD'S LIGHT.
//
// THE DEFECT, as RN-1875 left it. Render pass 4 draws the first-person arms and
// the held tool into their own scene, with their own sun, their own ambient and
// NO SHADOW MAP. The model therefore never loses the sun when the world does:
// model luma over frame luma read 0.57 / 1.05 / 2.32 / 2.94 across the four
// canonical shots (`voxelface` / `ruin` / `forestfloor` / `machine`), a 5.2x
// spread on a quantity that should sit near 1, AND IT CHANGES SIGN. That sign
// change is why RN-1875 refused to retune `VM_HEMI`: no constant can fix a term
// whose error is 2.9x too bright under a canopy and 1.8x too dark in a sunlit
// pit. The error is not a level, it is a MISSING INPUT.
//
// WHAT THIS FILE DOES. It gives pass 4 a real shadow receive by handing its sun
// THE WORLD'S OWN CASCADE 0 SHADOW MAP -- the same texture, the same bias, the
// same texel snap -- re-expressed in the view model's coordinate frame. Nothing
// is re-rendered and no second map is allocated: the cost is one extra
// `sampler2DShadow` fetch on the four per cent of the frame the model covers.
//
// WHY THAT IS THE HONEST ANSWER RATHER THAN A PROXY, and what was rejected:
//
//   * A CPU RAYCAST toward the sun from the eye. Rejected on both correctness
//     and cost. The thing that shades a player on this map is usually a TREE
//     CANOPY or a machine, neither of which is in `surface_field.h`, so a ray
//     against the solidity oracle (the only cheap ray this codebase has) would
//     answer a different question than the one the frame asks. A ray against
//     the near scene's meshes is a triangle loop over chunk geometry with no
//     BVH, per frame.
//   * READING THE SHADOW MAP BACK to drive `vmSun.intensity`. One `readPixels`
//     is a full pipeline stall, and it buys a WORSE answer than the one below:
//     a single scalar for the whole model, so the back of a glove and the tip
//     of a haft 0.4 m apart could not disagree about a shadow edge.
//   * RETUNING `VM_HEMI`, or re-deriving it from the world's own ambient
//     endpoint. Refused by RN-1875 on principle and refused again here on a
//     MEASUREMENT: `__ofVmLight.ambient(0)` takes the whole view-model
//     hemisphere out and moves `forestfloor`'s model from 72.43 to 68.95, so
//     that light is 3.5 of 72 counts. `sun(0)` moves it to 22.32, so the direct
//     sun is 50.1. The ambient cannot be the term that is out by a factor of
//     three, and the full write-up is in `Headlamp.ts` beside the constant.
//
// WHY THE MATRIX COMPOSITION IS THE WHOLE TRICK. The view-model scene is NOT in
// engine space: `CameraRig.setView` puts `vmCam` at the origin with the near
// camera's orientation, and `Avatar.placeViewModel` fixes the model at that
// same origin. So view-model space is engine space translated by minus the eye,
// a PURE TRANSLATION with no rotation and no scale. Cascade 0's shadow matrix
// maps engine metres to shadow UV; post-multiplying it by a translation of the
// engine eye maps view-model metres to the same UV. Because the two spaces are
// both metres and differ by a translation only, `bias` and `normalBias` carry
// over unchanged, which is the reason this is a copy and not a conversion.
//
// THE THREE.JS CONTRACT THIS DEPENDS ON, checked in the shipped r185 source
// rather than assumed (`three.module.js`):
//
//   1. `WebGLShadowMap.render` skips a light whose shadow has
//      `autoUpdate === false && needsUpdate === false`, BEFORE it would
//      allocate or draw into `shadow.map`. That is what stops the view-model
//      pass from re-rendering the world's cascade with the arms as its only
//      caster and blanking it.
//   2. `WebGLLights` reads `shadow.map.depthTexture` and `shadow.matrix` by
//      reference at setup time, so aliasing the texture and owning our own
//      matrix is enough; there is no per-light shadow state elsewhere.
//   3. `receiveShadow` is a UNIFORM (`p_uniforms.setValue(gl,
//      'receiveShadow', ...)`), not a program define, so turning it on and off
//      at runtime costs no recompile. `castShadow` IS a program parameter
//      (`numDirLightShadows`), so it is set ONCE, before the first view-model
//      frame, and never toggled -- the Headlamp's own 441 ms recompile stall is
//      the recorded reason that distinction matters here.
//
// FAILURE MODES, NAMED BEFORE MEASURING:
//
//   A. THE RIG IS OFF (`?shadows=0`, or the quality tier has no cascades).
//      There is no cascade 0 to alias, `castShadow` is never set, and pass 4 is
//      bit-identical to what shipped. `wired` reports false so a probe can tell
//      that apart from "the term ran and found nothing".
//   B. THE RIG IS OFF FOR THIS FRAME (night, orbit: `ShadowRig.update` clears
//      `castShadow` on every cascade and the map goes STALE). A stale map would
//      shadow the arms with the last daylight frame's trees. `shadowIntensity`
//      is driven to 0 in that case, which the shader resolves to
//      `mix(1.0, shadow, 0.0)` -- exactly no shadow, and no recompile.
//   C. THE TERM IS WIRED AND NOTHING RECEIVES IT. `receiveShadow` is false on
//      every arm mesh in the shipped rig, and the shader's own line is
//      `receiveShadow ? getShadow(...) : 1.0`, so a wired light with unwired
//      meshes is a silent identity. `receivers` counts the meshes that actually
//      carry the flag and `probes/vmlight.js` refuses a zero.

import * as THREE from 'three';
import { VM_HEMI_MODE } from './Headlamp.js';

/** Cascade 0 is also the near scene's sun. `ShadowRig` names it. */
const CASCADE0 = 'shadowCascade0';
/** `Headlamp` names the view-model hemisphere. */
const VM_AMBIENT = 'viewModelAmbient';
/** `Boot` names the view-model sun. */
const VM_SUN = 'vmSun';
/** Scratch for `stats().eyeCoord`. Allocated once; `stats` is called by probes. */
const EYE_UV = new THREE.Vector3();
const PEEK: { renderer: unknown; mats: THREE.Material[] } = { renderer: null, mats: [] };

export interface ViewModelLightStats {
  /** True once cascade 0 was found and pass 4's sun carries its map. */
  wired: boolean;
  /** The shadow intensity actually uploaded. 0 means "no shadow this frame". */
  shadowIntensity: number;
  /** Meshes in the view-model scene with `receiveShadow`. Zero is a defect. */
  receivers: number;
  /** Copied from cascade 0, so a probe can prove the two agree. */
  bias: number;
  normalBias: number;
  mapSize: number;
  /** Engine metres the shadow matrix was rebased through THIS frame. */
  eyeM: [number, number, number];
  /** Diagnostic multipliers. 1/1/true is the shipped frame. */
  sunScale: number;
  ambientScale: number;
  shadowOn: boolean;
  receiveOn: boolean;
  /** The eye's own shadow coordinate, [u, v, z]. See `stats()`. */
  eyeCoord: number[] | null;
  /** How the ambient endpoint was resolved. See `AMBIENT_FROM_WORLD`. */
  ambientMode: string;
  /** The view-model hemisphere intensity as applied this frame. */
  ambient: number;
}

// NO AMBIENT CHANGE SHIPS FROM THIS FILE, AND `__ofVmLight.ambient(k)` IS WHY.
// `Headlamp.ts` owns the view-model hemisphere and this lane built the obvious
// mechanism fix there (derive its open-sky endpoint from the same `stockFloor`
// the near hemisphere reads, so the two cannot drift), then sized the term with
// this multiplier before shipping it and reverted: 3.5 counts of 72. The knob
// stays because sizing a term needs a matched pair inside one page load and a
// boot flag cannot give one, and because the next lane will ask the same
// question. `Headlamp.ts`'s `VM_HEMI` block carries the numbers.

export class ViewModelLight {
  private cascade: THREE.DirectionalLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private searched = false;
  private wired = false;
  private receivers = 0;
  private readonly rebase = new THREE.Matrix4();

  /** Diagnostic knobs. Defaults are the shipped frame; see `installVmLightDiag`. */
  shadowOn = true;
  /**
   * RN-1990. THE COST CONTROL. `shadow(false)` zeroes the shadow INTENSITY,
   * which is the right control for a LOOK measurement (`mix(1.0, shadow, 0.0)`
   * is exactly no shadow) and the WRONG one for a PRICE measurement, because
   * three's shader still calls `getShadow` and still takes its five PCF taps.
   * Clearing `receiveShadow` takes the `: 1.0` arm of three's own ternary
   * instead, so the fetch does not happen, and it also skips this file's
   * per-frame traverse -- i.e. it removes every scrap of work RN-1990 added,
   * which is what WG-189's interleaved paired method needs as its off phase.
   * It is a uniform, so toggling it costs no recompile and the two phases can
   * be interleaved inside ONE page load, which is the whole point of that
   * method: a serial sweep lets thermal drift land entirely on one arm.
   */
  receiveOn = true;
  sunScale = 1;
  ambientScale = 1;

  constructor(
    private readonly near: THREE.Scene,
    private readonly viewModel: THREE.Scene,
  ) {}

  /** Resolve by NAME, once, for the reason `Frame.publishSun` resolves by name:
   *  every wire into the render layer comes from `Boot.ts`, and a name that the
   *  producer sets and the consumer reads cannot go stale the way a cached
   *  constructor argument can. */
  private resolve(): void {
    if (this.searched) return;
    this.searched = true;
    this.cascade = (this.near.getObjectByName(CASCADE0) ?? null) as THREE.DirectionalLight | null;
    this.sun = (this.viewModel.getObjectByName(VM_SUN) ?? null) as THREE.DirectionalLight | null;
    this.hemi = (this.viewModel.getObjectByName(VM_AMBIENT) ?? null) as THREE.HemisphereLight | null;
    const c = this.cascade;
    const s = this.sun;
    if (c === null || s === null) return;
    // ONE-TIME and never toggled: this is the program parameter half of the
    // contract above. Everything after this point is uniforms.
    s.castShadow = true;
    s.shadow.autoUpdate = false;
    s.shadow.needsUpdate = false;
    s.shadow.mapSize.copy(c.shadow.mapSize);
    this.wired = true;
  }

  /**
   * Turn on `receiveShadow` for everything in the view-model scene, and COUNT
   * it. Called every frame because the held tool is reloaded on a swing kind
   * change (`Avatar.swing` -> `PlayerRig.holdTool`), so a flag set once at boot
   * would be lost the first time the player picked up the axe. The traverse is
   * over a scene of three meshes and a light, which is why it is affordable;
   * `receivers` is published so that claim is a number and not a comment.
   */
  private wireReceivers(): void {
    let n = 0;
    const want = this.receiveOn;
    this.viewModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      if (m.receiveShadow !== want) m.receiveShadow = want;
      if (want) n++;
    });
    this.receivers = n;
  }

  /**
   * Called once per frame, from `Frame.render`, AFTER the near pass (so cascade
   * 0's map and matrix are this frame's) and BEFORE the view-model pass.
   *
   * @param engineEye the near camera's position in engine metres. View-model
   *   space is engine space minus this, so it is the entire rebase.
   */
  sync(engineEye: THREE.Vector3): void {
    this.resolve();
    if (this.receiveOn || this.receivers !== 0) this.wireReceivers();
    const c = this.cascade;
    const s = this.sun;
    if (s === null) return;
    if (this.sunScale !== 1) s.intensity *= this.sunScale;
    if (this.ambientScale !== 1 && this.hemi !== null) this.hemi.intensity *= this.ambientScale;
    if (c === null || this.wired === false) return;
    const sh = s.shadow;
    // RN-2306. A DIRECTIONAL LIGHT MAY NOT CAST WITH NO MAP TO LEND, and this
    // is where `?shadowcast=0`'s GL error storm came from.
    //
    // `resolve` sets `s.castShadow = true` once and the block there calls that
    // permanent on purpose: toggling it is a lights-state change and therefore
    // a recompile of the view model's thirteen materials, which is why the
    // night case below is handled with `intensity = 0` instead. That is right
    // for the night, where cascade 0's map still holds the last daylight frame
    // and the binding is valid. It is WRONG for a map that was never
    // allocated: `autoUpdate` and `needsUpdate` are both false on this shadow,
    // so three never creates one of its own, and with no cascade map to alias
    // `sh.map` stays null while the light still declares `USE_SHADOWMAP`.
    // three then binds its default 2-D texture into a `sampler2DShadow` and
    // every view-model draw takes `GL_INVALID_OPERATION: glDrawElements:
    // Mismatch between texture format and sampler type` -- the x256 storm
    // WORLD-AUDIT-R2 section 4 recorded at `machine`, which is a WALK pose
    // because the view model is what a walk pose has and an aerial one does
    // not. It reproduces at `meadow` too, and it is not only a flag's problem:
    // any boot that never sees a daylight cascade (`?shadowcast=0`, and orbit
    // from boot) is the same state.
    //
    // `haveMap` LATCHES, which is what keeps this cheap. three does not
    // dispose a shadow map, so it goes false -> true once, on the first frame
    // cascade 0 renders, and never back: one recompile at boot, none at dusk,
    // and the intensity path below still owns the night exactly as it did.
    const haveMap = c.shadow.map !== null;
    if (s.castShadow !== haveMap) s.castShadow = haveMap;
    // Failure mode B. `ShadowRig.update` clears `castShadow` at night and in
    // orbit and leaves the map holding the last daylight frame.
    const live = this.shadowOn && c.castShadow && haveMap;
    sh.intensity = live ? c.shadow.intensity : 0;
    if (!live) return;
    sh.map = c.shadow.map;
    sh.bias = c.shadow.bias;
    sh.normalBias = c.shadow.normalBias;
    sh.radius = c.shadow.radius;
    sh.mapSize.copy(c.shadow.mapSize);
    // shadowUV = cascadeMatrix * (viewModelPoint + eye).
    this.rebase.makeTranslation(engineEye.x, engineEye.y, engineEye.z);
    sh.matrix.copy(c.shadow.matrix).multiply(this.rebase);
  }

  /** RN-1990 diagnosis scratch: capture the renderer via onBeforeCompile. */
  /**
   * RN-1990. THE RENDERER HANDLE, taken the only way a render-layer class can
   * take one without widening `OFRenderer`'s published interface: three passes
   * `(shader, renderer)` to `Material.onBeforeCompile`, so arming the callback
   * on the view model's own materials and forcing one recompile hands this file
   * the renderer on the next frame. `peekRead` and `mapAt` need it and nothing
   * in the shipped frame does, so it is armed only when a probe asks.
   *
   * IT IS NOT DECORATION. Two of this lane's three false conclusions came from
   * not having it. The recompile is 13 materials in a scene of three meshes.
   */
  peek(): unknown {
    const mats: THREE.Material[] = [];
    this.viewModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true) return;
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.push(x);
    });
    PEEK.mats = mats;
    for (const m of mats) {
      m.onBeforeCompile = (_s, r): void => { PEEK.renderer = r; };
      m.needsUpdate = true;
    }
    return { armed: mats.length, names: mats.map((m) => `${m.type}:${m.name}`) };
  }

  /**
   * Which shadow uniforms three actually COMPILED into the view model's
   * programs. `wired` says this file set `castShadow`; this says the shader
   * that resulted has a `directionalShadowMap` in it. The gap between those two
   * is `USE_SHADOWMAP`, which depends on the renderer's `shadowMap.enabled` and
   * on the light being in the scene's `shadowsArray` at the instant the
   * material first compiled -- i.e. on an ORDERING, which is exactly the kind of
   * thing that is true today and silently false after someone moves a line in
   * `Boot.ts`. `probes/vmlight.js` asserts on it.
   */
  peekRead(): unknown {
    const r = PEEK.renderer as { shadowMap: { enabled: boolean; type: number };
      properties: { get: (o: unknown) => { currentProgram?: {
        cacheKey: string; getUniforms: () => { map: Record<string, unknown> } } } }; } | null;
    if (r === null) return { err: 'no renderer captured' };
    const out: unknown[] = [];
    for (const m of PEEK.mats) {
      const p = r.properties.get(m).currentProgram;
      out.push({ mat: `${m.type}:${m.name}`,
        prog: p === undefined ? null : Object.keys(p.getUniforms().map)
          .filter((k) => k.toLowerCase().includes('shadow')) });
    }
    return { shadowMapEnabled: r.shadowMap.enabled, type: r.shadowMap.type, out };
  }

  /**
   * RN-1990. WHAT IS ACTUALLY IN THE SHADOW MAP AT A GIVEN UV, and this is the
   * instrument the whole verification turned on.
   *
   * `shadow.map`'s COLOUR attachment is filled by three's stock
   * `MeshDepthMaterial` with `1 - fragCoordZ`, so one `readRenderTargetPixels`
   * of one texel says whether a caster is in that cell and at what depth. That
   * is a GPU sync and it must never be in a frame; it is here because it
   * answers the one question a luma reading cannot: WHETHER THE PLAYER IS IN A
   * CAST SHADOW AT ALL.
   *
   * Read over a 24 x 24 grid at the RN-352 forest site, cascade 0 came back
   * non-zero on 105 of 576 texels. The terrain does not cast into it; the trees
   * do. So "the ground in this frame is dark" and "this player is in a cast
   * shadow" are DIFFERENT FACTS, only the second is one this term can see, and
   * a straight 12 m walk chosen by eye found zero shaded stations. Without this
   * read, that null is indistinguishable from a dead lookup, and this lane
   * spent three measurement passes proving exactly that.
   */
  mapAt(u: number, v: number): unknown {
    const r = PEEK.renderer as { readRenderTargetPixels: (rt: unknown, x: number,
      y: number, w: number, h: number, out: Uint8Array) => void } | null;
    const c = this.cascade;
    if (r === null || c === null || c.shadow.map === null) return { err: 'not ready' };
    const n = c.shadow.mapSize.x;
    const x = Math.max(0, Math.min(n - 1, Math.round(u * n)));
    const y = Math.max(0, Math.min(n - 1, Math.round(v * n)));
    const out = new Uint8Array(4);
    r.readRenderTargetPixels(c.shadow.map, x, y, 1, 1, out);
    return { x, y, rgba: [...out], oneMinusZ: out[0] / 255 };
  }

  stats(): ViewModelLightStats {
    const s = this.sun;
    const r3 = (x: number): number => Math.round(x * 1000) / 1000;
    return {
      wired: this.wired,
      shadowIntensity: s === null ? 0 : r3(s.shadow.intensity),
      receivers: this.receivers,
      bias: s === null ? 0 : s.shadow.bias,
      normalBias: s === null ? 0 : r3(s.shadow.normalBias),
      mapSize: s === null ? 0 : s.shadow.mapSize.x,
      eyeM: [r3(this.rebase.elements[12]), r3(this.rebase.elements[13]),
        r3(this.rebase.elements[14])],
      sunScale: this.sunScale,
      ambientScale: this.ambientScale,
      shadowOn: this.shadowOn,
      receiveOn: this.receiveOn,
      // The shadow coordinate of the EYE (the view-model origin), evaluated on
      // the CPU through the same matrix the vertex shader is handed. Out of
      // [0,1] on any axis and `getShadow`'s own `frustumTest` fails, which is
      // the difference between "not in shadow" and "never looked".
      eyeCoord: s === null ? null
        : [r3(EYE_UV.set(0, 0, 0).applyMatrix4(s.shadow.matrix).x),
          r3(EYE_UV.y), r3(EYE_UV.z)],
      ambientMode: VM_HEMI_MODE,
      ambient: this.hemi === null ? 0 : r3(this.hemi.intensity),
    };
  }
}

/**
 * Publish `__ofVmLight`. Called unconditionally, on `IblDiag`'s and
 * `ShadeDiag`'s stated discipline (RN-514): a handle that is absent from the
 * shipped build cannot tell "the tool found nothing" from "the tool never ran",
 * and every default here is the shipped frame, so its existence changes no
 * pixel. Its value is the MATCHED PAIR: `shadow(false)` reproduces exactly the
 * frame RN-1875 measured, in the same page load as the fixed one, so the
 * before/after is one variable apart rather than two scene builds apart.
 */
export function installVmLightDiag(vml: ViewModelLight): void {
  (self as unknown as Record<string, unknown>).__ofVmLight = {
    state: (): unknown => vml.stats(),
    shadow: (on: boolean): boolean => { vml.shadowOn = on === true; return vml.shadowOn; },
    receive: (on: boolean): boolean => { vml.receiveOn = on === true; return vml.receiveOn; },
    sun: (k: number): number => { vml.sunScale = k; return vml.sunScale; },
    peek: (): unknown => vml.peek(),
    peekRead: (): unknown => vml.peekRead(),
    mapAt: (u: number, v: number): unknown => vml.mapAt(u, v),
    ambient: (k: number): number => { vml.ambientScale = k; return vml.ambientScale; },
  };
}
