// The always-on game HUD: crosshair, what you are aiming at, what you are
// carrying, and the grant toast.
//
// DW-2: HTML and CSS, not canvas. It imports zero three.js (scripts/check-limits
// enforces that mechanically) and takes only plain data, so it can be rendered
// from a test with no renderer at all. Text also means a screenshot carries its
// own evidence: "+5 Wood" in a PNG is a proof, a particle is an impression.
//
// It re-renders only when its inputs CHANGE. A HUD that rewrites innerHTML every
// frame is a layout pass every frame, and this one sits over a streaming game
// loop, so the diff is the whole point.

import './styles/game.css';
import { CompassStrip, type CompassReadout } from './CompassHud.js';
export type { CompassChip, CompassReadout } from './CompassHud.js';

export interface HudTarget {
  name: string;
  /** remaining / initial, for the depletion bar. */
  fraction: number;
  empty: boolean;
  distanceM: number;
  /** A second line of available verbs, e.g. "X remove". Optional. */
  action?: string;
  /** What the "use" button is CALLED, handed in rather than typed here, so the
   *  chip cannot go on saying E after the binding table has moved on. */
  verb?: string;
}

export interface HudCarry { name: string; count: number; icon?: string }

export class GameHud {
  private readonly cross: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly carry: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly gainEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  /** GP-700. The on-foot compass strip (ui/CompassHud.ts). Hidden with
   *  `cross`/`carry` in `setVisible`, not with `health`/`mode`: unlike those
   *  two, a bearing to a marker on THIS body means nothing while flying or
   *  inside the map's own 3D scene, so it hides on exactly the two facts
   *  `setWorldUi` already gates the crosshair on (FlightMode's `aboard`,
   *  MapMode's `open`) rather than a third mode check invented here. */
  private readonly compass: CompassStrip;
  /** DW-31: the mode badge. Never hidden by `setVisible`; see the constructor. */
  private readonly mode: HTMLElement;
  /** GP-79: the player's own health. NOT hidden by `setVisible`, for the same
   *  reason the sandbox badge is not: the one moment you most need to know you
   *  are on 12 health is while a panel is open in front of you. */
  private readonly health: HTMLElement;
  private lastHealth = '';
  private lastPrompt = '';
  /**
   * GP-166. NOT the empty string: an empty pack's diff key IS '', so an
   * initial '' meant the first render never happened and a fresh spawn showed
   * a styled, wordless rectangle where the pack summary belongs, until the
   * first pickup. Found as an unidentified empty box in a spawn screenshot;
   * `document.elementsFromPoint` did not even return the element, because
   * nothing had ever written its contents. The sentinel cannot collide with a
   * real key, so the "empty" state (which is what names the pack key for a
   * brand-new player) is drawn on the first frame like every other state.
   *
   * GP-603. THE SENTINEL IS `null`, AND IT USED TO BE A LITERAL NUL BYTE.
   *
   * The old value was a NUL escape followed by "never-rendered". It did the job
   * it was written for and had one cost nobody priced: **a source file
   * containing a 0x00 byte is BINARY to git**, so `git diff` and `git log -p`
   * have printed "Binary files differ" for this file ever since, and every
   * review of the HUD has been blind. Found while editing this file for GP-600,
   * by `git diff --numstat` reporting `-` for both columns.
   *
   * `null` is not a `string`, so the TYPE SYSTEM guarantees no key can collide
   * with it. That is a stronger version of the original argument (which relied
   * on a value being unreachable in practice) and it costs one union.
   *
   * The general form, worth more than the instance: **an in-band sentinel
   * chosen for being impossible is a claim about the data; an out-of-band one
   * is a claim the compiler checks.** Prefer the second where the language
   * offers it.
   */
  private lastCarry: string | null = null;
  private toastLeft = 0;
  private visible = true;
  gains = 0;
  banners = 0;

  /**
   * DW-31's visibility requirement, and it is the cheapest line in the feature.
   *
   * A player who forgets they are in sandbox and reports a balance bug costs
   * everyone a debugging session, so the badge is ALWAYS ON in that mode: it is
   * deliberately left out of `setVisible`, which hides the rest of the HUD
   * behind a panel, because the one moment a mode label matters most is while
   * somebody is staring at a craft list wondering why everything is free.
   * Empty in survival, so the normal game gains no chrome at all.
   */
  constructor(parent: HTMLElement, badge = '') {
    this.cross = this.div(parent, 'of-cross', '');
    this.prompt = this.div(parent, 'of-prompt', 'of-ui');
    this.carry = this.div(parent, 'of-carry', 'of-ui');
    this.toast = this.div(parent, 'of-toast', 'of-ui');
    this.gainEl = this.div(parent, 'of-gain', 'of-ui');
    this.bannerEl = this.div(parent, 'of-banner', 'of-ui');
    this.compass = new CompassStrip(parent);
    this.health = this.div(parent, 'of-health', 'of-ui');
    this.mode = this.div(parent, 'of-mode', 'of-ui');
    this.mode.textContent = badge;
    this.mode.style.display = badge === '' ? 'none' : 'block';
  }

  private div(parent: HTMLElement, id: string, cls: string): HTMLElement {
    const e = document.createElement('div');
    e.id = id;
    if (cls !== '') e.className = cls;
    parent.appendChild(e);
    return e;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    const d = v ? '' : 'none';
    this.cross.style.display = d;
    this.carry.style.display = d;
    this.gainEl.style.display = d;
    this.bannerEl.style.display = d;
    this.compass.setVisible(v);
    if (!v) this.prompt.style.display = 'none';
  }

  /**
   * The item-gain readout: a big "+7 Wood" that pops beside the crosshair on the
   * impact frame, plus a pulse on the crosshair itself.
   *
   * Separate from `flash` on purpose. The toast is a message channel ("cannot
   * place there"); this is the CONFIRMATION that the swing landed and it has to
   * arrive at the same instant as the debris, in the resource's own colour, and
   * be gone before the next swing. A grant that shares a widget with an error
   * message reads as an error message.
   */
  gain(text: string, colour: string): void {
    this.gains++;
    this.gainEl.textContent = text;
    this.gainEl.style.color = colour;
    // Removing the class, forcing layout, then re-adding is what restarts a CSS
    // animation; without the reflow the browser coalesces both writes and a
    // second swing inside the animation window shows nothing at all.
    this.gainEl.classList.remove('pop');
    this.cross.classList.remove('hit');
    void this.gainEl.offsetWidth;
    this.gainEl.classList.add('pop');
    this.cross.classList.add('hit');
  }

  /**
   * THE BANNER: a moment, not a message. Clearing a node and finishing an ingot
   * are the two events a player should notice from across the clearing, and
   * neither of them fits the gain readout (which is a per-swing tally that has
   * to be gone before the next swing) or the toast (which is where errors live).
   * It sits above the crosshair, holds for a beat, and drifts up as it fades.
   */
  banner(text: string, colour: string): void {
    this.banners++;
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = colour;
    // Same reflow trick as gain(): without it two banners inside the animation
    // window coalesce into one write and the second is never seen.
    this.bannerEl.classList.remove('rise');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('rise');
  }

  /** Show `text` for `secs`. The toast is the "something happened" channel. */
  flash(text: string, secs = 1.4): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastLeft = secs;
  }

  /**
   * GP-79. The health bar, diffed like everything else here.
   *
   * IT SAYS `SAFE` RATHER THAN DISAPPEARING when the player cannot be hurt.
   * That is DW-31's own rule from `Structures.affordInCore` applied to the HUD:
   * a mode that lifts a rule must publish the answer it is overriding, and a bar
   * that is simply absent in sandbox is indistinguishable from a bar that failed
   * to render. It also stops a sandbox playtester reporting "enemies do no
   * damage" as a bug.
   */
  setHealth(v: { hp: number; maxHp: number; fraction: number; dead: boolean;
                 respawnIn: number; invulnerable: boolean } | null): void {
    if (v === null) {
      if (this.lastHealth !== 'none') { this.health.style.display = 'none'; this.lastHealth = 'none'; }
      return;
    }
    const pct = Math.round(Math.max(0, Math.min(1, v.fraction)) * 100);
    const label = v.invulnerable ? 'SAFE'
      : v.dead ? `DOWN ${v.respawnIn.toFixed(1)}s`
        : `${Math.ceil(v.hp)} / ${v.maxHp}`;
    const key = `${pct}|${label}`;
    if (key === this.lastHealth) return;
    this.lastHealth = key;
    this.health.style.display = 'block';
    // The colour is the READING, not decoration: a bar that is only ever one
    // colour makes a player read a number, and a player under attack does not
    // read numbers.
    const colour = v.invulnerable ? '#6fd3ff'
      : pct > 60 ? '#63d47a' : pct > 25 ? '#e8c05a' : '#ff5a4a';
    this.health.innerHTML = `<span class="hl">${esc(label)}</span>`
      + `<div id="of-hpbar"><i style="width:${pct}%;background:${colour}"></i></div>`;
  }

  /**
   * Called every frame. `dt` only ages the toast; the rest is diffed.
   *
   * `compass` arrives COMPUTED EVERY FRAME regardless of mode (game/Compass.ts
   * has no idea whether the player is aboard a vessel or the map is up -- see
   * its own header), so the `!this.visible` branch below is the ONE place that
   * decides whether it draws, the same gate `setWorldUi` already puts the
   * crosshair and the carry panel behind. A second mode check here would be a
   * second authority on "is this the on-foot HUD" agreeing with `setVisible`
   * by construction rather than by rule.
   */
  render(dt: number, target: HudTarget | null, carried: HudCarry[],
         compass: CompassReadout | null = null): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toast.classList.remove('show');
    }
    if (!this.visible) return;
    this.renderPrompt(target);
    this.renderCarry(carried);
    this.compass.render(compass);
  }

  /** GP-700. `__of.game()`'s own `compass` block: what the strip drew last,
   *  the `progress`/`stations` precedent (GameplayReport.ts) applied to this
   *  feature -- a probe reads this rather than pixels. `null` while hidden. */
  compassReport(): unknown { return this.compass.report(); }

  private renderPrompt(t: HudTarget | null): void {
    const on = t !== null && !t.empty;
    this.cross.classList.toggle('on', on);
    if (t === null) {
      if (this.lastPrompt !== '') { this.prompt.style.display = 'none'; this.lastPrompt = ''; }
      return;
    }
    const pct = Math.round(Math.max(0, Math.min(1, t.fraction)) * 100);
    const act = t.action ?? '';
    const verb = t.verb ?? '';
    const key = `${t.name}|${pct}|${t.empty ? 1 : 0}|${act}|${verb}`;
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.prompt.style.display = 'block';
    // A BUILDING IS NOT HARVESTED. It carries its own verbs in `action`, so the
    // "E Harvest" chip is a node-only prefix; without this split a belt read
    // "E Harvest belt", which is a sentence about nothing.
    if (act !== '') {
      this.prompt.innerHTML = `${esc(t.name)}<div class="sub">${esc(act)}</div>`
        + `<div id="of-bar"><i style="width:${pct}%"></i></div>`;
      return;
    }
    // The verb chip names the button that actually does the thing, and it is
    // handed in from the binding table rather than typed, because E stopped
    // being harvest (GP-26) and a HUD that says otherwise is a lie on screen.
    this.prompt.innerHTML = t.empty
      ? `<span class="sub">${esc(t.name)} node depleted</span>`
      : `<span class="k">${esc(verb)}</span>Harvest ${esc(t.name)}`
        + `<div class="sub">${pct}% remaining</div>`
        + `<div id="of-bar"><i style="width:${pct}%"></i></div>`;
  }

  private renderCarry(items: HudCarry[]): void {
    const key = items.map((i) => `${i.name}:${i.count}`).join(',');
    if (key === this.lastCarry) return;
    this.lastCarry = key;
    const rows = items.length === 0
      ? '<div class="none">empty</div>'
      : items.map((i) => `<div class="row"><span>${iconTag(i.icon, 'ico-sm')}`
        + `${esc(i.name)}</span><b>${i.count}</b></div>`).join('');
    this.carry.innerHTML = `<h4>Pack &nbsp;<span style="float:right">Tab</span></h4>${rows}`;
  }
}

/**
 * An `<img>` for a baked item icon (ItemIcons), or nothing.
 *
 * The `data:image/` guard is the whole security story: a slot's picture is a
 * string this module put in a src attribute, so it is checked to be a data URL
 * and never a name, a path or anything a /core string could reach.
 */
export function iconTag(url: string | undefined, cls: string): string {
  return url !== undefined && url.startsWith('data:image/')
    ? `<img class="${cls}" src="${url}" alt="">` : '';
}

/**
 * GP-600. THE CLASS ON A COST CHIP, and there are THREE states, not two.
 *
 * Every screen that prices something drew `ok` or `no` off `have >= need`, and
 * in sandbox `no` is a lie: the placement, the craft and the pay path all
 * return true whatever the pack holds (`ModeRules.freeBuild`). So a red
 * `Stone 0/40` was a REFUSAL drawn beside a control that does not refuse, and
 * three screens said it about one session.
 *
 * The rule this encodes, and it is the whole of GP-600: **a number is
 * information and stays in both modes; a COLOUR is a verdict about what will
 * happen when you press the button, and in sandbox that verdict is always yes.**
 * So the text never changes and the class does. `free` reads as "this is the
 * price, and sandbox is paying it", which is the true sentence, and it is a
 * distinct class rather than `ok` because Reid tests the real game in sandbox
 * and still needs to see at a glance which lines a survival player would be
 * short of.
 *
 * ONE function so there is ONE authority: the build menu, the craft column and
 * the research cards all call this, and a fourth screen that prices something
 * cannot re-derive it differently by accident.
 */
export function costClass(have: number, need: number, free: boolean): string {
  if (have >= need) return 'ok';
  return free ? 'free' : 'no';
}

/** Item names come from /core, but they still reach innerHTML, so escape them. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
