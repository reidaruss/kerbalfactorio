// GP-38 acceptance: DW-32's cantilever, which did not exist.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/cantilever.js
//
// PROBEALL-TIMEOUT: 600000
// BT-130: hit the shared sweep's 240 s cap and was recorded NO_OUTPUT under
// the BT-116 4-way batch. Re-run standalone with no wrapper timeout on
// 2026-08-15 (lane/probeall-debts): on a genuinely quiet machine, GREEN in
// 238.2 s, 1.8 s inside the old cap with zero contention -- this probe's own
// scan-then-walk-then-verify cost leaves no margin at all against a 240 s
// budget. This VM runs several agent lanes concurrently by design (see
// CLAUDE.md), so "quiet" is the exception rather than the rule: a same-day
// re-verification measured 320s+ and still timed out while three other
// lanes were mid-build/mid-probe on the same box. 600000 (10 min, ~2.5x the
// clean baseline) is sized for that real operating condition, not the lab
// number, and is still a documented override on ONE probe rather than a
// silent raise of the shared default.
//
// `supported()` returned true unconditionally for every level-0 deck, so there
// was no neighbour concept at all and "a foundation may attach to an existing
// foundation's edge and hang over a drop, supported by its neighbour" was a
// sentence in a decision log with no code behind it. Now a deck with a deck
// beside it may hang up to one STOREY, the run is capped at
// `MAX_CANTILEVER_CELLS`, and the pillar that DW-32 also asked for is drawn
// underneath because the deck ended up clear of the ground.
//
// THREE THINGS MUST BE TRUE AT ONCE, and the third is the one that matters:
//   1. a carried deck goes down where a lone one would not, and it is carried
//      BY A NEIGHBOUR rather than by a looser constant: the placed deck's own
//      hang must EXCEED `floatToleranceM`, or the cantilever bought nothing and
//      this probe would pass against code that simply raised the tolerance.
//   2. the run is CAPPED. A base cannot walk out over a canyon for ever, and
//      the refusal says so by name rather than blaming the ground.
//   3. THE NEGATIVE CONTROL. A cell with the same hang and NO deck beside it is
//      still refused, by the ordinary float bound. Without this, a cantilever
//      that had accidentally been applied to every cell in the world would pass
//      the first two assertions perfectly. Standing rule 7 applied to a rule
//      instead of to a render layer.
//
// SANDBOX, and the ground is FOUND rather than assumed. The oracle is analytic,
// so candidate origins are scanned cheaply and the probe teleports to one whose
// per-cell drop lands in the band where the cantilever is the binding rule: a
// slope so gentle that the ordinary tolerance already covers it tests nothing,
// and a cliff refuses on the hang before the run cap is ever reached.
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
  const C = M.cellM, H = C * 0.5;
  const FLOAT = st.floatToleranceM;
  const HANG = M.storey;                 // the cantilever bound, one storey
  const MAXRUN = 3;                      // StructureTolerance.MAX_CANTILEVER_CELLS

  const D = 180 / Math.PI;
  const feet0 = of.world().player.feet;
  const R = Math.hypot(feet0[0], feet0[1], feet0[2]) || 1;
  const U = [feet0[0] / R, feet0[1] / R, feet0[2] / R];
  const lat0 = Math.asin(U[1]), lon0 = Math.atan2(U[2], U[0]);
  const E = [-Math.sin(lon0), 0, Math.cos(lon0)];
  const N = [-Math.sin(lat0) * Math.cos(lon0), Math.cos(lat0),
    -Math.sin(lat0) * Math.sin(lon0)];
  const latLonOf = (de, dn) => [
    +((lat0 + dn / R) * D).toFixed(5),
    +((lon0 + de / (R * Math.max(1e-6, Math.cos(lat0)))) * D).toFixed(5)];
  const pointAt = (de, dn) => {
    const x = feet0[0] + E[0] * de + N[0] * dn;
    const y = feet0[1] + E[1] * de + N[1] * dn;
    const z = feet0[2] + E[2] * de + N[2] * dn;
    const r = Math.hypot(x, y, z) || 1;
    return { x: x * R / r, y: y * R / r, z: z * R / r };
  };

  // --- find ground where the cantilever is the BINDING rule ----------------
  // The wanted per-cell drop is between the ordinary float bound and the
  // cantilever bound, with headroom, so cells 1 to MAXRUN all fit under the
  // hang and cell MAXRUN+1 is refused by the RUN and not by the hang.
  const WANT = HANG / (MAXRUN + 1);
  const groundAt = (p) => st.groundRadius(p.x, p.y, p.z) - Math.hypot(p.x, p.y, p.z);
  const RUNGS = [];
  for (let k = -8; k <= 8; ++k) RUNGS.push(k * 800);
  // A RANKED LIST, NOT ONE ANSWER. The scan founds a PROSPECTIVE site at the
  // sample point, and after the teleport the real site is founded on the lattice
  // cell under the player's feet, which is a metre or two away and therefore a
  // different frame. That mismatch was survivable on a coarse height field and
  // stopped being survivable the night the terrain lane gave the noise stack
  // real detail: the best-scoring spot became one whose founding cell is
  // refused. So the probe carries its next-best answers and tries them.
  const cands = [];
  let bestAt = null;
  for (const a of RUNGS) {
    for (const b of RUNGS) {
      const s = st.prospectiveSite(pointAt(a, b));
      // The drop from this cell's centre to its four neighbours' centres, in
      // the site's own frame, which is exactly what a run of decks will meet.
      const at = (de, dn) => {
        const x = s.o.x + s.east.x * de + s.north.x * dn;
        const y = s.o.y + s.east.y * de + s.north.y * dn;
        const z = s.o.z + s.east.z * de + s.north.z * dn;
        return st.groundRadius(x, y, z) - Math.hypot(x, y, z);
      };
      const c = at(H, H);
      let drop = 0;
      for (const [de, dn] of [[C, 0], [-C, 0], [0, C], [0, -C]]) {
        drop = Math.min(drop, at(H + de, H + dn) - c);
      }
      // THE FOUNDING CELL MUST ITSELF BE BUILDABLE. A slope with the right
      // per-cell drop is useless if the first foundation is refused on it, and
      // the first draft of this scan found exactly that: 1.12 m per cell on
      // ground whose own footprint spread 1.30 m against a 1.40 m budget with
      // no margin. The spread is the same five points `checkGround` samples.
      let lo = Infinity;
      let hi = -Infinity;
      for (const [de, dn] of [[0, 0], [-H, -H], [H, -H], [-H, H], [H, H]]) {
        const v = at(H + de, H + dn);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      if (hi - lo > (FLOAT + st.buryToleranceM) * 0.6) continue;
      cands.push({ a, b, drop: -drop, foundingSpread: hi - lo,
        err: Math.abs(-drop - WANT) });
    }
  }
  cands.sort((x, y) => x.err - y.err);
  if (cands.length === 0) return fail('the scan found nothing');
  log.push(`want ${WANT.toFixed(2)} m per cell, ${cands.length} candidates, `
    + `best ${cands[0].drop.toFixed(2)} (spread ${cands[0].foundingSpread.toFixed(2)})`);

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const ghost = () => of.build().structGhost;
  const parts = () => of.game().structures.parts;
  const yaw0 = of.world().observer.yawDeg;
  const AROUND = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  const sweep = async (want, lo = -85, hi = 0, yaws = AROUND) => {
    for (const dy of yaws) {
      for (let p = lo; p <= hi; p += 2.5) {
        const y = (yaw0 + dy + 360) % 360;
        of.look(y, p);
        await sleep(0.05);
        const g = ghost();
        if (g !== null && want(g)) return { g, pitch: p, yaw: y };
      }
    }
    return null;
  };
  const place = async () => {
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };

  /** Turn to face a body-frame point; `sign` -1 turns away from it. */
  const faceAt = async (t, sign = 1) => {
    let best = yaw0, bestD = -2;
    for (let y = 0; y < 360; y += 5) {
      of.look(y, -6);
      await sleep(0.03);
      const d = of.world().player.aim.dir, o = of.world().player.aim.origin;
      const to = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
      const L = Math.hypot(to[0], to[1], to[2]) || 1;
      const k = sign * (d[0] * to[0] + d[1] * to[1] + d[2] * to[2]) / L;
      if (k > bestD) { bestD = k; best = y; }
    }
    of.look(best, -6);
    await sleep(0.15);
    return best;
  };

  // --- the founding deck, at the first candidate that will take one --------
  let tlat = 0;
  let tlon = 0;
  let under = null;
  for (const c of cands.slice(0, 6)) {
    [tlat, tlon] = latLonOf(c.a, c.b);
    of.teleport(tlat, tlon, 2);
    await sleep(1.6);
    await of.settle(6);
    of.build(4);
    await sleep(0.25);
    const seen = new Map();
    under = await sweep((g) => {
      if (g.addr !== null) seen.set(g.key, `${g.reason} dev=${g.unevennessM}`);
      return g.addr !== null && g.ok && g.carryRun === 0;
    }, -88, -25);
    const feet = of.world().player.feet;
    log.push(`candidate ${c.a},${c.b} (drop ${c.drop.toFixed(2)}, spread `
      + `${c.foundingSpread.toFixed(2)}) at r=`
      + `${Math.hypot(feet[0], feet[1], feet[2]).toFixed(1)}: `
      + `${under === null ? `refused: ${[...seen.values()].slice(0, 3).join(' | ')}`
        : 'founding cell found'}`);
    if (under !== null) { bestAt = c; break; }
  }
  if (under === null) {
    return fail('no candidate site would take a founding foundation',
      { tried: Math.min(6, cands.length), ghost: ghost() });
  }
  await place();
  if (parts().length < 1) return fail('the founding click placed nothing');
  const site = parts()[0].site;
  log.push(`founded ${parts().length} at ${parts()[0].addr}`);

  // --- pick ONE direction and walk it -------------------------------------
  // Not "sweep for any carried cell": that wanders round the base and can never
  // build the STRAIGHT run the cap exists to bound. The direction is chosen off
  // the real adopted site rather than the prospective one the scan used, which
  // is a different frame founded on a different lattice cell.
  const live = st.sites.find((s) => s.id === site);
  if (live === undefined) return fail('the founded site is not in the registry');
  const a0 = parts()[0].addr;
  const devAt = (e, n) => {
    const x = live.o.x + live.east.x * e + live.north.x * n;
    const y = live.o.y + live.east.y * e + live.north.y * n;
    const z = live.o.z + live.east.z * e + live.north.z * n;
    return st.groundRadius(x, y, z) - Math.hypot(x, y, z);
  };
  // The wanted profile: cell k hangs about k * WANT, so cells 1..MAXRUN clear
  // the hang bound and cell MAXRUN+1 is stopped by the RUN rather than by the
  // ground. Scored on the deepest cell of the run, which is what binds.
  let dir = [1, 0];
  let dirErr = Infinity;
  const profileOf = ([di, dj]) => {
    const out = [];
    for (let k = 1; k <= MAXRUN + 1; ++k) {
      let lo = 0;
      for (const [de, dn] of [[0, 0], [-H, -H], [H, -H], [-H, H], [H, H]]) {
        lo = Math.min(lo, devAt((a0[0] + k * di + 0.5) * C + de,
          (a0[1] + k * dj + 0.5) * C + dn));
      }
      out.push(+(-lo).toFixed(3));
    }
    return out;
  };
  const profiles = {};
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const p = profileOf(d);
    profiles[`${d}`] = p;
    // Every cell of the run must fit under the hang, and the deepest should be
    // as close to it as possible without exceeding it.
    const worst = Math.max(...p.slice(0, MAXRUN));
    const err = worst > HANG ? Infinity : HANG - worst;
    if (err < dirErr) { dirErr = err; dir = d; }
  }
  log.push(`profiles ${JSON.stringify(profiles)}, chose ${dir}`);

  // --- walk it, one named cell at a time -----------------------------------
  const steps = [];
  let placedCarried = 0;
  let worstCarriedHang = 0;
  let capRefusal = null;
  let deepest = null;
  for (let k = 1; k <= MAXRUN + 2; ++k) {
    const want = [a0[0] + k * dir[0], a0[1] + k * dir[1], 0];
    const wants = (g) => g.addr !== null && g.addr[0] === want[0]
      && g.addr[1] === want[1] && g.addr[2] === 0;
    let found = await sweep(wants, -85, 10);
    if (found === null && parts().length > 0) {
      // WALK OUT ONTO THE RUN. The aim march reaches 24 m, which is six cells,
      // so a run laid from where it was founded goes out of reach at about the
      // fifth. A player walks along their own platform; so does this.
      const tail = parts()[parts().length - 1];
      await faceAt([tail.pos[0], tail.pos[1], tail.pos[2]]);
      of.input.tape([{ hold: 60, keys: ['KeyW'] }, { hold: 8, keys: [] }]);
      await sleep(1.4);
      found = await sweep(wants, -85, 15);
    }
    if (found === null) { log.push(`cell ${want} never came under the crosshair`); break; }
    const g = found.g;
    const before = parts().length;
    const row = { key: g.key, addr: g.addr, ok: g.ok, carryRun: g.carryRun,
      unevennessM: g.unevennessM, reason: g.reason, snapped: g.snapped };
    if (g.ok) {
      await place();
      row.placed = parts().length > before;
      if (row.placed && g.carryRun >= 1) {
        placedCarried++;
        worstCarriedHang = Math.min(worstCarriedHang, g.unevennessM);
        // The control cell is the FIRST one the cantilever actually bought,
        // not the deepest. Both prove the same thing and the first is three
        // cells nearer, which matters because the control has to re-aim at it
        // after the decks between here and there have been pulled up.
        if (deepest === null && -g.unevennessM > FLOAT) {
          deepest = { ...row, yaw: found.yaw, pitch: found.pitch };
        }
      }
    } else if (g.carryRun < 0 && capRefusal === null) {
      capRefusal = row;
    }
    steps.push(row);
    log.push(`cell ${JSON.stringify(g.addr)} run=${g.carryRun} ok=${g.ok} `
      + `dev=${g.unevennessM} "${g.reason}"`);
  }

  // The pillar count of the RUN ITSELF, read before the control pulls it apart.
  await of.settle(4);
  const runPillars = of.game().baseView.pillars;
  log.push(`pillars under the run ${JSON.stringify(runPillars)}`);

  // --- the NEGATIVE CONTROL, on the SAME cell ------------------------------
  // The deepest deck that the cantilever bought is pulled up along with every
  // deck touching it, and its own cell is then asked again. Same cell, same
  // ground, same crosshair: the ONLY thing that changed is whether a neighbour
  // is standing there. Without this the whole probe would pass against a build
  // that had simply raised `floatToleranceM` to one storey for everything, and
  // a control on some OTHER cell would not, because the two cells would differ
  // in ground as well as in support.
  let loneRow = null;
  if (deepest !== null) {
    const doomed = parts().filter((p) => p.addr !== null
      && (p.kind === 'foundation' || p.kind === 'floor')
      && Math.abs(p.addr[0] - deepest.addr[0]) + Math.abs(p.addr[1] - deepest.addr[1]) <= 1
      && p.addr[2] === deepest.addr[2]);
    for (const p of doomed) of.demolish({ part: p.id });
    await sleep(0.4);
    of.look(deepest.yaw, deepest.pitch);
    await sleep(0.2);
    let again = await sweep((g) => g.key === deepest.key, -85, 15);
    if (again === null) {
      // Walk towards it and try once more. The decks that were bridging the
      // gap are gone, so the cell may now be past the aim march's own reach.
      of.look(deepest.yaw, -6);
      await sleep(0.2);
      of.input.tape([{ hold: 45, keys: ['KeyW'] }, { hold: 8, keys: [] }]);
      await sleep(1.2);
      again = await sweep((g) => g.key === deepest.key, -85, 15);
    }
    if (again !== null) {
      loneRow = { addr: again.g.addr, carryRun: again.g.carryRun,
        hangM: again.g.unevennessM, ok: again.g.ok, reason: again.g.reason,
        wasM: deepest.unevennessM, pulled: doomed.length };
    }
    // Put the base back, so the capture and the pillar count are of the base
    // this probe actually built.
    for (let k = 0; k < doomed.length + 1; ++k) {
      const back = await sweep((g) => g.addr !== null && g.ok
        && !parts().some((p) => p.key === g.key), -85, 10);
      if (back === null) break;
      await place();
    }
  }
  log.push(loneRow === null ? 'the deepest carried cell could not be re-aimed'
    : `SAME cell ${JSON.stringify(loneRow.addr)} with its carriers pulled `
      + `(${loneRow.pulled}): run ${loneRow.carryRun}, hangs ${loneRow.hangM} `
      + `(was ${loneRow.wasM}), ok ${loneRow.ok}: "${loneRow.reason}"`);

  // --- the pillar ----------------------------------------------------------
  // Read AFTER a sync, because the count is what is BATCHED and reading it
  // before a frame reports an intention (DW-28).
  await of.settle(4);
  const pillars = of.game().baseView.pillars;
  log.push(`pillars ${JSON.stringify(pillars)}`);

  // --- frame the capture ---------------------------------------------------
  // Back off along the run and look down it, so the drop, the overhang and the
  // pillar under it are all in one shot.
  const shot = parts();
  const outer = shot[shot.length - 1];
  of.build(0);
  const mid = [outer.pos[0], outer.pos[1], outer.pos[2]];
  // WHERE TO STAND IS SAMPLED, NOT ASSUMED. The first two drafts of this
  // capture walked backwards off the end of the platform and photographed the
  // dark, then teleported to a fixed perpendicular offset and landed twelve
  // metres down the hill with the base out of frame. On ground this steep the
  // only reliable vantage is one that was MEASURED: sixteen directions at
  // twenty metres, keeping the one whose ground sits about five metres below
  // the deck plane, so the overhang and the pillar under it are both above the
  // horizon and lit from the same side as the base.
  const planeR = Math.hypot(mid[0], mid[1], mid[2]);
  const midU = [mid[0] / planeR, mid[1] / planeR, mid[2] / planeR];
  let vp = null;
  let vpErr = Infinity;
  for (let k = 0; k < 16; ++k) {
    const th = k * Math.PI / 8;
    const dx = live.east.x * Math.cos(th) + live.north.x * Math.sin(th);
    const dy = live.east.y * Math.cos(th) + live.north.y * Math.sin(th);
    const dz = live.east.z * Math.cos(th) + live.north.z * Math.sin(th);
    const q = [mid[0] + dx * 30, mid[1] + dy * 30, mid[2] + dz * 30];
    const gr = st.groundRadius(q[0], q[1], q[2]);
    const err = Math.abs((gr - planeR) + 5);
    if (err < vpErr) { vpErr = err; vp = q; }
  }
  const vr = Math.hypot(vp[0], vp[1], vp[2]) || 1;
  of.teleport(Math.asin(vp[1] / vr) * D, Math.atan2(vp[2], vp[0]) * D, 2);
  await sleep(1.6);
  await of.settle(8);
  log.push(`vantage ${vpErr.toFixed(2)} m off the wanted height, `
    + `up ${midU.map((v) => v.toFixed(3))}`);
  const shotYaw = await faceAt(mid);
  of.look(shotYaw, 4);
  await sleep(0.8);

  const g = of.game();
  const placedRun = steps.filter((s) => s.placed === true).length;
  return {
    advanced: { ticks: of.world().tick - t0, parts: parts().length },
    site, latLon: [tlat, tlon],
    bounds: { floatM: FLOAT, buryM: st.buryToleranceM, cantileverM: HANG,
      maxRunCells: MAXRUN, perCellDropM: +bestAt.drop.toFixed(3),
      candidates: cands.length },
    steps,
    carried: { placed: placedCarried, worstHangM: +worstCarriedHang.toFixed(3),
      runPlaced: placedRun },
    cap: capRefusal,
    negativeControl: loneRow,
    pillars, runPillars,
    budget: { drawCalls: of.stats().draw.calls, cap: of.stats().budget.drawCalls,
      refused: g.baseView.refused },
    valid:
      of.world().tick - t0 > 400
      // 1. at least one deck went down BECAUSE a neighbour carried it, and its
      //    own hang exceeds the bound a lone deck is held to
      && placedCarried >= 1 && -worstCarriedHang > FLOAT
      && -worstCarriedHang <= HANG
      // 2. the run is capped, and the refusal names the run rather than blaming
      //    ground that is perfectly buildable one cell back
      && capRefusal !== null && capRefusal.reason.includes('within 3 cells')
      // 3. and the SAME cell, with its carriers pulled up, is refused again by
      //    the ordinary bound while hanging by the same amount it did when it
      //    was accepted
      && loneRow !== null && loneRow.ok === false && loneRow.carryRun === 0
      && loneRow.reason.includes('hang') && -loneRow.hangM > FLOAT
      // 4. DW-32's pillar is drawn under the overhang, and nothing was dropped
      && runPillars.decks >= 1 && runPillars.pieces >= 3
      && g.baseView.refused === 0,
    log,
  };
})()
