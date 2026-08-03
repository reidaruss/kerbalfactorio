// qolspawn.js: the first ten minutes, with a QUALITY-OF-LIFE lens.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/qolspawn.js
//
// This RECORDS far more than it asserts. The deliverable is a list of things
// that would make a player hesitate, so every stage writes down what is ON THE
// SCREEN (the drawn text, not the model behind it), because "the state is
// correct" and "the player can tell" are different claims and only the second
// one is this pass's subject.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const notes = [];
  const note = (s) => { notes.push(s); };
  const sleep = (n) => of.run(n);
  const txt = (sel) => [...document.querySelectorAll(sel)]
    .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);

  await sleep(1.5);

  // ===== 1. WHAT IS ON THE SCREEN AT SPAWN =================================
  const w = of.world();
  const g = of.game();
  note(`world: biome ${w.biome} alt ${w.altM?.toFixed(1)} mode ${g?.mode ?? '?'}`);

  // Every visible element that carries words, top to bottom, so the survey is
  // of the SCREEN and not of the objects I happen to know about.
  const visibleText = [];
  const walk = (el) => {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const own = [...c.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
        .filter((s) => s).join(' ');
      const r = c.getBoundingClientRect();
      if (own && r.width > 0 && r.height > 0) {
        visibleText.push({ t: own, x: Math.round(r.x), y: Math.round(r.y),
                           id: c.id || null, cls: c.className || null });
      }
      walk(c);
    }
  };
  walk(document.body);
  visibleText.sort((a, b) => a.y - b.y || a.x - b.x);

  // ===== 2. THE CHECKLIST ==================================================
  const goals = of.goals();
  const rows = (goals.rows ?? []).map((r) => ({
    text: r.text, hint: r.hint, done: r.done, current: r.current, moot: r.moot,
  }));

  // ===== 3. THE HOTBAR AND WHAT THE LEFT BUTTON DOES =======================
  const report = g;
  const hot = report?.hotbar ?? null;

  // ===== 4. THE PACK =======================================================
  const pack = report?.inventory ?? report?.pack ?? null;

  // ===== 5. WHAT THE PLAYER IS LOOKING AT AND WHETHER IT SAYS SO ===========
  const aim = of.aim();
  const nodes = of.nodes();

  // ===== 6. THE FIRST ACTION: SWING AT NOTHING =============================
  // A miss is the commonest thing a new player does. Does the game say anything?
  const before = JSON.stringify(report?.counts ?? {});
  const flashesBefore = txt('.of-flash, [class*=flash]');
  of.look(0, 0);                       // level, at the horizon: nothing in reach
  await sleep(0.2);
  of.input.act(['primary'], 12);
  await sleep(0.8);
  const flashesAfter = txt('.of-flash, [class*=flash]');
  const after = JSON.stringify(report?.counts ?? {});

  // ===== 7. HARVEST A TREE: the first goal =================================
  const wood = nodes.find((n) => n.kind === 0);
  let harvest = null;
  if (wood) {
    const r0 = of.harvest(wood.index);
    await sleep(0.4);
    harvest = { ok: !!r0, r0, distM: wood.distM ?? null };
  }

  // ===== 8. THE PANELS, BY THE KEYS A PLAYER PRESSES =======================
  const bind = of.input.bindings();
  const panelKeys = {};
  for (const k of ['craft', 'build', 'research', 'inventory', 'assembly',
                   'map', 'equip', 'power', 'goals', 'menu', 'cheats']) {
    panelKeys[k] = bind[k] ?? null;
  }

  return {
    valid: true,
    world: { biome: w.biome, altM: w.altM, mode: g?.mode ?? null },
    visibleText,
    goals: { index: goals.index, rows },
    hotbar: hot,
    pack,
    aim,
    nodeKinds: [...new Set(nodes.map((n) => n.kind))],
    nearestNodes: nodes.slice(0, 6).map((n) => ({ kind: n.kind, distM: n.distM,
                                                  index: n.index })),
    missSwing: { flashesBefore, flashesAfter, before, after },
    harvest,
    panelKeys,
    notes,
  };
})()
