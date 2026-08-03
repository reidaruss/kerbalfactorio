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
import { Modal, type ModalStack } from './ModalStack.js';
import type { ControlGroup } from '../player/BindingText.js';
import type { VideoRow } from '../app/VideoSettings.js';
import type { AudioView } from '../app/AudioSettings.js';
import type { SaveListView } from '../game/SaveSlots.js';
import { codesFor } from '../player/Bindings.js';
import { audio, controls, saves, video } from './OptionPagesHtml.js';
// GP-235. The root page's HTML, lifted whole so this file stays under its cap.
import { rootPage } from './PauseRootHtml.js';

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
  /** GP-137. This mode's saves, the name being typed, and the armed delete. */
  saves: SaveListView;
  mode: string;
  /** The IndexedDB key this world lives under. Named on screen because the one
   *  destructive control in here destroys exactly it. */
  slotKey: string;
  /** GP-102. Empty when nothing has marked the save. */
  assisted: string;
  cheats: CheatRow[];
  /** GP-167. The Visit-site group: the seven surveyed spawn candidates. */
  visits: CheatRow[];
  /** GP-233. The In-orbit group: the walkable station, or one blocked row
   *  saying why there is not one. A SEPARATE array and not an eighth visit,
   *  because the seven above are a spawn-pick comparison and this is not a
   *  spawn: see app/VisitSites.ts for the argument. */
  station: CheatRow[];
  /** GP-500. The Another-world group: one row per body, the one you are
   *  standing on blocked by name. Its own array for GP-233's reason a third
   *  time -- a body is a different KIND of destination from a spawn candidate
   *  and from an orbit, and it is the only one whose door is a page reload.
   *  See app/VisitWorlds.ts. */
  worlds: CheatRow[];
  /** Set while Start Fresh is armed: the whole sentence the confirm shows. */
  confirm: string;
}

/** GP-152 to GP-154. Everything focusable a player can reach in here. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

export class PauseMenu extends Modal {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private open = false;
  private last = '';
  /**
   * GP-152. THE DEFECT THIS FIELD EXISTS FOR, because it is not obvious from
   * the code that anything is wrong.
   *
   * `render` replaces `body.innerHTML` wholesale, which DESTROYS the element
   * that has keyboard focus, and the browser then puts focus on `document.body`
   * with nothing on screen to say it moved. Driven and discriminated: focus
   * held by a button SURVIVES ten ticks with no key pressed and survives the
   * keydown synchronously, and is on `BODY` two ticks later with
   * `document.contains(button) === false`. So it is not the key blurring it and
   * not a focus that never took: it is this rebuild.
   *
   * That made keyboard navigation impossible before it was designed. Tab to a
   * row, press anything at all, and the row you were on no longer exists.
   *
   * The id is the row's `data-cheat`, which is stable across a rebuild in a way
   * a node reference and an index both are not: the list can gain or lose rows
   * (a blocked cheat, an armed confirm) and the row a player was on keeps its
   * identity through that.
   */
  private focusId = '';
  /** Set when the menu opens or changes page, so focus lands somewhere. */
  private needsFocus = false;
  /** The page the last render drew, so a page CHANGE is distinguishable from a
   *  rebuild of the same page. They want opposite focus behaviour. */
  private lastPage = '';

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
      if (el === null) return;
      // ONLY THE SLIDER. The save-name box is deliberately NOT reported as it
      // is typed: `onPress` invalidates the panel, and rebuilding the page on
      // every keystroke erased the box the player was typing in. A text input
      // holds its own value and hands it over on the press (GP-137).
      if (el.getAttribute('data-audio') === 'volume') {
        this.onPress(`audio:vol:${el.value}`);
      }
    });
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (b === null || b === undefined || b.disabled) return;
      const id = b.getAttribute('data-cheat');
      if (id === null || id === '') return;
      // GP-137. `save:new` carries the typed name with it, because the panel
      // owns its own input and `OptionsPages` owns the rule about names; the id
      // is the seam between them and nothing has to reach across it.
      if (id === 'save:new') {
        const box = this.root.querySelector<HTMLInputElement>('input[data-save="name"]');
        this.onPress(`save:new:${box?.value ?? ''}`);
        if (box !== null) box.value = '';
        return;
      }
      this.onPress(id);
    });
    // GP-154. On `window`, in the capture phase, because the game's own input
    // layer also listens on window and a menu key must not reach it. The
    // listener is never removed: this panel is a singleton for the session and
    // it gates itself on `this.open`.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
    // GP-153. Opening ARMS the focus rather than taking it here: there is
    // nothing to focus yet, because the rows are built by the `render` that
    // follows. Closing clears it, or the next open would try to restore a row
    // from the page before last.
    this.needsFocus = v;
    if (!v) this.focusId = '';
  }

  // --- GP-152 to GP-154, keyboard --------------------------------------------

  /** The rows a player can land on, in the order they are drawn. */
  private rows(): HTMLElement[] {
    return [...this.body.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }

  /** Remember what has focus, so `render` can put it back after the rebuild. */
  private rememberFocus(): void {
    const el = document.activeElement;
    if (el === null || !this.body.contains(el)) return;
    this.focusId = el.getAttribute('data-cheat')
      ?? el.getAttribute('data-save') ?? '';
  }

  /**
   * Put focus back where it was, or somewhere sensible if that row is gone.
   *
   * Falling back to the FIRST row rather than to nothing is the whole point:
   * "the row you were on has gone" and "the keyboard does nothing" look
   * identical to a player, and one of them is recoverable without a mouse.
   */
  private restoreFocus(): void {
    const rows = this.rows();
    if (rows.length === 0) { this.needsFocus = false; return; }
    const want = this.focusId === '' ? null
      : rows.find((e) => e.getAttribute('data-cheat') === this.focusId
                      || e.getAttribute('data-save') === this.focusId) ?? null;
    if (want !== null) { want.focus(); return; }
    // Nothing to restore. Only TAKE focus when the menu has just opened or
    // changed page: stealing it on every incidental rebuild would fight a
    // player who is typing in the save-name box.
    if (!this.needsFocus) return;
    this.needsFocus = false;
    rows[0]?.focus();
    this.rememberFocus();
  }

  /**
   * GP-154. One window listener, and it only acts while the menu is open.
   *
   * The codes come from `BINDINGS` through `codesFor`, never as literals, so
   * this cannot disagree with the controls screen that claims to list every
   * control the game listens to. That is not hypothetical tidiness: two key
   * prettifiers disagreed for weeks (GP-140) purely because they were never on
   * screen together.
   */
  private onKey(e: KeyboardEvent): void {
    if (!this.open) return;
    const rows = this.rows();
    if (rows.length === 0) return;
    const here = rows.indexOf(document.activeElement as HTMLElement);
    const step = (d: number): void => {
      e.preventDefault();
      // WRAPS. A list you can walk off the end of is a list that needs a mouse
      // to get back to the top of.
      const next = here < 0 ? (d > 0 ? 0 : rows.length - 1)
        : (here + d + rows.length) % rows.length;
      rows[next]?.focus();
      this.rememberFocus();
    };
    if (codesFor('menuDown').includes(e.code)) { step(1); return; }
    if (codesFor('menuUp').includes(e.code)) { step(-1); return; }
    if (codesFor('menuSelect').includes(e.code)) {
      const el = rows[here < 0 ? 0 : here];
      if (el === undefined) return;
      // preventDefault BEFORE the click, or a real keyboard fires the browser's
      // own activation as well and the row is pressed twice. A synthetic event
      // never would, so this is the half a probe cannot see.
      e.preventDefault();
      el.click();
    }
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  /** Rebuild, diffed on one key so an open menu nothing has moved is free. */
  render(view: PauseView): void {
    if (!this.open) return;
    const a = view.audio;
    const sv = view.saves;
    // GP-137: THE SAVE LIST IS IN THE KEY, and its absence was a real defect
    // rather than an omission: the page would have drawn once and then never
    // again, so a save would land in the store and never appear on the screen
    // that exists to show it. `note` and `busy` are in it too, because a
    // refusal that does not redraw is a button that did nothing.
    const key = `${view.page}|${view.mode}|${view.slotKey}|${view.assisted}|`
      + `${view.confirm}|${a.volume}|${a.muted ? 1 : 0}|${a.state}|`
      + `${a.silentBecause}|${sv.busy}|${sv.note}|${sv.confirmDelete}|`
      + sv.rows.map((r) => `${r.name}:${r.savedAt}`).join(',') + '|'
      // GP-233: the station rows are IN THE KEY, for the reason the save list
      // had to be. Its blocked sentence changes when the player boards, and a
      // group left out of the diff would keep drawing an enabled button for a
      // press that now refuses.
      // GP-500: the world rows are in the key on the same argument. Their
      // blocked sentence changes the moment the player boards, and one of the
      // two changes meaning entirely when the body does.
      + [...view.cheats, ...view.visits, ...view.station, ...view.worlds]
        .map((c) => `${c.id}:${c.on === true ? 1 : 0}:${c.blocked ?? ''}`)
        .join(',');
    if (key === this.last) return;
    // GP-152. The page identity is part of the focus decision, not just of the
    // diff: a page CHANGE must land focus on the new page's first row, and a
    // rebuild of the same page must put it back where it was.
    const pageMoved = this.lastPage !== view.page;
    this.lastPage = view.page;
    if (pageMoved) { this.needsFocus = true; this.focusId = ''; }
    else this.rememberFocus();
    this.last = key;
    this.body.innerHTML = view.page === 'controls' ? controls(view.controls)
      : view.page === 'video' ? video(view.video)
        : view.page === 'audio' ? audio(view.audio)
          : view.page === 'save' ? saves(view.saves)
            : rootPage(view);
    this.restoreFocus();
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
