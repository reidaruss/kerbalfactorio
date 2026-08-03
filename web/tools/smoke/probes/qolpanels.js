// qolpanels.js: EVERY panel key a player can press, one after another, in
// sandbox. For each: does it open, is it titled, does it say how to close, and
// does it say what it is for?
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=20 \
//        --evalfile=tools/smoke/probes/qolpanels.js
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const out = { panels: [] };
  const shownSet = () => {
    const list = [];
    const walk = (el) => {
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const own = [...c.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((s) => s).join(' ');
        const r = c.getBoundingClientRect();
        if (own && r.width > 0 && r.height > 0 && !own.startsWith('build')) list.push(own);
        walk(c);
      }
    };
    walk(document.body);
    return list;
  };
  await sleep(1.2);
  const base = shownSet();
  const bind = of.input.bindings();
  const label = (a) => (bind[a] ?? []).join('/');

  const ACTIONS = ['pack', 'build', 'research', 'power', 'equipment', 'goals'];
  for (const a of ACTIONS) {
    const before = shownSet();
    of.input.press(a, 4);
    await sleep(0.7);
    const after = shownSet();
    const added = after.filter((s) => !before.includes(s));
    const removed = before.filter((s) => !after.includes(s));
    const modals = of.modals ? of.modals() : null;
    // Close it again the way a player does, and check that it went.
    of.input.press('cancel', 4);
    await sleep(0.6);
    const closed = shownSet();
    out.panels.push({
      action: a, key: label(a),
      opened: added.length > 0,
      added: added.slice(0, 60),
      removedOnOpen: removed.slice(0, 10),
      modalsWhileOpen: modals,
      escapeClosedIt: added.every((s) => !closed.includes(s)),
      stillShowingAfterEscape: added.filter((s) => closed.includes(s)).slice(0, 10),
    });
  }
  out.baseScreen = base;
  return { valid: true, ...out }
})()
