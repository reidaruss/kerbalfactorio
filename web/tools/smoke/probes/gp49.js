// GP-49: A MACHINE PLACED WHERE A NEIGHBOUR ALREADY STANDS.
//
//   npx --prefix web vite build --outDir dist-gp
//   npx --prefix web vite preview --outDir dist-gp --port 4185
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4185/ --scenario=walk \
//     --sandbox=1 --evalfile=web/tools/smoke/probes/gp49.js
//
// THE REPORTED DEFECT, verbatim from the roadmap: "a generator at y 21103.98
// and an electric smelter placed on a bearing 15 degrees away landed at
// y 21104.98, the same tangent position exactly 1.00 m up. It floats, a
// downward aim ray passes underneath it, and it can never be interacted with,
// demolished or fed again."
//
// THIS PROBE DOES NOT TAKE THAT DIAGNOSIS ON TRUST, because the number that
// makes it is a WORLD-FRAME y at a 600 km radius, where a tangent direction can
// carry almost all of a metre. So it DECOMPOSES the offset between the two
// machines into the site's own up and tangent components and reports both. If
// the second machine really is a metre in the air, `upM` is 1.00 and `tangentM`
// is 0. If it is one cell over on the ground, `tangentM` is 1.00 and `upM` is
// about 0. Those are different bugs with the same printout and they need
// different fixes.
//
// EITHER WAY THE PLAYER LOSES THE MACHINE, which is what makes this worth
// refusing rather than tidying: two 2 m machines whose centres are 1 m apart
// interpenetrate, and `Factory.pick` resolves every bearing that reaches one to
// whichever is better centred, so the other can never be aimed at, opened,
// demolished or fed again. It was paid for and it is gone.
//
// THE CLAIM AFTER THE FIX: a placement whose FOOTPRINT would overlap a
// neighbour's is refused, before the button is pressed, with a reason on the
// ghost naming what it is too close to.
//
// THE NEGATIVE CONTROL, and it is the assertion that makes the rest mean
// anything: THE SAME PART, THE SAME HAND, THE SAME TICK, two cells further out,
// goes down. A build that had simply stopped placing electric smelters passes
// every assertion above this line and fails that one.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const press = async (code, frames = 6) => {
    of.input.act([code], frames);
    await sleep(0.3);
  };
  const click = (el) => {
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window }));
    return true;
  };

  await sleep(1.0);

  // ======================================================================
  // 0. SETUP PROOF (DW-20). This is sandbox and the factory is empty, so
  //    every count below starts from a known zero rather than from whatever
  //    a previous run left behind.
  // ======================================================================
  check('this run is sandbox', of.game().mode.sandbox === true,
    JSON.stringify(of.game().mode));
  const f0 = of.game().factory;
  check('the factory starts empty', (f0.list ?? []).length === 0,
    (f0.list ?? []).length);

  // ======================================================================
  // 1. GET TWO 2 m MACHINES INTO THE HAND. Crafted and assigned through the
  //    same pack tiles a player clicks, so nothing is granted by fiat.
  // ======================================================================
  const yaw = of.world().observer.yawDeg;
  await press('Tab');
  await sleep(0.4);
  const rows = () => [...document.querySelectorAll('#of-panel .of-recipe')];
  const rowNamed = (t) => rows().find((e) =>
    (e.querySelector('.nm')?.textContent ?? '').includes(t));
  const craftN = async (name, n) => {
    let k = 0;
    for (let i = 0; i < n; ++i) {
      if (click(rowNamed(name)?.querySelector('button'))) k++;
      await sleep(0.08);
    }
    return k;
  };
  check('the generator is craftable', await craftN('Burner generator', 1) === 1);
  check('the electric smelter is craftable',
    await craftN('Electric smelter', 3) === 3);
  await press('Tab');
  await sleep(0.3);

  const assign = async (item, slot) => {
    of.hotbar(slot);
    await sleep(0.15);
    await press('Tab');
    await sleep(0.35);
    const tile = document.querySelector(`#of-panel .of-slot[data-item="${item}"]`);
    const ok = click(tile);
    await sleep(0.2);
    await press('Tab');
    await sleep(0.3);
    return ok;
  };
  check('the generator went on slot 5', await assign(0x003E, 5));
  check('the electric smelter went on slot 6', await assign(0x003D, 6));

  const listed = () => of.game().factory.list ?? [];
  const ghost = () => of.game().build?.ghost ?? null;
  const refusals = () => of.game().build?.refusals ?? 0;
  const aim = async (slot, dyaw, pitch) => {
    of.hotbar(slot);
    await sleep(0.15);
    of.look(yaw + dyaw, pitch);
    await sleep(0.3);
  };
  const placeAt = async (slot, dyaw, pitch) => {
    await aim(slot, dyaw, pitch);
    of.input.tape([{ hold: 4, actions: ['use'] }, { hold: 10, keys: [] }]);
    await sleep(0.45);
  };

  // ======================================================================
  // 2. THE GENERATOR GOES DOWN, and its position is read from the sim rather
  //    than from where the probe thought it aimed.
  // ======================================================================
  await placeAt(5, 0, -42);
  const gen = listed().find((b) => b.kind === 'generator') ?? null;
  check('the generator is on the ground', gen !== null,
    JSON.stringify(listed().map((b) => b.kind)));
  if (gen === null) return { valid: false, fails, log };
  log.push(`generator at ${JSON.stringify(gen.pos)} cell ${gen.cell}`);

  // The site frame the two machines share, so the offset can be decomposed
  // into an UP and a TANGENT part instead of being read off a world axis.
  const up = (() => {
    const [x, y, z] = gen.pos;
    const r = Math.hypot(x, y, z) || 1;
    return [x / r, y / r, z / r];
  })();

  // ======================================================================
  // 3. THE REPORTED GESTURE: aim 15 degrees off the generator and place an
  //    electric smelter. This is the exact bearing the roadmap recorded.
  // ======================================================================
  const before = listed().length;
  const refusedBefore = refusals();
  await aim(6, 15, -42);
  const g1 = ghost();
  log.push(`ghost on the neighbour: ${JSON.stringify(g1 && {
    ok: g1.ok, reason: g1.reason, cell: g1.cell, ij: g1.ij })}`);
  await placeAt(6, 15, -42);
  const after = listed().length;
  const near = listed().find((b) => b.kind === 'esmelter') ?? null;

  const offset = near === null ? null : (() => {
    const d = [near.pos[0] - gen.pos[0], near.pos[1] - gen.pos[1],
      near.pos[2] - gen.pos[2]];
    const upM = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const total = Math.hypot(d[0], d[1], d[2]);
    const tangentM = Math.sqrt(Math.max(0, total * total - upM * upM));
    return { total, upM, tangentM, dy: d[1] };
  })();
  if (offset !== null) {
    log.push(`OFFSET generator -> smelter: total ${offset.total.toFixed(4)} m, `
      + `up ${offset.upM.toFixed(4)} m, tangent ${offset.tangentM.toFixed(4)} m, `
      + `world dy ${offset.dy.toFixed(4)} m`);
  }

  // THE ASSERTION. Two 2 m machines whose centres are less than 2 m apart
  // interpenetrate, and neither can then be reliably addressed. The refusal is
  // the fix, and the ghost has to have said so BEFORE the press.
  check('the ghost refused the overlapping cell', g1 !== null && g1.ok === false,
    JSON.stringify(g1 && { ok: g1.ok, reason: g1.reason }));
  check('and named what it was too close to',
    (g1?.reason ?? '').includes('too close'), g1?.reason ?? '');
  check('nothing was placed on top of the neighbour', after === before,
    `${before} -> ${after}`);
  check('and the refusal was counted', refusals() > refusedBefore,
    `${refusedBefore} -> ${refusals()}`);

  // ======================================================================
  // 4. THE NEGATIVE CONTROL. THE SAME PART, THE SAME HAND, further out. A
  //    build that had stopped placing electric smelters altogether passes
  //    every assertion above and fails this one.
  // ======================================================================
  await placeAt(6, 55, -34);
  const far = listed().find((b) => b.kind === 'esmelter') ?? null;
  check('the SAME smelter goes down clear of the generator', far !== null,
    JSON.stringify(listed().map((b) => b.kind)));
  let clearM = 0;
  if (far !== null) {
    clearM = Math.hypot(far.pos[0] - gen.pos[0], far.pos[1] - gen.pos[1],
      far.pos[2] - gen.pos[2]);
    log.push(`the accepted smelter is ${clearM.toFixed(4)} m from the generator`);
    check('and it really is clear of it (2 m machines, 2 m apart)',
      clearM >= 1.999, clearM.toFixed(4));
  }

  // ======================================================================
  // 5. BOTH MACHINES CAN STILL BE AIMED AT, which is the thing the defect
  //    destroyed. `pickAt` is the same resolve E and the demolish key use.
  // ======================================================================
  const reach = of.game().factory.list.length;
  check('both machines are in the world', reach === 2, reach);

  const valid = fails.length === 0;
  return {
    valid, fails, log,
    generator: gen.pos, cell: gen.cell,
    offsetOnRefusedAim: offset,
    ghostReason: g1?.reason ?? '',
    placedBefore: before, placedAfter: after,
    refusalsDelta: refusals() - refusedBefore,
    clearPlacementM: +clearM.toFixed(4),
    kinds: listed().map((b) => `${b.kind}@${b.cell}`),
  };
})()
