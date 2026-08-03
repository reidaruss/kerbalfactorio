// qolmenu.js: the Escape menu and the testing panel, as Reid meets them.
// Ends with the menu OPEN so --out photographs it. OF_ARGS.page picks which.
//
//   node tools/smoke/run.mjs --sandbox=1 --evalfile=tools/smoke/probes/qolmenu.js \
//        --evalargs='{"page":"root"}' --out=docs/screenshots/QOL_menu.png
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  const page = (typeof OF_ARGS === 'object' && OF_ARGS.page) || 'root';
  const out = { page };
  const shown = () => {
    const list = [];
    const walk = (el) => {
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const own = [...c.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((s) => s).join(' ');
        const r = c.getBoundingClientRect();
        if (own && r.width > 0 && r.height > 0) list.push({ t: own, y: Math.round(r.y) });
        walk(c);
      }
    };
    walk(document.body);
    return list;
  };
  await sleep(1.2);
  const before = shown().map((e) => e.t);

  of.input.press('cancel', 4);
  await sleep(0.6);
  out.rootRows = shown().filter((e) => !before.includes(e.t));
  out.buttons = [...document.querySelectorAll('button')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => ({ t: (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
                   disabled: b.disabled, id: b.id || null,
                   press: b.dataset ? b.dataset.press ?? null : null }));

  if (page !== 'root') {
    // Walk into the named page through its own button, the way a player does.
    const want = page.toLowerCase();
    const b = [...document.querySelectorAll('button')]
      .find((q) => (q.textContent ?? '').toLowerCase().includes(want));
    out.foundButton = b ? (b.textContent ?? '').trim() : null;
    if (b) {
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      b.click();
      await sleep(0.6);
      out.pageRows = shown().map((e) => e.t);
      out.pageButtons = [...document.querySelectorAll('button')]
        .filter((q) => q.offsetParent !== null)
        .map((q) => ({ t: (q.textContent ?? '').replace(/\s+/g, ' ').trim(),
                       disabled: q.disabled }));
    }
  }
  return { valid: true, ...out }
})()
