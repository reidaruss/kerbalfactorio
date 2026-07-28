// PULLING THE TRIGGER: the one place the rule, the pictures and the sound meet.
//
// `Weapon` is the rule and knows nothing about a renderer. `WeaponFx` is the
// pictures and knows nothing about a rule. This is the composition, and it is
// its own file rather than four more lines in `Gameplay` because that file is
// 60 lines over its cap with other lanes inside it, which is the same call
// `PersistLedger.ts` was.
//
// THE MUZZLE IS DEFINED HERE, ONCE. It is the eye pushed forward and down and
// to the right, which is where a shoulder-fired weapon's barrel end sits
// relative to the camera in first person, and it is the ONLY definition: the
// tracer starts there, the flash sits there, and `Weapon.fire` is handed the
// EYE rather than the muzzle so that what the crosshair is on and what the
// shot hits stay one computation (the whole hitscan argument in Weapon.ts).
// Drawing from the muzzle while tracing from the eye is the standard way a
// tracer ends up visibly missing what it kills; here the tracer is drawn to
// wherever the RAY ended, so the picture cannot disagree with the result.

import { Weapon, type GroundRadius, type Hittable, type ShotResult }
  from './Weapon.js';
import { WeaponFx } from './WeaponFx.js';

/** The four outputs a shot has to reach, as ports, so this file imports no
 *  renderer, no audio graph and no HUD. */
export interface GunHost {
  sfx: { play(name: string, seq?: number): number };
  fx: {
    debris: { burst(b: { pos: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
      back: { x: number; y: number; z: number };
      colour: number; count: number }): void };
    kick: { fire(n: number): void };
  };
}

/** Muzzle offset from the eye, in metres, along the aim/right/up triad. */
const MUZZLE_FWD_M = 0.55;
const MUZZLE_RIGHT_M = 0.16;
const MUZZLE_DOWN_M = 0.14;

/** Debris colours. A round into soil throws dirt; a round into a creature
 *  throws something else, and the two reading differently is what lets a player
 *  tell a hit from a miss at the edge of vision. */
const GROUND_CHIP = 0x9a8b6e;
const FLESH_CHIP = 0xb8434a;

export class Gunnery {
  readonly weapon = new Weapon();
  readonly fx = new WeaponFx();
  /** Ledger, separate from `Weapon`'s: this counts what was DRAWN and heard,
   *  and the weapon counts what was fired. Keeping them apart is what makes
   *  "the gun fired and nothing appeared" a findable state rather than an
   *  argument about which counter is wrong. */
  groundHits = 0;
  targetHits = 0;
  private seq = 0;

  step(dt: number): void { this.weapon.step(dt); }

  /**
   * Fire, if the cooldown allows, and produce everything a shot produces.
   *
   * Returns the raw result so the caller can apply DAMAGE to whatever `ref`
   * names. Damage is deliberately NOT applied here: this file has no idea what
   * an enemy is, and giving it one would put the combat resolution inside the
   * effects layer, where the next person to change a colour would be editing
   * the thing that kills.
   */
  fire(eye: { x: number; y: number; z: number },
       aim: { x: number; y: number; z: number },
       up: { x: number; y: number; z: number },
       targets: readonly Hittable[],
       ground: GroundRadius,
       host: GunHost): ShotResult {
    const r = this.weapon.fire(eye, aim, targets, ground);
    if (!r.fired) return r;

    // The muzzle, from the aim and the local up. `right` is aim x up, which is
    // stable everywhere except looking straight along the radial, and there the
    // offset simply collapses towards zero rather than flipping.
    const rx = aim.y * up.z - aim.z * up.y;
    const ry = aim.z * up.x - aim.x * up.z;
    const rz = aim.x * up.y - aim.y * up.x;
    const rl = Math.hypot(rx, ry, rz) || 1;
    const muzzle = {
      x: eye.x + aim.x * MUZZLE_FWD_M + (rx / rl) * MUZZLE_RIGHT_M - up.x * MUZZLE_DOWN_M,
      y: eye.y + aim.y * MUZZLE_FWD_M + (ry / rl) * MUZZLE_RIGHT_M - up.y * MUZZLE_DOWN_M,
      z: eye.z + aim.z * MUZZLE_FWD_M + (rz / rl) * MUZZLE_RIGHT_M - up.z * MUZZLE_DOWN_M,
    };

    const seq = this.seq++;
    // 1 + 2. THE FLASH AND THE TRACER, both from the muzzle to where the ray
    //        actually ended, so the picture cannot disagree with the result.
    this.fx.shot(muzzle, r.end);
    // 3. THE REPORT. Its own voice rather than a reused `crack`: a pick on stone
    //    and a gun going off are different events and a player who cannot tell
    //    them apart by ear is a player who cannot tell whether they fired.
    host.sfx.play('shot', seq);
    // 4. RECOIL. The same kick a swing uses, because the feel is already tuned
    //    and a second recoil curve would be a second authority on camera shake.
    host.fx.kick.fire(seq);

    // 5. THE ARRIVAL, which is a different event from the departure and needs
    //    its own sound or a hit and a miss are indistinguishable with the eyes
    //    shut. `back` points at the shooter so chips fly at the camera.
    const back = { x: -aim.x, y: -aim.y, z: -aim.z };
    if (r.hit !== null) {
      this.targetHits++;
      host.sfx.play('impact', seq);
      host.fx.debris.burst({ pos: r.hit.point, up, back, colour: FLESH_CHIP, count: 7 });
    } else if (r.ground) {
      this.groundHits++;
      host.sfx.play('impact', seq);
      // The ground's own outward normal at the impact, not the player's up: a
      // round into a canyon wall should throw dirt off the WALL.
      const n = Math.hypot(r.end.x, r.end.y, r.end.z) || 1;
      const gu = { x: r.end.x / n, y: r.end.y / n, z: r.end.z / n };
      host.fx.debris.burst({ pos: r.end, up: gu, back, colour: GROUND_CHIP, count: 5 });
    }
    return r;
  }

  report(): unknown {
    return {
      ...(this.weapon.report() as object),
      fx: this.fx.stats(),
      groundHits: this.groundHits, targetHits: this.targetHits,
      // The four tells a shot has to produce, in one row, because the failure
      // this whole file exists to prevent is a gun that is CORRECT and silent.
      // A probe asserts all four moved on the same shot.
      tells: {
        flash: this.fx.stats() as unknown, sound: 'shot', tracer: 'weaponFx',
        impact: 'impact + debris',
      },
    };
  }
}

/**
 * GP-86. The whole trigger, as a free function over a narrow host.
 *
 * It lives here rather than as a `Gameplay` method for the reason
 * `PersistLedger.ts` lives in its own file: that composition is 95 lines over
 * its cap and Admin's standing instruction is to extract rather than to grow
 * it. The host shape is written out rather than imported so this file still
 * depends on nothing but its own two halves.
 *
 * THE EYE GOES TO THE WEAPON AND THE MUZZLE ONLY TO THE PICTURES, so what the
 * crosshair is on and what the shot hits are one computation. The ground oracle
 * is the caller's, because GP-28 made `groundRadius` the one call site that was
 * always right about the LIVE surface, and a round must not pass through a
 * hillside the player has not dug.
 */
export interface TriggerHost extends GunHost {
  gun: Gunnery;
  shootables: readonly Hittable[];
  onShotHit(ref: unknown, damage: number): void;
  structures: { groundRadius: GroundRadius };
  interact: { target: unknown };
  walker: {
    view: { aim: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number }; pitch: number };
    look(dYaw: number, dPitch: number): void;
  };
  fx: GunHost['fx'] & { kick: { step(pitch: number): [number, number] } };
}

export function pullTrigger(g: TriggerHost, held: boolean,
                            ray: { origin: { x: number; y: number; z: number } }): void {
  if (!held) return;
  const r = g.gun.fire(ray.origin, g.walker.view.aim, g.walker.view.up,
    g.shootables, (x, y, z) => g.structures.groundRadius(x, y, z), g);
  if (r.hit !== null) g.onShotHit(r.hit.ref, r.hit.damage);
  // The kick is APPLIED here and not just fired, through the same additive
  // `Controller.look` the mouse uses, so a driven tape recoils exactly as often
  // as a human does and the offsets still sum to zero.
  const [ky, kp] = g.fx.kick.step(g.walker.view.pitch);
  if (kp !== 0 || ky !== 0) g.walker.look(ky, kp);
}
