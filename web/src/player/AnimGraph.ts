// The character's animation state, and the crossfade that plays it.
//
// ONE state enum drives BOTH skeletons. The third-person body and the
// first-person arms are separate .glb files with separate, self-contained clip
// sets (ASSET-SPECS 4.1 and 4.2), and the clip NAMES differ (`Walk` against
// `FP_Walk_Bob`), but the state that selects them must not, or the arms would be
// able to swing while the body idles. Each rig therefore owns a name map and
// nothing else; the state itself is computed once, from the capsule.
//
// Impact frames are a gameplay contract and are identical between the two
// files, so a swing started here fires at the same moment in both views.
// DW-34 shifted every clip's first key from Blender frame 1 to 0, which removed
// a 16.7 ms dead hold at the start of every clip and moved every published
// index down by one: the RUNTIME ticks are now 16 pickaxe, 17 axe, 15 dig, and
// `Swing_Pickaxe` spans 32/60 s rather than 33/60.

import * as THREE from 'three';

export type PlayerAnim =
  | 'idle' | 'walk' | 'run' | 'jumpStart' | 'jumpLoop' | 'jumpLand' | 'fall'
  | 'swing' | 'swingAxe' | 'dig';

/** Which tool the swing is with. Chopping a tree is not mining a rock. */
export type SwingKind = 'pickaxe' | 'axe' | 'dig';

/** Clip name per state, or null to fall back to the idle clip. */
export type ClipMap = Readonly<Record<PlayerAnim, string | null>>;

export const BODY_CLIPS: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run',
  jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land',
  fall: 'Fall', swing: 'Swing_Pickaxe', swingAxe: 'Swing_Axe', dig: 'Dig',
};

/**
 * The FP set used to map jump, loop, land and fall to null, with a comment
 * claiming that was correct because "the camera does the jumping". It was not
 * correct, it was a gap: the arms went dead still the moment the player left
 * the ground. The art lane shipped `FP_Jump_Start`, `FP_Jump_Loop`,
 * `FP_Jump_Land` and `FP_Fall` and they are wired here (blocker A-6).
 * `FP_Swing_Axe` and `FP_Dig` likewise ship and were unreachable.
 */
export const FP_CLIPS: ClipMap = {
  idle: 'FP_Idle', walk: 'FP_Walk_Bob', run: 'FP_Run_Bob',
  jumpStart: 'FP_Jump_Start', jumpLoop: 'FP_Jump_Loop', jumpLand: 'FP_Jump_Land',
  fall: 'FP_Fall', swing: 'FP_Swing_Pickaxe', swingAxe: 'FP_Swing_Axe',
  dig: 'FP_Dig',
};

/**
 * DW-34, read out of the exported samplers rather than inferred. Each entry is
 * the RUNTIME tick the tool lands on and the tick count the clip occupies, and
 * they are here rather than in three places because a published index into an
 * asset is an interface.
 */
export const SWING_CLIPS: Readonly<Record<SwingKind,
{ anim: PlayerAnim; impactTicks: number; ticks: number }>> = {
  pickaxe: { anim: 'swing', impactTicks: 16, ticks: 32 },
  axe: { anim: 'swingAxe', impactTicks: 17, ticks: 34 },
  dig: { anim: 'dig', impactTicks: 15, ticks: 30 },
};

const FADE_SECS = 0.15;
/** Authored ground speeds, used to keep the stride from skating (ASSET-SPECS 4.1). */
const WALK_CLIP_MPS = 1.4;
const RUN_CLIP_MPS = 4.5;
/** Above this the run clip is used; below it the walk clip. */
const RUN_THRESHOLD_MPS = 3.0;
/**
 * A-13. Sprint is `walkMps * 2` = 9.2 m/s against a clip authored at 4.5, so
 * the run played at timeScale 2.04 and read as a cartoon: the legs blur and the
 * character stops looking like it has weight.
 *
 * There is no sprint clip, so this is a choice between two wrong answers and
 * the cap is the less wrong one. Uncapped, cadence is right and the pose is
 * unreadable. Capped at 1.60, the clip plays at a cadence a person could hold
 * and the feet slip 2.0 m/s (22%) at full sprint, which is the standard game
 * answer and is invisible next to blurred legs. It costs nothing at the 4.6 m/s
 * default, where the scale is 1.02 and the measured slip stays at the 0.9 mm
 * the gait was authored to. **The right fix is an authored sprint clip**, and
 * that is an ask on the art lane, recorded rather than pretended away.
 */
const RUN_TIMESCALE_MAX = 1.6;
const SWING_SECS = 32 / 60;

export class AnimGraph {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  state: PlayerAnim = 'idle';

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], private readonly map: ClipMap) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }

  get clipCount(): number { return this.actions.size; }
  get playing(): string { return this.currentName; }

  /**
   * Crossfade to `state`. `speedMps` retimes the locomotion clips so the feet
   * match the ground: a walk clip authored at 1.4 m/s played at 4.6 m/s skates,
   * and skating is the single most obvious tell that a character is a puppet.
   */
  set(state: PlayerAnim, speedMps: number): void {
    this.state = state;
    const name = this.map[state] ?? this.map.idle ?? '';
    const next = this.actions.get(name);
    if (next === undefined || next === this.current) {
      if (next !== undefined) this.retime(next, state, speedMps);
      return;
    }
    const once = state === 'swing' || state === 'swingAxe' || state === 'dig'
      || state === 'jumpStart' || state === 'jumpLand';
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    this.retime(next, state, speedMps);
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current === null) next.play();
    else { next.play(); next.crossFadeFrom(this.current, FADE_SECS, false); }
    this.current = next;
    this.currentName = name;
  }

  private retime(a: THREE.AnimationAction, state: PlayerAnim, speedMps: number): void {
    if (state === 'walk') {
      a.timeScale = Math.min(RUN_TIMESCALE_MAX, Math.max(0.4, speedMps / WALK_CLIP_MPS));
    } else if (state === 'run') {
      a.timeScale = Math.min(RUN_TIMESCALE_MAX, Math.max(0.5, speedMps / RUN_CLIP_MPS));
    } else a.timeScale = 1;
  }

  /**
   * Every loaded clip's duration and the time of its FIRST keyframe, straight
   * off the three.js `AnimationClip` the loader built.
   *
   * DW-34's property is `firstKeyT === 0` EXACTLY. It is an equality and not a
   * tolerance because `frame / 60` into a float32 makes frame 0 exactly 0.0, so
   * a tolerance here would only be somewhere for the defect to hide: the broken
   * value is 0.016666668, which is a whole frame and not an epsilon.
   */
  timings(): { name: string; duration: number; firstKeyT: number; tracks: number }[] {
    const out = [];
    for (const [name, a] of this.actions) {
      const clip = a.getClip();
      let first = Number.POSITIVE_INFINITY;
      for (const t of clip.tracks) if (t.times.length > 0) first = Math.min(first, t.times[0]);
      out.push({
        name, duration: clip.duration, tracks: clip.tracks.length,
        firstKeyT: Number.isFinite(first) ? first : -1,
      });
    }
    out.sort((x, y) => (x.name < y.name ? -1 : 1));
    return out;
  }

  /** Which states have no clip on this rig. DW-34's companion: A-6's nulls. */
  unmapped(): string[] {
    const out = [];
    for (const [state, name] of Object.entries(this.map)) {
      if (name === null || !this.actions.has(name)) out.push(state);
    }
    return out;
  }

  update(dt: number): void { this.mixer.update(dt); }
}

/** State machine input: everything the graph needs, and nothing that is a view. */
export interface AnimInput {
  grounded: boolean;
  speedMps: number;
  /** Seconds remaining in a triggered swing, or 0. */
  swingLeft: number;
  /** Which swing is running. Ignored while `swingLeft` is 0. */
  swingKind: SwingKind;
  /** Upward component of velocity, m/s. Positive is rising. */
  verticalMps: number;
}

/** The whole state machine. Pure, so the same call drives body and arms. */
export function resolveAnim(i: AnimInput): PlayerAnim {
  if (i.swingLeft > 0) return SWING_CLIPS[i.swingKind].anim;
  if (!i.grounded) return i.verticalMps > 0.5 ? 'jumpLoop' : 'fall';
  if (i.speedMps > RUN_THRESHOLD_MPS) return 'run';
  if (i.speedMps > 0.15) return 'walk';
  return 'idle';
}

export const SWING_DURATION_SECS = SWING_SECS;

/** How long a swing of `kind` occupies, in seconds. DW-34 numbers. */
export function swingSecs(kind: SwingKind): number {
  return SWING_CLIPS[kind].ticks / 60;
}
