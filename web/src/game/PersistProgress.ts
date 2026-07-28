// FS-82: WHAT A SAVE RECORDS ABOUT RESEARCH AND THE PLAYER, both directions.
//
// Split out of `Persist.ts` when the FS-79 rescue copy pushed that file past its
// 400-line cap, and split along a seam that was already there rather than at an
// arbitrary line count. Everything left in `Persist` is about the CONTAINER: what
// counts as state, in what order it has to be restored, and what a load could not
// bring back. These two are about one SUBSYSTEM's state, they are the only pair
// in that file that names `g.progress` at all, and `PersistLedger.ts` set the
// precedent when the receipt moved out for the same reason.
//
// The pair stays a PAIR and in one file, because a field written by one and not
// read by the other is a field that is silently lost, and the only defence
// against that is that the two are read side by side.

import type { SaveProgress } from './SaveGame.js';
import type { Gameplay } from './Gameplay.js';

/** What a save writes about research and the player. Read here so the shape
 *  and its one reader stay in one file. */
export function saveProgress(g: Gameplay): SaveProgress {
  const p = g.progress;
  const worn = p.progression.wornAll();
  return {
    techs: p.research.unlocked(),
    milestones: p.research.milestones(),
    worn: [worn[0] ?? 0, worn[1] ?? 0, worn[2] ?? 0, worn[3] ?? 0],
    skills: p.progression.skillXp(),
    appearance: [...Object.values(p.progression.appearance())],
  };
}

/** Put it back. Returns what actually took, so the ledger can say so. */
export function restoreProgress(g: Gameplay, saved: SaveProgress | undefined):
    { techs: number; milestones: number; armour: number } {
  if (saved === undefined) return { techs: 0, milestones: 0, armour: 0 };
  const p = g.progress;
  const techs = p.research.restore(saved.techs);
  let milestones = 0;
  for (const m of saved.milestones) if (p.research.earn(m)) milestones++;
  const a = saved.appearance;
  p.progression.restore(saved.worn, saved.skills, a.length >= 5
    ? { skin: a[0], suitPrimary: a[1], suitSecondary: a[2], visor: a[3],
        build: a[4] }
    : null);
  const armour = p.progression.wornAll().filter((i) => i > 0).length;
  // H-4: THE BODY IS PART OF WHAT A LOAD RESTORES. A save that brought four
  // pieces back into /core's slots and left the avatar bare would be the same
  // defect the equip button had, one path further along, and it is the reason
  // `syncArmour` sweeps every slot from `wornAll` rather than reacting to a
  // click: this call site never presses a button.
  p.syncArmour();
  p.invalidate();
  return { techs, milestones, armour };
}
