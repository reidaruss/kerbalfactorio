// The one AudioContext, the master gain, the mute key, and the browser's
// autoplay rule.
//
// EVERY BROWSER BLOCKS AUDIO UNTIL A GESTURE. A context created at boot starts
// `suspended` and stays there, silently, so the game would be mute for exactly
// the players who never noticed why. The context is therefore created lazily and
// resumed from the first real pointer or key event, which the game already has
// (the canvas takes a click to acquire pointer lock).
//
// THE COST IS THE POINT. Nothing here runs per frame: there is no analyser, no
// scheduler and no polling. A one-shot builds three or four nodes, schedules a
// stop, and is collected by the implementation. `cpuMs` is wall time actually
// spent inside this module, measured rather than asserted, so the claim "audio
// is free" can be checked instead of believed.

const STORAGE_KEY = 'of.audio';

export interface AudioStats {
  supported: boolean;
  state: string;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  /** One-shots started, and how many are still scheduled to be audible. */
  plays: Record<string, number>;
  totalPlays: number;
  /** Wall milliseconds spent building voice graphs since boot. */
  cpuMs: number;
  /** Persistent nodes: the machine hum and the fire bed. Two at most. */
  loops: number;
}

export class AudioBus {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private unlockedFlag = false;
  private mutedFlag = false;
  private vol = 0.7;
  private cpu = 0;
  private readonly counts: Record<string, number> = {};
  private total = 0;
  loops = 0;

  constructor() {
    // Volume and mute survive a reload: a player who muted the game did not
    // mean "until the next refresh".
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const s = JSON.parse(raw) as { v?: number; m?: boolean };
        if (typeof s.v === 'number') this.vol = Math.max(0, Math.min(1, s.v));
        if (typeof s.m === 'boolean') this.mutedFlag = s.m;
      }
    } catch { /* a broken or absent store just means defaults */ }
  }

  get supported(): boolean {
    return typeof globalThis.AudioContext === 'function';
  }

  get unlocked(): boolean { return this.unlockedFlag; }
  get muted(): boolean { return this.mutedFlag; }
  get volume(): number { return this.vol; }
  get context(): BaseAudioContext | null { return this.ctx; }
  get now(): number { return this.ctx?.currentTime ?? 0; }

  /**
   * Install the one-shot gesture listeners. Capture phase and `once`, on the
   * window rather than the canvas, because the first gesture a player makes may
   * be a key press with the canvas unfocused and that still counts.
   */
  attach(): void {
    if (!this.supported) return;
    const go = (): void => { void this.unlock(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, go, { once: true, capture: true });
    }
  }

  /** Create and resume the context. Safe to call repeatedly. */
  async unlock(): Promise<boolean> {
    if (!this.supported) return false;
    if (this.ctx === null) this.build();
    const c = this.ctx as AudioContext | null;
    if (c === null) return false;
    if (c.state === 'suspended') { try { await c.resume(); } catch { return false; } }
    this.unlockedFlag = c.state === 'running';
    return this.unlockedFlag;
  }

  private build(): void {
    const c = new AudioContext({ latencyHint: 'interactive' });
    const g = c.createGain();
    g.gain.value = this.gainValue();
    g.connect(c.destination);
    this.ctx = c;
    this.master = g;
  }

  private gainValue(): number { return this.mutedFlag ? 0 : this.vol; }

  private apply(): void {
    if (this.master === null || this.ctx === null) return;
    // A ramp, not a jump: a gain step on a running oscillator is a click.
    this.master.gain.setTargetAtTime(this.gainValue(), this.ctx.currentTime, 0.02);
  }

  setVolume(v: number): number {
    this.vol = Math.max(0, Math.min(1, v));
    this.apply();
    this.save();
    return this.vol;
  }

  setMuted(m: boolean): boolean {
    this.mutedFlag = m;
    this.apply();
    this.save();
    return this.mutedFlag;
  }

  toggleMute(): boolean { return this.setMuted(!this.mutedFlag); }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: this.vol, m: this.mutedFlag }));
    } catch { /* private mode; the setting simply does not persist */ }
  }

  /**
   * The destination every voice connects to, or null when there is no audio.
   * Returns null while muted too, so a muted game builds no graph at all rather
   * than building one and multiplying it by zero.
   */
  out(): { ctx: BaseAudioContext; dest: AudioNode } | null {
    if (this.ctx === null || this.master === null) return null;
    if (this.mutedFlag || !this.unlockedFlag) return null;
    return { ctx: this.ctx, dest: this.master };
  }

  /** Count a play and charge it the wall time its graph took to build. */
  spend(name: string, ms: number): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    this.total++;
    this.cpu += ms;
  }

  stats(): AudioStats {
    return {
      supported: this.supported,
      state: (this.ctx as AudioContext | null)?.state ?? 'none',
      unlocked: this.unlockedFlag,
      muted: this.mutedFlag,
      volume: Math.round(this.vol * 1000) / 1000,
      plays: { ...this.counts },
      totalPlays: this.total,
      cpuMs: Math.round(this.cpu * 1000) / 1000,
      loops: this.loops,
    };
  }
}
