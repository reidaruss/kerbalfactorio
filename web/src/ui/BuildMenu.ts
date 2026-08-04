// GP-111. THE BUILD MENU, on B.
//
// Reid, verbatim: "I don't want to have to craft them and then put them in the
// hotbar and then scroll to the hotbar item and then place it. For now, let's
// make b, the letter b, a build menu... If you have the resources to craft
// them, they'll be lit up. If you don't, they'll be grayed out. And then you
// just click on whichever one you're trying to build. You're now holding it
// like you would build it, so you can see the preview of where you're gonna
// build it. And then to get out of that, you press escape."
//
// EVERY ONE OF THOSE FIVE CLAUSES IS A RULE HERE OR NEXT DOOR:
//
//   B opens it              -> `Bindings.build`, and it joins the modal stack
//   unlocked things show    -> a LOCKED row is still drawn, and names its tech
//   affordable is lit       -> `BuildRow.affordable`, off /core's own prices
//   click and you hold it   -> `Hotbar.hold`, an override over the bar (GP-112)
//   escape gets you out     -> falls out of the stack: the menu closes on the
//                              first press and the pick drops on the second,
//                              because the hand is a modal too (GP-25)
//
// A GREYED ROW IS SHOWN AND NEVER HIDDEN, which is the one place this file has
// an opinion of its own. Seeing that a launch pad costs 60 iron is how a player
// learns what to go and mine; a menu that hid everything unaffordable would be
// empty on the first morning and would teach nothing. Same argument the tech
// tree already makes about a locked node.
//
// DW-2 as everywhere under src/ui: plain DOM, zero three.js, plain rows in and
// one callback out. It knows nothing about ItemIds, recipes, research or the
// hotbar; `game/Buildables.ts` derives all of that from the authorities that
// already own it and hands over strings and booleans.

import './styles/build.css';
import { costClass, esc, iconTag } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

/** One buildable, as data. Mirrors `game/Buildables.BuildRow`. */
export interface BuildMenuRow {
  id: string;
  label: string;
  icon: string;
  group: string;
  cost: string;
  needs: { item: number; name: string; have: number; need: number }[];
  affordable: boolean;
  lockedBy: string;
  inHand: boolean;
}

export interface BuildMenuView {
  rows: BuildMenuRow[];
  /** What is in hand right now, for the footer. '' when nothing is. */
  holding: string;
  /** True in sandbox, so the footer can say why everything is lit AND so the
   *  price chips stop drawing a shortfall as a refusal (GP-600). */
  free: boolean;
}

export class BuildMenu extends Modal {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private open = false;
  private last = '';

  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly onPick: (id: string) => void) {
    super('build', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-build';
    this.root.className = 'of-ui';
    this.root.innerHTML = '<div class="frame"><h3>Build'
      + '<span class="foot"></span></h3><div class="body"></div>'
      + '<div class="hint"></div></div>';
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.body') as HTMLElement;
    // ONE delegated listener, never one per tile: the rows are rebuilt whenever
    // the pack moves and per-tile listeners would leak with them. A LOCKED tile
    // is not clickable; an UNAFFORDABLE one is, deliberately, because picking it
    // up and seeing the ghost say what it needs is more useful than a dead tile.
    this.body.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement | null)?.closest('.of-btile');
      if (t === null || t === undefined || t.classList.contains('locked')) return;
      const id = t.getAttribute('data-build');
      if (id !== null && id !== '') this.onPick(id);
    });
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  render(view: BuildMenuView): void {
    if (!this.open) return;
    const key = `${view.holding}|${view.free ? 1 : 0}|`
      + view.rows.map((r) => `${r.id}:${r.affordable ? 1 : 0}:${r.lockedBy}:`
        + `${r.inHand ? 1 : 0}:${r.cost}`).join(',');
    if (key === this.last) return;
    this.last = key;
    const groups: string[] = [];
    for (const r of view.rows) if (!groups.includes(r.group)) groups.push(r.group);
    this.body.innerHTML = groups.map((gname) => `<div class="grp">`
      + `<h4>${esc(gname)}</h4><div class="tiles">`
      + view.rows.filter((r) => r.group === gname)
        .map((r) => tile(r, view.free)).join('')
      + '</div></div>').join('');
    const foot = this.root.querySelector('.foot');
    if (foot !== null) {
      foot.textContent = view.holding === '' ? '' : `holding: ${view.holding}`;
    }
    const hint = this.root.querySelector('.hint');
    if (hint !== null) {
      hint.innerHTML = view.free
        // GP-600. THE SENTENCE NAMES WHAT THE NUMBERS ARE FOR. The prices below
        // it are real and are what SURVIVAL would charge; saying "everything is
        // free" and then printing `Stone 0/40` in red beside it was the single
        // worst contradiction the QOL sweep found. Now the note explains the
        // numbers instead of denying them.
        ? 'Sandbox: nothing is locked and sandbox pays for everything. '
          + 'The prices below are what <b>survival</b> would charge, so you can '
          + 'still see the real cost. Click one to hold it, '
          + '<b>Escape</b> to put it down.'
        : 'Click one to hold it and the ghost shows where it will go. '
          + '<b>Escape</b> closes this, and again puts it down. '
          + 'Greyed out means you are short of materials; you can still pick '
          + 'it up to see what it needs.';
    }
  }

  invalidate(): void { this.last = ''; }

  /** The tile for one buildable, so a probe clicks what a player clicks. */
  tileFor(id: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`.of-btile[data-build="${id}"]`);
  }
}

function tile(r: BuildMenuRow, free: boolean): string {
  const locked = r.lockedBy !== '';
  // GP-600: `short` is a REFUSAL class (it dims the tile), and in sandbox no
  // tile refuses. `free` is passed down rather than read off the row because
  // the mode is a property of the SCREEN, not of any one buildable.
  const cls = `of-btile${locked ? ' locked' : r.affordable ? ' can' : ' short'}`
    + `${r.inHand ? ' held' : ''}`;
  const art = r.icon !== '' ? iconTag(r.icon, 'ico')
    : `<span class="tx">${esc(r.label)}</span>`;
  const needs = r.needs.map((n) => `<i class="${costClass(n.have, n.need, free)}">`
    + `${esc(n.name)} ${n.have}/${n.need}</i>`).join(' ');
  return `<div class="${cls}" data-build="${esc(r.id)}" `
    + `data-afford="${r.affordable ? 1 : 0}" data-locked="${esc(r.lockedBy)}">`
    + `<div class="art">${art}</div>`
    + `<div class="nm">${esc(r.label)}</div>`
    + `<div class="cost">${esc(r.cost)}</div>`
    + (locked ? `<div class="lock">needs ${esc(r.lockedBy)} (J)</div>`
      : `<div class="ing">${needs}</div>`)
    + '</div>';
}
