// TAKING THINGS APART, AND WHAT IS LEFT WHERE THEY STOOD (GP-1075, split out
// of DebugGameplay.ts under the 400-line cap).
//
// One chain, in the order it runs: `collect` empties a building, `demolish`
// removes one by the X key's own handler, `damage` moves the health number
// through `Gameplay.damage` so the CONSEQUENCE of zero runs too, `wreckage`
// reports the pile that consequence leaves, and `hurt` is the same call
// against the PLAYER. `enemies` closes the file because the swarm is the only
// shipped source of every one of those, and its own debug surface is a
// separate module already (game/EnemyDebug.ts) that this only forwards to.
//
// Every entry keeps the property the file it came from insists on: none of
// them is a shortcut past the path a weapon takes.
import { demolishBuild, demolishMachine, demolishStructure, scavengeRubble }
  from '../game/Demolition.js';
import { enemyDebug } from '../game/EnemyDebug.js';
import type { Services } from './Services.js';

export function harmApi(s: Services) {
  return {
    collect(id: number) {
      const f = s.gameplay?.factory;
      const b = f?.placed.find((p) => p.id === id);
      return f === undefined || b === undefined ? 0 : f.collect(b);
    },

    /**
     * D1. WHAT FELL AND WHAT IS LEFT OF IT, as a report, `stations`' own shape
     * and its own reason: everything a probe needs to assert about a pile is a
     * fact rather than a measurement. `unresolved` and `unrecovered` are the two
     * that must be 0. Also in `game().wreckage`, so a probe reading the health
     * book and the wreckage in one snapshot can catch them disagreeing.
     */
    wreckage: () => s.gameplay?.wreckage.report() ?? null,

    demolish(sel: { id?: number; machine?: number; part?: number;
                    rubble?: number }) {
      const g = s.gameplay;
      if (g === null) return null;
      // D1. The rubble selector takes the same shape the other three do and
      // reaches the SAME function the X key reaches (`scavengeRubble`), so a
      // probe driving it is driving the player's path with the aim left off.
      // The aim itself is asserted separately, through `game().aimed.rubble`.
      if (sel.rubble !== undefined) {
        const r = g.wreckage.list.find((q) => q.id === sel.rubble);
        return r === undefined ? null : scavengeRubble(g.wreckage, g.game, r);
      }
      if (sel.part !== undefined) {
        const p = g.structures.parts.find((q) => q.id === sel.part);
        return p === undefined ? null
          : demolishStructure(g.structures, g.structView, g.game, p);
      }
      if (sel.machine !== undefined) {
        const m = g.machines.list[sel.machine];
        return m === undefined ? null
          : demolishMachine(g.machines, g.game, m);
      }
      const b = g.factory.placed.find((p) => p.id === sel.id);
      return b === undefined ? null
        : demolishBuild(g.factory, g.factoryView, g.game, b);
    },

    /**
     * GP-65. Deal damage to a placed thing, by its health key.
     *
     * THIS IS THE SAME CALL A WEAPON MAKES and deliberately not a shortcut past
     * one: `HealthBook.damage` is the only door into the number, so a probe
     * driving this is driving the combat path with the trigger left off. That
     * matters because health lands BEFORE any damage source exists, and without
     * an entry here the persistence claim could not be tested at all until a gun
     * shipped, which is exactly the order this work set out not to use.
     *
     * Returns null for an unknown key rather than a cheerful zero, because a
     * probe that silently damaged nothing and then asserted the damage survived
     * a reload would pass on two absences agreeing with each other.
     */
    damage(sel: { key: string; amount: number }) {
      const g = s.gameplay;
      if (g === null || typeof sel?.key !== 'string') return null;
      if (!g.health.has(sel.key)) return null;
      // D1. `Gameplay.damage`, NOT `health.damage`. The book is still the only
      // thing that moves the number, but the CONSEQUENCE of the number hitting
      // zero lives one level up, and a debug door that skipped it would let a
      // probe take a wall to 0 and watch it go on standing -- the exact bug D1
      // closed, reachable only from the surface that is meant to prove it fixed.
      // `hp`/`maxHp` are read back off the book because the host's return is
      // deliberately just `{applied, destroyed}`.
      const r = g.damage(sel.key, sel.amount);
      return { key: sel.key, ...r, hp: g.health.hpOf(sel.key),
        maxHp: g.health.maxOf(sel.key), wreckage: g.wreckage.report() };
    },

    /**
     * GP-79. Hurt the PLAYER, and stand them back up.
     *
     * `hurt` is the same `PlayerHealth.hurt` an enemy's contact will reach
     * through `step`, so a probe driving it drives the real path: the death
     * rule, the banner, the blackout and the respawn are all downstream of this
     * one call and none of them is reimplemented for the test.
     *
     * `respawn` exists so a probe does not have to wait out the five second
     * blackout in real time, and it is the SAME call the timer makes rather
     * than a second way to stand up, which is what keeps the teleport and the
     * heal from ever getting out of step.
     */
    hurt(sel: { amount?: number; cause?: string; respawn?: boolean }) {
      const g = s.gameplay;
      if (g === null) return null;
      if (sel?.respawn === true) {
        if (s.player === null) return null;
        g.vitals.respawn({ player: s.player, hud: g.hud });
      } else {
        g.vitals.health.hurt(Number(sel?.amount ?? 0), String(sel?.cause ?? 'debug'));
      }
      return g.vitals.report();
    },

    /** GP-87 to GP-93. The enemy loop, its nests and the swarm. `advance` is
     *  the ONLY verb that changes anything and it changes only the CLOCK; there
     *  is deliberately no way to conjure a wave. Reasoning in game/EnemyDebug.ts. */
    enemies(op?: string | number, a?: number) {
      const g = s.gameplay;
      return g === null ? null : enemyDebug(g.enemies, g, s.oracle, op, a);
    },
  };
}
