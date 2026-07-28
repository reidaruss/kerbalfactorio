// GP-119. THE ROLL-OUT GATE: a hopeless design is refused once, and a second
// press launches it anyway.
//
// Split out of `Vab.ts` at the 400-line cap. It holds the two fields the confirm
// needs and nothing else, which is also what makes the second of them readable:
// an arm is bound to the DESIGN REVISION it was granted for, so it cannot
// outlive its subject.
//
// A confirm rather than a hard block, deliberately, and GP-73 is the argument.
// That session was spent undoing a guard that refused the only key which could
// free the player, with a message naming the wrong thing. A check that can be
// wrong must never be the only authority over whether the player may act; a
// check that stops an ACCIDENT and yields to an INTENTION stops the accident
// either way and can never become a cage.

/** How long a refused roll-out stays armed for a confirming press. */
const ARM_MS = 6000;

export class RollOutGate {
  refused = 0;
  forced = 0;
  private until = 0;
  private revision = -1;

  /** True when the caller should roll out; false when it must refuse. */
  press(ok: boolean, revision: number): boolean {
    const now = performance.now();
    if (ok) { this.until = 0; return true; }
    if (this.armed(revision)) {
      this.until = 0;
      this.forced += 1;
      return true;
    }
    this.until = now + ARM_MS;
    this.revision = revision;
    this.refused += 1;
    return false;
  }

  armed(revision: number): boolean {
    return this.until > 0 && performance.now() < this.until
      && this.revision === revision;
  }

  clear(): void { this.until = 0; this.revision = -1; }
}
