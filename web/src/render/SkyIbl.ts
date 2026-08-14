// The runtime environment map, built from the SAME sky the horizon is built
// from (ARCHITECTURE.md 7.1, deferred at W3 and now due).
//
// W3 skipped this deliberately: TerrainMaterial reads its sky ambient from the
// scattering integral per fragment, so a cubemap would have been a second,
// coarser answer to a question already answered. W4 brings stock PBR materials
// (the rigged player, the tools, 41 biome props) and those have no such
// integral: a MeshStandardMaterial with no `environment` is lit by the
// HemisphereLight alone and renders as a near-black silhouette standing on a
// brightly lit hillside. That is measured, not asserted, and it is what
// W4_tp_character showed on the first capture.
//
// It is the sky scene rather than a preset because the whole point is that the
// ambient goes correctly warm at dawn, blue at noon and black in orbit with no
// transition code, from one uniform (air density times sun elevation).

// RN-64: THE ENVIRONMENT NOW HAS A GROUND UNDER IT.
//
// Until this pass the capture scene was the sky scene, which holds the
// atmosphere dome and the star field and nothing else, so the lower hemisphere
// of every prop's environment was the sky model marched THROUGH the planet,
// i.e. nearly nothing. TerrainShader has never had that hole: it adds
// `ground * (1 - skyView)` where `ground` is the flat ground's own radiance at
// that point, so a terrain face is lit by the field it was cut out of.
//
// Measured before the fix at two sites: at a high sun the two models agree to a
// quarter of a count (prop 96.37 against ground 96.13), and across a sun sweep
// the prop band swings 71.4 counts where the ground swings 22.4, a 3.2x
// disagreement concentrated entirely at LOW sun. That is the signature of a
// missing indirect term rather than of a wrong sun or a wrong albedo: at noon
// the direct term dominates and hides it.
//
// The fix is to capture from a scene that HAS ground in it. See SkyAtmosphere's
// ground mode for the radiance, and note that the shell is interposed for the
// duration of one capture and removed again, so it is absent from the object
// graph on every frame the player sees.

import * as THREE from 'three';
import type { OFRenderer } from './Renderer.js';
import { iblEnvSuppressed } from './IblDiag.js';
import { biomeColorArray } from './materials/BiomePalette.js';

/**
 * Frames between refreshes. Section 7.1 proposed 30, half a second, on a
 * projected 0.2 ms. MEASURED at 64^2 on an RTX 4060 Ti it is **10.5 ms**, six
 * cube faces plus the PMREM chain plus a fresh render target, and at every 30
 * frames it WAS the frame-time p95: 24.4 ms against a 16.6 ms budget, from a
 * subsystem that is not in the budget table at all. The sky changes over
 * minutes, so 240 frames plus an elevation trigger loses nothing visible.
 */
const REFRESH_FRAMES = 240;
/** Sun-elevation change that forces an immediate rebuild. */
const ELEVATION_EPS = 0.05;

/** The one biome -> colour table, the same one TerrainMaterial uploads. */
const PALETTE = biomeColorArray();

export interface SkyIblGround {
  /** False under `?iblground=0` or `?atmos=0`: there is no ground half. */
  readonly hasIblGround: boolean;
  setGroundAlbedo(c: THREE.Color): void;
  setGroundMode(on: boolean): void;
  /** RN-1524. The sun disc's capture-only radiance boost; see SkyPass. Called
   *  with the same raise/lower discipline as `setGroundMode`, and a no-op with
   *  `?ibldisc=` absent. */
  setDiscBoost(on: boolean): void;
}

export class SkyIbl {
  private texture: THREE.Texture | null = null;
  private frames = 0;
  private lastElevation = Number.NaN;
  private lastBiome = -1;
  builds = 0;
  lastMs = 0;
  groundBuilds = 0;

  /**
   * `targets` is every scene whose stock materials need an environment. The view
   * model is one of them and it is easy to forget: its own pass has no lights at
   * all, so the first-person arms rendered as a black silhouette holding a black
   * pickaxe against a lit landscape (W4_fp_tools, first capture).
   *
   * `ground` is RN-64's lower hemisphere. Null is a supported state and is what
   * `?iblground=0` and `?atmos=0` produce, in which case this class behaves
   * exactly as it did before that pass.
   */
  constructor(private readonly renderer: OFRenderer, private readonly targets: THREE.Scene[],
              private readonly ground: SkyIblGround | null = null) {}

  /**
   * Rebuild if it is stale, then assign. `target.environment` is assigned every
   * call rather than once, because it is cheap and it makes the "who owns the
   * environment" question have one answer.
   *
   * `biome` is the /core Biome index under the observer, or -1 where it is not
   * known. It is a REBUILD TRIGGER as well as an input: the ground half of the
   * environment is a function of it, so walking from sand onto forest floor has
   * to invalidate the capture the same way the sun moving does. Without that
   * the bounce would lag a biome change by up to 240 frames.
   */
  update(skyScene: THREE.Scene, elevationDot: number, biome = -1): void {
    const moved = !(Math.abs(elevationDot - this.lastElevation) < ELEVATION_EPS);
    const biomeMoved = biome >= 0 && biome !== this.lastBiome;
    if (this.texture === null || moved || biomeMoved || ++this.frames >= REFRESH_FRAMES) {
      const t0 = performance.now();
      if (biome >= 0 && biome < PALETTE.length) this.ground?.setGroundAlbedo(PALETTE[biome]);
      // RAISED FOR EXACTLY ONE CALL. `environmentFrom` renders all six cube
      // faces inside this call stack, so there is no frame between the raise and
      // the lower and the presented frame cannot observe ground mode. The lower
      // runs whatever the capture returned, because a sky box left in ground
      // mode would paint the world's lower half at the next present, which is
      // the one failure this ordering has to make impossible.
      const g = this.ground;
      if (g !== null && g.hasIblGround) { g.setGroundMode(true); this.groundBuilds++; }
      // RN-1524, on exactly the line above's discipline and inside the same
      // synchronous stack. `?ibldisc=` absent multiplies the disc by one, so
      // this pair is the identity on the shipped build.
      g?.setDiscBoost(true);
      const next = this.renderer.environmentFrom(skyScene);
      g?.setDiscBoost(false);
      g?.setGroundMode(false);
      if (next !== null) {
        // NOT disposed here: the renderer seam owns the render target the
        // texture belongs to, and disposing the texture alone leaks the target.
        this.texture = next;
        // RN-1526. `?ibldiag=noenv` assigns NULL here and changes nothing else:
        // the capture still ran, the ground half was still raised, the rebuild
        // still counted, and only the assignment differs. That is what makes
        // "the environment is worth N counts on this subject" one subtraction
        // rather than an inference from a two-variable pair.
        const env = iblEnvSuppressed() ? null : next;
        for (const t of this.targets) t.environment = env;
        this.builds++;
        this.lastMs = performance.now() - t0;
      }
      this.frames = 0;
      this.lastElevation = elevationDot;
      if (biome >= 0) this.lastBiome = biome;
    }
  }

  stats(): {
    builds: number; lastMs: number; ready: boolean; size: number;
    groundBuilds: number; ground: boolean; biome: number;
  } {
    return {
      builds: this.builds,
      lastMs: Math.round(this.lastMs * 100) / 100,
      ready: this.texture !== null,
      // RN-1415. WHICH environment these milliseconds belong to. `lastMs` alone
      // cannot tell a cheap rebuild from a small one.
      size: this.renderer.iblSize,
      // A COUNTER AND NOT A FLAG, on RN-58's `grabs` precedent: "the shell was
      // built once at boot" and "the shell is interposed on every rebuild" are
      // different claims and a boolean cannot tell them apart.
      groundBuilds: this.groundBuilds,
      ground: this.ground?.hasIblGround ?? false,
      biome: this.lastBiome,
    };
  }

  dispose(): void { this.texture = null; }
}
