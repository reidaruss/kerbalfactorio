// The assembly bay's pointer layer: DOM events in, verbs out.
//
// It is a separate file because the bay is the first mouse-DRIVEN screen in this
// client (everything else is pointer-locked and reads a key state on the fixed
// tick), so the click-versus-orbit decision, the slop threshold and the NDC
// conversion are a subject of their own rather than three lines inside a mode.
//
// The one rule worth stating: a pointerup after the camera MOVED is not a click.
// Without that, every orbit drag that happened to end over the rocket also
// placed a part, which is the classic 3D-editor bug and is invisible to a probe
// that drives actions instead of events.
import type * as THREE from 'three';
import type { VabCamera } from './VabCamera.js';

/** Below this much cursor travel a pointerup is a click, above it an orbit. */
export const CLICK_SLOP_PX = 6;

export interface PointerHost {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: VabCamera;
  /** The cursor moved: re-run the snap search and the ghost. */
  onAim(ndcX: number, ndcY: number): void;
  /** A real click at these normalised device coords. */
  onClick(ndcX: number, ndcY: number): void;
  /** Right button: drop whatever is in hand. */
  onCancel(): void;
}

export class VabPointer {
  ndcX = 0;
  ndcY = 0;
  /** Counters a probe can read, so "the mouse did nothing" is distinguishable
   *  from "the mouse was never delivered". */
  moves = 0; downs = 0; clicks = 0; orbits = 0; wheels = 0;

  private bound = false;

  constructor(private readonly h: PointerHost) {}

  bind(): void {
    if (this.bound) return;
    const c = this.h.canvas;
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerdown', this.onDown);
    // pointerup on the WINDOW, not the canvas: a drag that ends off the canvas
    // must still end, or the camera keeps orbiting with the button released.
    window.addEventListener('pointerup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onMenu);
    this.bound = true;
  }

  unbind(): void {
    if (!this.bound) return;
    const c = this.h.canvas;
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onMenu);
    this.h.cam.endDrag();
    this.bound = false;
  }

  get isBound(): boolean { return this.bound; }

  /** Drive the aim directly, in NDC. Used by the debug surface; it goes through
   *  the same `onAim` a real move does, so it cannot test a parallel path. */
  aimAt(ndcX: number, ndcY: number): void {
    this.ndcX = ndcX;
    this.ndcY = ndcY;
    this.h.onAim(ndcX, ndcY);
  }

  private setNdc(e: { clientX: number; clientY: number }): void {
    const r = this.h.canvas.getBoundingClientRect();
    this.ndcX = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    this.ndcY = -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
  }

  private readonly onMove = (e: PointerEvent): void => {
    this.moves += 1;
    this.setNdc(e);
    if (this.h.cam.isDragging) { this.h.cam.drag(e.clientX, e.clientY); return; }
    this.h.onAim(this.ndcX, this.ndcY);
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.downs += 1;
    this.setNdc(e);
    if (e.button === 2) { this.h.onCancel(); return; }
    if (e.button !== 0) return;
    this.h.cam.beginDrag(e.clientX, e.clientY);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const travel = this.h.cam.dragTravelPx;
    const wasDragging = this.h.cam.isDragging;
    this.h.cam.endDrag();
    if (e.button !== 0 || !wasDragging) return;
    if (travel > CLICK_SLOP_PX) { this.orbits += 1; return; }
    this.setNdc(e);
    this.clicks += 1;
    this.h.onClick(this.ndcX, this.ndcY);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheels += 1;
    this.h.cam.zoom(e.deltaY);
  };

  private readonly onMenu = (e: Event): void => { e.preventDefault(); };

  report(): unknown {
    return {
      bound: this.bound, ndc: [this.ndcX, this.ndcY],
      moves: this.moves, downs: this.downs, clicks: this.clicks,
      orbits: this.orbits, wheels: this.wheels,
    };
  }
}
