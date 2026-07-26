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

import * as THREE from 'three';
import type { OFRenderer } from './Renderer.js';

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

export class SkyIbl {
  private texture: THREE.Texture | null = null;
  private frames = 0;
  private lastElevation = Number.NaN;
  builds = 0;
  lastMs = 0;

  /**
   * `targets` is every scene whose stock materials need an environment. The view
   * model is one of them and it is easy to forget: its own pass has no lights at
   * all, so the first-person arms rendered as a black silhouette holding a black
   * pickaxe against a lit landscape (W4_fp_tools, first capture).
   */
  constructor(private readonly renderer: OFRenderer, private readonly targets: THREE.Scene[]) {}

  /**
   * Rebuild if it is stale, then assign. `target.environment` is assigned every
   * call rather than once, because it is cheap and it makes the "who owns the
   * environment" question have one answer.
   */
  update(skyScene: THREE.Scene, elevationDot: number): void {
    const moved = !(Math.abs(elevationDot - this.lastElevation) < ELEVATION_EPS);
    if (this.texture === null || moved || ++this.frames >= REFRESH_FRAMES) {
      const t0 = performance.now();
      const next = this.renderer.environmentFrom(skyScene);
      if (next !== null) {
        // NOT disposed here: the renderer seam owns the render target the
        // texture belongs to, and disposing the texture alone leaks the target.
        this.texture = next;
        for (const t of this.targets) t.environment = next;
        this.builds++;
        this.lastMs = performance.now() - t0;
      }
      this.frames = 0;
      this.lastElevation = elevationDot;
    }
  }

  stats(): { builds: number; lastMs: number; ready: boolean } {
    return {
      builds: this.builds,
      lastMs: Math.round(this.lastMs * 100) / 100,
      ready: this.texture !== null,
    };
  }

  dispose(): void { this.texture = null; }
}
