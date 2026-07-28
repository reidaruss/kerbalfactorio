// GP-100. THE GAME MENU: what Escape opens when nothing else is open.
//
// TWO LAYERS, and they age at opposite rates. The SHELL is the durable half:
// Save Game, Options (Controls, Video, Audio) and Multiplayer are the four
// things every game of this shape eventually has, and every one of them is a
// visible "not yet" here rather than a button that does nothing. Reserving the
// shape costs a dozen lines and means the work that fills them has a home to
// arrive into instead of a layout argument to have first. The TESTING half is
// the useful-today half, and it is the reason the menu is worth building now.
//
// A STUB SAYS WHAT IT IS WAITING FOR. "Not yet" on its own is indistinguishable
// from a bug; "not yet: the world autosaves every 20 seconds, named slots come
// with the save system" is a promise with a shape. Every stub below carries one.
//
// DW-2 as everywhere under src/ui: plain DOM, zero three.js, a plain view in and
// one callback out. It knows nothing about flight sessions, save slots or the
// enemy loop; it draws the rows it is handed and reports which button was
// pressed. That is what lets `Cheats.ts` own every rule and this own no rule at
// all, which is the same split `ResearchPanel` and `research.h` have.

import './styles/pause.css';
import { esc } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

/** One testing control, as data. The panel has no opinion about any of them. */
export interface CheatRow {
  id: string;
  label: string;
  /** What it does, in one line, on the row itself. */
  note: string;
  /** 'button' fires once. 'toggle' shows ON/OFF and reports its state. */
  kind: 'button' | 'toggle';
  on?: boolean;
  /** Why it cannot run right now, or '' when it can. A DISABLED row still
   *  SHOWS, and says why, for the same reason a locked tech does: a control the
   *  player cannot find is worse than one they can see is not ready yet. */
  blocked?: string;
  /** True for the row that must be confirmed before it does anything. */
  destructive?: boolean;
}

export interface PauseView {
  mode: string;
  /** The IndexedDB key this world lives under. Named on screen because the one
   *  destructive control in here destroys exactly it. */
  slotKey: string;
  /** GP-102. Empty when nothing has marked the save. */
  assisted: string;
  cheats: CheatRow[];
  /** Set while Start Fresh is armed: the whole sentence the confirm shows. */
  confirm: string;
}

/** Everything the shell reserves and does not build. Data, so adding the fifth
 *  section later is a row here rather than a layout. */
const STUBS: readonly { name: string; waiting: string }[] = [
  { name: 'Save Game',
    waiting: 'not yet: the world autosaves every 20 seconds to the slot named '
      + 'below. Named slots, manual saves and a load list come with the save '
      + 'system.' },
  { name: 'Options / Controls',
    waiting: 'not yet: this will show the binding table the game already has '
      + '(player/Bindings.ts), and let you rebind it. It will NOT be a second '
      + 'list of keys, because a second list is a list that goes wrong.' },
  { name: 'Options / Video',
    waiting: 'not yet: resolution, the post stack (AO, bloom, grade, AA) and '
      + 'the terrain quality dial, all of which are URL flags today.' },
  { name: 'Options / Audio',
    waiting: 'not yet: master volume and mute exist and are on the backslash '
      + 'key; they get sliders here, plus per-bus levels.' },
  { name: 'Multiplayer',
    waiting: 'not yet: host, join and the server list. The sim is already '
      + 'deterministic and command-driven, which is the hard half.' },
];

export class PauseMenu extends Modal {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private open = false;
  private last = '';

  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly onPress: (id: string) => void) {
    super('pause', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-pause';
    this.root.className = 'of-ui';
    this.root.innerHTML = '<div class="frame"><h3>Game menu'
      + '<span class="esc">Escape closes</span></h3>'
      + '<div class="body"></div>'
      + '<div class="hint">The simulation KEEPS RUNNING while this is open '
      + '(GP-101). Your factory does not stop because you opened a menu.</div>'
      + '</div>';
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.body') as HTMLElement;
    // ONE delegated listener, never one per button: the rows are rebuilt
    // whenever anything in the view moves and per-row listeners leak with them.
    // The probe presses the same real <button> a player presses.
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (b === null || b === undefined || b.disabled) return;
      const id = b.getAttribute('data-cheat');
      if (id !== null && id !== '') this.onPress(id);
    });
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  /** Rebuild, diffed on one key so an open menu nothing has moved is free. */
  render(view: PauseView): void {
    if (!this.open) return;
    const key = `${view.mode}|${view.slotKey}|${view.assisted}|${view.confirm}|`
      + view.cheats.map((c) => `${c.id}:${c.on === true ? 1 : 0}:${c.blocked ?? ''}`)
        .join(',');
    if (key === this.last) return;
    this.last = key;
    this.body.innerHTML = header(view) + stubs() + testing(view);
  }

  invalidate(): void { this.last = ''; }

  /**
   * The button for one control, exposed so a probe presses the thing a player
   * presses rather than a function only it can reach (standing rule 3).
   */
  buttonFor(id: string): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(
      `button[data-cheat="${id}"]`);
  }
}

function header(v: PauseView): string {
  return '<div class="of-pgrp world"><h4>World</h4>'
    + `<div class="row"><span class="nm">Mode</span>`
    + `<span class="val" data-mode="${esc(v.mode)}">${esc(v.mode)}</span></div>`
    + `<div class="row"><span class="nm">Save slot</span>`
    + `<span class="val" data-slot="${esc(v.slotKey)}">${esc(v.slotKey)}</span></div>`
    + (v.assisted === '' ? ''
      : `<div class="row assist"><span class="nm">Assisted</span>`
        + `<span class="val">${esc(v.assisted)}</span></div>`)
    + '</div>';
}

function stubs(): string {
  return '<div class="of-pgrp stubs"><h4>Not built yet</h4>'
    + STUBS.map((s) => `<div class="row stub" data-stub="${esc(s.name)}">`
      + `<span class="nm">${esc(s.name)}</span>`
      + `<span class="why">${esc(s.waiting)}</span></div>`).join('')
    + '</div>';
}

/**
 * The testing block. The destructive row is rendered in one of two states and
 * never in both: ARMED shows the sentence and two buttons, and that is the only
 * state from which the confirm button exists in the DOM at all. A confirm the
 * player can reach without first reading the sentence is not a confirm.
 */
function testing(v: PauseView): string {
  const rows = v.cheats.map((c) => {
    if (c.destructive === true && v.confirm !== '') return armed(c, v.confirm);
    const blocked = c.blocked !== undefined && c.blocked !== '';
    const state = c.kind === 'toggle'
      ? `<span class="state ${c.on === true ? 'on' : 'off'}">`
        + `${c.on === true ? 'ON' : 'OFF'}</span>`
      : '';
    return `<div class="row cheat${blocked ? ' blocked' : ''}`
      + `${c.destructive === true ? ' danger' : ''}" data-cheat-row="${esc(c.id)}">`
      + `<span class="nm">${esc(c.label)}${state}</span>`
      + `<span class="why">${esc(blocked ? (c.blocked ?? '') : c.note)}</span>`
      + `<button type="button" data-cheat="${esc(c.id)}"${blocked ? ' disabled' : ''}>`
      + `${c.kind === 'toggle' ? (c.on === true ? 'Turn off' : 'Turn on') : 'Do it'}`
      + '</button></div>';
  }).join('');
  return '<div class="of-pgrp cheats"><h4>Testing</h4>' + rows + '</div>';
}

function armed(c: CheatRow, sentence: string): string {
  return `<div class="row cheat danger armed" data-cheat-row="${esc(c.id)}">`
    + `<span class="nm">${esc(c.label)}</span>`
    + `<span class="why warn">${esc(sentence)}</span>`
    + `<span class="pair">`
    + `<button type="button" class="go" data-cheat="${esc(c.id)}:confirm">`
    + 'Yes, destroy it</button>'
    + `<button type="button" data-cheat="${esc(c.id)}:cancel">Cancel</button>`
    + '</span></div>';
}
