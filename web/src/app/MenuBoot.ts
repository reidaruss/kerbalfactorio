// GP-100. WIRING THE GAME MENU, and the one gesture that could not go anywhere
// else either.
//
// IT IS BUILT AT THE COMPOSITION ROOT and not inside `Gameplay`, for a reason
// and for an excuse, in that order. The reason: the menu's testing controls
// reach the flight session, and `Gameplay` has no reference to flight at all --
// Systems.ts states the rule ("flight is not part of Gameplay, it owns its own
// eye") -- so `Gameplay` could not own this menu even if it had room. The
// excuse: it does not have room. `game/Gameplay.ts` is 479 lines against a hard
// 400-line cap that `check-limits` already fails on, so nothing may be added to
// it tonight, and the hotbar-edit callbacks below (which WOULD have gone beside
// `onSelect` and `onSwap` in that constructor) are here for that reason alone.
// That is flagged rather than hidden: Gameplay needs splitting, and it is a
// cross-lane job because five lanes have live work in that file.
//
// THE POINTER TRANSITION is the part worth being careful about and is a verbatim
// sibling of `GameplayChrome.setPackPanel`: opening must release the lock, show
// the cursor and stop the camera dead in the same frame, and closing must take
// the lock back without the mouse having "moved" while the cursor was free.

import { Cheats } from './Cheats.js';
import { SaveSlots } from '../game/SaveSlots.js';
import { stepNames } from '../sim/LaunchSteps.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { BuildMenu } from '../ui/BuildMenu.js';
import { buildRows, contentFor } from '../game/Buildables.js';
import type { Services } from './Services.js';
import { labelOf } from '../player/Bindings.js';
import type { Loop } from './Loop.js';

export function installPauseMenu(s: Services, loop: Loop) {
  const g = s.gameplay;
  if (g === null) return {};

  // GP-137. ONE restart port, shared by Start Fresh and by Load, because they
  // are the same operation seen from two places: put a world under the autosave
  // key (or remove it) and boot into it. Two ports would be two answers to how
  // long a banner stays on screen.
  // A BEAT BEFORE THE PAGE GOES. The receipt has to be readable, and the line
  // saying which slot was destroyed or loaded has to be on screen for at least
  // one frame, or a player who pressed the wrong button never learns what it
  // did. It is also what lets a driven probe press the real confirm, read the
  // real outcome and return before the context is torn down.
  let restartOff = false;
  const restart = (): void => {
    if (restartOff) return;
    window.setTimeout(() => { window.location.reload(); }, 400);
  };
  const slots = new SaveSlots(restart);
  const cheats = new Cheats({
    slots,
    gameplay: () => s.gameplay,
    flight: () => s.flight,
    body: s.body,
    cfg: s.cfg,
    restart,
    suppressRestart: () => { restartOff = true; },
  });

  const menu = new PauseMenu(g.host, g.modals, (id) => {
    cheats.press(id);
    menu.invalidate();
  });
  // GP-131. THE MENU ALWAYS OPENS ON ITS ROOT PAGE. A player who left it on the
  // controls screen and pressed Escape twice must not come back to a sub-page
  // they have forgotten they were on, which is the shape of "why is my menu
  // broken" that costs a support message rather than a bug report.

  /** THE pointer transition. One place, both halves (GameplayChrome's rule). */
  const setPause = (open: boolean): void => {
    menu.setOpen(open);
    if (open) { cheats.press('page:'); g.modals.touch(menu); menu.invalidate(); }
    s.input.setUiCapture(open);
    g.hud.setVisible(!open);
    g.hotbarBar.setVisible(!open);
  };

  menu.closer = () => { setPause(false); };
  // GP-100. ESCAPE OPENS IT, through the DERIVED stack rather than a second
  // handler. `closeTop` already closes whatever is on top, including this menu
  // once it is up and including the HAND, which is registered as a modal and is
  // therefore why a player holding a wall gets the wall dropped on the first
  // press and the menu on the second. "If im not already in another menu" is
  // not a condition written anywhere: it is what having nothing to close MEANS.
  g.modals.whenNothingOpen = () => {
    if (menu.isOpen) return '';
    setPause(true);
    return 'opened the game menu';
  };

  // GP-104. The tanks are topped up on the FIXED tick, like every other rule in
  // this game, so a driven run refills exactly as often as a played one.
  loop.onFixedStep.push(() => { cheats.step(); });
  // Diffed on one key inside `render`, so a closed menu costs one string build
  // and an open one that nothing has moved costs one compare.
  loop.onDrain.push(() => { menu.render(cheats.view()); });

  // GP-108. THE HOTBAR EDIT GESTURES. They belong beside `onSelect`/`onSwap` in
  // Gameplay's constructor and are here only because that file may not grow
  // (see the header). Both re-arm the build ghost, because emptying the slot in
  // hand changes what the left button does and a stale ghost would keep drawing
  // a part the player no longer holds.
  g.hotbarBar.onClear = (i) => {
    if (!g.hotbar.clear(i)) return;
    g.build.arm(g.hotbar.partInHand);
    g.hotbarBar.invalidate();
    g.hud.flash(`slot ${i + 1} emptied  (reset puts the loadout back)`, 2.4);
  };
  g.hotbarBar.onReset = () => {
    const n = g.hotbar.reset();
    g.build.arm(g.hotbar.partInHand);
    g.hotbarBar.invalidate();
    g.hud.flash(n === 0 ? 'the bar was already the default loadout'
      : `restored the default loadout  (${n} slots changed)`, 2.4);
  };

  // =========================================================================
  // GP-111. THE BUILD MENU, on B.
  // =========================================================================
  const build = new BuildMenu(g.host, g.modals, (id) => {
    // CLICK AND YOU ARE HOLDING IT, and the menu SHUTS, because that is what
    // Reid described: "you just click on whichever one you're trying to build.
    // You're now holding it like you would build it, so you can see the preview
    // of where you're gonna build it." A menu left open over the preview would
    // be showing you a ghost you cannot see.
    const c = contentFor(id);
    if (c === null) return;
    g.hotbar.hold(c);
    g.build.arm(g.hotbar.partInHand);
    setBuild(false);
    g.hud.flash(`holding ${g.hotbar.label}  (${labelOf('cancel')} to put it down)`, 3);
  });

  /** THE pointer transition, the same shape as the pack's and the menu's. */
  const setBuild = (open: boolean): void => {
    buildMenuOpen = open;
    build.setOpen(open);
    if (open) { g.modals.touch(build); build.invalidate(); }
    s.input.setUiCapture(open);
    g.hud.setVisible(!open);
    g.hotbarBar.setVisible(!open);
  };
  let buildMenuOpen = false;
  build.closer = () => { setBuild(false); };

  // B, edge-detected here for the same reason `assembly` and `map` are edge
  // detected in Systems: this is a MODE-ish panel that owns the pointer, and
  // `Gameplay` is at its line cap and could not hold it anyway.
  let buildHeld = false;
  loop.onFixedStep.push(() => {
    const k = s.input.act('build');
    if (k && !buildHeld) setBuild(!buildMenuOpen);
    buildHeld = k;
  });
  loop.onDrain.push(() => {
    if (!build.isOpen) return;
    build.render({ rows: buildRows(g), holding: g.hotbar.label,
      free: g.mode.freeBuild });
  });

  return {
    /**
     * The build menu (GP-111). With no argument it only reports.
     *
     * `rows` is the SAME derivation the panel draws, so a probe asserting that a
     * launch pad is greyed is asserting about the tile the player sees rather
     * than about a second computation of the same thing.
     */
    buildMenu(open?: boolean) {
      if (open !== undefined) setBuild(open);
      const rows = buildRows(g);
      return {
        open: build.isOpen,
        holding: g.hotbar.label,
        fromMenu: g.hotbar.holdingFromMenu,
        armed: g.build.selected,
        rows: rows.map((r) => ({ id: r.id, cost: r.cost, group: r.group,
          affordable: r.affordable, lockedBy: r.lockedBy, inHand: r.inHand,
          tile: build.tileFor(r.id) !== null,
          drawn: build.tileFor(r.id)?.className ?? '' })),
      };
    },

    /**
     * The menu, through the SAME transition Escape reaches. With no argument it
     * only reports, so a probe can look without changing anything.
     *
     * `escapeOpens` is the assertion worth having here rather than in the probe:
     * it reads the hook off the live `ModalStack`, so a build in which the menu
     * was constructed but never claimed the fallback reports false instead of
     * passing on a menu that only `__of` can open.
     */
    pause(open?: boolean) {
      if (open !== undefined) setPause(open);
      return {
        open: menu.isOpen,
        escapeOpens: g.modals.whenNothingOpen !== null,
        buttons: cheats.view().cheats.map((c) => ({
          id: c.id, present: menu.buttonFor(c.id) !== null,
          disabled: menu.buttonFor(c.id)?.disabled ?? null,
          on: c.on ?? null, blocked: c.blocked ?? '',
        })),
        // GP-103. The confirm exists in the DOM ONLY while armed, which is the
        // structural half of "the confirm cannot be skipped"; the other half is
        // `Cheats.startFresh` refusing outright. A probe asserts both.
        confirmButton: menu.buttonFor('startfresh:confirm') !== null,
        cancelButton: menu.buttonFor('startfresh:cancel') !== null,
        armed: cheats.isArmed,
        view: cheats.view(),
      };
    },

    /**
     * GP-137. The named-slot layer, READ ONLY.
     *
     * Every verb here is reached by pressing the real button in the real panel,
     * exactly as `probes/savenamed.js` does; this exists so a probe can read
     * what actually happened (`loads`, `saved`, `deleted`, `refusals`) rather
     * than infer it from the world, which is the difference between proving a
     * load ran and proving something changed.
     */
    /**
     * GP-139. WHICH CONTROL the launch guide is currently naming, or ''.
     *
     * It lives on this surface and not on `__of.flight` because `DebugFlight.ts`
     * belongs to another lane tonight, and because the assertion it exists for
     * is about a UI instruction rather than about flight: the guide must never
     * name a control already at its stop, and matching that on the PROSE would
     * be matching on wording that is meant to be improved. An action name is a
     * fact; the sentence is a draft.
     */
    steps: () => (s.flight === null ? '' : stepNames(s.flight.session)),

    saves(op?: string) {
      // `refresh` RE-READS THE STORE and resolves with the report. The list is
      // otherwise rebuilt only when the save page is opened (GP-137), which is
      // right for a menu and wrong for a probe that never opens one: phase 2 of
      // the reload proof has to ask the STORE what survived, not the cache a
      // fresh page has never filled.
      if (op === 'refresh') {
        const m = s.gameplay?.mode.mode ?? 'survival';
        return slots.refresh(m).then(() => slots.report());
      }
      return slots.report();
    },

    /**
     * Press a testing control BY NAME, through the same `press` the button
     * reaches. It is deliberately the same door and not a shortcut past one: a
     * probe driving this is driving the path a player takes, and standing rule 3
     * says the probe should press the real button where it can, which
     * `probes/cheats.js` does for every one of them.
     */
    cheat(id?: string) {
      if (id !== undefined) cheats.press(id);
      return cheats.report();
    },
  };
}
