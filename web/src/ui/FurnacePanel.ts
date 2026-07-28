// THE MACHINE SCREEN: left-clicking any machine with a bare hand opens this
// (GP-61), for the hand furnace and for the factory's own machines alike.
//
// Same contract as InventoryPanel: plain DOM, zero three.js, plain rows in and
// callbacks out. It renders the numbers the SIM owns and nothing it made up:
// the progress bar is /core's own per-unit counter carried across the bridge
// (GP-63), never a client-side interpolation, because a bar that guesses drifts
// from the machine it claims to describe.
//
// THE SLOTS ARE BUTTONS, which is the Factorio grammar Reid asked for verbatim:
// click the output cell and the whole stack is yours, click the input cell and
// the ore comes back (published against the take-ore seam, GP-62, disabled and
// SAYING SO until the bridge exports it), click a pack row to put ore or fuel
// in. A disabled control that names its reason is a promise; a missing one is a
// feature nobody can find (GP-56).

import { esc } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

/**
 * FS-48: A SLOT NAMES THE PORT ITS STACK ARRIVES ON, so the panel and the world
 * agree about the same machine.
 *
 * The panel used to say "Input: 12 Raw Iron" and stop, which was the whole truth
 * while a connection was a proximity adjacency: there was nothing else to name,
 * because the ore came from "something nearby". Under FS-44 a stack arrives
 * through a specific socket on a specific face of the housing, and a player
 * debugging a stalled line needs the panel to agree with what they can walk
 * round and look at. `port` is the socket's own name, verbatim from the shipped
 * asset, and `via` is what is on the other end of it or why nothing is.
 *
 * Both are optional: the hand furnace has no ports and passes neither, and its
 * cells render exactly as they did.
 */
export interface MachineSlot {
  name: string;
  count: number;
  port?: string;
  via?: string;
}

/**
 * FS-56: ONE ROW OF THE ASSEMBLER'S RECIPE MENU.
 *
 * `output` is the recipe's identity (an ItemId), because that is what the plan
 * stores and what `Factory.setRecipe` takes; a button carrying an ordinal would
 * be a third id space for one thing.
 */
export interface RecipeChoice {
  output: number;
  label: string;
  /** "5 Iron + 5 Stone", built by the caller out of /core's own item names. */
  cost: string;
  /** The pack can pay for one right now. Only ever shading, never a gate: the
   *  machine is fed by BELT, so an unaffordable recipe is a perfectly good
   *  thing to set and this is a hint about hand-loading, not a refusal. */
  affordable: boolean;
  selected: boolean;
}

/** A /core recipe this machine cannot run, and why, so the menu's absences are
 *  visible rather than mysterious (GP-56: a missing feature is one nobody can
 *  find, and a disabled one that names its reason is a promise). */
export interface RecipeRefusal { label: string; why: string }

export interface MachineView {
  title: string;
  /** SMELTING / IDLE / MINING, whatever the sim says it is doing. */
  status: string;
  input: MachineSlot | null;
  /**
   * FS-56: THE SECOND INGREDIENT, and it is a separate optional field rather
   * than `input` becoming an array.
   *
   * An array would be the tidier type and it would rewrite every existing caller
   * and every probe assertion that reads `input.count`, for one machine that has
   * two. The panel's grid is three cells wide and always has been: a smelter
   * shows Input, Fuel, Output and an assembler shows Input A, Input B, Output,
   * so the LAYOUT does not grow either. Null for every machine with one input,
   * which renders exactly as it did.
   */
  input2: MachineSlot | null;
  /** The fuel POOL (burn ticks or units): a pool, not a stack, so no take. */
  fuel: { main: string; sub: string } | null;
  output: MachineSlot | null;
  /** 0..1 of the CURRENT unit, straight off the sim's own counter (GP-63).
   *  Null for a machine with no crafting stage (a drill, a generator). */
  progress01: number | null;
  progressText: string;
  /** GP-62: false until the take-ore bridge export exists. */
  canTakeInput: boolean;
  /** Why the input cell is disabled, shown as its tooltip. */
  takeInputHint: string;
  /** What the pack can feed it right now: [item, name, count, isFuel]. */
  loadable: { item: number; name: string; count: number; fuel: boolean }[];
  /** FS-56: the recipe menu, for a machine that HAS one. Null everywhere else,
   *  and an empty array is a different thing from null: null is "this machine's
   *  recipe is not a choice", empty is "it is a choice and there is nothing to
   *  choose", which are different bugs when either turns up. */
  recipes: RecipeChoice[] | null;
  /** /core recipes this machine cannot run, named with the reason. */
  refused: RecipeRefusal[];
}

export class FurnacePanel extends Modal {
  private readonly root: HTMLElement;
  private open = false;
  private last = '';

  constructor(
    parent: HTMLElement,
    stack: ModalStack,
    private readonly onLoad: (item: number) => void,
    private readonly onTake: () => void,
    private readonly onTakeInput: () => void,
    /** FS-56: a recipe row was clicked. Defaulted so no existing construction
     *  site moved; a panel built without it simply renders no menu, which is
     *  what every caller before assemblers wanted. */
    private readonly onRecipe: (output: number) => void = () => {},
  ) {
    super('furnace', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-furnace';
    this.root.className = 'of-ui';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b === null) return;
      // FS-56. Its own attribute, and NOT `data-load` carrying an output id:
      // both would be an ItemId on a button in the same panel, so "set this
      // machine to make a Smelter" and "put a Smelter into this machine" would
      // be one string apart and would eventually be confused by somebody adding
      // the third verb. Different questions get different attributes.
      const rec = b.getAttribute('data-recipe');
      if (rec !== null) { this.onRecipe(Number(rec)); return; }
      const item = b.getAttribute('data-load');
      if (item !== null) { this.onLoad(Number(item)); return; }
      if (b.getAttribute('data-take-in') !== null) { this.onTakeInput(); return; }
      if (b.getAttribute('data-take') !== null) this.onTake();
    });
  }

  get isOpen(): boolean { return this.open; }

  /**
   * The DRAWN bar, as a percentage read back off the element's own width.
   *
   * Reported rather than recomputed, because the claim GP-63 makes is about
   * what the player SEES: a probe that compared the sim's counter with a number
   * this file computed a second time would agree with itself while the bar on
   * screen stayed at zero. This is the pixel, asked for its value.
   */
  get barPct(): number {
    const i = this.root.querySelector('#of-fbar > i') as HTMLElement | null;
    return i === null ? -1 : Number.parseFloat(i.style.width) || 0;
  }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
    this.last = '';
  }

  render(v: MachineView): void {
    if (!this.open) return;
    const key = `${v.title}|${v.status}|${cellKey(v.input)}|${cellKey(v.input2)}`
      + `|${cellKey(v.output)}`
      + `|${v.fuel?.main ?? ''}${v.fuel?.sub ?? ''}|${pct(v)}|${v.progressText}`
      + `|${v.canTakeInput ? 1 : 0}|`
      + v.loadable.map((l) => `${l.item}:${l.count}`).join(',')
      // FS-56. The MENU is part of the key, and both of the things about it that
      // change: which row is selected, and which rows are affordable. Leaving
      // affordability out would leave a row greyed until something else on the
      // panel happened to move, which is the same "the panel said it was
      // connected for another ten seconds" failure `cellKey` was widened for.
      + '|' + (v.recipes ?? []).map((r) =>
        `${r.output}${r.selected ? 'S' : ''}${r.affordable ? 'A' : ''}`).join(',');
    if (key === this.last) return;
    this.last = key;
    const load = v.loadable.length === 0
      ? '<div class="hint">Nothing in the pack this machine will take.</div>'
      : v.loadable.map((l) => `<button data-load="${l.item}">`
        + `${l.fuel ? 'Fuel' : 'Load'} ${esc(l.name)} (${l.count})</button>`).join(' ');
    // THE MIDDLE CELL IS FUEL OR IT IS THE SECOND INGREDIENT, never both, and
    // the grid stays three wide. A four-cell row would reflow the panel for
    // every machine in the game to accommodate one that has no fuel pool at all.
    const middle = v.input2 !== null
      ? this.slotCell('Input B', v.input2, 'data-take-in2', false, v.takeInputHint)
      : `<div class="cell"><em>Fuel</em><b>${esc(v.fuel?.main ?? '-')}`
        + `</b><i>${esc(v.fuel?.sub ?? '')}</i></div>`;
    this.root.innerHTML = '<div class="frame">'
      + `<h3>${esc(v.title)}<span>${esc(v.status)}</span></h3>`
      + this.recipeMenu(v)
      + `<div class="grid">`
      + this.slotCell(v.input2 === null ? 'Input' : 'Input A', v.input,
        'data-take-in', v.canTakeInput && (v.input?.count ?? 0) > 0,
        v.takeInputHint)
      + middle
      + this.slotCell('Output', v.output, 'data-take',
        (v.output?.count ?? 0) > 0, 'click to take the stack')
      + '</div>'
      + `<div id="of-fbar"><i style="width:${pct(v)}%"></i></div>`
      + `<div class="hint">${esc(v.progressText)}</div>`
      + `<div class="acts">${load}</div>`
      + '<div class="hint">E or Escape closes. Click a slot to take its whole '
      + 'stack; loading comes out of the pack.</div>'
      + '</div>';
  }

  /**
   * FS-56: THE RECIPE MENU, and it sits ABOVE the slots on purpose.
   *
   * The slots answer "what is in this machine" and the menu answers "what is
   * this machine FOR", and the second question comes first for a player who has
   * just placed one: an unset assembler's slots are three empty cells that
   * cannot mean anything until a recipe names them. Putting the menu underneath
   * would put the answer below the confusion.
   *
   * Empty for every machine whose recipe is not a choice, which is every machine
   * that existed before this one, so their panels are byte-identical.
   */
  private recipeMenu(v: MachineView): string {
    if (v.recipes === null) return '';
    const rows = v.recipes.map((r) =>
      `<button data-recipe="${r.output}"`
      + ` class="recipe${r.selected ? ' on' : ''}${r.affordable ? '' : ' short'}">`
      + `<b>${esc(r.label)}</b><i>${esc(r.cost)}</i></button>`).join('');
    const head = v.recipes.length === 0
      ? '<div class="hint">No recipe this machine can run.</div>'
      : `<div class="recipes">${rows}</div>`;
    // THE REFUSALS ARE PRINTED, not omitted. A player looking for the electric
    // smelter needs to be told it takes three ingredients and this machine takes
    // two: that is a fact about the world they can act on (build it by hand),
    // where a menu that simply lacks the row teaches nothing and reads as a bug.
    const why = v.refused.length === 0 ? ''
      : `<div class="hint">Not here: ${v.refused
        .map((r) => `${esc(r.label)} (${esc(r.why)})`).join('; ')}.</div>`;
    return head + why;
  }

  /** An input/output SLOT: a button, so a click takes the stack (GP-61). */
  private slotCell(label: string, s: MachineSlot | null, attr: string,
                   enabled: boolean, hint: string): string {
    const out = attr === 'data-take' ? ' out' : '';
    if (s === null) {
      return `<div class="cell${out}"><em>${label}</em><b>-</b><i></i></div>`;
    }
    // FS-48. The PORT goes on the label line and the connection goes under the
    // count, because the label answers "which hole is this" and the line under
    // it answers "and is anything plugged into it". A tooltip alone would not
    // do: the player is looking at this panel BECAUSE the line has stopped, and
    // a reason you have to hover to find is a reason nobody reads.
    //
    // TWO CLASSED SPANS, AND THE FIRST DRAFT USED `<u>` AND `<s>` INSTEAD.
    // `<s>` is the strike-through element: "fed by #3 belt" would have rendered
    // with a line through it, which reads as CANCELLED, the precise opposite of
    // what it says. It was caught by reading the stylesheet rather than by
    // looking at the panel, and the general form is worth the sentence: reaching
    // for a bare HTML tag because its LETTER suits the field is how semantics
    // nobody intended get rendered. New markup gets its own class and its own
    // rule in game.css, where the disconnected state is also coloured.
    const tag = s.port === undefined ? ''
      : ` <span class="port">${esc(s.port)}</span>`;
    const off = s.via === 'not connected' ? ' off' : '';
    const via = s.via === undefined ? ''
      : `<span class="via${off}">${esc(s.via)}</span>`;
    return `<button class="cell${out}" ${attr}="1"${enabled ? '' : ' disabled'}`
      + ` title="${esc(hint)}"><em>${label}${tag}</em>`
      + `<b>${s.count > 0 ? esc(s.name) : '.'}</b><i>${s.count}</i>${via}</button>`;
  }
}

function cellKey(s: MachineSlot | null): string {
  // FS-48: the port and the connection are PART of the key. `render` returns
  // early on an unchanged key, so a field left out here is a field that updates
  // on screen only when something else happens to change, which is the shape of
  // "the panel said it was connected for another ten seconds".
  return s === null ? '-' : `${s.name}${s.count}|${s.port ?? ''}|${s.via ?? ''}`;
}

function pct(v: MachineView): number {
  return v.progress01 === null ? 0
    : Math.round(Math.max(0, Math.min(1, v.progress01)) * 100);
}
