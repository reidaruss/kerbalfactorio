// EVERY KEY AND BUTTON THE GAMEPLAY LAYER LISTENS TO, in one place and in one
// order. Split out of Gameplay when the controls were brought in line with the
// genre (GP-25 to GP-27) and Gameplay crossed its 400-line cap; the seam was
// already there, because Gameplay owns ORDER and the POINTER and this owns WHAT
// A PRESS MEANS.
//
// THE THREE RULES THIS FILE EXISTS TO STATE ONCE:
//
//   ESCAPE closes the top open menu, whatever it is, from the DERIVED list
//   (ModalStack). With nothing open it drops the part in hand; with nothing in
//   hand it lets the browser's own pointer-lock exit stand, which it was going
//   to do anyway and which we must not fight.
//
//   LEFT CLICK is "use what is in hand". The HOTBAR decides which: a part in
//   hand places (and HOLDING it drags a run), the bare hand swings at a node or
//   digs. Nothing here inspects what is under the crosshair to guess the verb.
//
//   E IS INTERACT and only interact: open a furnace, take a machine's stock,
//   work a door. It stopped being harvest, which is the specific thing the
//   player objected to.
//
// Every press is EDGE-DETECTED here rather than in Input, so a driven tape that
// holds a key for ten frames acts once, exactly like a human press.

import { collectFrom, stepBuild } from './GameplayActions.js';
import { openAimedMachine } from './MachineScreen.js';
import { showGoals } from './Objectives.js';
import { pullTrigger } from './Gunnery.js';
import type { Gameplay } from './Gameplay.js';
import { labelOf, type Action } from '../player/Bindings.js';

const SLOT_ACTIONS: Action[] = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5',
  'slot6', 'slot7', 'slot8', 'slot9', 'slot10', 'slot11'];

export class GameplayInput {
  private pack = false;
  private cancel = false;
  private use = false;
  private interact = false;
  private raze = false;
  private mute = false;
  private goals = false;
  private readonly slots = new Set<Action>();
  /** What Escape last did, so the acceptance can read it back. */
  lastEscape = '';
  escapes = 0;

  /**
   * The half that runs whether or not a panel is open: the pack key, Escape,
   * mute and the checklist. Everything else is muted by the UI capture.
   */
  chrome(g: Gameplay): void {
    const act = (a: Action): boolean => g.input.act(a);

    const pack = act('pack');
    if (pack && !this.pack) g.setPanel(!g.panel.isOpen);
    this.pack = pack;

    const cancel = act('cancel');
    if (cancel && !this.cancel) this.escape(g);
    this.cancel = cancel;

    const mute = act('mute');
    if (mute && !this.mute) {
      // The key name is READ from the binding table, never spelled here. This
      // line said "(M)" for an hour after mute moved to Backslash, because M
      // was taken by the map, and a hint that names the wrong key is worse
      // than no hint: it teaches the player a control that does nothing.
      g.hud.flash(`${g.sfx.bus.toggleMute() ? 'sound off' : 'sound on'}  (${labelOf('mute')})`);
    }
    this.mute = mute;

    // H hides the checklist, and the choice survives a reload: a player who
    // dismissed it did not mean "until the next refresh".
    const goals = act('goals');
    if (goals && !this.goals) showGoals(g, !g.goals.visible);
    this.goals = goals;
  }

  /**
   * ESCAPE, whole. One handler that knows the modal stack, which is the point:
   * five handlers that each guess give you four that work and one that was
   * written after the rule was forgotten.
   */
  private escape(g: Gameplay): void {
    this.escapes++;
    const closed = g.modals.closeTop();
    if (closed !== null) { this.lastEscape = `closed ${closed}`; return; }
    // Nothing open. The next most useful thing is to empty the hand, because a
    // player holding a wall they no longer want has nowhere else to put it.
    if (g.hotbar.clearHand()) { this.lastEscape = 'cleared the hand'; }
    else {
      // GP-100. AND WITH NOTHING TO CLOSE AND NOTHING IN HAND, IT OPENS THE GAME
      // MENU, which is Reid's ask stated exactly: "a menu i can open when i hit
      // escape, if im not already in another menu". The "if" is not a condition
      // written here; it is the two branches above, which is the point of
      // routing through the derived stack rather than asking a panel whether it
      // happens to be up.
      //
      // The hook can be unclaimed (a headless scenario with no menus), and then
      // the OLD answer stands unchanged: Escape means what the browser has
      // already made it mean, which is give the pointer back. Fighting that by
      // re-locking would produce a key that visibly does nothing, and Chrome
      // rejects a `requestPointerLock` outside a user gesture with a console
      // error that fails every driven probe in the suite.
      const opened = g.modals.whenNothingOpen?.() ?? '';
      this.lastEscape = opened !== '' ? opened : 'released the pointer';
    }
    g.modals.lastFallback = this.lastEscape;
  }

  /**
   * The half that only runs with the world in front of the player. Returns true
   * when the tick was consumed by a placement or a removal.
   */
  world(g: Gameplay, ray: { origin: { x: number; y: number; z: number };
                            dir: { x: number; y: number; z: number } },
        tick: number): boolean {
    const act = (a: Action): boolean => g.input.act(a);
    const f = g.input.frame;

    // --- the hotbar: number keys, then the wheel ----------------------------
    for (let i = 0; i < SLOT_ACTIONS.length; ++i) {
      const a = SLOT_ACTIONS[i];
      const down = act(a);
      if (down && !this.slots.has(a)) g.hotbar.select(i);
      if (down) this.slots.add(a); else this.slots.delete(a);
    }
    if (f.wheel !== 0) g.hotbar.cycle(f.wheel);
    g.build.arm(g.hotbar.partInHand);

    // --- left button: use whatever the selected slot holds -------------------
    const usePressed = f.use && !this.use;
    this.use = f.use;
    if (stepBuild(g, ray, f.use, usePressed)) return true;

    g.aim(ray);

    // X pulls up whatever is under the crosshair, and it is read BEFORE the
    // interact key so that "remove" can never be mistaken for "open".
    const raze = act('demolish');
    const razePressed = raze && !this.raze;
    this.raze = raze;
    if (razePressed && g.demolish()) return true;

    // --- E: interact, and never harvest -------------------------------------
    const interactPressed = f.interact && !this.interact;
    this.interact = f.interact;
    if (interactPressed && this.doInteract(g)) return false;

    // --- GP-86: THE GUN, and it is HELD rather than clicked ------------------
    // Read before the bare-hand branch because a gun is not a hand: it neither
    // swings nor opens a machine, and falling through to the swing is exactly
    // how GP-61 found a bare-hand click cratering eleven voxel cells under the
    // machine somebody was trying to use. `f.use` and not `usePressed`, because
    // 400 rpm is automatic fire and the cadence is the weapon's own cooldown,
    // which is the ONE authority on rate: a per-press gate here would be a
    // second one and they would disagree the first time either was tuned.
    if (g.hotbar.gunInHand) { g.interact.target = null; pullTrigger(g, f.use, ray); return false; }

    // --- the bare hand swings -----------------------------------------------
    // ONLY the hand swings. A player carrying a wall who clicks means the wall,
    // a player carrying a furnace means the furnace, and an empty slot means
    // nothing at all. `Gameplay.digAllowed` asks the same question for the dig
    // action, which Systems owns.
    if (!g.hotbar.handInHand) { g.interact.target = null; return false; }
    // GP-61: WITH THE BARE HAND, the left button on a machine OPENS it, the
    // genre's own grammar. It sits INSIDE the hand branch, so a part in hand
    // still places at a machine and a tool still swings at nodes; a machine is
    // not harvestable, so nothing is taken from the swing by giving the press
    // to the panel.
    //
    // IT ALSO STOPS A CLICK AT A MACHINE FROM CRATERING THE GROUND UNDER IT,
    // which was not the point and is measured anyway: opening flips `uiOpen`
    // before Systems reads `digAllowed`, and `probes/machinepanel.js` with only
    // this line reverted digs 11 voxel cells on the identical press.
    if (usePressed && openAimedMachine(g)) return false;
    const got = g.swing(f.use, tick, ray);
    // Practice is credited from the verb, HERE, because this file is where a
    // press becomes a verb. `interact.last` is the node the swing actually
    // landed on, so a swing that hit nothing credits nothing.
    if (got && g.interact.last !== null) {
      g.progress.creditHarvest(g.game.node(g.interact.last.index)?.kind ?? 1);
    }
    return got;
  }

  /** What E does, in the order a player expects: machine, then output, then door. */
  private doInteract(g: Gameplay): boolean {
    if (g.aimedMachine !== null) { g.openFurnace(g.aimedMachine); return true; }
    if (g.aimedBuild !== null) { collectFrom(g, g.aimedBuild); return true; }
    if (g.aimedPart !== null) {
      const open = g.structures.toggle(g.aimedPart);
      if (open !== null) {
        g.hud.flash(open ? 'opened' : 'closed');
        g.sfx.confirm();
      }
      return true;
    }
    return false;
  }

  /** E while a machine screen is up closes it, with the key that opened it. */
  closeWithInteract(g: Gameplay): void {
    const held = g.input.act('interact');
    if (held && !this.interact && g.furnacePanel.isOpen) g.openFurnace(null);
    this.interact = held;
  }

  report(): unknown {
    return { escapes: this.escapes, lastEscape: this.lastEscape };
  }
}
