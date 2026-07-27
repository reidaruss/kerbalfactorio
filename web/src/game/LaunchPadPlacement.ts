// WHERE A LAUNCH PAD WOULD GO, AND WHETHER IT WOULD BE ALLOWED.
//
// Split from LaunchPad.ts for the reason StructurePlacement.ts is split from
// Structures.ts: that file owns what exists, this one owns the questions asked
// before anything is allowed to exist. In the order a player needs them:
//
//   1. is the pad RESEARCHED at all? (DW-29; `ModeRules.researchGated` asks it.)
//   2. is there a build SITE here? A pad stands on decks, so with no base near
//      the crosshair there is nothing to stand on.
//   3. GP-58: are all 36 cells of the 6 x 6 block DECKED, at this level, on
//      this site? The refusal COUNTS the missing ones, because "you need 11
//      more foundations" is an instruction and "invalid placement" is not.
//   4. is there already a pad overlapping this block?
//   5. is the cost in the pack?
//
// THE RESEARCH GATE IS FIRST, AND IT USED TO BE FOURTH. Two reasons, and they
// are about the player rather than about the code. A tech gate is a fact about
// the PLAYER and the other four are facts about the WORLD, so a locked pad
// should read locked wherever it is pointed, exactly as a locked row in the
// craft menu reads locked whatever is in the pack. And the order is the order
// the answers are useful in: being told where a pad would go, and then that you
// may not build one, wastes the aim; being told first that it needs a tech
// sends the player to the research screen, which is the next thing they have to
// do anyway.
//
// Every one produces a SENTENCE on the ghost before the key is pressed, which
// is DW-24's teaching argument applied to a rule the player has never met: the
// only way anybody learns that a pad needs a platform is by aiming at bare
// ground and being told so while they are still aiming.
//
// THERE IS NO GROUND CHECK IN THIS FILE AND THAT IS THE DESIGN. A pad never
// touches soil (GP-58: a 24 m footprint is accepted on 3.7% of sampled origins
// and a 4 m one on 59.3%), so the terrain question is asked 36 times by
// `StructurePlacement.checkGround` when the foundations go down, at the 4 m
// scale DW-33's fitted plane was actually measured at, with GP-38's cantilever
// available for the cells that hang. Re-asking it here over 24 m would either
// refuse platforms that are already legal or need a second, looser tolerance,
// and a second tolerance for the same question is the two-authority failure
// this project keeps paying for.

import * as THREE from 'three';
import { orient } from './Grid.js';
import { aimPoint } from './StructurePlacement.js';
import { MAX_LEVEL, deckKey, type Site } from './StructureGrid.js';
import { padAnchor, padBlockAt, padKey, type LaunchPads, type PadPart }
  from './LaunchPad.js';
import { labelOf } from '../player/Bindings.js';
import type { Structures } from './Structures.js';
import type { HudTarget } from '../ui/GameHud.js';
import type { Vec3d } from '../world/PlanetBody.js';

export interface PadTarget {
  site: Site | null;
  i: number; j: number; level: number;
  key: string;
  pos: Vec3d;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  ok: boolean;
  reason: string;
  /** GP-58: how many of the block's cells have no deck under them. 0 is a
   *  complete platform, and it is the number the refusal quotes. */
  missingCells: number;
  /** How many cells the block is on a side. 6 at the shipped module. */
  cells: number;
}

/** What the crosshair says with a pad in hand. */
export function padPrompt(t: PadTarget | null): HudTarget | null {
  if (t === null) return null;
  return {
    name: `launch pad  ${t.reason}`,
    fraction: 0, empty: !t.ok, distanceM: 0,
    action: `${labelOf('use')} place`,
  };
}

/**
 * Resolve where a pad would go.
 *
 * `researched` is passed in rather than asked for here, because the research
 * gate belongs to the mode (`ModeRules.researchGated`, GP-48) and this file
 * should not learn what a game mode is to answer a geometry question. The
 * SENTENCE for a locked pad is composed by the caller, which already holds the
 * tech name; what this returns is the refusal, in the same shape as the others,
 * so a locked pad reads red on the ghost like every other refusal rather than
 * being a silent failure at the moment of the press.
 */
export function resolvePadTarget(pads: LaunchPads, s: Structures,
                                 ray: { origin: Vec3d; dir: Vec3d },
                                 locked: string): PadTarget {
  const cells = pads.cells(s.module.cellM);
  const hit = aimPoint(s, ray);
  const site = s.nearestSite(hit);
  const t: PadTarget = {
    site, i: 0, j: 0, level: 0, key: '',
    pos: { x: hit.x, y: hit.y, z: hit.z },
    up: new THREE.Vector3(hit.x, hit.y, hit.z).normalize(),
    fwd: new THREE.Vector3(0, 0, 1),
    quat: new THREE.Quaternion(),
    ok: false, reason: '', missingCells: cells * cells, cells,
  };
  if (!pads.ready) { t.reason = 'no launch-pad content loaded'; return t; }
  // 1. DW-29's gate. Named, never silent, and asked before anything about the
  //    world, so a locked pad reads locked wherever it is pointed.
  if (locked !== '') { t.reason = locked; return t; }
  // 2. A pad has nowhere to stand without a base. The refusal says the SIZE,
  //    because a player who has laid four foundations needs to know the target
  //    is thirty-six and not "more".
  if (site === null) {
    t.reason = `a launch pad stands on a ${cells} x ${cells} platform`
      + `  (${cells * cells} foundations), and there is no base here`;
    pads.noDeckRefusals++;
    return t;
  }
  const b = padBlockAt(s, site, hit, cells);
  t.i = b.i; t.j = b.j; t.level = b.level;
  t.key = padKey(site.id, b.i, b.j, b.level);
  padAnchor(site, s.module.cellM, s.module.storey, s.module.deckH,
    b.i, b.j, b.level, cells, t.pos);
  t.up = site.up.clone();
  t.fwd = site.north.clone();
  t.quat = orient(t.up, t.fwd);
  if (b.level > MAX_LEVEL) { t.reason = 'too high'; return t; }

  // 3. GP-58. THE PLATFORM, counted rather than merely tested.
  t.missingCells = missingDecks(s, site, b.i, b.j, b.level, cells);
  if (t.missingCells > 0) {
    t.reason = `${t.missingCells} of ${cells * cells} cells have no foundation`
      + `  (a launch pad rests on a ${cells} x ${cells} platform, never on soil)`;
    pads.noDeckRefusals++;
    return t;
  }

  // 4. One pad per platform block. Overlap rather than key equality, or two
  //    pads one cell apart would each pass a key test and interpenetrate.
  const clash = overlapping(pads, site.id, b.i, b.j, b.level, cells);
  if (clash !== null) {
    t.reason = `too close to launch pad #${clash.id}`;
    return t;
  }

  // 5. The bill.
  if (!pads.canAfford()) { t.reason = `need ${pads.costText()}`; return t; }
  t.ok = true;
  t.reason = pads.costText();
  return t;
}

/** How many cells of the block have no deck on them at this level and site. */
export function missingDecks(s: Structures, site: Site, i0: number, j0: number,
                             level: number, cells: number): number {
  let missing = 0;
  for (let di = 0; di < cells; ++di) {
    for (let dj = 0; dj < cells; ++dj) {
      if (s.partAt(deckKey(site.id, i0 + di, j0 + dj, level)) === undefined) {
        missing++;
      }
    }
  }
  return missing;
}

/** A placed pad whose block would overlap this one, or null. */
function overlapping(pads: LaunchPads, siteId: number, i: number, j: number,
                     level: number, cells: number): PadPart | null {
  for (const p of pads.list) {
    if (p.siteId !== siteId || p.level !== level) continue;
    if (Math.abs(p.i - i) < cells && Math.abs(p.j - j) < cells) return p;
  }
  return null;
}

/** Commit a resolved pad. The cost is paid FIRST and the pad only built on
 *  success, so a refused placement can never eat the iron. */
export function commitPad(pads: LaunchPads, t: PadTarget | null): PadPart | null {
  if (t === null || !t.ok || t.site === null) {
    if (t !== null) pads.refusals++;
    return null;
  }
  const def = pads.definition;
  if (def === null || !pads.pay()) { pads.refusals++; return null; }
  const p = pads.adopt(def, t.site.id, t.i, t.j, t.level, t.pos, t.up, t.fwd);
  pads.placements++;
  return p;
}
