// Pure mappings from /core state to what a panel or a probe wants to see.
//
// These were methods on Gameplay and are functions here for one reason: Gameplay
// is a COMPOSITION, and the moment the automation layer joined it the file was
// heading past the 400-line cap with row-shaping code that has no state and no
// order dependency. Nothing below touches the pointer, the tick or the scene.

import { CRAFT_BLOCK } from './GameCore.js';
import type { GameCore } from './GameCore.js';
import type { RecipeRow, SlotRow } from '../ui/InventoryPanel.js';

/** Name -> baked icon data URL. Empty string means "no mesh, use the text". */
export type IconFor = (name: string) => string;

const NO_ICON: IconFor = () => '';

/**
 * W11: what a recipe is gated BY, or '' when nothing gates it.
 *
 * A PORT rather than a `Research` import, so this file stays a pure mapping and
 * so the sandbox answer ("nothing is gated") is expressed by passing a function
 * that says so rather than by a branch in here.
 */
export type LockedBy = (recipeIndex: number) => string;
const NO_LOCK: LockedBy = () => '';

/** Which pack items can go on the hotbar: the machines and the parts. Asked of
 *  /core through the item's own category rather than by an id list here. */
export type Placeable = (item: number) => boolean;
const NOT_PLACEABLE: Placeable = () => false;

export function slotRows(game: GameCore, icon: IconFor = NO_ICON,
                         placeable: Placeable = NOT_PLACEABLE): SlotRow[] {
  return game.inventory().map((s) => {
    const name = s.count > 0 ? game.itemName(s.item) : '';
    return {
      name, count: s.count, icon: name === '' ? '' : icon(name),
      item: s.item, placeable: s.count > 0 && placeable(s.item),
    };
  });
}

/**
 * `all` is DW-31's full catalogue: in sandbox every recipe reads craftable
 * whatever the pack holds, because the panel is the only list of items the game
 * has and "pick anything thats in the game" has to reach it. The `have` counts
 * are still the TRUE ones, so the row shows what a survival player would need
 * even while the button is live.
 */
export function recipeRows(game: GameCore, icon: IconFor = NO_ICON,
                           all = false, lockedBy: LockedBy = NO_LOCK): RecipeRow[] {
  return game.recipes().map((r) => {
    const name = game.itemName(r.output);
    const lock = lockedBy(r.index);
    return {
      index: r.index,
      name,
      icon: icon(name),
      outputCount: r.outputCount,
      lockedBy: lock,
      // GP-51: the BUTTON asks the whole question, not the input half. A row
      // whose inputs are all present but whose output has nowhere to go is not
      // craftable, and it says which of the two it is rather than greying out
      // in silence, because the two need opposite actions from the player.
      craftable: (all || r.block === CRAFT_BLOCK.None) && lock === '',
      blockedBy: r.block === CRAFT_BLOCK.PackFull ? 'pack is full' : '',
      inputs: r.inputs.map((i) => {
        const n = game.itemName(i.item);
        return { name: n, have: i.have, need: i.need, icon: icon(n) };
      }),
    };
  });
}

// The machine screen's views moved to MachineScreen.ts (GP-57), and the
// hand-rolled ore/fuel table that used to live here is gone with them: the ore
// side now asks the sim's own exported smelt table and the fuel side is the
// named seam GP-58 documents, so this file cannot grow a second acceptance
// authority back by accident.

/**
 * Every node with its 64-bit body-frame position, sorted by distance from the
 * eye. This is the probe's eyes: without world positions a driven run cannot
 * tell "I aimed at nothing" from "the pick is broken", which is exactly the
 * silent success DW-20 is about.
 */
export function nodeDump(game: GameCore, indices: readonly { index: number }[],
                         eye: { x: number; y: number; z: number }): unknown[] {
  const out = [];
  for (const pl of indices) {
    const st = game.node(pl.index);
    if (st === null) continue;
    out.push({
      index: pl.index,
      x: st.x, y: st.y, z: st.z,
      name: game.itemName(st.resource),
      kind: st.kind,
      remaining: st.remaining,
      initial: st.initial,
      fraction: st.initial > 0 ? st.remaining / st.initial : 0,
      distanceM: Math.hypot(st.x - eye.x, st.y - eye.y, st.z - eye.z),
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

/**
 * The resource's own colour, lifted until it can be read as text over terrain.
 * Coal is authored at #35353c, which is correct for a chip in the air and
 * invisible as a caption, so the hue is kept and only the luminance is raised.
 */
export function readable(hex: number): string {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 150) {
    const k = 150 / Math.max(24, lum);
    r = Math.min(255, Math.round(r * k + 40));
    g = Math.min(255, Math.round(g * k + 40));
    b = Math.min(255, Math.round(b * k + 40));
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
