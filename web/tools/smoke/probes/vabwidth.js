// vabwidth.js: WHICH axis actually scrolled, before and after the tabs.
//
// Kept because it corrected the diagnosis. Reid asked for tabs and said he
// "shouldnt have to horizontal scroll", and horizontal was the wrong axis: the
// rail's list is `overflow-y: auto` and its rows are block-level at width 100%,
// so it never overflowed sideways at any window width down to 760 px (measured
// with the fix removed: worst 0 px at 1600, 900 and 760). What it DID do was
// scroll vertically past the bottom of a 330 px rail with 24 rows in it.
(async () => {
  const of = window.__of;
  if (!of || typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  of.vab('enter');
  await of.run(3);
  const rows = [];
  const t0 = of.vab('tabs');
  for (const g of t0.tabs) {
    const t = of.vab('tab', g);
    rows.push({ tab: g, rows: t.rowsShown, client: t.listClientWidth,
                over: t.overflowPx, scrollPx: t.scrollPx,
                h: t.listScrollHeight, ch: t.listClientHeight,
                widestRow: t.widestRowPx, rail: t.railClientWidth,
                bar: t.barOverflowPx });
  }
  // What the SAME rail would be if every group were listed at once, which is
  // what shipped: the tab heights sum, and the headings are on top of that.
  const oneColumnPx = rows.reduce((a, r) => a + r.h, 0);
  return { valid: true, viewport: [window.innerWidth, window.innerHeight],
           worstOverflowPx: Math.max(...rows.map((r) => r.over)),
           worstScrollPx: Math.max(...rows.map((r) => r.scrollPx)),
           barOverflowPx: Math.max(...rows.map((r) => r.bar)),
           untabbedColumnPx: oneColumnPx,
           railHeightPx: rows[0] === undefined ? 0 : rows[0].ch,
           rows };
})()
