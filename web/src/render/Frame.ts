// The 4-pass compositor. Owns the clear order and ONLY the clear order
// (ARCHITECTURE.md section 3.1). Compositing is by clear order, never by depth
// merge, so each pass gets a fresh depth buffer and its own decade range.

import type { OFRenderer } from './Renderer.js';
import type { Scenes } from './Scenes.js';
import type { CameraRig } from './CameraRig.js';

export interface PassTimings {
  sky: number; far: number; near: number; viewModel: number; total: number;
}

export class Frame {
  readonly timings: PassTimings = { sky: 0, far: 0, near: 0, viewModel: 0, total: 0 };

  constructor(
    private readonly r: OFRenderer,
    private readonly scenes: Scenes,
    private readonly rig: CameraRig,
  ) {}

  render(): void {
    const r = this.r;
    const t = this.timings;
    const t0 = performance.now();

    r.resetInfo();
    r.clearAll();

    r.render(this.scenes.sky, this.rig.skyCam);
    const t1 = performance.now();
    r.clearDepth();

    r.render(this.scenes.far, this.rig.farCam);
    const t2 = performance.now();
    r.clearDepth();

    r.render(this.scenes.near, this.rig.nearCam);
    const t3 = performance.now();
    r.clearDepth();

    r.render(this.scenes.viewModel, this.rig.vmCam);
    const t4 = performance.now();

    t.sky = t1 - t0;
    t.far = t2 - t1;
    t.near = t3 - t2;
    t.viewModel = t4 - t3;
    t.total = t4 - t0;
  }
}
