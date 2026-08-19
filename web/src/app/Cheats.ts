// GP-102 to GP-107. THE TESTING CONTROLS, and every rule about them.
//
// Reid asked for these in a stated order and they are built in it: start fresh,
// infinite fuel, teleport to orbit, then peaceful mode and kill all enemies.
// They exist because the loop they shortcut is real work: building a rocket,
// rolling it out, flying it and running out of fuel is four minutes before any
// orbital question can be asked once, and the answer to "does the map draw a
// periapsis correctly" should not cost four minutes.
//
// THIS FILE LIVES IN app/ AND NOT IN game/ because the cheats span gameplay AND
// flight AND the loop, and nothing in game/ can see a flight session: Systems.ts
// states the rule ("flight is not part of Gameplay, it owns its own eye") and
// `Gameplay` has no reference to it at all. So the composition root is where
// they can all be reached, and it is also where the pause menu is built.
//
// WHAT A CHEAT DOES IN SURVIVAL is decided in game/Assisted.ts, in one place,
// and every verb below funnels through `mark()`. It does not REFUSE anything: a
// mode that lets you do it and then lies about having done it would be worse
// than one that refuses. It remembers.
//
// EVERY VERB RETURNS A RECEIPT rather than a boolean, and that is deliberate.
// "Kill all enemies" returning true tells the player nothing; "12 creatures,
// 1 nest" tells them whether the button did what they meant, and it is the same
// number a probe asserts, so the screen and the acceptance read one source.

import { clearSlot, readSlot } from '../game/SaveGame.js';
import { assistedReport, clearAssisted, isAssisted, noteCheat } from '../game/Assisted.js';
import { livePropellantKg, refillTanks, warpToOrbit } from '../sim/FlightCheats.js';
import { pressVisit, stationRows, visitRows, type VisitPorts } from './VisitSites.js';
import { pressWorld, worldRows, type WorldPorts } from './VisitWorlds.js';
import { pressRuin, ruinRow, type RuinPorts } from './VisitRuin.js';
import { optionPages, pressOption } from './OptionsPages.js';
import { AudioBus } from '../audio/AudioBus.js';
import type { CheatRow, PauseView } from '../ui/PauseMenu.js';
import type { Gameplay } from '../game/Gameplay.js';
import type { FlightMode } from './FlightMode.js';
import type { PlanetBody } from '../world/PlanetBody.js';
import type { Config } from './Config.js';
import type { SaveSlots } from '../game/SaveSlots.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * 100 km. The atmosphere's ceiling is 60 km (`atmosphere.h`: density is exactly
 * zero at and above `topM`), and `FlightTelemetry.inSpace` is that comparison,
 * so anything below it is not an orbit however circular it looks. 100 gives
 * 40 km of margin, is a round number on the HUD, and is low enough that a
 * player who then burns retrograde comes down somewhere they can see.
 */
const ORBIT_ALT_M = 100000;

/** Refill when the tanks fall below this share of what they last held full. The
 *  number is a compromise: `refillTanks` rebuilds the craft, so topping up every
 *  tick would be a `_of_fl_create` at 60 Hz, and a threshold much lower than
 *  this makes the gauge visibly swing. */
const FUEL_FLOOR = 0.9;

/** GP-231. `VisitPorts` (the two teleport doors, argued in app/VisitSites.ts)
 *  is EXTENDED rather than held as a field, so `press` hands `this.d` over. */
export interface CheatDeps extends VisitPorts, WorldPorts, RuinPorts {
  gameplay: () => Gameplay | null;
  flight: () => FlightMode | null;
  body: PlanetBody;
  /** GP-1060. The walker's own feet, or null with no player, so "teleport to
   *  ruin" can pick the NEAREST one once there is more than one. */
  feet: () => Vec3d | null;
  /** GP-132: the PARSED config, read only. The video screen shows what the
   *  renderer was handed, not the defaults. */
  cfg: Config;
  slots: SaveSlots;   // GP-137: named slots, load list, delete.
  /**
   * How a wiped world comes back. A PORT rather than a bare `location.reload()`
   * so the destruction is observable before the page goes: a probe drives the
   * real button, reads the receipt, and the runner reloads on its own terms.
   */
  restart: () => void;
  /** Probe-only: stop the port navigating, so a driven run can read the
   *  receipt. See the `norestart` branch in `press`. */
  suppressRestart: () => void;
}

export interface CheatReceipt {
  id: string;
  done: boolean;
  /** What happened, or why nothing did. Never empty. */
  message: string;
  detail?: Record<string, unknown>;
}

export class Cheats {
  /** GP-103: Start Fresh is ARMED by one press and FIRED by a second. */
  private armed = false;
  private page = '';   // GP-131. '' is the root page.
  infiniteFuel = false;
  /** What the tanks held the last time they were filled, so the top-up has a
   *  target that survives a staging (a jettisoned tank lowers it, correctly). */
  private fullKg = 0;
  /** Every receipt, newest last. The screen shows the last one; a probe reads
   *  the list, so a run that pressed four buttons can assert four outcomes. */
  readonly log: CheatReceipt[] = [];

  constructor(private readonly d: CheatDeps) {}

  get lastMessage(): string { return this.log[this.log.length - 1]?.message ?? ''; }

  /**
   * THE ONE ENTRY POINT the menu and `__of.cheat` both go through: one place a
   * press can be recorded, one place it can be refused. The `:confirm` and
   * `:cancel` suffixes are part of the id because they belong to the row that
   * raised them.
   */
  press(id: string): CheatReceipt {
    // GP-131. NAVIGATION, not a cheat, routed here for the same reason.
    if (id.startsWith('page:')) {
      this.page = id.slice(5);
      return this.say(id, true, this.page === '' ? 'back' : `showing ${this.page}`);
    }
    // GP-134. The options pages' own verbs. NOT cheats, and routed here anyway,
    // because one place a press is handled is one place it can be wrong.
    const opt = pressOption(this.d.gameplay()?.sfx.bus ?? null, this.d.slots,
      this.d.gameplay(), id);
    if (opt !== '') return this.say(id, true, opt);
    // GP-167 / GP-168. Visit a surveyed site, or GP-231's orbital station. A
    // REAL cheat either way: it marks the save.
    const vis = pressVisit(id, this.d.flight(), this.d, this.d.body.bodyId);
    if (vis !== null) {
      if (vis.done) this.mark('visit');
      return this.say(id, vis.done, vis.message, vis.detail);
    }
    // GP-500. Go to another body. A REAL cheat: it marks the save, and it is
    // the only control here whose door is a page reload (VisitWorlds.ts).
    const wld = pressWorld(id, this.d.flight(), this.d.body.bodyId,
      window.location.href, this.d);
    if (wld !== null) {
      if (wld.done) this.mark('world');
      return this.say(id, wld.done, wld.message, wld.detail);
    }
    if (id === 'startfresh') return this.arm();
    if (id === 'startfresh:cancel') { this.armed = false; return this.say(id, true, 'cancelled'); }
    if (id === 'startfresh:confirm') {
      // THE REFUSAL IS DECIDED HERE, SYNCHRONOUSLY. The first version fired the
      // async wipe and returned a cheerful "wiping the world", so an UNARMED
      // call got `done: true` while the wipe refused itself out of sight;
      // `probes/cheats.js` caught it on its first run. On this verb, a receipt
      // that reports the opposite of what happened is the difference between a
      // guard and the appearance of one.
      if (!this.armed) {
        return this.say(id, false, 'refused: Start Fresh must be confirmed first');
      }
      void this.startFresh();
      // GP-155. `pending` MARKS THIS AS THE ACKNOWLEDGEMENT AND NOT THE ANSWER.
      // Two receipts carry this id: this one, synchronously, saying the wipe has
      // STARTED, and `startFresh`'s own, after two IndexedDB round trips, saying
      // whether the slot is really gone. They were told apart only by whether
      // `detail` happened to be present, so a reader arriving between them got
      // the acknowledgement and read `detail.slotRemains` off `undefined`. A
      // report that says nothing where it means "not yet" cannot be told from
      // one that means "no", on the one verb in the game that destroys a save.
      return this.say(id, true, 'wiping the world', { pending: true });
    }
    if (id === 'fuel') return this.toggleFuel();
    if (id === 'orbit') return this.toOrbit();
    if (id === 'ruin') return this.toRuin();
    if (id === 'peaceful') return this.togglePeaceful();
    if (id === 'killall') return this.killAll();
    // GP-102's negative control, and the only entry here that is not a cheat.
    // It clears the IN-MEMORY assisted record without touching the slot, which
    // is the only way a probe can prove the flag came back off DISK rather than
    // out of module state that was never cleared. `forgetTunnels` and
    // `repopulate` exist in DebugGameplay for exactly this reason.
    if (id === 'forgetassist') { clearAssisted(); return this.say(id, true, 'assisted record forgotten in memory'); }
    // The second and last non-cheat, and it suppresses the RESTART ONLY. A
    // reload tears down the very context a driven probe reports from, so phase
    // 1 of `probes/startfresh.js` could not both fire the real button and come
    // back to say what happened. The wipe still runs, still goes through the
    // same `startFresh` and still verifies itself against the store;
    // `reload.mjs` performs the identical reload from the outside. What the
    // probe skips is the `location.reload()` call and nothing else.
    // GP-137: it suppresses THE PORT, not a copy of the answer. Start Fresh and
    // Load both restart, and a flag only Start Fresh consulted let a driven Load
    // navigate out from under the probe reporting on it.
    if (id === 'norestart') { this.d.suppressRestart(); return this.say(id, true, 'restart suppressed'); }
    return this.say(id, false, `no such control: ${id}`);
  }

  // --- 1. START FRESH --------------------------------------------------------

  private arm(): CheatReceipt {
    this.armed = true;
    return this.say('startfresh', true, `armed: ${this.confirmSentence()}`);
  }

  /**
   * GP-103. The sentence the confirm shows. It NAMES THE SLOT KEY, because the
   * client keeps two worlds under two keys (DW-31) and "start fresh" is
   * ambiguous the moment there is more than one.
   */
  confirmSentence(): string {
    const g = this.d.gameplay();
    const mode = g?.mode.label ?? 'Survival';
    return `This DESTROYS the ${mode} save slot "${this.slotKey()}". Everything `
      + 'you have built, mined, researched and dug is gone and cannot be '
      + 'recovered. Rocket designs are kept: they are not world state (GP-34).';
  }

  slotKey(): string {
    return this.d.gameplay()?.mode.sandbox === true ? 'auto-sandbox' : 'auto';
  }

  get isArmed(): boolean { return this.armed; }

  /**
   * GP-103. Destroy the running mode's slot and boot a fresh world.
   *
   * THE OTHER MODE'S WORLD IS NOT TOUCHED, and that is the whole reason the keys
   * are separate (DW-31): a sandbox Start Fresh that also took the survival
   * world would be the contamination two keys exist to make impossible, arrived
   * at through the front door instead of through an autosave.
   *
   * A RELOAD IS THE FRESH WORLD, not a hundred lines of teardown. The clearing,
   * the ore patches, the biomes and the terrain all regenerate from the seed
   * (PS-7: a slot is a DIFF), so a boot with no slot to apply IS a new game.
   * Emptying the live world in place would mean clearing the factory, the
   * machines, the base, the pads, the health book, the pack, the tunnels and the
   * progression spine by hand, and the failure mode of getting one of those
   * wrong is a half-wiped world, which is worse than either outcome.
   *
   * The wipe is VERIFIED by reading the store back rather than by trusting the
   * delete: `clearSlot` swallows its own errors by design (a save is not a
   * rule), so a call that silently did nothing would otherwise report success
   * and reload into the world it claimed to destroy.
   */
  async startFresh(): Promise<CheatReceipt> {
    if (!this.armed) {
      return this.say('startfresh:confirm', false,
        'refused: Start Fresh must be confirmed first');
    }
    this.armed = false;
    const g = this.d.gameplay();
    const mode = g?.mode.mode ?? 'survival';
    const key = this.slotKey();
    await clearSlot(mode);
    clearAssisted();
    const left = await readSlot(mode);
    const gone = left.slot === null;
    const r = this.say('startfresh:confirm', gone,
      gone ? `destroyed save slot "${key}", restarting`
        : `slot "${key}" is STILL THERE after the wipe`,
      { slotKey: key, mode, slotRemains: !gone });
    if (gone) this.d.restart();
    return r;
  }

  // --- 2. INFINITE FUEL ------------------------------------------------------

  private toggleFuel(): CheatReceipt {
    const f = this.d.flight();
    this.infiniteFuel = !this.infiniteFuel;
    if (!this.infiniteFuel) return this.say('fuel', true, 'infinite fuel off');
    this.mark('fuel');
    this.fullKg = 0;
    const kg = f === null ? -1 : this.topUp(f);
    return this.say('fuel', true,
      kg >= 0 ? `infinite fuel on, ${kg.toFixed(0)} kg back in the tanks`
        : 'infinite fuel on, it will fill the tanks as soon as a craft exists',
      { restoredKg: kg, fullKg: this.fullKg });
  }

  /**
   * Called every fixed tick by the composition root. It is a tick hook and not
   * a one-shot because "infinite" means the tanks are still full in nine
   * minutes, and a single refill is just a refill.
   */
  step(): void {
    if (!this.infiniteFuel) return;
    const f = this.d.flight();
    if (f === null || !f.session.live) return;
    if (this.fullKg > 0 && livePropellantKg(f.session) >= this.fullKg * FUEL_FLOOR) return;
    this.topUp(f);
  }

  /** The tanks RIGHT NOW, or 0 with no craft. See FlightCheats.livePropellantKg
   *  for why the session's own `propellantKg()` is the wrong number here. */
  private liveFuelKg(): number {
    const f = this.d.flight();
    return f === null || !f.session.live ? 0 : livePropellantKg(f.session);
  }

  private topUp(f: FlightMode): number {
    const added = refillTanks(f.session, this.d.body.handle);
    if (added < 0) return -1;
    this.fullKg = livePropellantKg(f.session);
    return added;
  }

  // --- 3. TELEPORT TO A STABLE ORBIT ----------------------------------------

  /**
   * GP-105. The arithmetic is HERE and the state write is in FlightCheats,
   * because the client already has exactly one authority on the planet
   * (`PlanetBody`, off `_of_body_radius` and `_of_body_mu`) and a circular orbit
   * computed off a second copy of mu would be an ellipse around a planet the
   * rocket does not then fly in.
   */
  private toOrbit(): CheatReceipt {
    const f = this.d.flight();
    if (f === null || !f.session.live) {
      return this.say('orbit', false,
        'refused: there is no craft. Build one (C), then roll it out (G).');
    }
    this.mark('orbit');
    const r = this.d.body.radiusM + ORBIT_ALT_M;
    // v = sqrt(g(r) * r), off /core's OWN `of_gravity_accel`, which is mu/r^2.
    // It is asked this way rather than as sqrt(mu/r) because `of_gravity_accel`
    // is the single gravity authority the whole client uses (DW-18/PH-18) and
    // it has a fallback for a body whose mu was never set; reading `muM3S2`
    // directly would silently produce a zero speed on exactly that body.
    const speed = Math.sqrt(this.d.body.gravityAccel(r) * r);
    if (!warpToOrbit(f.session, r, speed)) {
      return this.say('orbit', false, 'refused: the flight would not take it');
    }
    // The camera's interpolator is the observer's, and without this the eye
    // lerps across 600 km in one frame (VesselObserver.syncToVessel's own
    // comment is about exactly this class of bug).
    f.observer.syncToVessel();
    const o = f.session.orbit;
    return this.say('orbit', true,
      `in orbit: ${(o.apoapsisAltM / 1000).toFixed(1)} x `
      + `${(o.periapsisAltM / 1000).toFixed(1)} km`,
      { radiusM: r, speedMS: speed, altM: ORBIT_ALT_M,
        apoapsisAltM: o.apoapsisAltM, periapsisAltM: o.periapsisAltM,
        eccentricity: o.eccentricity, bound: o.bound });
  }

  // --- 3b. TELEPORT TO THE NEAREST RUIN -------------------------------------

  /**
   * GP-1060. The arithmetic and the guard live in `app/VisitRuin.ts`, the same
   * split `toOrbit` above uses (state write here through the shared ports,
   * destination resolution in its own file); it is not folded into
   * `VisitSites.ts`'s `pressVisit` because a `visit:`-prefixed id there would
   * be swallowed by that file's own "no such site" refusal before this ever
   * ran (see VisitRuin.ts's header on `RUIN_ROW_ID`).
   */
  private toRuin(): CheatReceipt {
    const g = this.d.gameplay();
    const out = pressRuin(this.d.flight(), g?.ruins ?? null, this.d.feet(), this.d);
    if (out.done) this.mark('ruin');
    return this.say('ruin', out.done, out.message, out.detail);
  }

  // --- 4. PEACEFUL MODE, AND KILL ALL ---------------------------------------

  private togglePeaceful(): CheatReceipt {
    const g = this.d.gameplay();
    if (g === null) return this.say('peaceful', false, 'no world');
    const on = !g.enemies.peaceful;
    if (on) this.mark('peaceful');
    const killed = g.enemies.setPeaceful(on);
    return this.say('peaceful', true,
      on ? `peaceful: nothing more will be dispatched, ${killed} cleared`
        : 'peaceful off: the nests go back to work',
      { peaceful: on, cleared: killed });
  }

  private killAll(): CheatReceipt {
    const g = this.d.gameplay();
    if (g === null) return this.say('killall', false, 'no world');
    this.mark('killall');
    const r = g.enemies.killAll();
    return this.say('killall', true,
      `killed ${r.creatures} creature${r.creatures === 1 ? '' : 's'} and `
      + `${r.nests} nest${r.nests === 1 ? '' : 's'}`, { ...r });
  }

  // --- the view, and the plumbing -------------------------------------------

  /** What the menu draws. Every blocked reason is a whole sentence that names
   *  the thing to go and do, because a greyed control with no reason is
   *  indistinguishable from a broken one (GP-51's rule, applied to a menu). */
  view(): PauseView {
    const g = this.d.gameplay();
    const f = this.d.flight();
    const noCraft = f === null || !f.session.live
      ? 'no craft: build one with C, then roll it out with G' : '';
    const noEnemies = g === null ? 'no world'
      : !g.enemies.enabled ? g.enemies.disabledWhy : '';
    const cheats: CheatRow[] = [
      { id: 'startfresh', label: 'Start fresh', kind: 'button', destructive: true,
        note: `wipe save slot "${this.slotKey()}" and begin again` },
      { id: 'fuel', label: 'Infinite fuel', kind: 'toggle', on: this.infiniteFuel,
        note: 'keeps every tank topped up while you fly' },
      { id: 'orbit', label: 'Teleport to orbit', kind: 'button', blocked: noCraft,
        note: `the craft you are flying, into a ${(ORBIT_ALT_M / 1000).toFixed(0)} km circular orbit` },
      // GP-552. A world with no enemy loop IS peaceful, so the chip says so. It
      // read OFF beside a refusing button, i.e. the opposite of the world.
      { id: 'peaceful', label: 'Peaceful mode', kind: 'toggle',
        on: (g?.enemies.peaceful ?? false) || noEnemies !== '', blocked: noEnemies,
        note: 'no more waves are dispatched, and the live ones die' },
      { id: 'killall', label: 'Kill all enemies', kind: 'button', blocked: noEnemies,
        note: 'every creature and every nest, through the same damage a shot does' },
      // GP-1060. `ruinRow` derives its own `blocked` off the live catalogue
      // (no ruin placed, or aboard a vessel), the same live-derivation rule
      // every other row here follows.
      ruinRow(f, g?.ruins ?? null),
    ];
    return {
      page: this.page,
      // DERIVED ON EVERY VIEW and never stored, so no screen can go stale
      // against a rebind, a flag or a volume. See app/OptionsPages.ts.
      ...optionPages(this.d.cfg, this.d.gameplay()?.sfx.bus ?? null,
        () => new AudioBus(), this.d.slots, g?.mode.mode ?? 'survival', this.page),
      mode: g?.mode.label ?? 'Survival',
      slotKey: this.slotKey(),
      assisted: isAssisted()
        ? 'this world has had testing controls used on it' : '',
      cheats,
      // GP-167. Derived per view like everything else: the blocked reason
      // follows `aboard` the frame it changes.
      visits: visitRows(f, this.d.body.bodyId),
      // GP-233. Its own group, argued in VisitSites.ts.
      station: stationRows(f, this.d.body),
      // GP-500. `body.bodyId` is CE-22's one body identity, read live, so the
      // "you are already here" refusal follows the world and not a boot copy.
      worlds: worldRows(f, this.d.body.bodyId),
      confirm: this.armed ? this.confirmSentence() : '',
    };
  }

  report(): unknown {
    return {
      armed: this.armed, page: this.page,
      infiniteFuel: this.infiniteFuel,
      fullKg: +this.fullKg.toFixed(1), slotKey: this.slotKey(),
      // LIVE, re-read from /core every time this is asked, so a probe reading
      // it is reading the tanks rather than the session's stage-table copy.
      propellantKg: +this.liveFuelKg().toFixed(1),
      orbitAltM: ORBIT_ALT_M,
      ...(assistedReport() as object),
      log: this.log.slice(-12),
    };
  }

  /** GP-102. The single place a cheat is recorded, and the moment the player is
   *  told. Sandbox records nothing: `noteCheat` returns false there, so the
   *  banner never fires and the slot never grows a field. */
  private mark(id: string): void {
    const g = this.d.gameplay();
    if (g === null) return;
    if (noteCheat(id, g.mode.mode)) {
      g.hud.flash('this save is now marked as ASSISTED (a testing control was '
        + 'used). Sandbox mode is unmarked and always will be.', 5);
    }
  }

  private say(id: string, done: boolean, message: string,
              detail?: Record<string, unknown>): CheatReceipt {
    const r: CheatReceipt = { id, done, message, detail };
    this.log.push(r);
    if (this.log.length > 64) this.log.shift();
    this.d.gameplay()?.hud.flash(message, 3.2);
    return r;
  }
}
