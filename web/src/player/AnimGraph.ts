// The character's animation state, and the crossfade that plays it.
//
// ONE state enum drives BOTH skeletons. The third-person body and the
// first-person arms are separate .glb files with separate, self-contained clip
// sets (ASSET-SPECS 4.1 and 4.2), and the clip NAMES differ (`Walk` against
// `FP_Walk_Bob`), but the state that selects them must not, or the arms would be
// able to swing while the body idles. Each rig therefore owns a name map and
// nothing else; the state itself is computed once, from the capsule.
//
// Impact frames are a gameplay contract (17 pickaxe, 18 axe, 16 dig) and are
// identical between the two files, so a swing started here fires at the same
// moment in both views. W5 hangs harvestNode() off `swingImpacted`.

import * as THREE from 'three';

export type PlayerAnim =
  | 'idle' | 'walk' | 'run' | 'jumpStart' | 'jumpLoop' | 'jumpLand' | 'fall' | 'swing';

/** Clip name per state, or null to fall back to the idle clip. */
export type ClipMap = Readonly<Record<PlayerAnim, string | null>>;

export const BODY_CLIPS: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run',
  jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land',
  fall: 'Fall', swing: 'Swing_Pickaxe',
};

/**
 * The FP set has no jump, fall or land clip and that is correct rather than
 * missing: in first person the camera does the jumping and the arms keep their
 * bob. They fall back to the idle clip.
 */
export const FP_CLIPS: ClipMap = {
  idle: 'FP_Idle', walk: 'FP_Walk_Bob', run: 'FP_Run_Bob',
  jumpStart: null, jumpLoop: null, jumpLand: null,
  fall: null, swing: 'FP_Swing_Pickaxe',
};

const FADE_SECS = 0.15;
/** Authored ground speeds, used to keep the stride from skating (ASSET-SPECS 4.1). */
const WALK_CLIP_MPS = 1.4;
const RUN_CLIP_MPS = 4.5;
/** Above this the run clip is used; below it the walk clip. */
const RUN_THRESHOLD_MPS = 3.0;
const SWING_SECS = 33 / 60;

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
    const once = state === 'swing' || state === 'jumpStart' || state === 'jumpLand';
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
    if (state === 'walk') a.timeScale = Math.max(0.4, speedMps / WALK_CLIP_MPS);
    else if (state === 'run') a.timeScale = Math.max(0.5, speedMps / RUN_CLIP_MPS);
    else a.timeScale = 1;
  }

  update(dt: number): void { this.mixer.update(dt); }
}

/** State machine input: everything the graph needs, and nothing that is a view. */
export interface AnimInput {
  grounded: boolean;
  speedMps: number;
  /** Seconds remaining in a triggered swing, or 0. */
  swingLeft: number;
  /** Upward component of velocity, m/s. Positive is rising. */
  verticalMps: number;
}

/** The whole state machine. Pure, so the same call drives body and arms. */
export function resolveAnim(i: AnimInput): PlayerAnim {
  if (i.swingLeft > 0) return 'swing';
  if (!i.grounded) return i.verticalMps > 0.5 ? 'jumpLoop' : 'fall';
  if (i.speedMps > RUN_THRESHOLD_MPS) return 'run';
  if (i.speedMps > 0.15) return 'walk';
  return 'idle';
}

export const SWING_DURATION_SECS = SWING_SECS;
