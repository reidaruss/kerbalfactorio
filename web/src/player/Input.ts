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
  /** KeyE. Held state; DigAction turns it into one dig per cooldown (W5). */
  mine: boolean;
  /** Tab. Held state; the UI edge-detects it into one open/close per press. */
  panel: boolean;
  /** KeyG. Held state; the build system edge-detects it into one placement. */
  place: boolean;
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
  /**
   * POINTER LOCK. Drag-to-look was fine for a camera probe and is wrong for a
   * game: a player who has to hold a button to turn cannot turn and act at the
   * same time. Locked, movementX arrives with no button held and with no
   * window edge to run into. The drag path stays for the orbit-camera
   * scenarios and for anyone whose browser refuses the lock.
   */
  private locked = false;
  /** False while the UI owns the pointer: no look, no movement, no interact. */
  private lookEnabled = true;
  private uiHeld = false;
  private el: HTMLElement | null = null;
  private tape: TapeEntry[] = [];
  private tapeIdx = 0;
  private tapeHeld = 0;

  readonly frame: InputFrame = {
    fwd: 0, right: 0, up: 0, dYaw: 0, dPitch: 0, zoom: 0, boost: false,
    jump: false, toggleView: false, mine: false, panel: false, place: false,
  };

  attach(el: HTMLElement): void {
    this.el = el;
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      // Tab moves focus and Space scrolls; both would leak out of the canvas.
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') {
        e.preventDefault();
      }
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
      if (!this.lookEnabled) return;
      if (!this.dragging && !this.locked) return;
      this.dYaw -= e.movementX * MOUSE_SENS;
      this.dPitch -= e.movementY * MOUSE_SENS;
    });
    el.addEventListener('click', () => {
      if (this.lookEnabled && !this.locked) void el.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      // Escape also exits the lock, and the accumulated deltas from the frame
      // the lock dropped would otherwise land as a spin on the next sample.
      if (!this.locked) { this.dYaw = 0; this.dPitch = 0; }
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

  /** True while the pointer is locked to the canvas (flight-smooth mouse look). */
  get pointerLocked(): boolean { return this.locked; }

  /**
   * Hand the pointer to the UI, or take it back. Everything except the panel
   * key is muted while the UI holds it, tape-driven runs included, so a
   * scripted probe sees exactly what a player sees.
   */
  setUiCapture(on: boolean): void {
    this.uiHeld = on;
    this.lookEnabled = !on;
    this.down.clear();
    this.dYaw = 0;
    this.dPitch = 0;
    if (on) { if (this.locked) document.exitPointerLock(); }
    else if (this.el !== null) void this.el.requestPointerLock?.();
  }

  /**
   * Zero everything the UI is swallowing. `panel` and `mine` survive on
   * purpose: Tab has to be able to close the panel it opened, and a machine
   * screen has to close with the same key that opened it. Consumers behind an
   * open panel must therefore ignore `mine` themselves, which Gameplay does by
   * returning before the interaction step.
   */
  private mute(f: InputFrame): void {
    f.fwd = 0; f.right = 0; f.up = 0;
    f.dYaw = 0; f.dPitch = 0; f.zoom = 0;
    f.boost = false; f.jump = false; f.toggleView = false;
    f.place = false;
  }

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
      f.mine = keys.has('KeyE');
      f.panel = keys.has('Tab');
      f.place = keys.has('KeyG');
      if (this.uiHeld) this.mute(f);
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
    f.mine = this.down.has('KeyE');
    f.panel = this.down.has('Tab');
    f.place = this.down.has('KeyG');
    if (this.uiHeld) this.mute(f);
    this.dYaw = 0;
    this.dPitch = 0;
    this.zoomAccum = 0;
    return f;
  }
}
