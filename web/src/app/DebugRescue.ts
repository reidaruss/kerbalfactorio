// BT-320 (R-RECOVER-1). THE READER FOR THE DOOR FS-79/PS-53 BUILT AND NEVER
// WIRED.
//
// `of-rescue` (FactoryRescue.ts) has held load-bearing copies since FS-79 (a
// rescale copy) and PS-53 (a fieldgen copy of a cleared player world), and had
// NO reachable reader: `listRescue`/`readRescue` had zero callers anywhere in
// `src` or `tools`, no debug verb exposed them, and the one sentence that
// claimed a reader existed was a false one, deleted by PS-56 rather than
// routed (persistence.md's R-RECOVER-1). This file is that reader, following
// `DebugSeat.ts`'s own registration shape next door: a plain function taking
// the `Services` it needs, returning the verbs to spread into `window.__of`.
//
// `list` and `read` are side-effect-free. `restore` is the one verb that
// writes, and `FactoryRescue.restoreRescue` is where the safety argument for
// it lives (explicit-only, writes verbatim, never automatic); this wrapper's
// only job on top of that is putting the warning where a player driving the
// console by hand would also see it, not only in the object it returns.

import { listRescue, readRescue, restoreRescue } from '../game/FactoryRescue.js';
import type { Services } from './Services.js';

export function rescueApi(s: Services) {
  return {
    rescue: {
      /** Every rescue copy's key, newest first. See `FactoryRescue.listRescue`. */
      list: () => listRescue(),
      /** The stored `SaveSlot` under one rescue key, or null. Read-only. */
      read: (key: string) => readRescue(key),
      /**
       * Write a rescue copy's bytes back into the slot its own key names.
       * EXPLICIT ONLY: this is the only call that can trigger it. Warns on
       * the console always, and on the HUD too when one is mounted, that a
       * fieldgen copy restored onto the current planet re-creates the exact
       * misplacement PS-53/PS-54 exist to prevent (persistence.md
       * R-RECOVER-1): recovery-then-inspection, not silent resurrection.
       */
      async restore(key: string) {
        const r = await restoreRescue(key);
        // `restoreRescue` already `console.warn`s its own report; the toast
        // is the one thing it cannot do itself, since it is a `game/` module
        // with no `Services` to reach a HUD through. `s.hud` (Services.ts) is
        // the low-level overlay and has no `flash`; the toast lives on
        // `Gameplay`'s own HUD, which is null whenever no `Gameplay` is
        // booted (a headless fixture, a fly scenario), so the flash is
        // skipped rather than thrown in exactly that case, per every other
        // `s.gameplay?.` read in this file's siblings (DebugHand.ts,
        // DebugHarm.ts).
        s.gameplay?.hud.flash(r.ok
          ? `restored rescue copy into '${r.targetSlot}': inspect before you trust it`
          : `rescue.restore failed: ${r.warning}`, 6);
        return r;
      },
    },
  };
}
