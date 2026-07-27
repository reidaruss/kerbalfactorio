// DOM/pointer -> an input tape. Every consumer reads the tape, never the DOM, so
// a scripted tape from window.__of.input is indistinguishable from a human
// (ARCHITECTURE.md section 11.2). That is what makes replays deterministic.
//
// AND EVERY CONSUMER ASKS FOR AN ACTION, never for a key. The binding table is
// Bindings.ts and nothing else in the client names a key code, so a remap costs
// one file. Mouse buttons are codes in the same held set (`Mouse0`), which is
// what lets "left click" be a tape entry.

import { BINDINGS, UI_ALLOWED, codesFor, isAction, type Action }
  from './Bindings.js';

/** Shared empty allowance, so releasing the pointer allocates nothing. */
const EMPTY_ALLOW: readonly Action[] = [];

export interface InputFrame {
  fwd: number; right: number; up: number;
  dYaw: number; dPitch: number;
  zoom: number;
  boost: boolean;
  /** Space. Held state; the controller edge-detects what it needs. */
  jump: boolean;
  /** Held state; Controller turns it into one toggle per press. */
  toggleView: boolean;
  /**
   * THE HAND. Held state; consumers edge-detect a press and HOLD is meaningful
   * too, because dragging a belt run is one held button (GP-27).
   */
  use: boolean;
  /** Open a furnace, take from a machine, work a door. Never harvests (GP-26). */
  interact: boolean;
  /** Tab. Held state; the UI edge-detects it into one open/close per press. */
  panel: boolean;
  /** Escape. Held state; the modal stack edge-detects it (GP-25). */
  cancel: boolean;
  /** Held state; Systems edge-detects it into one headlamp toggle (W5). */
  lamp: boolean;
  /** Held state; LevelAction latches a floor on the press and repeats on a
   *  cooldown, so a terraforming pass is one held key (WG-22). */
  level: boolean;
  /** Wheel notches since the last sample. Positive is one slot to the right. */
  wheel: number;
}

export interface TapeEntry {
  /** Frames to hold this state for. */
  hold: number;
  /** Raw codes. `Mouse0` is the left button. */
  keys?: string[];
  /** Actions, resolved through the binding table. Prefer these. */
  actions?: string[];
  dYaw?: number;
  dPitch?: number;
  zoom?: number;
  /** Wheel notches applied on the FIRST frame of this entry, not every frame. */
  wheel?: number;
}

const MOUSE_SENS = 0.0025;

export class Input {
  private readonly down = new Set<string>();
  private dYaw = 0;
  private dPitch = 0;
  private zoomAccum = 0;
  private wheelAccum = 0;
  private dragging = false;
  /**
   * POINTER LOCK. Drag-to-look was fine for a camera probe and is wrong for a
   * game: a player who has to hold a button to turn cannot turn and act at the
   * same time. Locked, movementX arrives with no button held and with no
   * window edge to run into. The drag path stays for the orbit-camera
   * scenarios and for anyone whose browser refuses the lock.
   */
  private locked = false;
  /** False while the UI owns the pointer: no look, no movement, no use. */
  private lookEnabled = true;
  private uiHeld = false;
  /** The open panel's OWN actions. See `setUiCapture`. */
  private uiAllow: readonly Action[] = EMPTY_ALLOW;
  private el: HTMLElement | null = null;
  private tape: TapeEntry[] = [];
  private tapeIdx = 0;
  private tapeHeld = 0;

  readonly frame: InputFrame = {
    fwd: 0, right: 0, up: 0, dYaw: 0, dPitch: 0, zoom: 0, boost: false,
    jump: false, toggleView: false, use: false, interact: false, panel: false,
    cancel: false, lamp: false, level: false, wheel: 0,
  };

  attach(el: HTMLElement): void {
    this.el = el;
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      // Tab moves focus and Space scrolls; both would leak out of the canvas.
      // Escape is NOT prevented: the browser's own pointer-lock exit is a
      // guarantee we must not fight, only cooperate with (GP-25).
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('contextmenu', stop);
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      // Pointer capture is a CONVENIENCE for drag-look, never a precondition
      // for the click registering. It throws for a pointer id the browser does
      // not consider active, and because it sat above the line that records the
      // button, one throw skipped everything below it and the press vanished.
      // `dragging` was set first, so look still worked and only the button was
      // lost, which is exactly the shape of "I can turn but I cannot swing".
      try { el.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
      // THE CLICK THAT BUYS THE LOCK IS NOT A SWING. Without this the press
      // that re-captures the pointer after Escape also places a building under
      // the crosshair, which reads as the game acting on a click the player
      // made at the menu.
      //
      // But ONLY the click that actually buys it. This used to swallow every
      // click made while unlocked, which meant the left button was completely
      // inert whenever the lock was not held, and drag-to-look is a supported
      // mode that never holds it. Reported as "left click to harvest and place
      // doesnt work", and invisible to the whole probe suite because probes
      // drive the `use` ACTION and never generate a pointer event.
      const code = `Mouse${e.button}`;
      if (this.lookEnabled && !this.locked) {
        this.requestLockThen((gotLock) => {
          // No lock means the click bought nothing, so it was a real click.
          // `dragging` guards a release that already happened: adding the code
          // after pointerup would leave the button held forever.
          if (!gotLock && this.dragging) this.down.add(code);
        });
      } else {
        this.down.add(code);
      }
    });
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      // Release BEFORE nothing: the delete must happen even if release throws,
      // or a failed capture leaves the button held for ever.
      this.down.delete(`Mouse${e.button}`);
      try { el.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.lookEnabled) return;
      if (!this.dragging && !this.locked) return;
      // Yaw is NOT the mirror of pitch, and assuming it was is how this shipped
      // inverted. tangentFrame builds ENU with east x north = up, and ViewMode
      // aims along east*sin(yaw) + north*cos(yaw), so RISING yaw swings from
      // north toward east, which is a turn to the RIGHT. Mouse right therefore
      // ADDS. Pitch keeps its minus: screen Y grows downward, so mouse down
      // must lower the aim.
      this.dYaw += e.movementX * MOUSE_SENS;
      this.dPitch -= e.movementY * MOUSE_SENS;
    });
    el.addEventListener('click', () => {
      if (this.lookEnabled && !this.locked) this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      // Escape also exits the lock, and the accumulated deltas from the frame
      // the lock dropped would otherwise land as a spin on the next sample.
      if (!this.locked) { this.dYaw = 0; this.dPitch = 0; }
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const n = e.deltaY > 0 ? 1 : -1;
      this.zoomAccum += n;
      this.wheelAccum += n;
    }, { passive: false });
  }

  /**
   * Ask for the lock back. The promise is CAUGHT rather than voided: Chrome
   * rejects a re-lock made outside a user gesture and an unhandled rejection is
   * a console error, which fails every driven probe in the suite.
   */
  private requestLock(): void {
    const p = this.el?.requestPointerLock?.() as unknown;
    if (p instanceof Promise) p.catch(() => undefined);
  }

  /**
   * Ask for the lock and report whether it was granted, so a caller can tell a
   * click that BOUGHT the lock from a click that merely happened while
   * unlocked. Those are the same event and only the first should be eaten.
   *
   * The promise form is Chrome's; older engines return undefined, in which case
   * the only honest answer comes from whether `pointerlockchange` has fired by
   * the next turn of the loop.
   */
  private requestLockThen(done: (gotLock: boolean) => void): void {
    const p = this.el?.requestPointerLock?.() as unknown;
    if (p instanceof Promise) p.then(() => done(true), () => done(false));
    else setTimeout(() => done(this.locked), 0);
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
   * Hand the pointer to the UI, or take it back. Everything except the actions
   * on UI_ALLOWED is muted while the UI holds it, tape-driven runs included, so
   * a scripted probe sees exactly what a player sees.
   *
   * `alsoAllow` is the panel's OWN actions, live only while that panel holds
   * the pointer. UI_ALLOWED is global and deliberately tiny; this is the seam
   * for the case it cannot express, which the assembly bay's launch key is:
   * `board` must work while the bay is open and must NOT work from the
   * inventory screen. Cleared on release, so an allowance can never outlive the
   * panel that asked for it.
   */
  setUiCapture(on: boolean, alsoAllow: readonly Action[] = []): void {
    this.uiAllow = on ? alsoAllow : EMPTY_ALLOW;
    this.uiHeld = on;
    this.lookEnabled = !on;
    this.down.clear();
    this.dYaw = 0;
    this.dPitch = 0;
    this.wheelAccum = 0;
    if (on) { if (this.locked) document.exitPointerLock(); }
    else this.requestLock();
  }

  /** Zero everything the UI is swallowing. See UI_ALLOWED for what survives. */
  private mute(f: InputFrame): void {
    f.fwd = 0; f.right = 0; f.up = 0;
    f.dYaw = 0; f.dPitch = 0; f.zoom = 0; f.wheel = 0;
    f.boost = false; f.jump = false; f.toggleView = false;
    f.use = false; f.lamp = false; f.level = false;
  }

  private axis(neg: Action, pos: Action): number {
    return (this.act(pos) ? 1 : 0) - (this.act(neg) ? 1 : 0);
  }

  /**
   * Is this ACTION held right now? The one question every consumer asks.
   *
   * It reads the SAME source `sample()` did, live or taped, so a scripted tape
   * drives the build menu exactly as a human does, and it honours the UI
   * capture so a consumer cannot act behind an open panel by accident.
   */
  act(a: Action): boolean {
    if (this.uiHeld && !UI_ALLOWED.includes(a) && !this.uiAllow.includes(a)) return false;
    for (const c of BINDINGS[a]) if (this.active.has(c)) return true;
    return false;
  }

  /** Raw held-code test. Only the debug HUD's backtick still needs one. */
  held(code: string): boolean {
    return !this.uiHeld && this.active.has(code);
  }

  /** Whatever was down for the frame `sample()` last produced. */
  private active: ReadonlySet<string> = new Set();

  /** Collapse everything accumulated since the last call into one frame. */
  sample(): InputFrame {
    const f = this.frame;
    if (this.tapePending()) {
      const e = this.tape[this.tapeIdx];
      const keys = new Set<string>(e.keys ?? []);
      for (const name of e.actions ?? []) for (const c of codesFor(name)) keys.add(c);
      this.active = keys;
      f.dYaw = e.dYaw ?? 0;
      f.dPitch = e.dPitch ?? 0;
      f.zoom = e.zoom ?? 0;
      // The wheel is a DELTA, so it fires on the entry's first frame only. A
      // tape holding `wheel: 1` for thirty frames would otherwise spin the
      // hotbar thirty slots, which is not what one notch means.
      f.wheel = this.tapeHeld === 0 ? this.tapeWheel(e) : 0;
      this.fill(f);
      if (this.uiHeld) this.mute(f);
      if (++this.tapeHeld >= Math.max(1, e.hold)) { this.tapeIdx++; this.tapeHeld = 0; }
      return f;
    }
    this.active = this.down;
    f.dYaw = this.dYaw;
    f.dPitch = this.dPitch;
    f.zoom = this.zoomAccum;
    f.wheel = this.wheelAccum;
    this.fill(f);
    if (this.uiHeld) this.mute(f);
    this.dYaw = 0;
    this.dPitch = 0;
    this.zoomAccum = 0;
    this.wheelAccum = 0;
    return f;
  }

  /** A tape entry's wheel, from the explicit field or from a slot action. */
  private tapeWheel(e: TapeEntry): number {
    if (e.wheel !== undefined) return e.wheel;
    const a = e.actions ?? [];
    return (a.includes('slotNext') ? 1 : 0) - (a.includes('slotPrev') ? 1 : 0);
  }

  /** The named fields, from whichever held set `active` currently points at. */
  private fill(f: InputFrame): void {
    f.fwd = this.axis('back', 'forward');
    f.right = this.axis('strafeLeft', 'strafeRight');
    f.up = this.axis('flyDown', 'flyUp');
    f.boost = this.act('sprint');
    f.jump = this.act('jump');
    f.toggleView = this.act('view');
    f.use = this.act('use');
    f.interact = this.act('interact');
    f.panel = this.act('pack');
    f.cancel = this.act('cancel');
    f.lamp = this.act('lamp');
    f.level = this.act('level');
  }
}

export { isAction };
export type { Action };
