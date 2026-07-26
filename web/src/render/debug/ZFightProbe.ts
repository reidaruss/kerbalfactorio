// ?scenario=zfight: the five-scale depth probe that closes DW-3 by MEASUREMENT
// (ARCHITECTURE.md section 3.3, risk R3).
//
// Each scale is a pair of coplanar-ish quads: a GREEN front face and a RED back
// face a hair behind it. If depth precision holds, every pixel of the pair reads
// green. Z-fighting shows up as red bleeding through, which is a direct,
// single-frame, unambiguous number rather than a judgement about a screenshot.
// The camera then sweeps, and the frame-to-frame change in that number is the
// frame-diff assertion the design asked for.

import * as THREE from 'three';
import type { OFRenderer } from '../Renderer.js';
import type { Scenes } from '../Scenes.js';
import type { CameraRig } from '../CameraRig.js';
import { FAR_SCALE } from '../Scenes.js';
import type { FloatingOrigin } from '../../world/FloatingOrigin.js';
import type { Vec3d } from '../../world/PlanetBody.js';

export interface ZScaleResult {
  label: string;
  distanceM: number;
  separationM: number;
  /** Percentage of the pair's pixels showing the BACK surface. 0 is perfect. */
  bleedPct: number;
  /** Worst frame-to-frame change in bleedPct over the sweep: the frame-diff. */
  maxDeltaPct: number;
  pixels: number;
}

export interface ZFightResult {
  mode: string;
  frames: number;
  scales: ZScaleResult[];
  worstBleedPct: number;
  worstDeltaPct: number;
  verdict: 'PASS' | 'FAIL';
}

/** Anything above this is visible speckle, not sampling noise on quad edges. */
const BLEED_FAIL_PCT = 0.5;

interface Probe {
  label: string;
  distanceM: number;
  separationM: number;
  far: boolean;
  anchor: Vec3d;
  front: THREE.Mesh;
  back: THREE.Mesh;
  bleed: number;
  lastBleed: number;
  maxDelta: number;
  pixels: number;
}

/**
 * `sep` is the BUDGET: the separation, as a fraction of the distance, that this
 * scale is required to resolve. The numbers are the measured reversed-Z limits
 * on a 24-bit fixed-point default framebuffer (see ARCHITECTURE.md 15.2), so a
 * default run is a regression gate and not an arbitrary threshold. ?zsep=
 * overrides all five with one absolute ratio, which is how the limits were
 * swept in the first place.
 */
const SCALES: { label: string; d: number; sep: number; far: boolean }[] = [
  { label: 'decal @ 1 m', d: 1, sep: 1e-4, far: false },
  { label: 'machine @ 30 m', d: 30, sep: 1e-4, far: false },
  { label: 'cliff @ 2 km', d: 2e3, sep: 1e-2, far: false },
  { label: 'mountain @ 60 km', d: 6e4, sep: 1e-1, far: false },
  { label: 'moon @ 400,000 km', d: 4e8, sep: 3e-2, far: true },
];

function quad(color: number, size: number, order: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = order;
  m.matrixAutoUpdate = false;
  return m;
}

export class ZFightProbe {
  private readonly probes: Probe[] = [];
  private readonly px = new Uint8Array(256 * 256 * 4);
  private readonly v = new THREE.Vector3();
  /** Boot view direction. The BACK quad is offset along this and nothing else:
   *  "behind" is along the view ray, not radially inward. */
  private readonly fwd = new THREE.Vector3();
  private frames = 0;

  /**
   * @param eye    body-frame f64 eye at boot
   * @param fwd    unit forward, body frame
   * @param right  unit right, body frame
   * @param up     unit up, body frame
   */
  constructor(
    scenes: Scenes, origin: FloatingOrigin,
    eye: Vec3d, fwd: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3,
    /** Absolute override for every scale's budgeted ratio, or 0 for budgets. */
    readonly sepRatio: number,
  ) {
    this.fwd.copy(fwd).normalize();
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd.clone().negate(), up);
    const rot = new THREE.Quaternion().setFromRotationMatrix(look);
    SCALES.forEach((s, i) => {
      // Spread the five across the screen so their read-back rects never overlap.
      const lateral = (i - 2) * 0.30 * s.d;
      const size = 0.20 * s.d;
      const anchor: Vec3d = {
        x: eye.x + fwd.x * s.d + right.x * lateral,
        y: eye.y + fwd.y * s.d + right.y * lateral,
        z: eye.z + fwd.z * s.d + right.z * lateral,
      };
      const front = quad(0x00ff00, size, 0);
      const back = quad(0xff0000, size, 1);
      front.quaternion.copy(rot);
      back.quaternion.copy(rot);
      front.name = `zprobe front ${s.label}`;
      back.name = `zprobe back ${s.label}`;
      const target = s.far ? scenes.far : scenes.near;
      target.add(front);
      target.add(back);
      this.probes.push({
        label: s.label, distanceM: s.d, separationM: s.d * (sepRatio > 0 ? sepRatio : s.sep),
        far: s.far,
        anchor, front, back, bleed: 0, lastBleed: -1, maxDelta: 0, pixels: 0,
      });
    });
    this.place(origin);
  }

  /** Re-derive engine transforms from the 64-bit anchors. The rebase handler. */
  place(origin: FloatingOrigin): void {
    for (const p of this.probes) {
      const sep = p.separationM;
      const a = p.anchor;
      const f = this.fwd;
      if (p.far) {
        p.front.position.set(a.x * FAR_SCALE, a.y * FAR_SCALE, a.z * FAR_SCALE);
        p.back.position.set(
          (a.x + f.x * sep) * FAR_SCALE,
          (a.y + f.y * sep) * FAR_SCALE,
          (a.z + f.z * sep) * FAR_SCALE,
        );
        p.front.scale.setScalar(FAR_SCALE);
        p.back.scale.setScalar(FAR_SCALE);
      } else {
        origin.toEngine(a, p.front.position);
        origin.toEngine(a, p.back.position);
        p.back.position.addScaledVector(f, sep);
      }
      p.front.updateMatrix();
      p.back.updateMatrix();
      p.front.updateMatrixWorld(true);
      p.back.updateMatrixWorld(true);
    }
  }

  /** Read back the five regions. MUST run in the same task as the render. */
  sample(r: OFRenderer, rig: CameraRig, width: number, height: number, pixelRatio: number): void {
    this.frames++;
    for (const p of this.probes) {
      const cam = p.far ? rig.farCam : rig.nearCam;
      const rect = this.screenRect(p.front, cam, width, height);
      if (rect === null) { p.pixels = 0; continue; }
      const [x, y, w, h] = rect;
      const px = Math.round(x * pixelRatio), py = Math.round(y * pixelRatio);
      const pw = Math.min(256, Math.max(1, Math.round(w * pixelRatio)));
      const ph = Math.min(256, Math.max(1, Math.round(h * pixelRatio)));
      r.readPixels(px, py, pw, ph, this.px);
      let front = 0, back = 0;
      const n = pw * ph * 4;
      for (let i = 0; i < n; i += 4) {
        const rr = this.px[i], gg = this.px[i + 1];
        if (gg > rr + 24) front++;
        else if (rr > gg + 24) back++;
      }
      const total = front + back;
      p.pixels = total;
      const bleed = total > 0 ? (back / total) * 100 : 0;
      if (p.lastBleed >= 0) {
        const d = Math.abs(bleed - p.lastBleed);
        if (d > p.maxDelta) p.maxDelta = d;
      }
      p.lastBleed = bleed;
      if (bleed > p.bleed) p.bleed = bleed;
    }
  }

  /**
   * The quad's screen-space AABB, inset so quad EDGES (which are genuinely
   * mixed pixels) never count as bleed. Returns null when it is off screen.
   */
  private screenRect(
    mesh: THREE.Mesh, cam: THREE.PerspectiveCamera, width: number, height: number,
  ): [number, number, number, number] | null {
    const g = mesh.geometry.getAttribute('position');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < g.count; ++i) {
      this.v.fromBufferAttribute(g as THREE.BufferAttribute, i);
      this.v.applyMatrix4(mesh.matrixWorld).project(cam);
      if (this.v.z < -1 || this.v.z > 1) return null;
      const sx = (this.v.x * 0.5 + 0.5) * width;
      // readPixels' origin is bottom-left, which is already NDC's orientation.
      const sy = (this.v.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    const insetX = (maxX - minX) * 0.15, insetY = (maxY - minY) * 0.15;
    const x0 = Math.max(0, minX + insetX), y0 = Math.max(0, minY + insetY);
    const x1 = Math.min(width, maxX - insetX), y1 = Math.min(height, maxY - insetY);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }

  result(mode: string): ZFightResult {
    const scales = this.probes.map((p) => ({
      label: p.label,
      distanceM: p.distanceM,
      separationM: p.separationM,
      bleedPct: Math.round(p.bleed * 1000) / 1000,
      maxDeltaPct: Math.round(p.maxDelta * 1000) / 1000,
      pixels: p.pixels,
    }));
    const worstBleedPct = scales.reduce((a, s) => Math.max(a, s.bleedPct), 0);
    const worstDeltaPct = scales.reduce((a, s) => Math.max(a, s.maxDeltaPct), 0);
    const anyEmpty = scales.some((s) => s.pixels === 0);
    return {
      mode,
      frames: this.frames,
      scales,
      worstBleedPct,
      worstDeltaPct,
      verdict: !anyEmpty && worstBleedPct <= BLEED_FAIL_PCT && worstDeltaPct <= BLEED_FAIL_PCT
        ? 'PASS' : 'FAIL',
    };
  }
}
