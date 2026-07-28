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
import { PauseMenu } from '../ui/PauseMenu.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function installPauseMenu(s: Services, loop: Loop) {
  const g = s.gameplay;
  if (g === null) return {};

  const cheats = new Cheats({
    gameplay: () => s.gameplay,
    flight: () => s.flight,
    body: s.body,
    // A BEAT BEFORE THE PAGE GOES. The receipt has to be readable, and the
    // banner saying which slot was destroyed has to be on screen for at least
    // one frame, or a player who pressed the wrong button never learns what it
    // did. It is also what lets a driven probe press the real confirm, read the
    // real outcome and return before the context is torn down.
    restart: () => { window.setTimeout(() => { window.location.reload(); }, 400); },
  });

  const menu = new PauseMenu(g.host, g.modals, (id) => {
    cheats.press(id);
    menu.invalidate();
  });

  /** THE pointer transition. One place, both halves (GameplayChrome's rule). */
  const setPause = (open: boolean): void => {
    menu.setOpen(open);
    if (open) { g.modals.touch(menu); menu.invalidate(); }
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

  return {
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
