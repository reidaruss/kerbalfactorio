// W7: the pack shows the items, not their names.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/icons.js --out=docs/screenshots/W7_icons.png
//
// THE ASSERTION IS BYTES, NOT A COUNT. A canvas that rendered nothing still
// produces a perfectly valid PNG data URL, so "20 icons baked" is true of twenty
// blank squares. A transparent 64x64 PNG is a few hundred bytes and a drawn one
// is thousands, so every icon is checked to be over a threshold no empty render
// can reach, and the smallest one is reported so the margin is visible.
//
// It then fills the pack from the world and opens the real Tab panel through the
// real pointer transition, so the capture is the panel a player sees.
(async () => {
  const of = window.__of;
  const MIN_BYTES = OF_ARGS.minBytes ?? 900;
  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  const g0 = of.game();
  if (g0 === null) return { valid: false, why: 'no gameplay layer' };

  // --- fill the pack from the world, so the slots have something to show ----
  let swings = 0;
  const kinds = new Set();
  for (const n of of.nodes()) {
    if (kinds.has(n.kind)) continue;
    kinds.add(n.kind);
    for (let k = 0; k < 6; ++k) if (of.harvest(n.index).ok) swings++;
  }
  // Craft both tools and a furnace if the pack can pay: those are the icons
  // that come from the tool and machine files rather than from the atlas, and
  // an atlas-only check would not notice them missing.
  // The index is the LOOP's, not indexOf's: of.game() rebuilds the report every
  // call, so indexOf against a freshly built array compares object identity
  // across two different arrays and silently returns -1 for everything.
  const crafted = [];
  for (let pass = 0; pass < 2; ++pass) {
    const rs = of.game().recipes;
    for (let i = 0; i < rs.length; ++i) {
      if (rs[i].craftable && of.craft(i)) crafted.push(rs[i].name);
    }
  }
  await settle(1.2);

  const rep = of.game();
  const icons = rep.icons;
  const sizes = Object.entries(icons.bytes);
  const carried = rep.carried.map((c) => c.name);
  // Only what the player is actually holding has to have a picture in THIS
  // capture; every baked icon is size-checked regardless.
  const missing = carried.filter((n) => !(n in icons.bytes));
  const blank = sizes.filter(([, b]) => b < MIN_BYTES).map(([n]) => n);

  // --- open the panel through the pointer transition and frame the shot -----
  of.panel(true);
  await settle(0.5);

  return {
    valid: swings > 0 && (of.world().tick - t0.tick) > 60
      && of.game().panelOpen && carried.length >= 3,
    // --- THE ACCEPTANCE -----------------------------------------------------
    iconsAreReal: icons.icons >= 20 && sizes.length >= 20
      && blank.length === 0 && missing.length === 0,
    icons: { baked: icons.icons, px: icons.px, ms: icons.ms,
      smallestBytes: Math.min(...sizes.map(([, b]) => b)),
      largestBytes: Math.max(...sizes.map(([, b]) => b)),
      totalKB: +(sizes.reduce((a, [, b]) => a + b, 0) / 1024).toFixed(1) },
    blank,
    missing,
    carried,
    crafted,
    swings,
    panelOpen: of.game().panelOpen,
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
  };
})()
