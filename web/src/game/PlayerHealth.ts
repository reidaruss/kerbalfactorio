// THE PLAYER'S OWN HEALTH, THE DAMAGE THAT TAKES IT, AND WHAT HAPPENS AT ZERO.
//
// The damage arithmetic is DELIBERATELY NOT HERE and neither is the enemy: this
// takes a list of `HurtSource` rows and spends `dt` seconds against them, so the
// only thing it knows about an attacker is a rate, a reach and how far away it
// is. Those three fields are exactly `enemies.h`'s `damagePerSecond`, `reachM`
// and a distance, so the numbers come out of `/core`'s own catalogue and nothing
// here re-authors them. The list is FILLED as of GP-91 by `EnemySwarm.step`,
// which pushes one row per creature within reach and nothing else; this file
// still has no idea what an enemy is, and that is the point of the shape.
//
// DEATH AND RESPAWN WAS UNSPECIFIED AND THIS IS THE CHOICE, made out loud
// (GP-79). At zero the player DROPS NOTHING, blacks out for `RESPAWN_SECS` and
// stands up at the world spawn at full health. The cost of dying is TIME, plus
// whatever the attack did to the base while nobody was defending it, and that
// second half is real now precisely because building damage is persistent
// (GP-65). Three alternatives were considered and rejected:
//
//   Drop the inventory as a corpse. This is the survival-game default and it is
//   the wrong genre. It needs a corpse entity, a corpse marker on the map, a
//   corpse decay rule, corpse persistence and a corpse-vs-corpse case, all so a
//   loop that already punishes you can punish you twice. Factorio does not do
//   it, and Factorio is the reference this whole feedback loop is copied from.
//
//   Permadeath or a world reset. Unthinkable for a game whose entire subject is
//   a base you build over hours.
//
//   No death at all, just a knockdown. Tempting, and it is what the sandbox
//   answer below actually is, but in survival it removes the only stake the
//   combat loop has: if losing a fight costs nothing then the pollution you emit
//   costs nothing, and the causal chain the whole design rests on stops being a
//   pressure and becomes weather.
//
// THE SPAWN, NOT THE BASE, and that is a decision too. Respawning at the nearest
// owned building would be kinder and is what several modern factory games do,
// but it needs a "which building is home" rule, a way to see it, and a way for
// it to be destroyed, none of which exist tonight. The world spawn IS the base
// in this game (the clearing is grown there), so the kind answer and the simple
// answer currently agree, and the day they stop agreeing is the day to write the
// rule rather than now.

/** One thing currently trying to hurt the player. See the header. */
export interface HurtSource {
  /** For the HUD and the report: "Skitterer", "fall", "fire". */
  name: string;
  /** `enemies.h` EnemyTypeDef::damagePerSecond, unmodified. */
  dps: number;
  /** `enemies.h` EnemyTypeDef::reachM. Beyond this the source does nothing. */
  reachM: number;
  /** Metres from the source to the player, measured by whoever owns the source. */
  distM: number;
}

export const PLAYER_MAX_HP = 150;
/** Seconds of NOT being hurt before health starts coming back. */
export const REGEN_DELAY_SECS = 6;
/** Health per second once it does. Full from empty takes 6 + 18.75 seconds. */
export const REGEN_PER_SEC = 8;
/** How long the player is down. Long enough to feel like a loss, short enough
 *  that a player watching their base burn is not also bored. */
export const RESPAWN_SECS = 5;

export interface PlayerHealthSave {
  hp: number;
  deaths: number;
}

export class PlayerHealth {
  readonly maxHp = PLAYER_MAX_HP;
  hp = PLAYER_MAX_HP;
  /** True from the tick health hit zero until `revive` is called. */
  dead = false;
  /** Seconds left on the blackout. Only meaningful while `dead`. */
  respawnIn = 0;
  deaths = 0;
  /** Ledger, for the HUD and for a probe. */
  totalTaken = 0;
  hurtEvents = 0;
  lastCause = '';
  /** Seconds since the last damage. Starts high so a fresh world regenerates
   *  immediately rather than spending six seconds pretending it was just hit. */
  private sinceHurt = REGEN_DELAY_SECS;

  /**
   * `mortal` is asked EVERY TICK rather than captured, because it comes from
   * `ModeRules` and a mode is fixed for the life of a world (GP-29): reading it
   * live costs nothing and means a caller cannot construct this with one answer
   * and run it with another.
   */
  constructor(private readonly mortal: () => boolean = () => true) {}

  get fraction(): number {
    return this.maxHp > 0 ? Math.max(0, Math.min(1, this.hp / this.maxHp)) : 0;
  }
  get invulnerable(): boolean { return !this.mortal(); }

  /**
   * ONE tick. Spends `dt` against every source in reach, then regenerates.
   *
   * Sources OUT OF REACH ARE SKIPPED RATHER THAN SCALED. A `reachM` is an
   * engagement range and not a falloff curve: `enemies.h` says a Lancer's 12 m
   * "outranges a short-reach turret", which is a statement about a threshold. A
   * smooth falloff would make every enemy on the planet deal a little damage,
   * which is both wrong and unboundedly expensive.
   */
  step(dt: number, sources: readonly HurtSource[]): void {
    if (this.dead) {
      this.respawnIn = Math.max(0, this.respawnIn - dt);
      return;
    }
    let taken = 0;
    let worst = '';
    let worstDps = 0;
    for (const s of sources) {
      if (!(s.dps > 0) || !(s.distM <= s.reachM)) continue;
      taken += s.dps * dt;
      if (s.dps > worstDps) { worstDps = s.dps; worst = s.name; }
    }
    if (taken > 0) this.hurt(taken, worst);
    else {
      this.sinceHurt += dt;
      if (this.sinceHurt >= REGEN_DELAY_SECS && this.hp < this.maxHp) {
        this.hp = Math.min(this.maxHp, this.hp + REGEN_PER_SEC * dt);
      }
    }
  }

  /**
   * Take damage from anything. Returns true on the tick this kills.
   *
   * INVULNERABILITY IS APPLIED HERE AND NOWHERE ELSE, so a caller that finds a
   * new way to hurt the player next month cannot forget it. It still counts the
   * event, deliberately: DW-31's own lesson from `Structures.affordInCore` is
   * that a mode which lifts a rule must PUBLISH the answer it is overriding, or
   * "nothing hurt me" and "the damage path is broken" are the same picture.
   */
  hurt(amount: number, cause = ''): boolean {
    if (!(amount > 0) || this.dead) return false;
    this.hurtEvents++;
    this.lastCause = cause;
    this.sinceHurt = 0;
    if (this.invulnerable) return false;
    this.totalTaken += amount;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return false;
    this.dead = true;
    this.respawnIn = RESPAWN_SECS;
    this.deaths++;
    return true;
  }

  /** True the instant the blackout is over and the caller should move the body
   *  and call `revive`. Asked rather than pushed, so nothing has to hold a
   *  callback across a save. */
  get readyToRespawn(): boolean { return this.dead && this.respawnIn <= 0; }

  /** Stand up: full health, no grudge, and the regen clock reset so a player
   *  who walks straight back into the same fight is not instantly regenerating
   *  through it. */
  revive(): void {
    this.dead = false;
    this.respawnIn = 0;
    this.hp = this.maxHp;
    this.sinceHurt = 0;
  }

  serialize(): PlayerHealthSave {
    // A DEAD player is saved ALIVE at one point of health, not dead. The
    // blackout is a five second animation and a slot cannot describe a player
    // halfway through one: restoring it would either strand somebody on a black
    // screen that no longer has a respawn scheduled, or respawn them the instant
    // they load, which is a death they did not get to see. One point of health
    // is the honest world state at the moment they were killed, and it is
    // recoverable, which is the direction a rounding error should fall.
    return { hp: this.dead ? 1 : this.hp, deaths: this.deaths };
  }

  restore(s: PlayerHealthSave | undefined): boolean {
    if (s === undefined) return false;
    this.hp = Math.max(1, Math.min(this.maxHp, Number(s.hp) || this.maxHp));
    this.deaths = Math.max(0, Number(s.deaths) || 0);
    this.dead = false;
    this.respawnIn = 0;
    this.sinceHurt = 0;
    return true;
  }

  report(): unknown {
    return {
      hp: +this.hp.toFixed(2), maxHp: this.maxHp,
      fraction: +this.fraction.toFixed(4),
      dead: this.dead, respawnIn: +this.respawnIn.toFixed(2),
      deaths: this.deaths,
      // COUNTED EVEN WHEN NOTHING LANDED, see `hurt`. `hurtEvents` rising while
      // `totalTaken` stays at zero is what an invulnerable sandbox player looks
      // like, and it is a different picture from a damage path that is not
      // wired, which is both at zero.
      hurtEvents: this.hurtEvents, totalTaken: +this.totalTaken.toFixed(2),
      invulnerable: this.invulnerable, lastCause: this.lastCause,
      regen: { delaySecs: REGEN_DELAY_SECS, perSec: REGEN_PER_SEC,
        secsSinceHurt: +this.sinceHurt.toFixed(2) },
      respawnSecs: RESPAWN_SECS,
    };
  }
}
