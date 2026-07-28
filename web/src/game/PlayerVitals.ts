// THE DRIVER FOR PLAYER HEALTH: the clock, the banner, and standing back up.
//
// Separate from `PlayerHealth` because that file is a rule and this is a
// composition. The rule takes a `dt` and a list of things hurting you and has no
// idea a HUD or a body exists; this is the only thing that knows a death should
// put a red banner on screen and move a walker back to the landing site. Keeping
// them apart is what lets the rule be reasoned about, and it is the same split
// `Health.ts` and `HealthCensus.ts` already use.
//
// It also lives outside `Gameplay` because that file is over its line cap and
// has three lanes in it tonight.

import { PlayerHealth, type HurtSource, type PlayerHealthSave } from './PlayerHealth.js';

/** The two things a death needs to reach. Structural, so nothing here imports
 *  `Controller` or `GameHud`, neither of which this lane owns. */
export interface VitalsHost {
  player: {
    state(): { latDeg: number; lonDeg: number };
    teleport(latDeg: number, lonDeg: number, altM: number): void;
  };
  hud: {
    flash(text: string, secs?: number): void;
    banner(text: string, colour: string): void;
  };
}

export class PlayerVitals {
  readonly health: PlayerHealth;
  /** Where the player stands up. See the decision in `PlayerHealth`'s header. */
  homeLatDeg = NaN;
  homeLonDeg = NaN;
  respawns = 0;
  /** Whether the current death has already put a banner on screen. */
  private announced = false;

  constructor(mortal: () => boolean) {
    this.health = new PlayerHealth(mortal);
  }

  /**
   * ONE fixed tick.
   *
   * THE HOME POINT IS CAPTURED ON THE FIRST TICK and never again. That is right
   * for every world the client can currently produce, because nothing restores a
   * player position: a save slot has no field for one, so a load always puts the
   * player at the generated spawn, which is where the clearing is grown. The day
   * the slot learns to carry an avatar position this becomes wrong and has to
   * become saved state, and this comment is here so that is noticed rather than
   * discovered.
   */
  step(dt: number, sources: readonly HurtSource[], host: VitalsHost): void {
    if (!Number.isFinite(this.homeLatDeg)) {
      const s = host.player.state();
      if (Number.isFinite(s.latDeg) && Number.isFinite(s.lonDeg)) {
        this.homeLatDeg = s.latDeg;
        this.homeLonDeg = s.lonDeg;
      }
    }
    this.health.step(dt, sources);
    // THE ANNOUNCEMENT IS LATCHED OFF THE STATE, not off a transition this call
    // happened to witness, and that difference is a real bug this caught. The
    // obvious version reads `dead` before `step` and compares: it works when the
    // killing blow lands inside `step` and SILENTLY DOES NOTHING when anything
    // else kills the player, because by the time this runs they were already
    // dead. A probe's killing blow, and later a scripted event or a fall, all go
    // through `hurt` directly. A latch cannot care who did it.
    if (this.health.dead && !this.announced) {
      this.announced = true;
      // The banner rather than the toast, because this is not a message channel
      // (GameHud's own distinction): it is the single most consequential thing
      // that can happen to a player and it has to stop them.
      host.hud.banner('You were killed', '#ff6b5a');
    }
    if (this.health.readyToRespawn) this.respawn(host);
  }

  /** Stand the body up at the landing site. Public because a death is worth
   *  being able to drive directly from a probe, and because doing it through
   *  this call rather than through `revive` is what keeps the teleport and the
   *  heal from ever getting out of step. */
  respawn(host: VitalsHost): void {
    if (Number.isFinite(this.homeLatDeg)) {
      host.player.teleport(this.homeLatDeg, this.homeLonDeg, 0);
    }
    this.health.revive();
    this.announced = false;
    this.respawns++;
    host.hud.flash('you woke up at the landing site, your pack is intact', 3);
  }

  serialize(): PlayerHealthSave { return this.health.serialize(); }
  restore(s: PlayerHealthSave | undefined): boolean { return this.health.restore(s); }

  report(): unknown {
    return {
      ...(this.health.report() as object),
      respawns: this.respawns,
      home: [Number.isFinite(this.homeLatDeg) ? +this.homeLatDeg.toFixed(5) : null,
        Number.isFinite(this.homeLonDeg) ? +this.homeLonDeg.toFixed(5) : null],
    };
  }
}
