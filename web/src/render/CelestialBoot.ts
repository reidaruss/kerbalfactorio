// RN-845. The wiring for CelestialBodies, in its own file for the reason
// MapBoot.ts and VabBoot.ts are: `Boot.ts` is at the 400-line cap and, this
// round, is a file another lane owns. Everything here reads only what
// `registerSystems` already holds, so the second body costs the shared wiring
// files three lines and nothing else.
//
// The flags are parsed from `location.search` directly rather than added to
// `Config.ts` for the same reason `Boot.ts:187` reads `?gnomon=` that way: this
// is a render-side debug surface with no sim consequence, and widening the
// config record would touch a file two other lanes are live in tonight.

import type * as THREE from 'three';
import { CelestialBodies, type CelestialDeps } from './CelestialBodies.js';
import { airProfile, type EphemerisModule } from './CelestialEphemeris.js';

export interface CelestialFlags {
  readonly on: boolean;
  readonly texW: number;
  readonly relief: number;
  readonly detail: number;
  readonly timeS: number | null;
}

/**
 * `?skybodies=0` is the negative control and it is a REAL one: with it the
 * class is never constructed, so no oracle is sampled, no texture is allocated
 * and no group joins the far scene. It controls the mechanism, not one value
 * the mechanism produced (RN-842's rule for `?horizonocc=0`).
 *
 * `?skybodyrelief=0` is the OTHER control and it is deliberately different: the
 * bake still happens and the disc is still drawn, with the relief normal
 * perturbation removed. That separates "the body is in the wrong place" from
 * "the body's surface is wrong", which one flag could not.
 */
export function celestialFlags(search: string): CelestialFlags {
  const q = new URLSearchParams(search);
  const num = (k: string, dflt: number): number => {
    const v = q.get(k);
    if (v === null) return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  };
  const t = q.get('skybodytime');
  return {
    on: q.get('skybodies') !== '0',
    texW: num('skybodytex', 512),
    relief: num('skybodyrelief', 1),
    detail: num('skybodydetail', 0.6),
    timeS: t === null || !Number.isFinite(Number(t)) ? null : Number(t),
  };
}

/**
 * Construct, register the per-frame placement, and install the driven surface.
 * Returns null when `?skybodies=0`, which is what makes the control structural.
 *
 * The update is on `onPreRender` and not `onDrain`, for the reason the vessel
 * meshes and the shadow cascades are: it needs `farCam.position`, which
 * `Loop.frame` writes through `rig.setView` AFTER the drain list has run. In
 * `onDrain` the eye vector handed to the disc would be one frame stale, which
 * at transfer speed is metres of parallax on a body 1.2e7 m away, i.e. nothing
 * visible and a wrong number in every readback. Correct is cheaper than
 * explaining why the wrong one does not matter.
 */
export function bootCelestialBodies(
  deps: CelestialDeps,
  farCamPos: () => THREE.Vector3,
  onPreRender: (fn: () => void) => void,
  setFov: (deg: number) => void,
  flags: CelestialFlags = celestialFlags(location.search),
): CelestialBodies | null {
  if (!flags.on) {
    installApi(null, setFov, deps);
    return null;
  }
  const bodies = new CelestialBodies(deps, {
    texW: flags.texW, relief: flags.relief, detail: flags.detail,
    timeS: flags.timeS,
  });
  onPreRender(() => { bodies.update(farCamPos()); });
  installApi(bodies, setFov, deps);
  return bodies;
}

/**
 * `window.__ofBodies`, on the `__ofAtmos` and `__ofTerrainArt` precedent: a
 * runtime surface, because every claim about a disc is a MATCHED PAIR and a
 * page reload cannot guarantee the same camera, the same streamed chunks or the
 * same sun. `?skybodies=0` still installs the object, reporting `present:false`
 * with a reason, so a probe run against the control gets an answer rather than
 * `undefined` (standing rule 11: a dead read must be loud).
 */
function installApi(b: CelestialBodies | null, setFov: (deg: number) => void,
  deps: CelestialDeps): void {
  (window as unknown as { __ofBodies: unknown }).__ofBodies = {
    /**
     * `CameraRig.setFov` has existed since W1 and NOTHING has ever called it.
     * It is published here because a 1.91-degree disc is 29 pixels on a
     * 900-line frame at the shipped 60-degree FOV, and no amount of shader work
     * is reviewable at 29 pixels: a telephoto frame is the only way to see what
     * is actually being drawn.
     *
     * IT IS NOT FREE AND THE COST IS NAMED: `setFov` calls `publishFov`, which
     * feeds `ShadowLodK`'s screen-error budget, so a zoomed frame has a
     * different shadow LOD ladder from a shipped one. Never take a triangle
     * count, a draw-call count or an LOD number from a zoomed frame.
     */
    setFov: (deg: number) => { setFov(deg); return deg; },
    report: () => b?.report() ?? {
      present: false, reason: 'disabled by ?skybodies=0', drawn: [],
      refusedId: -1, texW: 0, texH: 0, bakeMs: 0, oracleSamples: 0,
      uvResidual: 0, eyeM: [0, 0, 0], bodies: [], simSecs: 0,
    },
    setRelief: (g: number) => b?.setRelief(g) ?? null,
    setDetail: (g: number) => b?.setDetail(g) ?? null,
    setDebug: (on: boolean) => b?.setDebug(on) ?? null,
    setTimeS: (s: number | null) => b?.setTimeS(s) ?? null,
    facts: () => b?.facts() ?? [],
    planetshine: () => b?.planetshine() ?? null,
    airProfile: (id: number) => airProfile(deps.core as EphemerisModule, id),
    aim: () => b?.aim() ?? [],
  };
}
