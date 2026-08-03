// qolpack.js: the pack and the hand-crafting column, as a player meets them.
// Ends with the panel OPEN so --out photographs it.
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=20 \
//        --evalfile=tools/smoke/probes/qolpack.js --out=docs/screenshots/QOL_pack.png
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const out = {};
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

  // The crosshair prompt: aim at each kind of node and read what the game says.
  const prompts = [];
  const seen = new Set();
  for (const n of of.nodes()) {
    if (seen.has(n.kind)) continue;
    seen.add(n.kind);
    // Aim the walker at the node through the same teleport+look a player's feet
    // and mouse would produce is not available; instead read the target the
    // interact system publishes after harvesting nothing, plus the node's name.
    prompts.push({ kind: n.kind, name: n.name, art: n.art,
                   remaining: n.remaining, initial: n.initial,
                   distanceM: n.distanceM });
  }
  out.nodeTable = prompts;

  // Fill the pack the way ten minutes of play would.
  const take = (kind, times) => {
    for (let i = 0; i < times; ++i) {
      const n = of.nodes().find((q) => q.kind === kind && q.remaining > 0);
      if (!n) return;
      of.harvest(n.index);
    }
  };
  take(0, 6); take(1, 6); take(3, 4); take(2, 3);
  await sleep(0.5);

  // What the pack panel says, opened by the key a player presses.
  const before = shown();
  of.input.press('pack', 4);
  await sleep(0.6);
  out.packOpenText = shown().filter((s) => !before.includes(s));
  out.modals = of.modals ? of.modals() : null;

  // The recipe rows AS DRAWN: name, whether the button is disabled, and the
  // sentence (if any) a greyed row gives.
  out.recipeRows = [...document.querySelectorAll('.of-recipe')].map((el) => ({
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cls: el.className,
    buttonDisabled: !!el.querySelector('button')?.disabled,
  }));
  out.packSlots = [...document.querySelectorAll('.of-slot, .slot')].map((el) =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 30);

  // Craft a pickaxe: what changes on screen, and does the swing change?
  const g = of.game();
  const rs = g?.recipes ?? [];
  const pi = rs.findIndex((r) => /pick/i.test(r.name));
  out.pickaxeRow = rs[pi] ?? null;
  const yieldBefore = (() => {
    const n = of.nodes().find((q) => q.kind === 3 && q.remaining > 0);
    const r = n ? of.harvest(n.index) : null;
    return r?.granted ?? r?.carried ?? null;
  })();
  const crafted = pi >= 0 ? of.craft(pi) : false;
  await sleep(0.6);
  const yieldAfter = (() => {
    const n = of.nodes().find((q) => q.kind === 3 && q.remaining > 0);
    const r = n ? of.harvest(n.index) : null;
    return r?.granted ?? r?.carried ?? null;
  })();
  out.pickaxe = { crafted, yieldBefore, yieldAfter,
                  toolReport: of.game()?.interact ?? null };
  out.afterCraftText = shown();
  return { valid: true, ...out };
})()
