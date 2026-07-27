// GP-37 and GP-39 acceptance: does a new part CATCH the part already standing
// there, and does a machine end up ON the deck rather than in it.
//
// Reid, verbatim, and both halves are here:
//   "once one is placed, walls or other foundations dont snap to the one that
//    was placed."
//   "Items like smelters dont sit ontop of the foundation"
//
// RUN IN SANDBOX (`--sandbox=1`). The costs are asserted by probes/build.js in
// survival, where they mean something; this file is about GEOMETRY, and forty
// stone per foundation would turn a five-part measurement into a ten-minute
// harvest with nothing to show for it. DW-31 exists for exactly this.
//
// WHAT IS MEASURED, and why each number is the honest one:
//   1. the ghost NAMES the socket it caught, and the address it proposes is the
//      cell across that socket rather than the cell the crosshair is inside.
//      Asserted before anything is placed, because the whole complaint is about
//      what the preview does.
//   2. deck to deck: the centre distance minus the module. Zero means the two
//      4.00 m decks touch exactly, and it is compared against `module.cellM`
//      read off the shipped socket rather than against a typed 4.
//   3. wall to deck: the distance from the placed wall's ORIGIN to the deck's
//      own `socket_edge_*` world position, read out of the .glb. This is the
//      published contract in ASSET-SPECS 4.23 and it is the number that says
//      the snap is real: recomputing the anchor from `cellM * 0.5` would agree
//      with itself no matter what the assets shipped.
//   4. wall to wall: a second panel caught on the first one's `socket_end_*`,
//      which is the "walls dont snap to the one that was placed" half stated
//      exactly. Measured end to end, so a run that overlapped or gapped fails.
//   5. a furnace placed on a deck, measured against the deck's `socket_top`.
//   6. AT LEAST ONE placement through a REAL PointerEvent. probes/realclick.js
//      found a completely inert left mouse button behind twenty green probes
//      that only ever drove ACTIONS, and a placement suite that never touches
//      the DOM would find it again.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const log = [];
  const fail = (why, extra) => ({ fail: why, ...extra, log });

  await sleep(0.8);
  const t0 = of.world().tick;
  const st = of.structures();
  if (st === null) return fail('no structural layer');
  if (!of.sandbox().sandbox) return fail('run this with --sandbox=1');
  const M = of.game().structures.module;
  const yaw0 = of.world().observer.yawDeg;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const at = (p) => [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]];
  const ghost = () => of.build().structGhost;
  const parts = () => of.game().structures.parts;

  /** Sweep the crosshair until the ghost satisfies `want`. Exactly how a player
   *  finds a cell: move the aim and watch the preview. */
  const sweep = async (want, lo = -85, hi = -8, yaws = [0]) => {
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2.5) {
        const y = (yaw0 + dy + 360) % 360;
        of.look(y, p);
        await sleep(0.06);
        const g = ghost();
        if (g !== null && want(g)) return { g, pitch: p, yaw: y };
      }
    }
    return null;
  };
  const AROUND = [0, 30, -30, 60, -60, 90, -90, 150, -150, 180];
  const place = async () => {
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };

  /** A socket's world position, taken from the SHIPPED file and the part's own
   *  transform. Nothing here recomputes it from the module. */
  const socketWorld = (part, name) => {
    const root = st.scenes.get(part.kind);
    const s = root === undefined ? undefined : root.getObjectByName(name);
    if (s === undefined) return null;
    const live = st.parts.find((q) => q.id === part.id);
    if (live === undefined) return null;
    const v = s.position.clone().applyQuaternion(live.quat);
    return [live.pos.x + v.x, live.pos.y + v.y, live.pos.z + v.z];
  };
  /** The nearest of a part's published sockets to a point, by name and metres. */
  const nearestOf = (part, names, p) => {
    let best = null;
    for (const n of names) {
      const w = socketWorld(part, n);
      if (w === null) continue;
      const d = dist(w, p);
      if (best === null || d < best.d) best = { name: n, d, w };
    }
    return best;
  };
  const EDGES = ['socket_edge_n', 'socket_edge_e', 'socket_edge_s', 'socket_edge_w'];
  const ENDS = ['socket_end_l', 'socket_end_r'];

  // --- 1. the founding foundation, straight down ---------------------------
  of.build(4);
  await sleep(0.15);
  const under = await sweep((g) => g.addr !== null && g.ok, -88, -55);
  if (under === null) return fail('no valid cell underfoot', { ghost: ghost() });
  await place();
  if (parts().length < 1) return fail('the founding click placed nothing',
    { ghost: ghost() });
  // A held `use` DRAG-PLACES (GP-26), so one press can lay more than one cell.
  // The count is reported rather than asserted: what this probe is about is
  // where the parts landed, not how many one tape bought.
  const deckA = parts()[0];
  log.push(`founding press laid ${parts().length}`);
  log.push(`founded at ${deckA.addr}, snapped=${under.g.snapped}`);

  // --- 2. aim AT the placed deck with another deck in hand ------------------
  // The complaint restated as a test: aiming at the middle of a foundation used
  // to answer "already built here" for the whole 4 x 4 m of it, because the aim
  // ray stops on its top face. It must now offer the neighbour.
  const onDeckAim = await sweep((g) => g.snapped !== null && g.ok
    && g.addr !== null && !(g.addr[0] === deckA.addr[0] && g.addr[1] === deckA.addr[1]),
  -88, -20, AROUND);
  if (onDeckAim === null) {
    return fail('aiming at a placed foundation caught no socket',
      { ghost: ghost(), deckA });
  }
  const caughtDeck = onDeckAim.g.snapped;
  const wantKey = onDeckAim.g.key;
  const n1 = parts().length;
  await place();
  const deckB = parts().find((p) => p.key === wantKey);
  if (deckB === undefined) {
    return fail('the deck the socket offered was refused',
      { wantKey, was: n1, now: parts().length, ghost: ghost() });
  }
  // Against the socket the ghost NAMED, and against the module. Two decks whose
  // centres are one module apart are adjacent; the socket check says the offer
  // and the landing are the same place.
  const centres = dist(at(deckA.pos), at(deckB.pos));
  const deckGapM = centres - M.cellM;
  log.push(`deck to deck: caught "${caughtDeck}", ${deckA.addr} -> ${deckB.addr}, `
    + `centres ${centres.toFixed(9)}, gap ${deckGapM.toExponential(3)} m`);

  // --- 3. a wall, caught on a deck's own published edge socket -------------
  of.build(6);
  await sleep(0.15);
  const wallAim = await sweep((g) => g.snapped !== null && g.ok
    && g.snapped.includes('socket_edge'), -80, -10, AROUND);
  if (wallAim === null) return fail('a wall caught no deck edge socket',
    { ghost: ghost() });
  const caughtWall = wallAim.g.snapped;
  await place();
  const wall = parts().find((p) => p.kind === 'wall');
  if (wall === undefined) return fail('the wall was refused', { ghost: ghost() });
  // The socket it SAID it caught, not the nearest one after the fact.
  const ownerId = Number(caughtWall.slice(1).split(' ')[0]);
  const owner = parts().find((p) => p.id === ownerId);
  const named = owner === undefined ? null
    : socketWorld(owner, caughtWall.split(' ')[1]);
  const wallSocketM = named === null ? null : dist(named, at(wall.pos));
  const wallNearestM = owner === undefined ? null
    : nearestOf(owner, EDGES, at(wall.pos))?.d ?? null;
  log.push(`wall: caught "${caughtWall}", origin ${wallSocketM === null ? 'n/a'
    : wallSocketM.toExponential(3)} m from THAT socket, `
    + `${wallNearestM === null ? 'n/a' : wallNearestM.toExponential(3)} m from `
    + 'the nearest one');

  // --- 4. a second wall, caught on the first wall's END socket -------------
  const runAim = await sweep((g) => g.snapped !== null && g.ok
    && g.snapped.includes('socket_end'), -60, 5, AROUND);
  const caughtRun = runAim === null ? null : runAim.g.snapped;
  let wallRunM = null;
  if (runAim !== null) {
    const n0 = parts().length;
    await place();
    const wall2 = parts().length > n0 ? parts()[parts().length - 1] : null;
    if (wall2 !== null) {
      // END TO END, not centre to centre: two panels in a run must share one
      // plane exactly, and a centre distance of one module would also be true
      // of two panels that had both drifted the same way.
      const a = nearestOf(wall, ENDS, at(wall2.pos));
      const b = nearestOf(wall2, ENDS, at(wall.pos));
      if (a !== null && b !== null) wallRunM = dist(a.w, b.w);
      log.push(`wall run: caught "${caughtRun}", the two panels' facing ends are `
        + `${wallRunM === null ? 'n/a' : wallRunM.toExponential(3)} m apart`);
    }
  } else {
    log.push('no wall-end socket came within reach of the crosshair');
  }

  // --- 5. GP-39: a furnace ON the deck -------------------------------------
  of.build(0);
  await sleep(0.1);
  of.hotbar(2);
  await sleep(0.15);
  // Aim at a shallow angle so the flattened place-ahead point lands on a deck
  // rather than beyond it. The machine goes 2.2 m in front of the eye.
  let onDeck = null;
  let machineGapM = null;
  for (const dy of AROUND) {
    of.look((yaw0 + dy + 360) % 360, -22);
    await sleep(0.15);
    const n0 = of.game().machines.length;
    await place();
    const list = of.game().machines;
    if (list.length === n0) continue;
    const m = list[list.length - 1];
    onDeck = m.onDeck;
    if (m.onDeck) {
      // Against the DECK'S OWN `socket_top`, in the tangent plane's up: the
      // machine may legitimately sit anywhere on the 4 m square, so the number
      // that means anything is the HEIGHT above the deck top, not the distance.
      let best = null;
      for (const p of parts()) {
        if (p.kind !== 'foundation' && p.kind !== 'floor') continue;
        const top = socketWorld(p, 'socket_top');
        if (top === null) continue;
        const live = st.parts.find((q) => q.id === p.id);
        const d = [m.pos[0] - top[0], m.pos[1] - top[1], m.pos[2] - top[2]];
        const lat = Math.hypot(...d) ** 2
          - (d[0] * live.up.x + d[1] * live.up.y + d[2] * live.up.z) ** 2;
        if (lat > (M.cellM * 0.75) ** 2) continue;
        const up = d[0] * live.up.x + d[1] * live.up.y + d[2] * live.up.z;
        if (best === null || Math.abs(up) < Math.abs(best)) best = up;
      }
      machineGapM = best;
      break;
    }
    of.demolish({ machine: list.length - 1 });
    await sleep(0.2);
  }
  log.push(`furnace: onDeck ${onDeck}, ${machineGapM === null ? 'no deck under it'
    : `${machineGapM.toExponential(3)} m above the deck's own socket_top`}`);

  // --- 6. and ONE placement through a REAL PointerEvent --------------------
  // Not a tape. See probes/realclick.js: an inert left button survived twenty
  // green probes because every one of them drove the ACTION.
  of.build(4);
  await sleep(0.2);
  const realAim = await sweep((g) => g.addr !== null && g.ok, -80, -10, AROUND);
  const el = document.querySelector('canvas');
  const before = parts().length;
  let realPlaced = 0;
  if (realAim !== null && el !== null) {
    const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
    // TWO clicks. The first may legitimately be swallowed buying the pointer
    // lock back, which is correct behaviour and not the thing under test.
    for (let k = 0; k < 2; ++k) {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      await sleep(0.15);
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      await sleep(0.3);
    }
    realPlaced = parts().length - before;
  }
  log.push(`real PointerEvent placed ${realPlaced} part(s)`);

  await of.settle(3);
  const g = of.game();
  return {
    advanced: { ticks: of.world().tick - t0, parts: parts().length },
    module: M,
    snap: {
      deckCaught: caughtDeck, deckGapM: +deckGapM.toExponential(3),
      wallCaught: caughtWall,
      wallSocketM: wallSocketM === null ? null : +wallSocketM.toExponential(3),
      wallNearestM: wallNearestM === null ? null : +wallNearestM.toExponential(3),
      runCaught: caughtRun,
      wallRunM: wallRunM === null ? null : +wallRunM.toExponential(3),
    },
    machine: { onDeck, gapM: machineGapM === null ? null
      : +machineGapM.toExponential(3), machines: g.machines.length },
    realClick: { placed: realPlaced },
    base: { parts: parts().length, sites: g.structures.sites,
      refusals: g.structures.refusals, unevenRefusals: g.structures.unevenRefusals,
      viewRefused: g.baseView.refused },
    valid:
      of.world().tick - t0 > 400
      // 1. aiming at a placed deck offers a NEIGHBOUR and names the socket
      && caughtDeck !== null && caughtDeck.includes('socket_edge')
      // 2. and the two decks meet exactly
      && Math.abs(deckGapM) < 1e-6
      // 3. a wall lands on the socket the ghost said it caught, and that socket
      //    is also the nearest one, so "it caught something" and "it caught the
      //    RIGHT something" are two separate assertions
      && wallSocketM !== null && wallSocketM < 1e-6
      && wallNearestM !== null && wallNearestM < 1e-6
      // 4. a second wall continues the run end to end
      && wallRunM !== null && wallRunM < 1e-6
      // 5. a furnace sits ON the deck top, not in it
      && onDeck === true && machineGapM !== null && Math.abs(machineGapM) < 1e-6
      // 6. and the real left mouse button places
      && realPlaced > 0
      && g.baseView.refused === 0,
    log,
  };
})()
