// DOM/pointer -> an input tape. Every consumer reads the tape, never the DOM, so
// a scripted tape from window.__of.input is indistinguishable from a human
// (ARCHITECTURE.md section 11.2). That is what makes replays deterministic.

export interface InputFrame {
  fwd: number; right: number; up: number;
  dYaw: number; dPitch: number;
  zoom: number;
  boost: boolean;
  /** Space. Held state; the controller edge-detects what it needs. */
  jump: boolean;
  /** KeyV. Held state; Controller turns it into one toggle per press. */
  toggleView: boolean;
}

export interface TapeEntry {
  /** Frames to hold this state for. */
  hold: number;
  keys?: string[];
  dYaw?: number;
  dPitch?: number;
  zoom?: number;
}

const MOUSE_SENS = 0.0025;

export class Input {
  private readonly down = new Set<string>();
  private dYaw = 0;
  private dPitch = 0;
  private zoomAccum = 0;
  private dragging = false;
  private tape: TapeEntry[] = [];
  private tapeIdx = 0;
  private tapeHeld = 0;

  readonly frame: InputFrame = {
    fwd: 0, right: 0, up: 0, dYaw: 0, dPitch: 0, zoom: 0, boost: false,
    jump: false, toggleView: false,
  };

  attach(el: HTMLElement): void {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('contextmenu', stop);
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dYaw -= e.movementX * MOUSE_SENS;
      this.dPitch -= e.movementY * MOUSE_SENS;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAccum += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });
  }

  /** Queue a scripted tape. Replaces anything still playing. */
  playTape(tape: TapeEntry[]): void {
    this.tape = tape;
    this.tapeIdx = 0;
    this.tapeHeld = 0;
  }

  tapePending(): boolean { return this.tapeIdx < this.tape.length; }

  private axis(neg: string[], pos: string[]): number {
    let v = 0;
    for (const k of neg) if (this.down.has(k)) v -= 1;
    for (const k of pos) if (this.down.has(k)) v += 1;
    return v;
  }

  /** Collapse everything accumulated since the last call into one frame. */
  sample(): InputFrame {
    const f = this.frame;
    if (this.tapePending()) {
      const e = this.tape[this.tapeIdx];
      const keys = new Set(e.keys ?? []);
      f.fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      f.right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      f.up = (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0);
      f.dYaw = e.dYaw ?? 0;
      f.dPitch = e.dPitch ?? 0;
      f.zoom = e.zoom ?? 0;
      f.boost = keys.has('ShiftLeft');
      f.jump = keys.has('Space');
      f.toggleView = keys.has('KeyV');
      if (++this.tapeHeld >= Math.max(1, e.hold)) { this.tapeIdx++; this.tapeHeld = 0; }
      return f;
    }
    f.fwd = this.axis(['KeyS'], ['KeyW']);
    f.right = this.axis(['KeyA'], ['KeyD']);
    f.up = this.axis(['KeyF'], ['KeyR']);
    f.dYaw = this.dYaw;
    f.dPitch = this.dPitch;
    f.zoom = this.zoomAccum;
    f.boost = this.down.has('ShiftLeft') || this.down.has('ShiftRight');
    f.jump = this.down.has('Space');
    f.toggleView = this.down.has('KeyV');
    this.dYaw = 0;
    this.dPitch = 0;
    this.zoomAccum = 0;
    return f;
  }
}
