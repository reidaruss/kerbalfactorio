// Pure mappings from /core state to what a panel or a probe wants to see.
//
// These were methods on Gameplay and are functions here for one reason: Gameplay
// is a COMPOSITION, and the moment the automation layer joined it the file was
// heading past the 400-line cap with row-shaping code that has no state and no
// order dependency. Nothing below touches the pointer, the tick or the scene.

import type { GameCore } from './GameCore.js';
import type { RecipeRow, SlotRow } from '../ui/InventoryPanel.js';

/** Name -> baked icon data URL. Empty string means "no mesh, use the text". */
export type IconFor = (name: string) => string;

const NO_ICON: IconFor = () => '';

export function slotRows(game: GameCore, icon: IconFor = NO_ICON): SlotRow[] {
  return game.inventory().map((s) => {
    const name = s.count > 0 ? game.itemName(s.item) : '';
    return { name, count: s.count, icon: name === '' ? '' : icon(name) };
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
                           all = false): RecipeRow[] {
  return game.recipes().map((r) => {
    const name = game.itemName(r.output);
    return {
      index: r.index,
      name,
      icon: icon(name),
      outputCount: r.outputCount,
      craftable: all || r.craftable,
      inputs: r.inputs.map((i) => {
        const n = game.itemName(i.item);
        return { name: n, have: i.have, need: i.need, icon: icon(n) };
      }),
    };
  });
}

/** What the pack can feed this machine: the ores it smelts and the fuels. */
export function furnaceView(game: GameCore, handle: number, tier: number) {
  const st = game.furnaceState(handle);
  const I = game.ids;
  const loadable = [];
  for (const [item, fuel] of [[I.rawIron, false], [I.rawCopper, false],
    [I.coal, true], [I.wood, true]] as [number, boolean][]) {
    const c = game.count(item);
    if (c > 0) loadable.push({ item, name: game.itemName(item), count: c, fuel });
  }
  return {
    title: tier === 1 ? 'Smelter' : 'Primitive furnace',
    oreName: st === null ? '' : game.itemName(st.oreItem),
    oreCount: st?.oreCount ?? 0,
    outName: st === null || st.outItem === 0 ? '' : game.itemName(st.outItem),
    outCount: st?.outCount ?? 0,
    fuelTicks: st?.fuelTicks ?? 0,
    progress: st?.progress ?? 0,
    ticksPerSmelt: st?.ticksPerSmelt ?? 180,
    smelting: st?.smelting ?? false,
    loadable,
  };
}

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
