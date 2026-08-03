// qolctl.js: the Options / Controls page, which is the only in-game place a
// player can read the controls when the debug HUD is off.
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  await sleep(1.0);
  of.input.press('cancel', 4);
  await sleep(0.6);
  const opens = [...document.querySelectorAll('button')]
    .filter((b) => b.offsetParent !== null && (b.textContent ?? '').trim() === 'Open');
  const which = (typeof OF_ARGS === 'object' && Number(OF_ARGS.i)) || 1;
  const b = opens[which];
  if (!b) return { valid: false, why: `only ${opens.length} Open buttons` };
  b.click();
  await sleep(0.7);
  const rows = [];
  const walk = (el) => {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const own = [...c.childNodes].filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((s) => s).join(' ');
      const r = c.getBoundingClientRect();
      if (own && !own.startsWith('build') && r.width > 0) {
        rows.push({ t: own, y: Math.round(r.y) });
      }
      walk(c);
    }
  };
  walk(document.body);
  const panel = document.querySelector('.of-pause, #of-pause, [class*=pause]');
  return { valid: true, count: opens.length, rows,
           scrollH: panel ? panel.scrollHeight : null,
           clientH: panel ? panel.clientHeight : null }
})()
