// RN-1570. THE SHADE DISCRIMINATOR: is a machine's dark vertical face dark
// because the SUN NEVER REACHES IT, or because the machine SHADOWS ITSELF?
//
// WHAT THIS EXISTS FOR. RN-1492 swept six camera bearings and two sun
// elevations around a placed smelter and found the same thing in every arm:
// the machine's camera-facing vertical faces are in shade while the ground in
// the same frame is lit (world p95 155 to 197) and the roof deck is lit. That
// lane named two candidate causes and deliberately claimed neither:
//
//   (a) SHOT GEOMETRY. A 4 m box 3.4 degrees off the equator has no vertical
//       face the sun squares up to at the pinned elevation, so the manifest's
//       sun placement is at fault and the fix belongs in `artframe.js`.
//   (b) WHOLE-OBJECT SELF-SHADOWING. Roof lit, all four walls dark, ground lit
//       is also exactly the signature of an object rasterising itself into the
//       cascade it then samples, with the wrong bias or the wrong caster mesh.
//
// SEPARATING THEM IS ONE SUBTRACTION AND IT NEEDS A HANDLE THE PAGE DOES NOT
// OTHERWISE OFFER. `?ibldiag=noenv` is the precedent: remove exactly one term
// from the light transport, change nothing else, re-measure the SAME rectangle
// on the SAME pose. Here the term removed is the machine's own contribution to
// the shadow maps.
//
//   `machineCast(false)` clears `castShadow` on every mesh whose material is a
//   `factory:machines:*` material. The cascades still run, the terrain and the
//   props still cast, the machine still RECEIVES. If the face lights up, the
//   umbra on it was cast by the machine itself and cause (b) is confirmed. If
//   it does not move, the machine was never in its own shadow and the sun
//   genuinely does not reach that face, which is cause (a).
//
// THE ARM MUST BE REVERSIBLE, because the discriminator's whole value is a
// matched pair one variable apart taken in ONE page load: two page loads differ
// by the whole scene build. So the previous flag is remembered per mesh and
// restored, and `machineCast(true)` is asserted to restore the exact count it
// cleared.
//
// FAILURE MODES, NAMED BEFORE MEASURING (RN-1526's rule: an instrument that
// counts a CPU-side write is not evidence that anything downstream read it):
//
//   1. THE TRAVERSE FINDS NOTHING. No machine has been placed yet, or the
//      material naming changed. Then `machineCast` returns 0 and the arm is a
//      silent identity that would read as "not self-shadowing". So the count is
//      published and the probe REFUSES a zero.
//   2. THE FLAG IS WRITTEN AND THE SHADOW PASS IGNORES IT. `castShadow` is read
//      by three's `WebGLShadowMap` per object per cascade, so a write that
//      lands is a write that is read; the check that it landed is that the
//      shipped `shadow` draw-call and triangle counts MOVE, which the probe
//      reads out of `of.stats()` beside the rectangle.
//   3. THE ARM LEAKS INTO THE BASELINE. Cleared by taking the baseline FIRST
//      and by `restored` reporting the count put back.
//
// It publishes only. Nothing here runs, allocates or compiles until a probe
// calls a method, so a shipped frame is unchanged by this file's existence
// (RN-514: a handle that is absent in the shipped build cannot tell "the tool
// found nothing" from "the tool never ran").

import * as THREE from 'three';

/** A machine material, by the name `MachineBatch` gives it. Same predicate
 *  `IblDiag.materials()` uses, deliberately, so the two diagnostics cannot
 *  disagree about which meshes are "the machine". */
const MACHINE_MAT = 'factory:machines:';

/** Cascade lights are named by `ShadowRig`; cascade 0 is also the sun. */
const CASCADE_NAME = 'shadowCascade';

export interface ShadeDiagHost {
  /** The near scene: the machines, the terrain and the cascade lights. */
  readonly nearScene: THREE.Scene;
  /** Unit vector TOWARD the sun, world space. `SkyPass.sunDirection`. */
  readonly sunDirection: THREE.Vector3;
  /** The observer's world position, for the local tangent frame the azimuth is
   *  reported in. Read through a closure because the walker moves. */
  feet(): THREE.Vector3;
}

/** Every mesh drawn with a machine material, LOD rungs and all. */
function machineMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat === undefined) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (m.name.startsWith(MACHINE_MAT)) { out.push(mesh); return; }
    }
  });
  return out;
}

function cascadeLights(scene: THREE.Scene): THREE.DirectionalLight[] {
  const out: THREE.DirectionalLight[] = [];
  scene.traverse((o) => {
    if (o.name.startsWith(CASCADE_NAME)) out.push(o as THREE.DirectionalLight);
  });
  return out;
}

/**
 * Publish `__ofShade`. Called unconditionally from Boot, for RN-514's reason.
 */
export function installShadeDiag(host: ShadeDiagHost): void {
  /** Per-mesh remembered flag, so the restore is the value that was there and
   *  not a guessed `true`. */
  const savedCast = new Map<THREE.Mesh, boolean>();
  const savedLight = new Map<THREE.DirectionalLight, boolean>();

  (self as unknown as Record<string, unknown>).__ofShade = {
    state: (): unknown => {
      const meshes = machineMeshes(host.nearScene);
      return {
        machineMeshes: meshes.length,
        machineCasting: meshes.filter((m) => m.castShadow).length,
        cascades: cascadeLights(host.nearScene).length,
        heldMeshes: savedCast.size, heldLights: savedLight.size,
      };
    },

    /**
     * THE DISCRIMINATOR'S ONE VARIABLE. Clear or restore `castShadow` on every
     * machine mesh. Returns the number of meshes whose flag actually CHANGED,
     * which is the number the probe asserts on: a zero means the arm was an
     * identity and any conclusion drawn from it is about nothing.
     */
    machineCast: (on: boolean): unknown => {
      const meshes = machineMeshes(host.nearScene);
      let changed = 0;
      for (const m of meshes) {
        if (on) {
          const was = savedCast.get(m);
          if (was === undefined) continue;
          if (m.castShadow !== was) changed++;
          m.castShadow = was;
          savedCast.delete(m);
        } else {
          if (!savedCast.has(m)) savedCast.set(m, m.castShadow);
          if (m.castShadow) changed++;
          m.castShadow = false;
        }
      }
      return { changed, meshes: meshes.length,
        castingNow: meshes.filter((m) => m.castShadow).length };
    },

    /** The wider control: no cascade casts anything at all. Distinguishes "the
     *  machine shadows itself" from "something ELSE shadows the machine" (the
     *  terrain it stands on, a tree, the belt beside it). */
    rigCast: (on: boolean): unknown => {
      const lights = cascadeLights(host.nearScene);
      let changed = 0;
      for (const l of lights) {
        if (on) {
          const was = savedLight.get(l);
          if (was === undefined) continue;
          if (l.castShadow !== was) changed++;
          l.castShadow = was;
          savedLight.delete(l);
        } else {
          if (!savedLight.has(l)) savedLight.set(l, l.castShadow);
          if (l.castShadow) changed++;
          l.castShadow = false;
        }
      }
      return { changed, lights: lights.length,
        castingNow: lights.filter((l) => l.castShadow).length };
    },

    /**
     * THE BIAS, LIVE. `ShadowRig` sets `shadow.bias` once at construction and
     * never touches it again, so an override here sticks; `normalBias` is
     * re-derived every frame from the cascade's texel and is deliberately NOT
     * overridable, because a knob the rig overwrites next frame is the kind of
     * silent identity RN-1526 was written about.
     *
     * Returns the value every cascade now carries, read back rather than
     * echoed, so a probe asserts on what the light holds and not on what this
     * function was asked for.
     */
    bias: (v: number): unknown => {
      const lights = cascadeLights(host.nearScene);
      for (const l of lights) l.shadow.bias = v;
      return { asked: v, lights: lights.length,
        now: lights.map((l) => l.shadow.bias),
        normalBias: lights.map((l) => l.shadow.normalBias) };
    },

    /**
     * The sun in the frame the shot's bearings are built in: the tangent frame
     * off the player's own feet, which is the frame `artframe.js` uses for
     * `bearingDeg`. Reported so "the sun's azimuth" and "the camera's bearing"
     * are numbers in ONE frame rather than two that were never checked against
     * each other -- RN-1492's `__ofPost.state().sun` finding is exactly what
     * happens when they are not.
     */
    sun: (): unknown => {
      const up = host.feet().clone().normalize();
      const e0 = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0))
        .normalize();
      const e1 = new THREE.Vector3().crossVectors(up, e0).normalize();
      const s = host.sunDirection.clone().normalize();
      const elevDot = s.dot(up);
      // Same convention as `artframe.js`: bearing th means cos(th)*e0 + sin(th)*e1.
      const az = (Math.atan2(s.dot(e1), s.dot(e0)) * 180) / Math.PI;
      return {
        sunWorld: s.toArray(), up: up.toArray(),
        elevDot, elevDeg: (Math.asin(Math.max(-1, Math.min(1, elevDot))) * 180) / Math.PI,
        azimuthDeg: (az + 360) % 360,
      };
    },

    /**
     * N-dot-L FOR THE FOUR CARDINAL VERTICAL FACES AND THE ROOF, analytically,
     * in the same tangent frame. This is the half that settles cause (a)
     * WITHOUT a pixel: a vertical face whose outward normal is the tangent
     * bearing `th` has N.L = cos(elev) * cos(th - azimuth), and the roof has
     * N.L = sin(elev). If some vertical face has a LARGER N.L than the roof and
     * the roof is lit while that face is not, no geometry argument survives and
     * the cause is shadowing.
     */
    faceNdotL: (bearingsDeg: number[] = [0, 90, 180, 270]): unknown => {
      const up = host.feet().clone().normalize();
      const e0 = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0))
        .normalize();
      const e1 = new THREE.Vector3().crossVectors(up, e0).normalize();
      const s = host.sunDirection.clone().normalize();
      const rows: Record<string, number>[] = [];
      for (const b of bearingsDeg) {
        const th = (b * Math.PI) / 180;
        const n = e0.clone().multiplyScalar(Math.cos(th))
          .addScaledVector(e1, Math.sin(th)).normalize();
        rows.push({ bearingDeg: b, ndotl: n.dot(s) });
      }
      return { roofNdotL: s.dot(up), walls: rows };
    },
  };
}
