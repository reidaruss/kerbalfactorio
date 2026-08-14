// RN-1520 to RN-1525. WHY RAISING THE PMREM BOUGHT NOTHING.
//
// THE QUESTION. RN-1415 took the environment cube from 64 to 256 and moved the
// most IBL-dominated subject in the game from 20.52 to 20.43 luma, i.e. by
// nothing. Its stated cause (`panel`'s roughness band is 0.032 wide, so there
// is no variation to show) was WITHDRAWN by RN-1470, which measured the shipped
// band at 0.143 to 0.245 per role and ~0.4 across the family. So the
// observation stands with no explanation, and a wide roughness band under a
// raised-resolution environment that shows nothing is either a broken chain or
// an environment with nothing in it.
//
// THE THING THAT CANNOT BE MEASURED FROM A SCREENSHOT. Resolution can only
// reveal detail that EXISTS. A PMREM raise is a claim about the angular
// frequency content of the source cube, and every read of that cube in this
// repo until now has been downstream of ACES and an 8-bit framebuffer, both of
// which destroy exactly the quantity in question. `OFRenderer.cubeRadiance`
// exists for that one reason; `env()` below is its reader.
//
// THE THREE ARMS, each one variable from the shipped build (standing rule 7):
//
//   (absent)         OFF. Nothing is constructed, nothing is overridden, and
//                    the flag's own absence is reported so a fixture can assert
//                    the shipped default rather than read it back off `enabled`
//                    (RN-150).
//   ?ibldiag=1       THE INSTRUMENT ONLY. `__ofIblDiag` is published and the
//                    frame is byte-identical to the absent case, because
//                    nothing on this path runs until a probe calls it. That is
//                    what makes the readings attributable to the shipped build
//                    rather than to the measurement.
//   ?ibldiag=noenv   THE CONTROL THAT SETTLES SUSPECT (1) OUTRIGHT, and the one
//                    this file shipped without. `SkyIbl` assigns `null` instead
//                    of the PMREM texture and changes nothing else, so "what is
//                    the environment worth on this subject" is one subtraction.
//                    Combines: `?ibldiag=mirror,noenv`.
//   ?ibldiag=mirror  THE SPECULAR-TARGETED ARM. Every machine material becomes
//                    metalness 1.0 / roughness 0.02, i.e. a mirror. A mirror IS
//                    the environment map, displayed. If the machine box barely
//                    moves under this, the environment is not reaching the
//                    material; if it moves to a flat wash, the environment
//                    reaches it and has no structure; if it moves to a bright
//                    lobe, the chain is fine and the shipped roughness is the
//                    story. Those three are indistinguishable in the shipped
//                    frame and trivially distinct here.
//                    IT FORCES `machinemat` OFF ITSELF (RN-1526). This comment
//                    used to say "pair it with `?machinemat=0`", which is how
//                    the arm shipped for one commit as a SILENT NO-OP for
//                    anyone who read the registered flag list rather than this
//                    paragraph. See `iblDiagMirrorOn` below for the mechanism
//                    and for the measurement that found it.
//
//   ?ibldisc=<k>     THE FOURTH ARM AND THE CANDIDATE FIX, isolable on its own.
//                    Multiplies the sun sprite's radiance BY k FOR THE DURATION
//                    OF ONE IBL CAPTURE and for nothing else, on SkyIbl's own
//                    ground-mode precedent: it is raised, all six cube faces are
//                    rendered inside the same call stack, and it is lowered, so
//                    no presented frame can observe it. k=1 is the shipped
//                    identity and is what an absent flag gives.
//
// WHAT THE FOURTH ARM IS TESTING, STATED BEFORE THE MEASUREMENT. The sky scene
// holds an analytic scattering integral scaled by `AtmosphereParams.sunIntensity`
// (15.0 on Forge) and, as its only high-frequency feature, a `THREE.Sprite`
// whose peak radiance is its texture's alpha times its LDR colour 0xfff3d6,
// i.e. about 1.0. `sunIntensity` is documented in Atmosphere.glsl.ts as
// "radiance scale for the sun disc" and reaches `uSunColor` inside the
// scattering integral ONLY: grep says the sprite never reads it. So the
// predicted reading is that the brightest texel in the environment is sky and
// not sun, and if that is what comes back then no PMREM size can help, because
// there is no structure at any frequency to resolve.
//
// NAMED FAILURE MODES OF THIS INSTRUMENT, BEFORE ANY NUMBER (INSTRUMENTS.md):
//
//   (a) THE READBACK IS REFUSED AND READS AS A DARK SKY. `readRenderTargetPixels`
//       on a cube face can throw or return an untouched buffer, and an all-zero
//       Float32Array is a perfectly plausible night. `env()` returns
//       `{ ok: false }` on a null readback and publishes `nonZero`, the count of
//       texels above zero, so "the sky is dark" and "the buffer was never
//       written" are different reports.
//   (b) THE CAPTURE IS NOT THE ONE THE PMREM TAKES. If this rendered the sky
//       scene with the presented tone mapping it would measure ACES output and
//       call it radiance. The seam sets `NoToneMapping` and linear output for
//       the duration exactly as PMREMGenerator does, and `env()` reports
//       `groundRaised` so a reading taken without RN-64's lower hemisphere
//       cannot be mistaken for one taken with it.
//   (c) THE MIRROR ARM SILENTLY DOES NOTHING. `MachineBatch.makeMaterial` is the
//       one construction site and `overrides` counts what this file actually
//       rewrote; a probe that reads 0 there has measured the shipped material
//       twice and must say so.

import * as THREE from 'three';
import type { OFRenderer } from './Renderer.js';

const params = new URLSearchParams(self.location.search);
const rawMode = params.get('ibldiag');
/** RN-150: whether the flag was present AT ALL, distinct from its value. */
export const IBL_DIAG_PRESENT = rawMode !== null;
/**
 * A COMMA-SEPARATED SET, not one of three words, because RN-1526 needs two arms
 * ON AT ONCE (`mirror,noenv`) and a mode enum would have forced a fourth name
 * for every combination. Unknown words are ignored rather than refused: this is
 * a diagnosis flag and a typo here must not become a boot failure in a lane
 * measuring something else.
 */
const words = new Set((rawMode ?? '').split(',').map((s) => s.trim()));
const mode: 'off' | 'on' | 'mirror' = words.has('mirror') ? 'mirror'
  : rawMode !== null && rawMode !== '0' ? 'on' : 'off';
/**
 * RN-1526, AND IT IS THE ONE CONTROL THIS FILE SHIPPED WITHOUT.
 *
 * `?ibldiag=noenv` makes `SkyIbl` assign `null` instead of the PMREM texture,
 * so the near and view-model scenes have NO environment at all. Everything else
 * is untouched: the capture still runs, the ground half is still raised, the
 * timing and the rebuild count are unchanged, and only the assignment differs.
 *
 * WHY IT HAD TO EXIST. The first pass measured a mirror arm against the SHIPPED
 * frame and attributed the whole difference to the mirror, but that pair is TWO
 * variables wide (`?ibldiag=mirror` was run with `?machinemat=0` beside it, so
 * the per-part channel was off in one arm and on in the other). A verifier
 * running the mirror WITHOUT `machinemat=0` reproduced almost nothing and
 * correctly asked whether the environment reaches these materials at all. That
 * question deserves a direct answer and not an inference from a two-variable
 * pair: with this flag, "the environment contributes N counts to a machine" is
 * one subtraction on one binary at one pose.
 */
const NO_ENV = words.has('noenv');
export function iblEnvSuppressed(): boolean { return NO_ENV; }

/**
 * RN-1526. THE MIRROR ARM FORCES THE PER-PART CHANNEL OFF, AND THIS EXPORT IS
 * HOW, because the alternative shipped for one commit and cost a verifier a
 * whole run.
 *
 * `PartMaterial`'s injected GLSL ASSIGNS `roughnessFactor` and
 * `metalnessFactor` from the per-vertex channel; it does not scale what the
 * material carries. So with the channel on, `MeshStandardMaterial.roughness`
 * and `.metalness` are dead uniforms and `iblDiagOverride` writes values no
 * fragment ever reads. MEASURED, not reasoned: `?ibldiag=mirror` alone renders
 * the canonical machine box at luma 20.43 / p95 39.12 / iqr 15.30, **bit-identical
 * to the shipped frame**, while `overrides` cheerfully reported 14.
 *
 * That is this repo's oldest failure shape (MachineMat's own failure mode (a),
 * "the injection is a silent no-op") wearing a green light: the counter counted
 * the CPU-side write and there was nothing downstream that read it. The fix is
 * not documentation. An arm that needs a second flag beside it to mean anything
 * is an arm that will be run without it, so the arm now carries its own
 * precondition and `machineMatState().mirrorForcedOff` says so out loud.
 */
export function iblDiagMirrorOn(): boolean { return mode === 'mirror'; }

/** The mirror arm's response. Not 0.0: three clamps roughness off zero anyway
 *  and a literal that the shader silently rewrites is not a reading. */
const MIRROR_ROUGHNESS = 0.02;
const MIRROR_METALNESS = 1.0;

const rawDisc = params.get('ibldisc');
const discRaw = rawDisc === null ? NaN : Number(rawDisc);
/** RN-1524. The sun-disc radiance multiplier applied for the IBL capture only.
 *  1 is the shipped identity and is what an absent or unparseable flag gives. */
export const IBL_DISC_GAIN = Number.isFinite(discRaw) && discRaw >= 0 ? discRaw : 1;
export const IBL_DISC_PRESENT = rawDisc !== null;

let overrides = 0;

/**
 * Failure mode (c). Called from `MachineBatch.makeMaterial` AFTER
 * `assertMachineBase`, so the base assertion still guards the shipped path and
 * this is visibly a diagnosis layered on top of it rather than a second
 * authority on what a machine is.
 *
 * IT SHARES A LINE WITH THAT ASSERT AT THE CALL SITE, and that is deliberate
 * rather than sloppy: `MachineBatch.ts` sits at 399 lines against
 * `check-limits.mjs`'s 400 cap, measured on `origin/main` before this lane
 * touched it (45 files over the cap there, and that file is not one of them).
 * A diagnosis must not be what pushes a shipped file over a gate, so the
 * explanation lives here and the call site costs one import.
 */
export function iblDiagOverride(m: THREE.MeshStandardMaterial): void {
  if (mode !== 'mirror') return;
  m.metalness = MIRROR_METALNESS;
  m.roughness = MIRROR_ROUGHNESS;
  overrides++;
}

export interface EnvStats {
  ok: boolean;
  /** Cube side actually read back. */
  size: number;
  /** Failure mode (a): texels with any non-zero channel. */
  nonZero: number;
  texels: number;
  /** Solid-angle weighted mean luminance over the whole sphere. */
  mean: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  /**
   * THE HEADLINE. `max / mean`. A PMREM raise can only pay for itself if the
   * source has structure, and this is the cheapest scalar that says whether it
   * does: a clear sky with a sun in it runs into the thousands, a uniform grey
   * room is 1.0.
   */
  peakRatio: number;
  /** Fraction of the sphere brighter than 10x the mean. A sun is a tiny bright
   *  set; a bright horizon band is a large one, and the ratio alone cannot tell
   *  them apart. */
  brightFrac: number;
  /**
   * RN-1573. THE SAME SET, AS A COUNT, AND IT IS NOT REDUNDANT: `brightFrac` IS
   * UNABLE TO REPRESENT A PHYSICALLY CORRECT SUN.
   *
   * `probes/ibldiag.js` rounds every field to 4 decimal places. A 0.53-degree
   * disc subtends 6.7e-5 sr, i.e. 5.3e-6 of the sphere, which at a 256 cube is
   * about 2 texels of 393,216 and rounds to `brightFrac` 0.0000. So the
   * acceptance "brightFrac must become nonzero" is unmeetable by the real sun
   * and meetable only by a sun six times too wide -- which is exactly the
   * defect RN-1525 asked to remove. Reporting the integer removes the
   * ambiguity: 0 texels means no bright source, 2 texels means a sun, and the
   * two are no longer the same printed number.
   */
  brightTexels: number;
  /** Luminance of the texel nearest the sun direction, and the direction used. */
  atSun: number;
  sunDir: [number, number, number];
  /** Whether RN-64's ground half was raised for this capture. */
  groundRaised: boolean;
}

/** Rec.709 luminance, the same weighting `texgen.py` and the probes use. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Direction of cube face `f` at face coordinates `u,v` in [-1,1]. three's cube
 * face order and axis convention (WebGLCubeRenderTarget / CubeCamera), so a
 * direction taken from here can be compared with a world-space sun direction
 * without a second convention to get wrong.
 */
function faceDir(f: number, u: number, v: number, out: THREE.Vector3): void {
  switch (f) {
    case 0: out.set(1, -v, -u); break;
    case 1: out.set(-1, -v, u); break;
    case 2: out.set(u, 1, v); break;
    case 3: out.set(u, -1, -v); break;
    case 4: out.set(u, -v, 1); break;
    default: out.set(-u, -v, -1); break;
  }
  out.normalize();
}

function stats(data: Float32Array | null, size: number, sun: THREE.Vector3,
               groundRaised: boolean): EnvStats {
  const base: EnvStats = {
    ok: false, size, nonZero: 0, texels: 6 * size * size,
    mean: 0, max: 0, p50: 0, p95: 0, p99: 0, peakRatio: 0, brightFrac: 0,
    brightTexels: 0,
    atSun: 0, sunDir: [sun.x, sun.y, sun.z], groundRaised,
  };
  if (data === null) return base;
  const n = size * size;
  const lum = new Float64Array(6 * n);
  const dir = new THREE.Vector3();
  let wSum = 0;
  let lwSum = 0;
  let nonZero = 0;
  let bestDot = -2;
  let atSun = 0;
  for (let f = 0; f < 6; ++f) {
    for (let y = 0; y < size; ++y) {
      for (let x = 0; x < size; ++x) {
        const i = (f * n + y * size + x) * 4;
        const L = luma(data[i], data[i + 1], data[i + 2]);
        lum[f * n + y * size + x] = L;
        if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) nonZero++;
        const u = (2 * (x + 0.5)) / size - 1;
        const v = (2 * (y + 0.5)) / size - 1;
        // Cube-texel solid angle, up to the constant that cancels in the mean.
        const w = (1 + u * u + v * v) ** -1.5;
        wSum += w;
        lwSum += L * w;
        faceDir(f, u, v, dir);
        const d = dir.dot(sun);
        if (d > bestDot) { bestDot = d; atSun = L; }
      }
    }
  }
  const mean = lwSum / wSum;
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1,
    Math.floor(q * sorted.length))];
  const max = sorted[sorted.length - 1];
  let bright = 0;
  for (const L of lum) if (L > 10 * mean) bright++;
  return {
    ok: true, size, nonZero, texels: 6 * n,
    mean, max, p50: at(0.5), p95: at(0.95), p99: at(0.99),
    peakRatio: mean > 0 ? max / mean : 0,
    brightFrac: bright / (6 * n), brightTexels: bright,
    atSun, sunDir: [sun.x, sun.y, sun.z], groundRaised,
  };
}

export interface IblDiagHost {
  readonly renderer: OFRenderer;
  /** The pass-1 scene, i.e. exactly what `SkyIbl` hands `environmentFrom`. */
  readonly skyScene: THREE.Scene;
  /** The near scene, whose `environment` the machine materials read. */
  readonly nearScene: THREE.Scene;
  readonly sunDirection: THREE.Vector3;
  /** RN-64's lower hemisphere, raised and lowered around one capture. */
  setGroundMode(on: boolean): void;
  readonly hasIblGround: boolean;
  /** RN-1524's disc boost, same raise-and-lower discipline. */
  setDiscBoost(on: boolean): void;
}

/**
 * Publish `__ofIblDiag`. Called unconditionally from Boot; the handle exists in
 * every build because a report nothing is wired to cannot tell "the tool found
 * nothing" from "the tool never ran" (RN-514), and it costs no program, no draw
 * call and no uniform until a probe calls a method on it.
 */
export function installIblDiag(host: IblDiagHost): void {
  const env = (size = 32, boost = false): EnvStats => {
    const g = host.hasIblGround;
    if (g) host.setGroundMode(true);
    if (boost) host.setDiscBoost(true);
    const data = host.renderer.cubeRadiance(host.skyScene, size);
    if (boost) host.setDiscBoost(false);
    if (g) host.setGroundMode(false);
    return stats(data, size, host.sunDirection, g);
  };
  (self as unknown as Record<string, unknown>).__ofIblDiag = {
    state: (): unknown => ({
      mode, flagPresent: IBL_DIAG_PRESENT, overrides, noEnv: NO_ENV,
      mirrorRoughness: MIRROR_ROUGHNESS, mirrorMetalness: MIRROR_METALNESS,
      discGain: IBL_DISC_GAIN, discFlagPresent: IBL_DISC_PRESENT,
      iblSize: host.renderer.iblSize,
    }),
    env,
    /**
     * Suspect (1), answered without a screenshot: does a machine material
     * actually receive `scene.environment`, and at what intensity. A stock
     * material samples the scene environment only while its own `envMap` is
     * null, and `Headlamp` drives `environmentIntensity` down underground, so
     * both have to be read rather than assumed.
     */
     materials: (): unknown => {
      const rows: Record<string, unknown>[] = [];
      host.nearScene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (mat === undefined) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) {
          if (!m.name.startsWith('factory:machines:')) continue;
          const s = m as THREE.MeshStandardMaterial;
          rows.push({
            name: s.name, metalness: s.metalness, roughness: s.roughness,
            envMapIntensity: s.envMapIntensity, ownEnvMap: s.envMap !== null,
          });
        }
      });
      return {
        rows,
        sceneEnvironment: host.nearScene.environment !== null,
        environmentIntensity: host.nearScene.environmentIntensity,
      };
    },
  };
}
