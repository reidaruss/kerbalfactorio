// The tech tree screen: what is already unlocked, what can be researched right
// now, and what is standing in the way of everything else.
//
// DW-2 holds here as everywhere under src/ui: plain DOM, zero three.js, plain
// rows in and one callback out. It knows nothing about TechIds, science packs or
// /core's unlock bitset beyond the shape of the rows it is handed, which is what
// lets the same panel serve a second tree later.
//
// THE COLUMNS ARE THE GRAPH. Factorio draws edges between nodes; this draws one
// column per prereq depth and NAMES the prereqs on the card instead, because an
// SVG edge router is a week of work to say what two words of text already say.
// Every card carries data-tech, so an edge layer added later can find both
// endpoints of every edge without this file changing at all.
//
// render() is called on every frame the panel is open, so it diffs one key and
// rebuilds only when that key moves. A closed panel returns before it builds one.

import './styles/research.css';
import { costClass, esc, iconTag } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

/** One line of a tech's price. `icon` is a baked data URL (ItemIcons) or ''. */
export interface CostRow {
  item: number; name: string; have: number; need: number; icon?: string;
}

export interface TechRow {
  id: number;
  name: string;
  /** Column in the graph, 0-based, already computed for you as prereq depth. */
  tier: number;
  state: 'unlocked' | 'available' | 'blocked';
  /** Why it cannot be researched right now, a whole sentence. '' when
   *  available or unlocked. */
  reason: string;
  /** TechIds this depends on, for drawing the edges. */
  prereqs: number[];
  cost: CostRow[];
  /** Display names of the machines, recipes and items this makes available. */
  unlocks: string[];
}

export interface ScienceRow {
  item: number; name: string; count: number; icon?: string;
}

export interface ResearchView {
  techs: TechRow[];
  /** Every science item the player holds, for the header line. */
  science: ScienceRow[];
  /** How many techs are unlocked out of how many exist, for the header. */
  done: number;
  total: number;
  /**
   * GP-600. DOES THIS TREE GATE ANYTHING? `ModeRules.researchGated`, and it is
   * false in sandbox.
   *
   * This is the field that stops the screen lying. Every number on it was TRUE
   * in sandbox and the SCREEN was false, which is the harder kind: `0 / 7
   * unlocked` beside seven greyed cards reads as "you have almost nothing and
   * this is what is stopping you", in a mode where the tree stops nothing at
   * all and every machine, recipe and part it names is already buildable.
   *
   * It does NOT make research free. Spending science through `of_rs_try` is
   * real in both modes, so the cards keep their true costs and their true
   * refusals; what changes is that the screen says once, at the top, that none
   * of it is in the player's way.
   */
  gated: boolean;
}

export interface ResearchPanelHooks { onResearch: (techId: number) => void }

export class ResearchPanel extends Modal {
  private readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly tree: HTMLElement;
  private open = false;
  private lastKey = '';

  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly hooks: ResearchPanelHooks) {
    super('research', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-research';
    this.root.className = 'of-ui';
    this.root.innerHTML =
      '<div class="frame">'
      + '<div class="of-rhead"></div>'
      + '<div class="tree"></div>'
      + '<div class="hint">Escape closes. A tech turns gold the moment its '
      + 'science is in the pack.</div>'
      + '</div>';
    parent.appendChild(this.root);
    this.head = this.root.querySelector('.of-rhead') as HTMLElement;
    this.tree = this.root.querySelector('.tree') as HTMLElement;
    // ONE delegated listener on the tree, never one per card: the cards are
    // rebuilt whenever the pack changes and per-card listeners would leak with
    // them. The probe presses the same real <button> a player presses.
    this.tree.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (b === null || b === undefined || b.disabled) return;
      const id = Number(b.getAttribute('data-tech'));
      if (Number.isFinite(id)) this.hooks.onResearch(id);
    });
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  /** Rebuild the header and the tree. Diffed on one key, so an open panel that
   *  nothing has moved costs one string compare and a closed one costs less. */
  render(view: ResearchView): void {
    if (!this.open) return;
    const key = keyOf(view);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.head.innerHTML = header(view);
    this.tree.innerHTML = view.techs.length === 0
      ? '<div class="none">No technologies defined.</div>'
      : columns(view.techs, view.gated);
    const hint = this.root.querySelector('.hint');
    if (hint !== null) {
      hint.innerHTML = view.gated
        ? 'Escape closes. A tech turns gold the moment its science is in '
          + 'the pack.'
        // GP-600. THE SENTENCE THAT MAKES THE REST OF THE SCREEN HONEST.
        : 'Escape closes. <b>Sandbox: this tree gates nothing.</b> Every '
          + 'machine, recipe and part it lists is already yours to build and '
          + 'craft, so researching here is optional and is only for seeing how '
          + 'the survival tree behaves. Science still has to be in the pack to '
          + 'press a button, and in sandbox you can craft it for nothing.';
    }
  }

  /** Force the next render to rebuild, e.g. right after a successful research
   *  or once the item icons have finished baking. */
  invalidate(): void { this.lastKey = ''; }

  /**
   * The Research button for a tech, exposed so a probe can press the thing a
   * player presses rather than a function only it can reach (standing rule 3).
   * Null for an unlocked tech, which shows a tick and no button at all.
   */
  buttonFor(techId: number): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(
      'button[data-tech="' + String(techId) + '"]');
  }
}

/**
 * Everything that can change what is on screen, in one string.
 *
 * Names and unlock lists ARE included even though a catalogue does not normally
 * move: they are twenty short strings, and leaving them out buys nothing but a
 * stale-label bug the day somebody swaps trees mid-session.
 */
function keyOf(view: ResearchView): string {
  return `${view.done}/${view.total}|${view.gated ? 1 : 0}|`
    + view.science.map((s) => `${s.item}:${s.count}`).join(',') + '|'
    + view.techs.map((t) => `${t.id}:${t.tier}:${t.state}:${t.name}:${t.reason}:`
      + t.cost.map((c) => `${c.item}=${c.have}/${c.need}`).join('+') + ':'
      + t.unlocks.join('/')).join(';');
}

/**
 * `Research 2 / 6 researched` plus the science the player is holding.
 *
 * GP-600 changed one word and it is the load-bearing one. `2 / 6 unlocked` is a
 * claim about what the PLAYER MAY USE, and in sandbox that number is 6 of 6
 * while this line said 0. `researched` is a claim about what they have SPENT
 * SCIENCE ON, which is true in both modes and is what the counter has always
 * actually counted. The sandbox row underneath then states the availability
 * separately, because they are two different facts and one number cannot be
 * both.
 */
function header(view: ResearchView): string {
  const chips = view.science.length === 0
    ? '<span class="none">no science held yet</span>'
    : view.science.map((s) => `<span class="sci" data-sci="${s.item}">`
      + `${iconTag(s.icon, 'ico-sm')}${esc(s.name)} <b>${s.count}</b></span>`)
      .join('');
  const avail = view.gated ? ''
    : `<span class="sbx" data-avail="${view.total}">sandbox: all `
      + `${view.total} available already</span>`;
  return `<h3>Research <span class="prog" data-done="${view.done}" `
    + `data-total="${view.total}" data-gated="${view.gated ? 1 : 0}">`
    + `${view.done} / ${view.total} researched</span>${avail}</h3>`
    + `<div class="held">${chips}</div>`;
}

/** One column per distinct tier, ascending; cards inside a column sort by id. */
function columns(techs: readonly TechRow[], gated: boolean): string {
  const names = new Map<number, string>();
  for (const t of techs) names.set(t.id, t.name);
  const tiers = [...new Set(techs.map((t) => t.tier))].sort((a, b) => a - b);
  return tiers.map((tier) => {
    const rows = techs.filter((t) => t.tier === tier)
      .sort((a, b) => a.id - b.id);
    return `<div class="col" data-tier="${tier}">`
      + `<h4>Tier ${tier}<span>${rows.length}</span></h4>`
      + rows.map((t) => card(t, names, gated)).join('') + '</div>';
  }).join('');
}

function card(t: TechRow, names: Map<number, string>, gated: boolean): string {
  // An unlocked tech gets a tick and NO button: a dead "Research" on something
  // already researched reads as a fault the player then goes hunting for.
  const act = t.state === 'unlocked'
    ? '<span class="tick" title="researched">&#10003;</span>'
    : `<button type="button" data-tech="${t.id}"`
      + `${t.state === 'available' ? '' : ' disabled'}>Research</button>`;
  const needs = t.prereqs.map((p) => '<i class="need">needs '
    + esc(names.get(p) ?? `#${p}`) + '</i>').join('');
  // GP-600: `free` rather than `no` in sandbox. Science really does have to be
  // in the pack to press the button, so this is NOT saying the cost is waived;
  // it is saying the cost is not standing between the player and the content,
  // because the content is already theirs. The number is unchanged either way.
  const cost = t.cost.map((c) => `<i class="${costClass(c.have, c.need, !gated)}">`
    + `${iconTag(c.icon, 'ico-sm')}${esc(c.name)} ${c.have}/${c.need}</i>`)
    .join(' &nbsp;+&nbsp; ');
  return `<div class="tech ${cls(t.state)}" data-tech="${t.id}" `
    + `data-state="${t.state}" data-tier="${t.tier}">`
    + `<div class="top"><span class="nm">${esc(t.name)}</span>${act}</div>`
    + (needs === '' ? '' : `<div class="needs">${needs}</div>`)
    + (cost === '' ? '' : `<div class="cost">${cost}</div>`)
    + (t.unlocks.length === 0 ? ''
      : `<div class="gives">${gated ? 'unlocks' : 'already available'}: `
        + `${esc(t.unlocks.join(', '))}</div>`)
    + (t.reason === '' ? '' : `<div class="why">${esc(t.reason)}</div>`)
    + '</div>';
}

/** Unlocked reads green, available reads gold, blocked reads dimmed. */
function cls(state: TechRow['state']): string {
  if (state === 'unlocked') return 'unlocked';
  return state === 'available' ? 'can' : 'blocked';
}
