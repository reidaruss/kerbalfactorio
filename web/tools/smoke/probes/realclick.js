// Does the REAL left mouse button harvest? probes/harvest.js drives a `use`
// TAPE, which sets the intent flag directly and never touches the DOM, so it
// passes while the actual button does nothing. Reid reported exactly that:
// "left click to harvest and place doesnt work".
//
// This is the same trap the inverted mouse-look fix had. Assert through the
// event the player generates, or the probe measures the abstraction instead of
// the game. It is the more important half of standing rule 3.
//
// The suspect is Input.swallowClick: it is set whenever look is enabled and the
// pointer is NOT locked, so it swallows every click in drag-to-look mode rather
// than only the one click that buys the lock.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const el = document.querySelector('canvas');
  if (!el) return { valid: false, why: 'no canvas' };

  const V = (a) => Math.hypot(a[0], a[1], a[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = V(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  await of.run(0.5);
  const nodes = of.nodes();
  if (!nodes.length) return { valid: false, why: 'no nodes' };

  // Face the nearest node, using the same look() a mouse drives.
  const eye0 = of.world().player.aim.origin;
  let best = nodes[0], bestD = Infinity;
  for (const n of nodes) {
    const d = V(sub([n.x, n.y, n.z], eye0));
    if (d < bestD) { bestD = d; best = n; }
  }
  // Aim, walk, then aim AGAIN: the first aim is only good enough to walk along,
  // and the node is metres wide, so the sweep must happen from where the swing
  // is actually thrown. The first draft of this probe aimed once, walked, and
  // reported aimedAtNode:false with both harvests zero, which measured nothing
  // at all. A probe has to prove its own setup worked (DW-20).
  const aimAt = (n) => {
    const eye = of.world().player.aim.origin;
    const want = norm(sub([n.x, n.y, n.z], eye));
    let yaw = 0, best = -2;
    const st = of.world().observer;
    for (let p = -30; p <= 10; p += 5) {
      for (let a = 0; a < 360; a += 2) {
        of.look(a, p);
        const k = dot(of.aim().dir, want);
        if (k > best) { best = k; yaw = a; pit = p; }
      }
    }
    of.look(yaw, pit);
    return best;
  };
  let pit = 0;
  const distTo = (n) => V(sub([n.x, n.y, n.z], of.world().player.aim.origin));
  // Close the distance in stages, re-aiming each time. One fixed walk is not
  // enough: the node was 18 m out and a 90 frame press covers about 7 m, which
  // left the probe aimed perfectly at something it could not reach.
  // press() queues a tape and does not wait for it, so the run() after it must
  // cover the tape's own length. A 0.2 s wait after a 60 frame press advanced
  // the walk by 0.6 m instead of 4.6 m, and the probe then reported a perfect
  // aim at something 13 m away.
  for (let i = 0; i < 10 && distTo(best) > 3.5; ++i) {
    aimAt(best);
    of.input.press('KeyW', 60);
    await of.run(1.2);
  }
  const bestDot = aimAt(best);
  const reach = distTo(best);

  // Observable is the TARGET NODE's remaining amount, which is what harvest.js
  // trusts. My first draft summed of.game().pack and read 0 for both paths even
  // though harvest.js was green, i.e. the probe was measuring the wrong thing
  // and would have reported a working button as broken.
  const remainingOf = () => {
    const n = of.nodes().find((x) => Math.abs(x.x - best.x) < 0.01
      && Math.abs(x.y - best.y) < 0.01 && Math.abs(x.z - best.z) < 0.01);
    return n ? n.remaining : null;
  };
  const packOf = () => remainingOf();

  // --- 1. the abstraction: what every existing probe tests -----------------
  const packA0 = packOf();
  of.input.act(['use'], 90);
  await of.run(2.5);              // must exceed the 90 frame tape, see above
  const gainedViaAction = packA0 - packOf();

  // --- 2. the real button: what the player actually presses ----------------
  // TWO clicks, and the distinction is the whole design. The FIRST click may
  // legitimately be eaten because it buys the pointer lock back, which is the
  // behaviour that stops a click aimed at a menu from placing a building. It is
  // the SECOND click, made while playing, that must act. Measuring only the
  // first would call correct lock-buying behaviour a bug.
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  const clickHold = async (seconds) => {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await of.run(seconds);
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await of.run(0.4);
  };

  const packLock0 = packOf();
  await clickHold(1.5);
  const gainedViaFirstClick = packLock0 - packOf();

  const packB0 = packOf();
  await clickHold(1.5);
  const gainedViaButton = packB0 - packOf();

  return {
    valid: true,
    pointerLocked: document.pointerLockElement !== null,
    aimDot: bestDot,
    reachM: reach,
    // Setup proof. If this is false the two harvest numbers below mean nothing.
    aimedAtNode: bestDot > 0.9 && reach < 6,
    gainedViaAction,
    gainedViaFirstClick,
    gainedViaButton,
    actionHarvests: gainedViaAction > 0,
    // THE ASSERTION. A click made while playing must swing.
    realButtonHarvests: gainedViaButton > 0,
    // The whole point: a suite that only drives the action cannot see this.
    abstractionHidesTheBug: gainedViaAction > 0 && gainedViaButton === 0,
  };
})()
