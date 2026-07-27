// THE PLAYER THEMSELF: what they wear, what they are good at, what they look
// like. The typed face over `of_pg_*` (ABI 9), the client half of
// `core/include/of/progression.h`, which landed at 823 checks with no way to
// reach the game.
//
// NO RULE LIVES HERE. The cap on damage reduction, the summing of four slots,
// the multiplying of four encumbrances, the quadratic level curve, the
// rounding direction of a skill yield and the palette clamp are all /core's,
// and every one of them comes back out of WASM. That is deliberate to the point
// of pedantry: `Skills::applyYield` exists in /core precisely because
// `int(n * mul)` at four call sites is three call sites that will round the
// other way within a month, and re-implementing it here would be the fourth.
//
// THE ART LANE'S NODE NAMES ARE A PURE FUNCTION OF THE SLOT and are read from
// /core rather than typed here, because the contract says the four nodes in
// `armour_set.glb` are SLOT names and not SET names. A second armour set is a
// second file carrying the same four nodes, and nothing in this file moves.

import { scratchF64, scratchI32, scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';

/** `progression.h` EquipSlot, in enum order. */
export const EQUIP_SLOT = { Head: 0, Chest: 1, Legs: 2, Feet: 3 } as const;
export const EQUIP_SLOT_COUNT = 4;

/** `progression.h` SkillId, in enum order. One per verb the game HAS. */
export const SKILL = {
  Mining: 0, Forestry: 1, Smelting: 2, Building: 3, Piloting: 4,
} as const;
export const SKILL_COUNT = 5;

/** The five appearance fields, in the order `of_pg_set_appearance` takes. */
export const APPEARANCE_FIELDS =
  ['skin', 'suitPrimary', 'suitSecondary', 'visor', 'build'] as const;
export type AppearanceField = typeof APPEARANCE_FIELDS[number];

export interface ArmourStats {
  reduction: number; moveSpeedMul: number; insulationC: number;
}
export interface ArmourDef {
  index: number; item: number; slot: number; stats: ArmourStats;
}
export interface SkillState {
  id: number; name: string; level: number; xp: number;
  progress: number; multiplier: number; nextAt: number;
}
export interface Appearance {
  skin: number; suitPrimary: number; suitSecondary: number;
  visor: number; build: number;
}

const decoder = new TextDecoder();

export class Progression {
  /** Counted so a probe can prove the buttons did work rather than that the
   *  state happened to look right. */
  equips = 0;
  unequips = 0;
  levelUps = 0;

  private readonly slotNames: string[] = [];
  private readonly skillNames: string[] = [];
  private readonly nodeNames: string[] = [];

  constructor(private readonly M: OfCoreModule) {
    for (let i = 0; i < EQUIP_SLOT_COUNT; ++i) {
      this.slotNames.push(this.str(this.M._of_pg_slot_name(i)));
      this.nodeNames.push(this.str(this.M._of_pg_armour_node(i)));
    }
    for (let i = 0; i < SKILL_COUNT; ++i) {
      this.skillNames.push(this.str(this.M._of_pg_skill_name(i)));
    }
  }

  private str(n: number): string {
    return n > 0 ? decoder.decode(scratchU8(this.M, n).slice()) : '';
  }

  slotName(slot: number): string { return this.slotNames[slot] ?? ''; }
  /** The `armour_set.glb` node the renderer binds for this slot. */
  armourNode(slot: number): string { return this.nodeNames[slot] ?? ''; }

  // --- equipment ------------------------------------------------------------
  /** The ItemId in a slot, or 0. */
  worn(slot: number): number { return this.M._of_pg_worn(slot); }

  wornAll(): number[] {
    const n = this.M._of_pg_worn_all();
    return n > 0 ? Array.from(scratchI32(this.M, n).slice()) : [0, 0, 0, 0];
  }

  /** Pack to body, swapping out whatever was there. All or nothing. */
  equip(item: number): boolean {
    const ok = this.M._of_pg_equip(item) === 1;
    if (ok) this.equips++;
    return ok;
  }
  /** Body to pack. False (and nothing moves) if the slot is empty or the pack
   *  is full: `unequip` is the direction that genuinely can be refused, because
   *  it adds without removing. */
  unequip(slot: number): boolean {
    const ok = this.M._of_pg_unequip(slot) === 1;
    if (ok) this.unequips++;
    return ok;
  }

  /** Every armour piece the game has, with its slot and its stats. */
  armour(): ArmourDef[] {
    const out: ArmourDef[] = [];
    for (let i = 0; i < this.M._of_pg_armour_count(); ++i) {
      if (this.M._of_pg_armour_info(i) !== 5) continue;
      const p = scratchF64(this.M, 5);
      out.push({
        index: i, item: p[0], slot: p[1],
        stats: { reduction: p[2], moveSpeedMul: p[3], insulationC: p[4] },
      });
    }
    return out;
  }

  armourFor(item: number): ArmourDef | null {
    for (const a of this.armour()) if (a.item === item) return a;
    return null;
  }

  /** The suit added up, straight from /core: reduction SUMS and is capped at
   *  0.80, the speed penalties MULTIPLY. */
  total(): ArmourStats {
    if (this.M._of_pg_total() !== 3) {
      return { reduction: 0, moveSpeedMul: 1, insulationC: 0 };
    }
    const p = scratchF64(this.M, 3);
    return { reduction: p[0], moveSpeedMul: p[1], insulationC: p[2] };
  }

  /** ONE call, so a combat model never re-derives the cap and the summation
   *  and gets a different answer. */
  damageAfter(raw: number): number { return this.M._of_pg_damage_after(raw); }

  // --- skills ---------------------------------------------------------------
  skill(i: number): SkillState | null {
    if (this.M._of_pg_skill_state(i) !== 5) return null;
    const p = scratchF64(this.M, 5);
    return {
      id: i, name: this.skillNames[i] ?? '', level: p[0], xp: p[1],
      progress: p[2], multiplier: p[3], nextAt: p[4],
    };
  }

  skills(): SkillState[] {
    const out: SkillState[] = [];
    for (let i = 0; i < SKILL_COUNT; ++i) {
      const s = this.skill(i);
      if (s !== null) out.push(s);
    }
    return out;
  }

  /** Grant experience. Returns the LEVELS it bought, so the caller can say so
   *  on screen without diffing two reports. */
  addXp(skill: number, n: number): number {
    const gained = this.M._of_pg_add_xp(skill, n);
    this.levelUps += gained;
    return gained;
  }

  /** Apply a skill to an integer yield, rounding DOWN, through /core's own
   *  published call. Level 0 is bit-exactly neutral, which is what makes the
   *  whole layer optional for every caller that never grants a point. */
  applyYield(skill: number, base: number): number {
    return this.M._of_pg_apply_yield(skill, base);
  }

  skillXp(): number[] {
    const n = this.M._of_pg_skill_xp_all();
    return n > 0 ? Array.from(scratchI32(this.M, n).slice()) : [0, 0, 0, 0, 0];
  }

  // --- appearance -----------------------------------------------------------
  appearance(): Appearance {
    if (this.M._of_pg_appearance() !== 5) {
      return { skin: 0, suitPrimary: 0, suitSecondary: 0, visor: 0, build: 1 };
    }
    const p = scratchI32(this.M, 5);
    return {
      skin: p[0], suitPrimary: p[1], suitSecondary: p[2],
      visor: p[3], build: p[4],
    };
  }

  /** Returns false when /core CLAMPED the value into its palette, which is the
   *  honest answer to "did you get what you asked for" and is what stops a
   *  panel drawing a selection that is not the stored one. */
  setAppearance(field: AppearanceField, value: number): boolean {
    const i = APPEARANCE_FIELDS.indexOf(field);
    return i >= 0 && this.M._of_pg_set_appearance(i, value) === 1;
  }

  /** A palette as CSS colours. `which`: 0 skin, 1 suit, 2 visor. The INDEX is
   *  the stored byte, so the client never keeps a parallel table. */
  palette(which: number): string[] {
    const n = this.M._of_pg_palette(which);
    if (n <= 0) return [];
    const p = scratchI32(this.M, n).slice();
    return Array.from(p, (c) =>
      `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`);
  }

  // --- persistence ----------------------------------------------------------
  /** Restore WITHOUT touching the pack: the load path already restored the pack
   *  from its own bytes, and taking the armour out of it again would delete
   *  four items on every reload. /core validates each id against its own slot,
   *  so a hand-edited save cannot put boots on a head. */
  restore(worn: readonly number[], xp: readonly number[],
          look: Appearance | null): void {
    this.M._of_pg_restore_worn(worn[0] ?? 0, worn[1] ?? 0, worn[2] ?? 0,
      worn[3] ?? 0);
    this.M._of_pg_restore_skills(xp[0] ?? 0, xp[1] ?? 0, xp[2] ?? 0,
      xp[3] ?? 0, xp[4] ?? 0);
    if (look === null) return;
    for (const f of APPEARANCE_FIELDS) this.setAppearance(f, look[f]);
  }

  report(): unknown {
    const t = this.total();
    return {
      worn: this.wornAll(),
      slots: this.slotNames,
      nodes: this.nodeNames,
      reduction: t.reduction, moveSpeedMul: t.moveSpeedMul,
      insulationC: t.insulationC,
      equips: this.equips, unequips: this.unequips, levelUps: this.levelUps,
      skills: this.skills().map((s) => ({ name: s.name, level: s.level, xp: s.xp })),
      appearance: this.appearance(),
    };
  }
}
