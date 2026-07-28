// THE THREE PROGRESSION SCREENS, composed: research, power and equipment.
//
// One object rather than three fields on `Gameplay` because Gameplay sits at
// its 400-line cap and because these three genuinely are one thing: they are
// the screens that show what the player has EARNED, they share one key-handling
// shape, and they share the pointer transition. Gameplay keeps ORDER and the
// POINTER, exactly as it always has, and hands this object the one callback
// that owns the transition.
//
// THE KEYS ARE ACTIONS (H-5, closed). They shipped as three raw codes read
// through `Input.held` because `player/Bindings.ts` belonged to another lane
// that night, and three raw codes break the one property that made a whole
// control remap cost a single file: every consumer in this client asks for an
// ACTION and nothing else names a key. `BINDINGS` now carries `research`,
// `power` and `equipment`, all three are in `UI_ALLOWED` so a panel's own key
// closes it, and `PROGRESS_ACTIONS` below is a mapping from a screen to a verb
// rather than to a keyboard.
//
// KeyK for `equipment` is deliberate rather than a leftover: it is also
// `throttleDown`, which means something in a rocket and nothing on foot, which
// is the precedent `Bindings.ts` states itself. These panels are gated on
// `suspended`, so the two consumers are never live at once.

import { EquipPanel, type EquipView } from '../ui/EquipPanel.js';
import { PowerPanel, type PowerView } from '../ui/PowerPanel.js';
import { ResearchPanel, type ResearchView } from '../ui/ResearchPanel.js';
import type { Power } from './Power.js';
import { Progression, SKILL } from './Progression.js';
import { Research } from './Research.js';
import { equipView, powerView, researchView } from './ProgressViews.js';
import type { GameCore } from './GameCore.js';
import type { ModeRules } from './GameMode.js';
import type { ModalStack } from '../ui/ModalStack.js';
import type { Action } from '../player/Bindings.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** Screen -> the ACTION that toggles it. Identity today, and deliberately kept
 *  as a table so a screen and its verb can be named differently tomorrow
 *  without anything downstream learning a key code. */
export const PROGRESS_ACTIONS = {
  research: 'research',
  power: 'power',
  equipment: 'equipment',
} as const satisfies Record<Which, Action>;

export interface ProgressDeps {
  core: OfCoreModule;
  host: HTMLElement;
  modals: ModalStack;
  game: GameCore;
  mode: ModeRules;
  /** THE grid, the factory's own, so the panel reads the SAME network the
   *  machines are on rather than a second, always-correct, always-empty one. */
  power: Power;
  /** Machines on the grid that no pole reaches. They run at zero, which is a
   *  different sentence from "you are short of power". */
  offGrid: () => number;
  /** FS-53: generators that joined no network. Its own port for its own
   *  sentence; see GameplayChrome.offGridGenerators. */
  offGridGenerators: () => number;
  /** THE pointer transition, both halves, owned by Gameplay. */
  setCapture: (open: boolean) => void;
  /** Say something to the player. */
  flash: (msg: string, secs?: number) => void;
  icon: (name: string) => string;
  /**
   * H-4: PUT THE ARMOUR ON THE BODY. A port, so this object learns nothing
   * about the avatar, the rig, three.js or the asset registry, exactly as
   * `setCapture` keeps the pointer transition out of here.
   *
   * Both strings come from /core (`progression.h` `slotName` and `armourNode`)
   * and NEITHER is rebuilt in the client, because the four node names are the
   * art lane's published contract and a second derivation of a name is how a
   * lookup ends up binding 284 of 904 triangles while every slot reports
   * something equipped.
   */
  armour: (slotName: string, node: string, on: boolean) => void;
}

type Which = 'research' | 'power' | 'equipment';

export class ProgressUi {
  readonly research: Research;
  readonly power: Power;
  readonly progression: Progression;
  readonly researchPanel: ResearchPanel;
  readonly powerPanel: PowerPanel;
  readonly equipPanel: EquipPanel;

  private open: Which | null = null;
  private readonly down = new Set<string>();

  constructor(private readonly d: ProgressDeps) {
    this.research = new Research(d.core);
    this.power = d.power;
    this.progression = new Progression(d.core);

    this.researchPanel = new ResearchPanel(d.host, d.modals, {
      onResearch: (id) => this.doResearch(id),
    });
    this.researchPanel.closer = () => this.show(null);

    this.powerPanel = new PowerPanel(d.host, d.modals);
    this.powerPanel.closer = () => this.show(null);

    this.equipPanel = new EquipPanel(d.host, d.modals, {
      onEquip: (item) => this.doEquip(item),
      onUnequip: (slot) => this.doUnequip(slot),
      onAppearance: (field, value) => {
        this.progression.setAppearance(field, value);
        this.equipPanel.invalidate();
      },
    });
    this.equipPanel.closer = () => this.show(null);
  }

  /** True while any of the three owns the pointer. */
  get isOpen(): boolean { return this.open !== null; }

  /**
   * Open one screen, or close whatever is open. ONE transition, both halves,
   * and only one of the three is ever up: they are all full-width frames, and
   * two at once is a stack of panels with no way to tell which the pointer
   * belongs to.
   */
  show(which: Which | null): void {
    if (this.open === which) return;
    this.researchPanel.setOpen(which === 'research');
    this.powerPanel.setOpen(which === 'power');
    this.equipPanel.setOpen(which === 'equipment');
    if (which === 'research') this.d.modals.touch(this.researchPanel);
    if (which === 'power') this.d.modals.touch(this.powerPanel);
    if (which === 'equipment') this.d.modals.touch(this.equipPanel);
    this.open = which;
    this.d.setCapture(which !== null);
    this.invalidate();
  }

  toggle(which: Which): void { this.show(this.open === which ? null : which); }

  /** Edge-detected ACTION handling, so a held key acts once exactly as a human
   *  press does. Runs whether or not a panel is open, because a panel's own key
   *  has to survive to close it (which is why all three are in `UI_ALLOWED`). */
  step(act: (a: Action) => boolean): void {
    for (const [which, action] of
      Object.entries(PROGRESS_ACTIONS) as [Which, Action][]) {
      const now = act(action);
      if (now && !this.down.has(action)) this.toggle(which);
      if (now) this.down.add(action); else this.down.delete(action);
    }
  }

  /** Render whichever screen is up. Each panel diffs internally, so a closed
   *  one costs one string compare. */
  frame(): void {
    if (this.open === 'research') this.researchPanel.render(this.researchViewNow());
    else if (this.open === 'power') this.powerPanel.render(this.powerViewNow());
    else if (this.open === 'equipment') this.equipPanel.render(this.equipViewNow());
  }

  researchViewNow(): ResearchView {
    return researchView(this.research, this.d.game, this.d.icon);
  }
  powerViewNow(): PowerView {
    return powerView(this.power, this.d.offGrid(), this.d.offGridGenerators());
  }
  equipViewNow(): EquipView {
    return equipView(this.progression, this.d.game, this.d.icon);
  }

  invalidate(): void {
    this.researchPanel.invalidate();
    this.powerPanel.invalidate();
    this.equipPanel.invalidate();
  }

  // --- the verbs, each one "ask /core, then say so out loud" ----------------
  private doResearch(id: number): void {
    const before = this.research.at(this.indexOf(id));
    if (!this.research.research(id)) {
      this.d.flash('cannot research that yet');
      this.invalidate();
      return;
    }
    const name = before?.name ?? 'a technology';
    const unlocked = (before?.unlocks.length ?? 0);
    this.d.flash(`researched ${name}` + (unlocked > 0
      ? `  (${unlocked} unlocked)` : ''), 2.6);
    this.invalidate();
  }

  private indexOf(techId: number): number {
    for (let i = 0; i < this.research.count; ++i) {
      if (this.research.at(i)?.id === techId) return i;
    }
    return -1;
  }

  /**
   * H-4. MAKE THE BODY MATCH /core, for EVERY slot, every time.
   *
   * Derived rather than incremental, which is GP-25's ModalStack argument and
   * GP-44's gating argument in a third place: a pair of "add on equip, remove
   * on unequip" calls is correct until the third path appears, and the third
   * path already exists (a LOAD puts four pieces on a body nobody clicked).
   * One idempotent sweep from /core's own `wornAll` cannot drift from it, and
   * the rig's own equip/unequip are both no-ops when they already agree.
   *
   * Fire and forget: the rig's `equip` is async because it loads a GLB, and
   * nothing here depends on the frame it lands on.
   */
  syncArmour(): void {
    const worn = this.progression.wornAll();
    for (let s = 0; s < worn.length; ++s) {
      this.d.armour(this.progression.slotName(s),
        this.progression.armourNode(s), (worn[s] ?? 0) !== 0);
    }
  }

  private doEquip(item: number): void {
    if (this.d.mode.researchGated && !this.research.itemAvailable(item)) {
      this.d.flash('that armour is not researched yet');
      return;
    }
    if (!this.progression.equip(item)) {
      this.d.flash('cannot wear that');
      return;
    }
    this.d.flash(`equipped ${this.d.game.itemName(item)}`);
    this.syncArmour();
    this.invalidate();
  }

  private doUnequip(slot: number): void {
    if (!this.progression.unequip(slot)) {
      this.d.flash('nothing to take off, or the pack is full');
      return;
    }
    this.d.flash(`removed ${this.progression.slotName(slot)} armour`);
    this.syncArmour();
    this.invalidate();
  }

  /**
   * PRACTICE, credited from the verbs the game already has.
   *
   * A skill with no action behind it is a line in a menu, which is why /core
   * authored exactly five and why each one is credited here from the verb it
   * names. The amounts are small and the curve is `100 * n^2`, so level 1
   * Mining is a hundred swings: a background reward for playing, never a
   * grind the player is asked to perform.
   *
   * The LEVEL-UP is announced and the xp is not, because a number ticking up
   * in silence is noise and a level is an event.
   */
  credit(skill: number, xp: number): void {
    const gained = this.progression.addXp(skill, xp);
    if (gained <= 0) return;
    const s = this.progression.skill(skill);
    if (s === null) return;
    this.d.flash(`${s.name} level ${s.level}  (x${s.multiplier.toFixed(2)})`, 2.6);
    this.invalidate();
  }

  /** A swing that granted something. Trees are Forestry, everything else is
   *  Mining, from the node's own /core kind rather than from a name. */
  creditHarvest(nodeKind: number): void {
    this.credit(nodeKind === 0 ? SKILL.Forestry : SKILL.Mining, 1);
  }

  report(): unknown {
    return {
      open: this.open,
      keys: PROGRESS_ACTIONS,
      research: this.research.report(),
      power: this.power.report(),
      progression: this.progression.report(),
    };
  }
}
