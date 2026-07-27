// The assembly bay's orbit camera. It drives `CameraRig.vabCam`, which the rig
// still owns (ARCHITECTURE 2.2 rule 2): this class writes a position and a
// look-at, and never constructs a camera of its own.
//
// Deliberately NOT three's OrbitControls: that add-on binds its own DOM
// listeners to the canvas, which would fight the VAB's picking for the same
// pointerdown and would be invisible to a driven probe. Sixty lines of spherical
// arithmetic is cheaper than owning that conflict.
import * as THREE from 'three';

const MIN_PITCH = -1.35;
const MAX_PITCH = 1.35;
const MIN_DIST = 2.5;
const MAX_DIST = 160;

export class VabCamera {
  yaw = 0.6;
  pitch = 0.15;
  distance = 22;
  readonly target = new THREE.Vector3(0, 6, 0);

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** Set while a drag is in progress, so a click that ROTATED is not a click. */
  dragTravelPx = 0;

  constructor(private readonly cam: THREE.PerspectiveCamera) { this.apply(); }

  beginDrag(clientX: number, clientY: number): void {
    this.dragging = true;
    this.lastX = clientX;
    this.lastY = clientY;
    this.dragTravelPx = 0;
  }

  drag(clientX: number, clientY: number): void {
    if (!this.dragging) return;
    const dx = clientX - this.lastX;
    const dy = clientY - this.lastY;
    this.lastX = clientX;
    this.lastY = clientY;
    this.dragTravelPx += Math.abs(dx) + Math.abs(dy);
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.005, MIN_PITCH, MAX_PITCH);
    this.apply();
  }

  endDrag(): void { this.dragging = false; }
  get isDragging(): boolean { return this.dragging; }

  zoom(deltaY: number): void {
    this.distance = clamp(this.distance * (deltaY > 0 ? 1.12 : 1 / 1.12),
                          MIN_DIST, MAX_DIST);
    this.apply();
  }

  /** Pan the target up and down the stack, which is the only pan a rocket needs. */
  raise(dy: number): void {
    this.target.y = clamp(this.target.y + dy, -2, 200);
    this.apply();
  }

  /**
   * Frame a bounding box. Distance is derived from the vertical FOV so a tall
   * rocket fits without a magic multiplier, plus a small margin so the readouts
   * on the rails never sit over the nose.
   */
  frame(centre: THREE.Vector3, size: THREE.Vector3): void {
    this.target.copy(centre);
    const half = Math.max(size.y * 0.5, size.x, size.z, 1.5);
    const fov = (this.cam.fov * Math.PI) / 180;
    this.distance = clamp((half / Math.tan(fov * 0.5)) * 1.55, MIN_DIST, MAX_DIST);
    this.apply();
  }

  apply(): void {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.cam.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * sp,
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.target);
    this.cam.updateMatrixWorld(true);
  }

  report(): unknown {
    return {
      yaw: this.yaw, pitch: this.pitch, distance: this.distance,
      target: [this.target.x, this.target.y, this.target.z],
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v);
}
