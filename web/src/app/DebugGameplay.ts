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
import { clearEdits } from '../game/VoxelSave.js';
import { showGoals } from '../game/Objectives.js';
import { isPart } from '../game/Hotbar.js';
import { snapToGround } from '../game/Grid.js';
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
    wipe: () => clearSlot(),
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
      return g.goals.report();
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
