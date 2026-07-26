// ESCAPE CLOSES ANY OPEN MENU, and the list of menus is DERIVED.
//
// The obvious implementation is one Escape handler per panel, and it is wrong
// for a reason worth writing down: the guarantee the player is asking for is
// "whatever is open, this key shuts it", and five handlers that each guess give
// you four that work and one that was written after the rule was forgotten. So
// there is ONE handler and ONE registry, every modal joins the registry in its
// own constructor by extending `Modal`, and `ModalStack.all()` is the complete
// list by construction rather than by anybody remembering.
//
// A probe reads that same derived list (`__of.modals()`) and asserts Escape
// against every entry in it, so a new menu that skipped the base class fails the
// acceptance instead of quietly escaping the guarantee.
//
// DW-2 holds: no three.js, plain DOM, plain data.

export interface ModalLike {
  /** Stable name, for the report and for a probe to drive by. */
  readonly modalName: string;
  readonly isOpen: boolean;
  /** Close, through whatever path the owning system needs (pointer included). */
  requestClose(): void;
}

/**
 * The base every panel extends. Registration is the constructor, so a panel
 * cannot exist without being in the stack.
 */
export abstract class Modal implements ModalLike {
  /**
   * How the APP wants this closed. A panel cannot close itself correctly: who
   * owns the pointer is a whole-application question (InventoryPanel's header
   * has the argument), so the app hands the panel its own transition here and
   * Escape goes through exactly the path the panel's own key goes through.
   */
  closer: (() => void) | null = null;

  constructor(readonly modalName: string, stack: ModalStack) {
    stack.register(this);
  }

  abstract get isOpen(): boolean;
  abstract setOpen(v: boolean): void;

  requestClose(): void {
    if (this.closer !== null) this.closer();
    else this.setOpen(false);
  }
}

export class ModalStack {
  private readonly items: ModalLike[] = [];
  /** How many times Escape has actually closed something. For the probe. */
  closed = 0;
  /** What Escape did with nothing open, so the fallback is observable. */
  lastFallback = '';

  register(m: ModalLike): void {
    if (!this.items.includes(m)) this.items.push(m);
  }

  /** Every modal that exists, in registration order. The derived list. */
  all(): readonly ModalLike[] { return this.items; }

  open(): ModalLike[] { return this.items.filter((m) => m.isOpen); }

  get anyOpen(): boolean { return this.items.some((m) => m.isOpen); }

  /**
   * Close the TOP open modal. Returns its name, or null if nothing was open.
   *
   * Top means last-opened, which is why `opened` is stamped rather than read off
   * registration order: a furnace opened over the pack must close first, or
   * Escape would shut the thing behind the thing being looked at.
   */
  closeTop(): string | null {
    const open = this.open();
    if (open.length === 0) return null;
    let top = open[0];
    for (const m of open) {
      if ((order.get(m) ?? 0) >= (order.get(top) ?? 0)) top = m;
    }
    top.requestClose();
    this.closed++;
    return top.modalName;
  }

  /** Stamp a modal as the most recent to open. Called by the app's own
   *  transition, which is the one place that knows a panel just opened. */
  touch(m: ModalLike): void { order.set(m, ++seq); }

  report(): unknown {
    return {
      modals: this.items.map((m) => ({ name: m.modalName, open: m.isOpen })),
      openCount: this.open().length,
      closedByEscape: this.closed,
      lastFallback: this.lastFallback,
    };
  }
}

const order = new WeakMap<ModalLike, number>();
let seq = 0;
