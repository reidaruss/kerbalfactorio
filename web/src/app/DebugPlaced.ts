// THE THINGS THAT STAND IN THE WORLD, and the mode that decides what they
// cost (GP-1075, split out of DebugGameplay.ts under the 400-line cap).
//
// Structures, the two placement ghosts, the aim branch, the pads, the research
// stations and the antennas: every population a player can put down, each
// published the way its own domain published it (a live model where a probe
// must measure, a report where every question is a fact).
//
// `sandbox` IS PART OF THIS GROUP AND NOT AN ORPHAN. `ModeRules` is "what a
// placement costs, what the catalogue offers, and what the save slot is keyed
// by" (Gameplay.ts), so the mode is the price list every entry above is read
// against; a probe asserting that a wall was affordable is asserting about
// both. It stays READ-ONLY here for the reason DW-31 gives below.
import { urlForMode } from '../game/GameMode.js';
import type { Services } from './Services.js';

export function placedApi(s: Services) {
  return {
    /** The base: every part, every site, the module and the costs. */
    structures: () => s.gameplay?.structures ?? null,
    /**
     * GP-288. THE STRUCTURE VIEW, which is a different object from the model
     * above and is the one that owns the placement ghost. Reid reported the
     * preview filling the screen, and `structures()` could not answer that
     * because the model has no idea what is drawn.
     */
    structView: () => s.gameplay?.structView.stats() ?? null,
    /** GP-288. The launch pad's own view, which owns a SECOND ghost. */
    padView: () => s.gameplay?.padView.stats() ?? null,
    /**
     * GP-289. WHICH BRANCH THE AIM TOOK, so a probe can tell a real ground hit
     * from the mid-air fallback from the overhead cone. Without it "the preview
     * encloses the player" has three different causes and one number.
     */
    buildAim: () => {
      const t = s.gameplay?.build.structTarget ?? null;
      if (t === null) return null;
      return { aimed: t.aimed, overhead: t.overhead, ok: t.ok,
               reason: t.reason, freePlaced: t.freePlaced };
    },

    /**
     * GP-57. The launch pads, LIVE, so a probe can measure against the pad's
     * own `socket_vessel` rather than against a number retyped in the probe.
     * `vesselAnchor` is the same call the roll-out makes, which is the point:
     * a probe that recomputed the anchor would be checking its own arithmetic.
     */
    pads: () => s.gameplay?.pads ?? null,

    /**
     * D-019. The research stations, as their own REPORT rather than as the live
     * object the two above hand over.
     *
     * A report and not the object, because everything a probe needs to assert
     * about a station is a fact rather than a measurement: how many stand, what
     * one costs, whether /core says the pack can pay (with the mode taken back
     * out, which is DW-31's in-page negative control), and which mesh is
     * standing in for the art that has not shipped. There is no `module` to
     * measure the way the pad has one, because the station borrows a mesh and
     * measuring a placeholder would pin numbers that are about to change.
     */
    stations: () => s.gameplay?.stations.report() ?? null,

    /** GP-533. Same shape as `stations` above, and for the same reasons. */
    antennas: () => s.gameplay?.antennas.report() ?? null,

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
  };
}
