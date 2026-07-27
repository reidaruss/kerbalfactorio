// The player themself: what they are wearing, what it is worth added up, what
// they have practised, and what they look like.
//
// DW-2 as everywhere under src/ui: plain DOM, zero three.js, nothing about WASM.
// Plain rows in through render(), plain callbacks out through the hooks handed
// to the constructor. It is the client half of core/include/of/progression.h and
// it DERIVES NOTHING: the summed suit arrives already summed, because /core owns
// the 80% reduction cap and the multiplicative encumbrance and a second opinion
// computed here would disagree with the save the first time a piece is retuned.
//
// THE NUMBERS ARE THE FEATURE, so move speed is printed to three decimals. The
// shipped iron set multiplies out to a figure that rounds to 0.89 at two, and a
// panel that prints 0.89 cannot be checked against /core by anybody, including a
// probe. Three decimals costs one character and buys an assertion.
//
// Every control is a real <button> carrying a stable data-* attribute, driven by
// ONE delegated listener on the root, because the rows are rebuilt whenever
// anything changes and per-row listeners would be rebuilt (and leaked) with
// them. A probe presses the thing a player presses.

import './styles/equip.css';
import { esc, iconTag } from './GameHud.js';
import { Modal, type ModalStack } from './ModalStack.js';

export interface ArmourStats {
  /** Fraction of a hit removed, 0..0.80. */
  reduction: number;
  /** Multiplier on walking speed, 1.0 is unencumbered. */
  moveSpeedMul: number;
  insulationC: number;
}
export interface EquipSlotRow {
  /** 0 head, 1 chest, 2 legs, 3 feet, matching progression.h's EquipSlot. */
  slot: number;
  slotName: string;
  /** 0 when the slot is empty. */
  item: number;
  /** '' when the slot is empty. */
  name: string;
  icon?: string;
  stats: ArmourStats;
}
export interface CarriedArmourRow {
  item: number;
  name: string;
  slot: number;
  slotName: string;
  icon?: string;
  count: number;
  stats: ArmourStats;
}
export interface SkillRow {
  id: number;
  name: string;
  level: number;
  xp: number;
  /** 0..1 through the CURRENT level, what the bar draws. */
  progress: number;
  /** e.g. 1.15 at level 3. */
  multiplier: number;
  /** Total xp needed to reach the next level, or 0 at the cap. */
  nextAt: number;
}
export type AppearanceField = 'skin' | 'suitPrimary' | 'suitSecondary' | 'visor' | 'build';
export interface AppearanceView {
  skin: number; suitPrimary: number; suitSecondary: number; visor: number; build: number;
}
export interface PaletteView {
  /** CSS colour strings, e.g. 'rgb(242,209,184)'. Index IS the stored byte. */
  skin: string[];
  suit: string[];
  visor: string[];
  /** Three labels for the build byte, e.g. ['slight','average','heavy']. */
  build: string[];
}
export interface EquipView {
  /** Always four, in slot order. */
  slots: EquipSlotRow[];
  /** Armour in the pack that could be equipped. May be empty. */
  carried: CarriedArmourRow[];
  /** The suit added up, straight from /core's own Equipment::total. */
  total: ArmourStats;
  /** Always five, in SkillId order. */
  skills: SkillRow[];
  appearance: AppearanceView;
  palettes: PaletteView;
}
export interface EquipPanelHooks {
  onEquip: (item: number) => void;
  onUnequip: (slot: number) => void;
  onAppearance: (field: AppearanceField, value: number) => void;
}

/** The five legal appearance keys, in one place, so the delegated listener can
 *  check an attribute against them before it reaches a callback. */
const FIELDS: readonly AppearanceField[] =
  ['skin', 'suitPrimary', 'suitSecondary', 'visor', 'build'];

export class EquipPanel extends Modal {
  private readonly root: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly sum: HTMLElement;
  private readonly pack: HTMLElement;
  private readonly skills: HTMLElement;
  private readonly looks: HTMLElement;
  private open = false;
  private lastKey = '';

  constructor(parent: HTMLElement, stack: ModalStack,
              private readonly hooks: EquipPanelHooks) {
    super('equip', stack);
    this.root = document.createElement('div');
    this.root.id = 'of-equip';
    this.root.className = 'of-ui';
    this.root.innerHTML =
      '<div class="frame">'
      + '<div class="col gear"><h3>Equipment</h3><div class="tiles"></div>'
      + '<div class="sum"></div></div>'
      + '<div class="col pack"><h3>In the pack</h3><div class="list"></div></div>'
      + '<div class="col me"><h3>Skills</h3><div class="skills"></div>'
      + '<h3 class="mid">Appearance</h3><div class="looks"></div></div>'
      + '</div>';
    parent.appendChild(this.root);
    this.gear = this.root.querySelector('.tiles') as HTMLElement;
    this.sum = this.root.querySelector('.sum') as HTMLElement;
    this.pack = this.root.querySelector('.list') as HTMLElement;
    this.skills = this.root.querySelector('.skills') as HTMLElement;
    this.looks = this.root.querySelector('.looks') as HTMLElement;
    // ONE listener, on the root, for all three verbs. The tiles, the pack rows
    // and the swatches are all thrown away and rebuilt on every change, so a
    // listener attached to any of them would be a listener attached to a corpse.
    this.root.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(e: MouseEvent): void {
    const b = (e.target as HTMLElement | null)?.closest('button') ?? null;
    if (b === null) return;
    const eq = b.getAttribute('data-equip');
    if (eq !== null) { this.fire(eq, this.hooks.onEquip); return; }
    const un = b.getAttribute('data-unequip');
    if (un !== null) { this.fire(un, this.hooks.onUnequip); return; }
    const ap = b.getAttribute('data-appearance');
    if (ap === null) return;
    // 'field:value'. The field is checked against the five literals BEFORE the
    // hook sees it: a malformed attribute must not be able to hand the caller a
    // key that is not one of the five bytes progression.h actually stores.
    const cut = ap.indexOf(':');
    if (cut < 0) return;
    const field = ap.slice(0, cut);
    const value = Number(ap.slice(cut + 1));
    if (!isField(field) || !Number.isFinite(value)) return;
    this.hooks.onAppearance(field, value);
  }

  private fire(raw: string, hook: (n: number) => void): void {
    const n = Number(raw);
    if (Number.isFinite(n)) hook(n);
  }

  get isOpen(): boolean { return this.open; }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    this.root.classList.toggle('open', v);
  }

  toggle(): boolean { this.setOpen(!this.open); return this.open; }

  /** Rebuild the three columns. Diffed on one key, so a closed panel costs one
   *  string compare and an open panel that has not changed costs the same. */
  render(view: EquipView): void {
    if (!this.open) return;
    const key = viewKey(view);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.gear.innerHTML = view.slots.map(slotTile).join('');
    this.sum.innerHTML = totalBlock(view.total);
    this.pack.innerHTML = view.carried.length === 0
      ? '<div class="none">No armour in the pack. Craft a piece from the '
        + 'Hand crafting menu.</div>'
      : view.carried.map(carriedRow).join('');
    this.skills.innerHTML = view.skills.map(skillRow).join('');
    this.looks.innerHTML = appearanceBlock(view.appearance, view.palettes);
  }

  /** Force the next render to rebuild, e.g. right after a successful equip. */
  invalidate(): void { this.lastKey = ''; }

  /** Exposed so a probe presses the thing a player presses. */
  equipButton(item: number): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`button[data-equip="${item}"]`);
  }

  unequipButton(slot: number): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`button[data-unequip="${slot}"]`);
  }
}

function isField(s: string): s is AppearanceField {
  return (FIELDS as readonly string[]).includes(s);
}

/** Everything the three columns draw, in one string. Cheap to build, and it is
 *  the only thing standing between this panel and a layout pass per frame. */
function viewKey(v: EquipView): string {
  const st = (s: ArmourStats): string =>
    `${s.reduction},${s.moveSpeedMul},${s.insulationC}`;
  const a = v.appearance;
  const p = v.palettes;
  return v.slots.map((r) => `${r.slot}:${r.item}:${r.name}:${r.icon ?? ''}:${st(r.stats)}`)
      .join('|')
    + '#' + v.carried.map((r) => `${r.item}:${r.count}:${r.name}:${r.icon ?? ''}:${st(r.stats)}`)
      .join('|')
    + '#' + st(v.total)
    + '#' + v.skills.map((r) => `${r.level}:${r.xp}:${r.progress.toFixed(4)}:${r.nextAt}`)
      .join('|')
    + `#${a.skin},${a.suitPrimary},${a.suitSecondary},${a.visor},${a.build}`
    + '#' + p.skin.join(',') + ';' + p.suit.join(',') + ';' + p.visor.join(',')
    + ';' + p.build.join(',');
}

/** Whole percent, which is how every armour figure in progression.h lands. */
function pct(x: number): string { return `${Math.round(x * 100)}`; }

/** Up to one decimal, with the trailing '.0' dropped: '12 C', not '12.0 C'. */
function num1(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

/** The per-piece line. Two decimals here, three only on the total, where the
 *  product of four multipliers is the number somebody will check. */
function statLine(s: ArmourStats): string {
  return `-${pct(s.reduction)}% damage, x${s.moveSpeedMul.toFixed(2)} speed`;
}

function slotTile(r: EquipSlotRow): string {
  const worn = r.item !== 0 && r.name !== '';
  const body = worn
    ? `${iconTag(r.icon, 'ico')}<span class="nm">${esc(r.name)}</span>`
    : '<span class="nm none">empty</span>';
  const btn = worn
    ? `<button type="button" data-unequip="${r.slot}">Remove</button>` : '';
  return `<div class="of-eslot${worn ? ' filled' : ' bare'}">`
    + `<div class="hd"><span class="sl">${esc(r.slotName)}</span>${btn}</div>`
    + `<div class="bd">${body}</div>`
    + `<div class="st">${statLine(r.stats)}</div></div>`;
}

/** The suit added up. Straight from /core, printed and not recomputed. */
function totalBlock(t: ArmourStats): string {
  const ln = (k: string, v: string): string =>
    `<div class="ln"><span>${k}</span><b>${v}</b></div>`;
  return '<h4>Total</h4>'
    + ln('damage reduction', `${pct(t.reduction)}%`)
    + ln('move speed', `x${t.moveSpeedMul.toFixed(3)}`)
    + ln('insulation', `${num1(t.insulationC)} C`);
}

function carriedRow(r: CarriedArmourRow): string {
  const n = r.count > 1 ? ` x${r.count}` : '';
  return '<div class="of-erow"><div class="top">'
    + `<span class="nm">${iconTag(r.icon, 'ico-sm')}${esc(r.name)}${n}</span>`
    + `<button type="button" data-equip="${r.item}">Equip</button></div>`
    + `<div class="sub">${esc(r.slotName)}, ${statLine(r.stats)}</div></div>`;
}

function skillRow(r: SkillRow): string {
  const w = Math.round(Math.max(0, Math.min(1, r.progress)) * 100);
  // At the cap there is no next level to count towards, so the line says so
  // rather than printing '/ 0', which reads as a bug in the xp table.
  const tail = r.nextAt > 0 ? ` / ${r.nextAt} to level ${r.level + 1}` : ' max';
  return '<div class="of-eskill"><div class="top">'
    + `<span class="nm">${esc(r.name)}</span>`
    + `<span class="lv">Lv ${r.level}</span>`
    + `<span class="bar"><i style="width:${w}%"></i></span>`
    + `<b class="mul">x${r.multiplier.toFixed(2)}</b></div>`
    + `<div class="xp">${r.xp} xp${tail}</div></div>`;
}

function appearanceBlock(a: AppearanceView, p: PaletteView): string {
  return swatchRow('skin', p.skin, a.skin)
    + swatchRow('suitPrimary', p.suit, a.suitPrimary)
    + swatchRow('suitSecondary', p.suit, a.suitSecondary)
    + swatchRow('visor', p.visor, a.visor)
    + optionRow('build', p.build, a.build);
}

/** A palette as square buttons. The label is not decoration: a swatch has no
 *  text of its own, so without title and aria-label it is a nameless control. */
function swatchRow(field: AppearanceField, colours: string[], sel: number): string {
  const cells = colours.map((c, i) => {
    const lb = `${field} ${i}`;
    return `<button type="button" class="sw${i === sel ? ' sel' : ''}" `
      + `data-appearance="${field}:${i}" title="${lb}" aria-label="${lb}" `
      + `style="background:${cssColour(c)}"></button>`;
  }).join('');
  return `<div class="of-eapp"><span class="lb">${field}</span>`
    + `<div class="row">${cells}</div></div>`;
}

/** Build is a shape, not a colour, so its three choices are words. */
function optionRow(field: AppearanceField, labels: string[], sel: number): string {
  const cells = labels.map((t, i) => {
    const lb = `${field} ${i}`;
    return `<button type="button" class="opt${i === sel ? ' sel' : ''}" `
      + `data-appearance="${field}:${i}" title="${lb}" aria-label="${lb}">`
      + `${esc(t)}</button>`;
  }).join('');
  return `<div class="of-eapp"><span class="lb">${field}</span>`
    + `<div class="row">${cells}</div></div>`;
}

/**
 * A palette entry reaches a style attribute, so it is checked to be a COLOUR and
 * never an arbitrary string, exactly as iconTag checks an icon is a data URL.
 * The palettes come from /core, but "it is trusted today" is not a property a
 * string keeps, and the fallback is a visible black square rather than silence.
 */
function cssColour(c: string): string {
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9,.\s%]+\)|[a-zA-Z]{3,20})$/.test(c)
    ? c : '#000';
}
