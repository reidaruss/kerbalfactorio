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
import type { ControlGroup } from '../player/BindingText.js';
import type { VideoRow } from '../app/VideoSettings.js';
import type { AudioView } from '../app/AudioSettings.js';

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
  /** GP-131. Which page is showing: '' is the root, 'controls' is the binding
   *  table. A PAGE and not a second modal, deliberately: Escape must keep
   *  meaning one thing, and a nested modal would make the first press close a
   *  sub-screen while the player expects it to close the menu. Back is a button;
   *  Escape always shuts the whole thing. */
  page: string;
  controls: ControlGroup[];
  /** GP-132. The video knobs this session is actually running at. Read only:
   *  see app/VideoSettings.ts for why the wiring is a separate, cross-lane job. */
  video: VideoRow[];
  /** GP-134. The audio page, and the only options page that WRITES. */
  audio: AudioView;
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
const STUBS: readonly { name: string; waiting: string; page: string }[] = [
  { name: 'Save Game', page: '',
    waiting: 'not yet: the world autosaves every 20 seconds to the slot named '
      + 'above. Named slots, manual saves and a load list come with the save '
      + 'system.' },
  // GP-131. THE FIRST STUB TO BECOME REAL, and it stays in this list rather
  // than being promoted out of it, because the shape the shell reserved is the
  // shape it turned out to want: a named section with a page behind it.
  { name: 'Options / Controls', page: 'controls',
    waiting: 'every control the game listens to, read live from the one binding '
      + 'table. Rebinding is not built yet.' },
  // GP-132. READ ONLY. Every knob already exists as a URL flag and is read once
  // at boot by files another lane owns; showing what this session is running at
  // is worth having on its own and needs no renderer contact whatsoever.
  { name: 'Options / Video', page: 'video',
    waiting: 'what this session is running at, read live from the parsed '
      + 'config. Changing them from here is not built yet.' },
  // GP-134. The only options page that WRITES, because `AudioBus` already has
  // live persisted setters and nothing else is editing web/src/audio/ this
  // round. It also diagnoses a silent game, which nothing anywhere could do.
  { name: 'Options / Audio', page: 'audio',
    waiting: 'master volume, mute, and why the game might be silent.' },
  { name: 'Multiplayer', page: '',
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
    // THE SLIDER NEEDS ITS OWN LISTENER, because `input` does not bubble as a
    // click and a range control that only reported on mouse-up would feel dead
    // while dragging. Same delegation, second event, one extra line.
    this.body.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement | null;
      if (el === null || el.getAttribute('data-audio') !== 'volume') return;
      this.onPress(`audio:vol:${el.value}`);
    });
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
    const a = view.audio;
    const key = `${view.page}|${view.mode}|${view.slotKey}|${view.assisted}|`
      + `${view.confirm}|${a.volume}|${a.muted ? 1 : 0}|${a.state}|`
      + `${a.silentBecause}|`
      + view.cheats.map((c) => `${c.id}:${c.on === true ? 1 : 0}:${c.blocked ?? ''}`)
        .join(',');
    if (key === this.last) return;
    this.last = key;
    this.body.innerHTML = view.page === 'controls' ? controls(view.controls)
      : view.page === 'video' ? video(view.video)
        : view.page === 'audio' ? audio(view.audio)
          : header(view) + stubs() + testing(view);
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
  return '<div class="of-pgrp stubs"><h4>Options</h4>'
    + STUBS.map((s) => `<div class="row stub${s.page === '' ? '' : ' live'}" `
      + `data-stub="${esc(s.name)}">`
      + `<span class="nm">${esc(s.name)}</span>`
      + `<span class="why">${esc(s.waiting)}</span>`
      + (s.page === '' ? ''
        : `<button type="button" data-cheat="page:${esc(s.page)}">Open</button>`)
      + '</div>').join('')
    + '</div>';
}

/**
 * GP-131. THE CONTROLS SCREEN: every action the game listens to, with the key
 * it is actually on.
 *
 * Nothing here is written down. The rows are DERIVED from `BINDINGS` by
 * `controlGroups()` on every render, so this screen cannot state a key the game
 * does not listen to, which is the whole reason it was worth building before
 * rebinding. A shared code is called out rather than drawn twice and hoped over.
 */
function controls(groups: ControlGroup[]): string {
  const n = groups.reduce((a, g) => a + g.rows.length, 0);
  return '<div class="of-pgrp ctl"><h4>Controls'
    + `<button type="button" class="back" data-cheat="page:">Back</button></h4>`
    + `<div class="row note"><span class="why">All ${n} controls, read from the `
    + 'one binding table the game itself asks. Rebinding is not built yet; when '
    + 'it is, it will edit this table and nothing else.</span></div>'
    + groups.map((g) => `<div class="ctlg" data-group="${esc(g.name)}">`
      + `<h5>${esc(g.name)}</h5>`
      + g.rows.map((r) => `<div class="ctlr" data-action="${esc(r.action)}">`
        + `<span class="nm">${esc(r.label)}</span>`
        + `<span class="keys">${r.keys.map((k) =>
          `<kbd>${esc(k)}</kbd>`).join(' ')}</span>`
        + (r.sharedWith.length === 0 ? ''
          : `<span class="share">also ${esc(r.sharedWith.join(', '))}</span>`)
        + '</div>').join('') + '</div>').join('')
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

/**
 * GP-132. THE VIDEO SCREEN: what this session is actually running at.
 *
 * Every value is read off the parsed `Config` the renderer was handed at boot,
 * not off a default table, because the number worth comparing across two
 * machines is the number each of them RAN. `applyBy` is shown per row rather
 * than as a blanket footnote: three of these are baked into an allocation or a
 * shader path at boot, and a screen that offered a live slider for a
 * preallocated chunk pool would be lying about what it could do.
 */
function video(rows: VideoRow[]): string {
  const groups: string[] = [];
  for (const r of rows) if (!groups.includes(r.group)) groups.push(r.group);
  return '<div class="of-pgrp ctl"><h4>Video'
    + '<button type="button" class="back" data-cheat="page:">Back</button></h4>'
    + `<div class="row note"><span class="why">Read only for now. Every one of `
    + 'these is a URL flag the game already accepts, so you can benchmark by '
    + 'adding it to the address bar today; a control here needs the renderer to '
    + 'either take the value live or reload, which is a cross-lane call.'
    + '</span></div>'
    + groups.map((gname) => `<div class="ctlg" data-group="${esc(gname)}">`
      + `<h5>${esc(gname)}</h5>`
      + rows.filter((r) => r.group === gname).map((r) =>
        `<div class="ctlr" data-flag="${esc(r.flag)}" data-apply="${r.applyBy}">`
        + `<span class="nm">${esc(r.label)}</span>`
        + `<span class="keys"><kbd>${esc(r.value)}</kbd></span>`
        + `<span class="share">?${esc(r.flag)}= ${esc(r.options)}`
        + `${r.applyBy === 'reload' ? ' (needs a reload)' : ''}</span>`
        + '</div>').join('') + '</div>').join('')
    + '</div>';
}

/**
 * GP-134. THE AUDIO SCREEN, and the only options page with working controls.
 *
 * THE DIAGNOSIS IS FIRST, above the controls, because it is the reason to open
 * this page at all: `AudioBus`'s own header says every browser blocks audio
 * until a gesture and that "the game would be mute for exactly the players who
 * never noticed why". `silentBecause` names ONE reason out of the four that can
 * gate sound, in the order they actually gate, and the page offers the button
 * that fixes the commonest of them. When there is nothing wrong it says so
 * rather than showing an empty box, because a blank diagnostic and a broken one
 * look identical.
 *
 * The counters are shown next to it deliberately: "412 sounds asked for, none
 * of them audible" is a completely different fault from "nothing has tried to
 * make a sound", and one number tells them apart.
 */
function audio(a: AudioView): string {
  const pct = Math.round(a.volume * 100);
  const diag = a.silentBecause === ''
    ? '<div class="row note ok"><span class="nm">Sound is on</span>'
      + `<span class="why">volume ${pct}%, context ${esc(a.state)}</span></div>`
    : '<div class="row note warn"><span class="nm">You will hear nothing</span>'
      + `<span class="why">${esc(a.silentBecause)}</span>`
      + (a.unlocked || !a.supported ? ''
        : '<button type="button" data-cheat="audio:unlock">Start audio</button>')
      + '</div>';
  return '<div class="of-pgrp ctl aud"><h4>Audio'
    + '<button type="button" class="back" data-cheat="page:">Back</button></h4>'
    + diag
    + '<div class="ctlg"><h5>Master</h5>'
    + '<div class="ctlr vol"><span class="nm">Volume</span>'
    + `<input type="range" min="0" max="100" step="1" value="${pct}" `
    + 'data-audio="volume" aria-label="master volume">'
    + `<span class="keys"><kbd data-vol="${pct}">${pct}%</kbd></span></div>`
    + `<div class="ctlr"><span class="nm">Mute</span>`
    + `<span class="keys"><kbd>${esc(a.muteKey)}</kbd></span>`
    + `<button type="button" data-cheat="audio:mute">`
    + `${a.muted ? 'Unmute' : 'Mute'}</button></div>`
    + '</div>'
    + '<div class="ctlg"><h5>What has played</h5>'
    + `<div class="ctlr"><span class="nm">One-shots since boot</span>`
    + `<span class="keys"><kbd>${a.plays}</kbd></span></div>`
    + `<div class="ctlr"><span class="nm">Running loops</span>`
    + `<span class="keys"><kbd>${a.loops}</kbd></span></div>`
    + `<div class="ctlr"><span class="nm">Time spent building voices</span>`
    + `<span class="keys"><kbd>${a.cpuMs} ms</kbd></span></div>`
    + '</div>'
    + '<div class="ctlg"><h5>Buses</h5>'
    + a.buses.map((b) => `<div class="ctlr" data-bus="${esc(b.name)}">`
      + `<span class="nm">${esc(b.name)}</span>`
      + `<span class="share">${esc(b.note)}</span></div>`).join('')
    + '</div></div>';
}
