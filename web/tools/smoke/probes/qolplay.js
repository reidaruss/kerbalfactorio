// qolplay.js: PLAY the first ten minutes with real input and write down every
// moment a player would have to guess.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/qolplay.js
//
// Records, does not assert. The subject is what the SCREEN says, so every stage
// captures the drawn text before and after the gesture rather than the model.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const out = {};
  const sleep = (n) => of.run(n);
  const shown = () => {
    const list = [];
    const walk = (el) => {
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const own = [...c.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((s) => s).join(' ');
        const r = c.getBoundingClientRect();
        if (own && r.width > 0 && r.height > 0) list.push(own);
        walk(c);
      }
    };
    walk(document.body);
    return list;
  };

  await sleep(1.2);

  // ===== 0. EVERY BINDING THE GAME PUBLISHES ===============================
  out.bindings = of.input.bindings();

  // ===== 1. AIM AT A TREE: does the crosshair say anything? ================
  const nodes = of.nodes();
  const tree = nodes.find((n) => n.kind === 0);
  out.treeFound = !!tree;
  if (tree) {
    // Point the camera at it the way a player would, using the node's own
    // position rather than a guess.
    const p = of.game();
    out.aimBefore = shown();
    // of.nodes() publishes screen coords for on-screen nodes; walk toward it.
    out.tree = { index: tree.index, kind: tree.kind, x: tree.x, y: tree.y, z: tree.z,
                 keys: Object.keys(tree) };
  }

  // ===== 2. THE MISS: swing at the sky ====================================
  of.look(0, 45);                       // straight up: nothing is ever there
  await sleep(0.3);
  const beforeMiss = shown();
  of.input.act(['primary'], 20);
  await sleep(0.6);
  const duringMiss = shown();
  await sleep(1.5);
  const afterMiss = shown();
  out.missSwing = {
    newDuringMiss: duringMiss.filter((s) => !beforeMiss.includes(s)),
    newAfterMiss: afterMiss.filter((s) => !beforeMiss.includes(s)),
  };

  // ===== 3. THE HARVEST: what does the screen say when it WORKS? ==========
  const before = shown();
  const w2 = of.nodes().find((n) => n.kind === 0);
  const h = w2 ? of.harvest(w2.index) : null;
  await sleep(0.6);
  const afterH = shown();
  out.harvest = {
    ok: !!h?.ok,
    carried: h?.carried ?? null,
    newOnScreen: afterH.filter((s) => !before.includes(s)),
  };

  // ===== 4. HARVEST A ROCK WITH BARE HANDS: the refusal ===================
  // Kind 1 is stone in this world's node table; the storyline says a bare hand
  // must not mine it. What does the screen say?
  const kinds = [...new Set(of.nodes().map((n) => n.kind))];
  out.nodeKinds = kinds;
  const refusals = [];
  for (const k of kinds) {
    const n = of.nodes().find((q) => q.kind === k);
    if (!n) continue;
    const b = shown();
    const r = of.harvest(n.index);
    await sleep(0.5);
    const a = shown();
    refusals.push({ kind: k, ok: !!r?.ok, reason: r?.reason ?? r?.why ?? null,
                    raw: r === null || r === undefined ? String(r) : undefined,
                    newOnScreen: a.filter((s) => !b.includes(s)) });
  }
  out.harvestByKind = refusals;

  // ===== 5. THE CRAFT PANEL: which key, and what does it offer? ===========
  const g = of.game();
  out.recipes = (g?.recipes ?? []).map((r) => ({ name: r.name, craftable: r.craftable,
                                                 why: r.why ?? r.reason ?? null }));
  out.packAfter = g?.pack ?? g?.inventory ?? null;

  // ===== 6. THE PACK, ON TAB ==============================================
  const beforeTab = shown();
  of.input.press('inventory', 4);
  await sleep(0.4);
  out.tabOpened = shown().filter((s) => !beforeTab.includes(s));
  of.input.press('cancel', 4);
  await sleep(0.3);

  out.modalsAfter = of.modals ? of.modals() : null;
  return { valid: true, ...out };
})()
