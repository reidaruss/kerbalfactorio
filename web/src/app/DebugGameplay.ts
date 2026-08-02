// The gameplay half of window.__of, split out when the demolition and audio
// surfaces landed and Debug.ts crossed the 400-line cap.
//
// EVERY ENTRY HERE GOES THROUGH THE PLAYER'S OWN PATH. `build(n)` is the number
// key, `demolish` is the X key's handler, `craft` is the panel button. A probe
// that reached past these into the sim would be verifying a path no player can
// take, which is the quiet way an acceptance test stops meaning anything.

import { demolishBuild, demolishMachine, demolishStructure } from '../game/Demolition.js';
import { renderVoices } from '../audio/Sfx.js';
import { renderBeds } from '../audio/Beds.js';
import { clearSlot } from '../game/SaveGame.js';
import { urlForMode } from '../game/GameMode.js';
import { clearEdits } from '../game/VoxelSave.js';
import { showGoals } from '../game/Objectives.js';
import { enemyDebug } from '../game/EnemyDebug.js';
import { isPart } from '../game/Hotbar.js';
import { snapToGround } from '../game/Grid.js';
import { STRUCTURE_STEP_UP_M, VOXEL_STEP_UP_M } from '../player/VoxelCollision.js';
import { StandTrace } from '../player/StandTrace.js';
import {
  findStation, lastStationInstall, STATION_ALT_M, STATION_PROXIES, STATION_TAG,
  stationAxes,
} from '../game/SpaceStation.js';
import { registry, stateOf } from '../sim/VesselRegistry.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function gameplayApi(s: Services, loop: Loop) {
  return {
    game: () => s.gameplay?.report() ?? null,
    nodes: () => s.gameplay?.nodes() ?? [],
    panel(open: boolean) { s.gameplay?.setPanel(open); return s.gameplay?.report() ?? null; },
    craft: (index: number) => s.gameplay?.game.craft(index) ?? false,
    lamp(on?: boolean) {
      if (on !== undefined && on !== s.headlamp.enabled) s.headlamp.toggle();
      return s.headlamp.stats();
    },

    /**
     * The old build-menu index, kept as a name for the seven BUILDABLE parts.
     *
     * It is now a view onto the hotbar, because the hotbar is what a number key
     * actually moves (GP-26): 0 puts the hands back and 1 to 7 are drill, belt,
     * smelter, foundation, floor, wall, door, which live in hotbar slots 3 to 9.
     * Probes written against the old menu keep meaning what they meant.
     */
    build(index?: number) {
      const h = s.gameplay?.hotbar;
      if (index !== undefined && h !== undefined) {
        h.select(index <= 0 ? 0 : Math.min(index + 1, 8));
        s.gameplay?.build.arm(h.partInHand);
      }
      return s.gameplay?.build.report() ?? null;
    },

    /**
     * The hotbar itself. `n` is 1-based, exactly as the number keys are, and it
     * goes through the SAME `select` a key press does.
     */
    hotbar(n?: number) {
      const g = s.gameplay;
      if (g === null) return null;
      if (n !== undefined) { g.hotbar.select(n - 1); g.build.arm(g.hotbar.partInHand); }
      return g.hotbar.report();
    },

    /** Put something in a hotbar slot, 1-based. The "put things in it" half. */
    assignSlot(n: number, what: string) {
      const g = s.gameplay;
      if (g === null) return null;
      const content = what === 'hand' ? { kind: 'hand' as const }
        : what === 'furnace' ? { kind: 'furnace' as const }
          : what === 'empty' || !isPart(what) ? { kind: 'empty' as const }
            : { kind: 'part' as const, part: what };
      g.hotbar.assign(n - 1, content);
      g.build.arm(g.hotbar.partInHand);
      return g.hotbar.report();
    },

    /**
     * Every modal that EXISTS, derived from the registry rather than listed, so
     * a probe asserting Escape against all of them cannot miss a new menu.
     */
    modals: () => s.gameplay?.modals.report() ?? null,

    /** Escape, through the one handler a key press reaches. */
    escape() {
      const g = s.gameplay;
      if (g === null) return null;
      g.input.playTape([{ hold: 2, actions: ['cancel'] }, { hold: 2, keys: [] }]);
      return g.modals.report();
    },

    /** The base: every part, every site, the module and the costs. */
    structures: () => s.gameplay?.structures ?? null,

    /**
     * GP-57. The launch pads, LIVE, so a probe can measure against the pad's
     * own `socket_vessel` rather than against a number retyped in the probe.
     * `vesselAnchor` is the same call the roll-out makes, which is the point:
     * a probe that recomputed the anchor would be checking its own arithmetic.
     */
    pads: () => s.gameplay?.pads ?? null,

    /**
     * DW-31. READ-ONLY on purpose: there is no `sandbox(true)`.
     *
     * A setter would be the single most useful thing here and the single most
     * dangerous: a probe, or a curious player at a console, could flip a
     * survival world halfway through and its autosave would then be written to
     * the sandbox key with half a survival session in it. Switching goes
     * through the reload the menu uses, so a mode is always decided at boot.
     * `switchUrl` is what that button would navigate to, for a probe to assert.
     */
    sandbox() {
      const g = s.gameplay;
      if (g === null) return null;
      const to = g.mode.sandbox ? 'survival' : 'sandbox';
      return {
        ...(g.mode.report() as object),
        switchUrl: urlForMode(window.location.href, to),
        // The button a PLAYER presses, so a probe can click it rather than
        // calling a function only a probe can reach (standing rule 3).
        menuButton: g.panel.modeSwitch?.textContent ?? null,
      };
    },

    /**
     * Snap a body-frame point exactly as a MACHINE placement does: the metric
     * site grid, then back onto the ground (GP-27). This is the number a belt
     * run is laid on, so measuring it is measuring the alignment itself.
     *
     * READ THIS BEFORE MEASURING WITH IT. Until a site has been ADOPTED, every
     * call founds a prospective one on the lattice cell it was handed, so two
     * calls a metre apart land in two different frames and it reproduces the
     * voxel lattice's own uneven steps. Place something first, or use
     * `latticeCell` if the lattice is what you actually wanted.
     */
    snapCell(x: number, y: number, z: number) {
      const f = s.gameplay?.factory;
      if (f === undefined) return null;
      const p = f.snap(x, y, z);
      return [p.pos.x, p.pos.y, p.pos.z];
    },

    /**
     * Snap to /core's own 1 m VOXEL lattice, which is what machines used to use.
     *
     * Kept precisely so the claim behind the change stays measurable: one unit
     * step of a cell key covers 0.59 to 1.02 m of ground depending on the axis,
     * because a body-frame cube grid is cut obliquely by the ground sphere. The
     * acceptance measures both and reports the difference.
     */
    latticeCell(x: number, y: number, z: number) {
      const f = s.gameplay?.factory;
      if (f === undefined) return null;
      const p = snapToGround(s.core, f.bodyHandle,
        s.voxels?.handle ?? 0, x, y, z);
      return [p.pos.x, p.pos.y, p.pos.z];
    },

    /**
     * Open or shut a placed door by part id, through the SAME toggle the E key
     * reaches. A probe that set `wantOpen` directly would be proving a path no
     * player can take.
     */
    door(id: number, open?: boolean) {
      const st = s.gameplay?.structures;
      const p = st?.parts.find((q) => q.id === id);
      if (st === undefined || p === undefined) return null;
      if (open === undefined || open !== p.wantOpen) st.toggle(p);
      return { id, kind: p.kind, wantOpen: p.wantOpen, swing: p.swing,
        shut: p.solid.shut };
    },

    /**
     * Is this body-frame point inside a structural collider? This is the exact
     * predicate the walker uses, so a probe asserting that a doorway is open is
     * asserting about the collision the player will actually meet, not about a
     * parallel test written in the probe.
     */
    solidBuild(x: number, y: number, z: number) {
      return s.gameplay?.structures.bodies.blocks(x, y, z) ?? false;
    },

    /**
     * The per-TICK standing trace (player/StandTrace.ts). `stand(true)` arms and
     * clears it, `stand()` dumps it oldest-first, `stand(false)` disarms.
     *
     * It lives on the gameplay surface because the question it answers is a
     * gameplay one: WHICH of the terrain and the base is holding the player up
     * this tick. `world().player` reports the answer once per FRAME, and a frame
     * carries one to three fixed ticks, so anything that alternates is aliased
     * away before a probe can see it.
     */
    /** The structural step ladder, so a probe can assert the rung that gets a
     *  player onto their own foundation still clears the shipped deck rather
     *  than reciting 0.55 back at itself. */
    stepUpM: STRUCTURE_STEP_UP_M,

    /** The VOXEL step ladder, deliberately a second name for a second ladder
     *  (see VoxelCollision.ts). A probe bounding the lift a tunnel floor query
     *  is allowed to apply reads its first rung from here rather than reciting
     *  0.55, so retuning the walker retunes the assertion with it. */
    voxelStepUpM: VOXEL_STEP_UP_M,

    stand(on?: boolean) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      if (on === false) { b.trace = null; return { armed: false, samples: [] }; }
      if (on === true) {
        if (b.trace === null) b.trace = new StandTrace();
        b.trace.reset();
      }
      const t = b.trace;
      return { armed: t !== null, total: t?.total ?? 0, samples: t?.dump() ?? [] };
    },

    /**
     * PH-94. THE STATION, read from the RECORD rather than from the installed
     * solid, so a probe comparing across a reload is comparing the thing that
     * is actually on disk. `pos` is `stateOf`, one Kepler solve, derived on
     * demand and cached nowhere.
     *
     * `deckR` is the radius the interior's floor sits at, which is `|pos|`
     * because the station is nadir pointing and the deck top face is its own
     * local y = 0. A probe wanting the floor the walker will stand on should
     * bisect `solidBuild` instead, which is the walker's own predicate; this is
     * the ORBIT's answer and the two agreeing is a real assertion (PH-96).
     */
    station() {
      const rec = findStation();
      if (rec === null) return null;
      const st = stateOf(s.core, registry, rec, 0);
      const r = Math.hypot(st.pos[0], st.pos[1], st.pos[2]);
      const el = rec.where.kind === 'conic' ? rec.where.el : null;
      return {
        id: rec.id, name: rec.name, mode: rec.mode, tag: rec.status,
        expectTag: STATION_TAG,
        pos: st.pos, vel: st.vel, deckR: r,
        speedMps: Math.hypot(st.vel[0], st.vel[1], st.vel[2]),
        designParts: rec.design.parts.length,
        clockS: rec.clockS, stampedTick: rec.stampedTick,
        proxies: STATION_PROXIES.length,
        proxyNames: STATION_PROXIES.map((b) => b.name),
        nominalAltM: STATION_ALT_M,
        el: el === null ? null : { ...el },
        axes: stationAxes(st.pos),
        install: lastStationInstall(),
        records: registry.count,
      };
    },

    /**
     * PH-90. Put the walker's feet at a BODY-FRAME point and report where they
     * ended up. The companion to `stand()`: that one asks WHICH authority held
     * the player up, this one puts the player somewhere there is no terrain
     * authority at all so the question can be asked off the heightfield.
     *
     * Deliberately NOT routed through `__of.teleport`, which is lat/lon/alt and
     * discards the altitude by a documented contract every walking probe in the
     * suite depends on (Config.ts line 51). See `Controller.standAt`.
     */
    standAt(x: number, y: number, z: number) {
      const p = s.player;
      if (p === null || p === undefined) return null;
      p.standAt(x, y, z);
      const f = p.body.feet;
      return { feet: [f.x, f.y, f.z], r: Math.hypot(f.x, f.y, f.z),
        grounded: p.body.grounded, onDeck: p.body.onDeck };
    },

    collect(id: number) {
      const f = s.gameplay?.factory;
      const b = f?.placed.find((p) => p.id === id);
      return f === undefined || b === undefined ? 0 : f.collect(b);
    },

    demolish(sel: { id?: number; machine?: number; part?: number }) {
      const g = s.gameplay;
      if (g === null) return null;
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
      const r = g.health.damage(sel.key, sel.amount);
      return { key: sel.key, ...r };
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

    audio(op?: string | number) {
      const sfx = s.gameplay?.sfx;
      if (sfx === undefined) return null;
      if (typeof op === 'number') sfx.bus.setVolume(op);
      else if (op === 'mute') sfx.bus.setMuted(true);
      else if (op === 'unmute') sfx.bus.setMuted(false);
      else if (op === 'unlock') void sfx.bus.unlock();
      else if (op !== undefined) sfx.play(op);
      return sfx.stats();
    },

    // DW-20 for sound, in two calls and not one. The published shape of
    // audioRender is a CONTRACT that probes already read; the beds get their
    // own entry rather than being wrapped around it. Both exist for the same
    // reason: a bed that runs for ever producing silence is exactly the failure
    // a play counter reports as working.
    audioRender: () => renderVoices(),
    bedsRender: () => renderBeds(),

    // DW-17. `save` writes the autosave slot NOW and `load` applies it over the
    // live world, which is what makes a reload testable without one: a probe
    // can save, mutate, load and compare in a single page.
    save: () => s.gameplay?.save() ?? Promise.resolve(null),
    load: () => s.gameplay?.load() ?? Promise.resolve(null),
    // The RUNNING mode's slot only. Wiping both would let a probe destroy a
    // world it is not testing, which is exactly the contamination DW-31 exists
    // to prevent, from the other direction.
    wipe: () => clearSlot(s.gameplay?.mode.mode ?? 'survival'),
    // Regrow the clearing from the seed, exactly as boot does. This is what
    // lets a probe model a RELOAD without one: a save is a diff over a freshly
    // generated world, so restoring onto a world that is already more depleted
    // than the save is a state a real boot can never be in.
    repopulate() { s.gameplay?.populate(); return s.gameplay?.report() ?? null; },

    // W7. The H key's own handler, so a probe cannot hide the checklist by a
    // path a player has no access to.
    goals(show?: boolean) {
      const g = s.gameplay;
      if (g === undefined || g === null) return null;
      if (show !== undefined) showGoals(g, show);
      // GP-165: the resolved hints ride along so a probe can assert the
      // derivation for rows the panel is not currently drawing.
      return { ...(g.goals.report() as object), hints: g.goals.allHints(g) };
    },

    // DW-17, the voxel half of `repopulate`: put the rock back, so a restore is
    // verified against a world with no digs in it, which is the only state a
    // reloaded page can actually be in.
    forgetTunnels() {
      const left = clearEdits(s.core, s.voxels, s.voxelMesh);
      return { removedCells: left, meshVisible: s.voxelMesh?.mesh.visible ?? false };
    },

    harvest(index: number) {
      if (s.gameplay === null) return null;
      const ok = s.gameplay.interact.harvestNow(index, loop.tickIndex);
      return { ok, node: s.gameplay.game.node(index), carried: s.gameplay.game.carried() };
    },
  };
}
