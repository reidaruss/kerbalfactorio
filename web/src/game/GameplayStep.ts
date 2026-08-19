// THE FIXED TICK: what the world does 60 times a second, and what one swing
// of the bare hand does inside it (GP-1076, split out of Gameplay.ts under the
// 400-line cap).
//
// ONE CONCERN, AND IT IS AN ORDER. `stepFixed` is a sequence whose every line
// is placed relative to the ones around it, and the comments in it are almost
// all about that: the census after the ticks, the swarm BEFORE the vitals so
// damage is spent against this tick's `hurtSources` and not the last one's,
// the autosave on the sim clock so a driven run saves as often as a played
// one. Moving the sequence out of the class does not touch a line of it.
//
// `stepSwing` rides with it because it is the tail of the same tick:
// `stepFixed` ends by handing the tick to `GameplayInput`, which is what calls
// the swing, and the kick at the end of the swing is applied on the FIXED tick
// for the reason written there. `lookAngles` is here for the same reason, as
// the one fact `GameplayInput` reads to tell a held click from a drag.
import { harvestRefusalText } from './GameCore.js';
import { reconcile } from './HealthCensus.js';
import type { Gameplay } from './Gameplay.js';
import type { GameplayDeps } from './GameplayDeps.js';

/** Ticks between autosaves. 20 seconds: often enough to matter, rare enough
 * that a slot write is invisible against a 16 ms frame. */
const AUTOSAVE_TICKS = 20 * 60;

/** Fixed tick. Returns true on the tick a harvest actually granted items. */
export function stepFixed(g: Gameplay, d: GameplayDeps, tick: number): boolean {
  g.keys.chrome(g);
  // H-5 closed: the three progression screens are ACTIONS, so a remap moves
  // them. Gated on `suspended` because `equipment` shares KeyK with
  // `throttleDown`, and you are either walking or strapped in.
  if (!g.suspended) g.progress.step((a) => d.input.act(a));

  // Machines and the automation network tick on the SIM clock, like
  // everything else that is a rule: a furnace on a synthetic-clock probe
  // smelts in exactly the tick count gameplay.h says it does, and "walk away
  // and iron accumulates" waits on no frame, panel or player proximity.
  g.machines.tick(1);
  g.factory.tick(1);
  // GP-65/GP-79. After the ticks (a commit replaces the whole plan) and every
  // tick rather than on an event, because an event is a thing a future call
  // site can forget to raise. HealthCensus.ts says why registering never heals.
  reconcile(g.health, g);
  // BEFORE the vitals, and the order is the rule: this rebuilds hurtSources,
  // and a tick that ran them the other way round would spend damage against
  // the previous tick's list (Enemies.ts says why that shows as a corpse
  // still biting).
  g.enemies.step(1 / 60, g);
  g.gun.step(1 / 60);
  g.vitals.step(1 / 60, g.hurtSources,
    { player: d.player, hud: g.hud });
  g.fx.watchSmelters(g.factory, g.game);
  // AUTOSAVE on the sim clock too, so a driven run saves as often as a played
  // one does.
  if (++g.sinceSaveTicks >= AUTOSAVE_TICKS) { g.sinceSaveTicks = 0; void g.save(); }

  // GP-79. A dead player does not swing, place or dig. The panels stay open
  // to them, deliberately: locking somebody out of the UI mid-blackout is a
  // punishment nobody asked for, and reading your own pack is harmless.
  if (g.uiOpen || g.suspended || g.vitals.health.dead) {
    // A machine screen closes with the key that opened it; the pack is handled
    // by `chrome`. Either way nothing in the world is aimed at.
    g.keys.closeWithInteract(g);
    g.interact.target = null;
    return false;
  }
  return g.keys.world(g, d.player.aimRay(), tick);
}

/** The bare hand. Returns true on the tick a harvest granted items. */
export function stepSwing(g: Gameplay, d: GameplayDeps, use: boolean,
                          tick: number,
                          ray: { origin: { x: number; y: number; z: number } },
): boolean {
  const got = g.interact.step(use, tick);
  if (got && g.interact.last !== null) {
    g.fx.impact(g.interact.last, ray.origin, g.interact.swings);
    g.panel.invalidate();
  }
  // GP-506. THE REFUSAL, SHOWN: a gated swing never reaches `interact.last`
  // (it was turned away before it was ever attempted), so the reason has to
  // be read off `lastRefusal` here instead of off a grant that never
  // happened.
  const lr = g.interact.lastRefusal;
  if (lr !== null && lr.tick === tick) g.hud.flash(harvestRefusalText(lr.code), 1.2);
  // The kick runs on the FIXED tick and is applied through the same additive
  // Controller.look the mouse uses, so a driven tape kicks exactly as often as
  // a human does and the offsets still sum to zero.
  const [ky, kp] = g.fx.kick.step(d.player.view.pitch);
  if (kp !== 0 || ky !== 0) d.player.look(ky, kp);
  return got;
}

/** GP-59: what the PLAYER is doing, which is what tells a held click apart
 *  from a drag. A foundation appearing under the feet moves the aim RAY and
 *  leaves all three of these untouched. */
export function lookAngles(d: GameplayDeps,
): { yaw: number; pitch: number; moving: boolean } {
  const v = d.player.view;
  const f = d.input.frame;
  return { yaw: v.yaw, pitch: v.pitch,
    moving: f.fwd !== 0 || f.right !== 0 || f.up !== 0 };
}
