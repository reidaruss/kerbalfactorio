// The VAB: the assembly screen, where the numbers are the point.
//
// DW-2 holds here as everywhere under src/ui: plain DOM, zero three.js, plain
// data in and callbacks out. The rocket itself is drawn on the canvas UNDERNEATH
// this panel, which is why the root spans the viewport but takes NO pointer
// events: only the two rails and the bottom bar do, and the middle of the screen
// stays a clear gap the player can grab to orbit the camera. A panel that ate
// that drag would make the 3D half unusable, so the gap is a layout requirement
// and not a style preference (vab.css caps the rail widths to hold it).
//
// DW-30 item 4: per-stage delta-v is always visible. So the readouts are the
// loudest thing on the screen and every stage row carries its own delta-v, TWR,
// burn time, thrust and engine count. A stage with no delta-v reads as a FAULT
// in the warning colour rather than as an empty cell, because "0 m/s" is the
// most useful thing this screen can tell somebody whose rocket will not fly.
//
// render() is called on every frame the design changes, and possibly on every
// frame full stop, so it diffs four cheap string keys (catalogue, readouts plus
// stages, bottom bar, message) and rebuilds only the regions that actually
// moved. invalidate() drops all four.

import './styles/vab.css';
import { esc } from './GameHud.js';
import {
  SKELETON, TAB_LABEL, chip, fix, groupsOf, partRow, readouts, stageRow,
  verdictBand,
} from './VabPanelHtml.js';
import type {
  VabPartRow, VabStageRow, VabStats, VabVerdict,
} from './VabPanelTypes.js';

import { Modal, type ModalStack } from './ModalStack.js';

// Re-exported so every existing caller keeps importing these from `VabPanel`:
// the split is a line-count fix, not an interface change.
export type { VabPartRow, VabStageRow, VabStats, VabVerdict };

export interface VabPanelHooks {
  pick(index: number): void;
  stageUp(index: number): void;
  stageDown(index: number): void;
  autostage(): void;
  clear(): void;
  save(name: string): void;
  load(name: string): void;
  remove(name: string): void;
  symmetry(n: number): void;
  /** GP-54. Leave the bay and put the rocket on the ground in front of you.
   *  The same thing the launch key does, because a key nobody can see is not a
   *  way in: Reid built a rocket and had to ask how to fly it. */
  rollOut(): void;
  /** GP-121 / R11. Clear the pad from inside the bay. */
  recover(): void;
  exit(): void;
}

export class VabPanel extends Modal {
  private readonly el: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly partsEl: HTMLElement;
  private readonly readEl: HTMLElement;
  private readonly stagesEl: HTMLElement;
  private readonly symEl: HTMLElement;
  private readonly designsEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly input: HTMLInputElement;
  private opened = false;
  /**
   * GP-120. WHICH TAB IS SHOWING. Reid: "the menu on the left should be tabbed
   * for different component types like kerbal, i shouldnt have to horizontal
   * scroll to see stuff." It lives here rather than in `Vab.ts` because which
   * page of a list you are looking at is a property of the list, not of the
   * design: switching tabs must not touch the model, must not autosave and must
   * not re-derive a stage table. Empty means "not chosen yet", which resolves to
   * the first group present, so a mode that offers fewer groups still opens on
   * something real (GP-35 offers 13 parts in survival and 24 in sandbox).
   */
  private tab = '';
  /** The last rows handed to render(), so a tab press can repaint without one. */
  private parts: readonly VabPartRow[] = [];
  /** [catalogue, readouts + stages, bottom bar, message]. */
  private last = ['', '', '', ''];
  /**
   * GP-143. THE TWO SENTENCES THAT SHARE ONE LINE. `msg` is an EVENT ("placed
   * Main Engine"), written by `Vab.after` and cleared by its own three second
   * clock; `aim` is a STATE, what the bay would do if the button went down now,
   * rewritten on every pointer move and never on a clock. One element, because
   * a second line is a second place a player has to learn to look. The reason
   * the AIM wins, and the reason an event CLEARS it rather than covering it,
   * are both in `VabAim.ts` beside the sentence itself.
   */
  private msg = '';
  private aim = '';

  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly hooks: VabPanelHooks) {
    super('vab', stack);
    this.el = document.createElement('div');
    this.el.id = 'of-vab';
    this.el.className = 'of-ui';
    this.el.innerHTML = SKELETON;
    parent.appendChild(this.el);
    this.tabsEl = this.pick('.of-vtabs');
    this.partsEl = this.pick('.of-vparts');
    this.readEl = this.pick('.of-vread');
    this.stagesEl = this.pick('.of-vstages');
    this.symEl = this.pick('.sym');
    this.designsEl = this.pick('.designs');
    this.msgEl = this.pick('.of-vmsg');
    this.input = this.pick('#of-vab-name') as HTMLInputElement;
    // ONE delegated listener, never one per row: the catalogue and the stage
    // list are rebuilt whenever the design moves, and per-row listeners would
    // be rebuilt (and leaked) with them.
    this.el.addEventListener('click', (e) => { this.onClick(e); });
    // The name field types letters, and the game binds letters. Keep the keys
    // that land in this input out of the world's key handler.
    for (const t of ['keydown', 'keyup', 'keypress']) {
      this.input.addEventListener(t, (e) => { e.stopPropagation(); });
    }
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.hooks.save(this.input.value.trim());
    });
  }

  private pick(sel: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(sel) as HTMLElement;
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-vab]');
    if (t === null || t === undefined) return;
    if (t instanceof HTMLButtonElement && t.disabled) return;
    const i = Number(t.getAttribute('data-index'));
    const name = t.getAttribute('data-name') ?? '';
    switch (t.getAttribute('data-vab')) {
      case 'part': if (Number.isFinite(i)) this.hooks.pick(i); break;
      case 'stage-up': if (Number.isFinite(i)) this.hooks.stageUp(i); break;
      case 'stage-down': if (Number.isFinite(i)) this.hooks.stageDown(i); break;
      case 'autostage': this.hooks.autostage(); break;
      case 'clear': this.hooks.clear(); break;
      case 'save': this.hooks.save(this.input.value.trim()); break;
      case 'design': this.hooks.load(name); break;
      case 'design-del': this.hooks.remove(name); break;
      case 'rollout': this.hooks.rollOut(); break;
      case 'recover': this.hooks.recover(); break;
      case 'exit': this.hooks.exit(); break;
      // A tab press repaints the catalogue HERE and does not call back into the
      // caller: which page of a list you are on is not a change to the design,
      // and routing it through `Vab.after` would autosave the vessel every time
      // somebody browsed the engine tab.
      case 'tab': {
        const g = t.getAttribute('data-group') ?? '';
        if (g !== '' && g !== this.tab) { this.tab = g; this.paintCatalogue(); }
        break;
      }
      case 'sym': {
        const n = Number(t.getAttribute('data-n'));
        if (Number.isFinite(n)) this.hooks.symmetry(n);
        break;
      }
      default: break;
    }
  }

  get isOpen(): boolean { return this.opened; }

  setOpen(v: boolean): void {
    if (this.opened === v) return;
    this.opened = v;
    this.el.classList.toggle('open', v);
    this.invalidate();
  }

  /** Force the next render to rebuild, ignoring the diff keys. */
  invalidate(): void { this.last = ['', '', '', '']; }

  // --- the driven surface -------------------------------------------------
  // Every accessor is a querySelector over a stable data- attribute, so a probe
  // can dispatch a real PointerEvent at the element a player actually presses
  // rather than at a function only the probe can reach.

  get root(): HTMLElement { return this.el; }

  partButton(index: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="part"][data-index="${index}"]`);
  }

  /**
   * GP-120. The button for a part, SWITCHING TABS to it if that is where it
   * lives. With one tab painted at a time the other groups are genuinely not in
   * the DOM, so `partButton` alone answers null for two thirds of the catalogue,
   * and a caller that treated null as "not offered" would be wrong about a part
   * that is one press away. This is the two presses a player makes, in order.
   */
  revealPart(index: number): HTMLElement | null {
    const hit = this.partButton(index);
    if (hit !== null) return hit;
    const row = this.parts.find((p) => p.index === index);
    if (row === undefined) return null;
    if (row.group !== this.tab) { this.tab = row.group; this.paintCatalogue(); }
    return this.partButton(index);
  }

  stageUpButton(index: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="stage-up"][data-index="${index}"]`);
  }

  stageDownButton(index: number): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="stage-down"][data-index="${index}"]`);
  }

  get exitButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="exit"]');
  }

  get autostageButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="autostage"]');
  }

  get saveButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="save"]');
  }

  get nameInput(): HTMLInputElement | null {
    return this.el.querySelector<HTMLInputElement>('#of-vab-name');
  }

  /**
   * Redraw. Four keys, four regions, and a closed panel costs four compares.
   *
   * The catalogue key carries index, selection and affordability only: the rows
   * themselves are a static catalogue and what moves frame to frame is which
   * one is in hand and which ones the pack can pay for. A caller that swaps the
   * catalogue out from under the panel calls invalidate().
   */
  render(parts: readonly VabPartRow[], stages: readonly VabStageRow[],
         stats: VabStats, designs: readonly string[], symmetry: number,
         message: string, verdict: VabVerdict): void {
    if (!this.opened) return;
    this.parts = parts;
    const kParts = `${this.tab}|` + parts.map((p) => `${p.index}${p.selected ? '*' : ''}`
      + `${p.affordable ? '' : '!'}`).join(',');
    const kRead = `${fix(stats.totalDeltaV, 0)}/${fix(stats.massKg, 0)}/`
      + `${fix(stats.dryKg, 0)}/${fix(stats.propellantKg, 0)}/${stats.parts}/`
      + `${fix(stats.lengthM, 2)}/${fix(stats.padTwr, 2)}/`
      + `${fix(stats.staticMarginM, 2)}/${stats.stable ? 1 : 0}/${stats.crew}|`
      + stages.map((s) => `${s.index}:${fix(s.deltaV, 0)}:${fix(s.twr, 2)}:`
        + `${fix(s.burnS, 1)}:${fix(s.thrustKN, 1)}:${s.engines}:${s.decouplers}:`
        + `${s.partCount}:${s.lifts ? 1 : 0}${s.fault ? 'F' : ''}`)
        .join(',')
      + `|${verdict.ok ? 'ok' : 'bad'}|${verdict.summary}`;
    const kBar = `${symmetry}|${designs.join(',')}`;
    // GP-143: the early-out compares the EVENT against `this.msg`, not against
    // `last[3]`. `last[3]` is now the line as drawn, which may be the aim state
    // rather than the event, so comparing an event to it would let a genuine
    // message change fall through the guard and never be painted.
    if (kParts === this.last[0] && kRead === this.last[1]
      && kBar === this.last[2] && message === this.msg) return;
    if (kParts !== this.last[0]) this.paintCatalogue();
    if (kRead !== this.last[1]) {
      this.last[1] = kRead;
      this.readEl.innerHTML = verdictBand(verdict) + readouts(stats, verdict);
      this.stagesEl.innerHTML = stages.length === 0
        ? '<div class="none">No stages yet. Place a part to start a design.</div>'
        : stages.map((s, i) => stageRow(s, i === 0, i === stages.length - 1)).join('');
    }
    if (kBar !== this.last[2]) {
      this.last[2] = kBar;
      this.symEl.innerHTML = '<em>Symmetry</em>' + [1, 2, 3, 4].map((n) =>
        `<button type="button" class="sq${n === symmetry ? ' on' : ''}" `
        + `data-vab="sym" data-n="${n}">${n}</button>`).join('');
      this.designsEl.innerHTML = '<em>Saved</em>' + (designs.length === 0
        ? '<span class="none">none yet</span>'
        : designs.map(chip).join(''));
    }
    this.msg = message;
    // An EVENT invalidates the aim, because the aim described a hover over the
    // model as it was BEFORE the event: the face it named may not exist any
    // more. The next pointer move recomputes it. Only a non-empty message
    // clears it, so the message's own three second clock expiring leaves the
    // aim standing rather than blanking a line the player is reading.
    if (message !== '') this.aim = '';
    this.paintLine();
  }

  /**
   * GP-143. Set on every pointer move from `VabAim`. It repaints immediately
   * rather than waiting for a `render()`, because a hover changes no model and
   * must not trigger one: a render re-derives the catalogue rows, the stage
   * table and the verdict, and `Vab.after` additionally autosaves the design.
   */
  setAim(text: string): void {
    if (text === this.aim) return;
    this.aim = text;
    this.paintLine();
  }

  /** The line as DRAWN, so a probe asserts against the screen (GP-64). */
  get messageText(): string { return this.msgEl.textContent ?? ''; }

  private paintLine(): void {
    // The AIM wins while it exists. It is the only one of the two that
    // describes the present, and the event that could have hidden it has
    // already cleared it above, so this is not a race between them.
    const line = this.aim !== '' ? this.aim : this.msg;
    if (line === this.last[3]) return;
    this.last[3] = line;
    // textContent, not innerHTML: the line is somebody else's string and it is
    // the one field on this screen that carries arbitrary text.
    this.msgEl.textContent = line;
    this.msgEl.classList.toggle('on', line !== '');
  }

  /**
   * GP-120. Paint the tab strip and the ONE group it selects.
   *
   * Called both from `render` (the design moved) and directly from a tab press
   * (only the view moved), which is why the diff key it writes is set here and
   * not at the call site: two callers writing the same key from two places is
   * how a region stops repainting.
   */
  private paintCatalogue(): void {
    const groups = groupsOf(this.parts);
    if (groups.length > 0 && !groups.includes(this.tab)) this.tab = groups[0] as string;
    this.tabsEl.innerHTML = groups.map((g) => {
      const n = this.parts.filter((p) => p.group === g).length;
      return `<button type="button" class="of-vtab${g === this.tab ? ' on' : ''}" `
        + `data-vab="tab" data-group="${esc(g)}" `
        + `aria-pressed="${g === this.tab ? 'true' : 'false'}" `
        + `title="${esc(g)}">${esc(TAB_LABEL[g] ?? g)}<span>${n}</span></button>`;
    }).join('');
    const shown = this.parts.filter((p) => p.group === this.tab);
    this.partsEl.innerHTML = shown.length === 0
      ? '<div class="none">No parts available.</div>'
      : shown.map(partRow).join('');
    this.last[0] = `${this.tab}|` + this.parts.map((p) =>
      `${p.index}${p.selected ? '*' : ''}${p.affordable ? '' : '!'}`).join(',');
  }

  /** The tab currently showing, for a probe. */
  get activeTab(): string { return this.tab; }

  /**
   * GP-120. The tab strip AS PAINTED, plus the one measurement that is the
   * actual complaint: `scrollWidth` against `clientWidth` on the list element.
   * Reid asked for tabs and reported horizontal scrolling, and those are two
   * different defects; a probe that only counted tabs would go green while the
   * sideways scrollbar he was complaining about was still there.
   */
  tabReport(): unknown {
    const tabs = [...this.el.querySelectorAll<HTMLElement>('[data-vab="tab"]')]
      .map((t) => t.getAttribute('data-group') ?? '');
    const rows = this.partsEl.querySelectorAll('[data-vab="part"]').length;
    const widest = [...this.partsEl.querySelectorAll<HTMLElement>('[data-vab="part"]')]
      .reduce((m, r) => Math.max(m, r.scrollWidth), 0);
    const bar = this.el.querySelector<HTMLElement>('.of-vbar');
    return {
      tabs,
      active: this.tab,
      rowsShown: rows,
      rowsTotal: this.parts.length,
      listScrollWidth: this.partsEl.scrollWidth,
      listClientWidth: this.partsEl.clientWidth,
      overflowPx: this.partsEl.scrollWidth - this.partsEl.clientWidth,
      // The axis that ACTUALLY moved. Measured after the fact: the rail never
      // could scroll sideways at any window width this project supports, and a
      // 24-row column in a 330 px rail overflowed it VERTICALLY by hundreds of
      // pixels. Both are published so the claim cannot quietly become the other.
      listScrollHeight: this.partsEl.scrollHeight,
      listClientHeight: this.partsEl.clientHeight,
      scrollPx: this.partsEl.scrollHeight - this.partsEl.clientHeight,
      widestRowPx: widest,
      railClientWidth: (this.el.querySelector<HTMLElement>('.rail.left'))?.clientWidth ?? 0,
      barOverflowPx: bar === null ? 0 : bar.scrollWidth - bar.clientWidth,
    };
  }

  /** Every tab button, so a probe presses what a player presses. */
  tabButton(group: string): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-vab="tab"][data-group="${group}"]`);
  }

  get rollOutButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="rollout"]');
  }

  get recoverButton(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>('[data-vab="recover"]');
  }

  /** The verdict as PAINTED, read back off the element. An assertion against
   *  this is an assertion about the screen and not about the model. */
  get verdictText(): string {
    return this.el.querySelector<HTMLElement>('.of-vverdict')?.textContent ?? '';
  }

  get verdictIsFault(): boolean {
    return this.el.querySelector<HTMLElement>('.of-vverdict.bad') !== null;
  }
}
