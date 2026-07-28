// W7 / W11 H-7: the pack shows the items, not their names.
//
//   node web/tools/smoke/run.mjs --url=http://127.0.0.1:4187/ --sandbox=1 \
//        --evalfile=web/tools/smoke/probes/icons.js \
//        --out=docs/screenshots/W11_icons.png
//
// THE ASSERTION IS PIXELS AND TRIANGLES, NOT A COUNT. A canvas that rendered
// nothing still produces a perfectly valid PNG data URL, so "26 icons baked" is
// true of twenty-six blank squares. ItemIcons therefore reports, per row, the
// triangles it actually BOUND and the non-background pixels that actually
// landed, and this probe fails on either being zero. A lookup that "found" a
// multi-primitive node and bound none of it is the exact shape of bug that has
// caught three files in this repo in two days.
//
// AND IT IS ASSERTED BY /core ItemId, not by a display string, because a string
// is not an identity: "Power pole" is a name TWO different ItemIds carry.
//
// The negative controls are the point. Three of them, and a build where
// everything claimed an icon fails all three.
(async () => {
  const of = window.__of;
  const MIN_BYTES = OF_ARGS.minBytes ?? 900;
  // 4096 pixels in a 64x64 cell. 120 is 2.9% of it: below the thinnest real
  // silhouette here and far above the zero an empty camera view produces.
  const MIN_PIXELS = OF_ARGS.minPixels ?? 120;

  // H-7 ITSELF: three ids that were craftable, placeable and pictureless.
  // [ItemId, /core display name, the hotbar part that places it].
  const H7 = [
    ['0x003d', 'Electric smelter', 'esmelter'],
    ['0x003e', 'Burner generator', 'generator'],
    ['0x003f', 'Power pole', 'pole'],
  ];
  // THE FULL SET THAT ALREADY WORKED, listed rather than counted, so a fix that
  // quietly broke an old icon while adding three new ones cannot pass.
  const BEFORE_OK = [
    'Wood', 'Stone', 'Coal', 'Raw iron', 'Raw copper', 'Iron', 'Copper', 'Water',
    'Oil', 'Ferrite ore', 'Ferrite plate', 'Frame part', 'Cinderite',
    'Combustite', 'Crude pickaxe', 'Crude axe', 'Primitive furnace', 'Smelter',
    'Miner', 'Belt',
  ];
  // NEGATIVE CONTROL 1: a real /core item, in the real craft menu, that is
  // DELIBERATELY unmapped because no science-pack mesh ships. It must still
  // report the fallback.
  const UNMAPPED = 'Automation science';
  // NEGATIVE CONTROL 2: an id that is not an item at all.
  const BOGUS_ID = '0xbeef';
  // NEGATIVE CONTROL 3: a hotbar part whose icon name is deliberately '', on the
  // SAME render path as the three slots that must now show a picture.
  const NO_ICON_SLOT = 6;

  const settle = async (secs) => {
    of.input.tape([{ hold: Math.ceil(60 * secs) + 30, keys: [] }]);
    await of.run(secs, 60);
  };
  const txt = (el) => (el === null ? '' : (el.textContent ?? '').trim());

  await settle(1.0);
  await of.wipe();
  const t0 = of.world();
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };

  // --- SETUP, and it reports itself: fill the pack from the world -----------
  let swings = 0;
  const kinds = new Set();
  for (const n of of.nodes()) {
    if (kinds.has(n.kind)) continue;
    kinds.add(n.kind);
    for (let k = 0; k < 8; ++k) if (of.harvest(n.index).ok) swings++;
  }
  // Craft everything the pack can pay for. The index is the LOOP's, not
  // indexOf's: of.game() rebuilds the report every call, so indexOf against a
  // freshly built array compares object identity across two different arrays.
  const crafted = [];
  for (let pass = 0; pass < 3; ++pass) {
    const rs = of.game().recipes;
    for (let i = 0; i < rs.length; ++i) {
      if (rs[i].craftable && of.craft(i)) crafted.push(rs[i].name);
    }
  }
  // Put the three on the hotbar, in slots 7 to 9, through the same assign a
  // player's pack-tile click uses. Slot 6 is left as foundation on purpose.
  for (let i = 0; i < H7.length; ++i) of.assignSlot(7 + i, H7[i][2]);
  await settle(1.2);

  // --- open the panel through the pointer transition and frame the shot -----
  of.panel(true);
  await settle(0.6);

  const rep = of.game();
  const icons = rep.icons;
  const bytes = icons.bytes;
  const byId = {};
  const byName = {};
  for (const d of icons.detail) { byId[d.id] = d; byName[d.name] = d; }
  const explained = new Set(icons.textOnly.map((t) => t.name));

  // --- WHAT THE PLAYER SEES. The DOM, not the table. ------------------------
  const menu = [...document.querySelectorAll('.of-recipe')].map((el) => {
    const img = el.querySelector('.top .nm img');
    return { name: txt(el.querySelector('.top .nm')).replace(/\s+x\d+$/, ''),
      src: img === null ? '' : img.getAttribute('src') ?? '' };
  });
  const slots = [...document.querySelectorAll('.of-hslot')].map((el) => {
    const img = el.querySelector('img');
    return { i: Number(el.getAttribute('data-i')) + 1,
      text: txt(el.querySelector('.tx')),
      src: img === null ? '' : img.getAttribute('src') ?? '' };
  });
  const slotAt = (n) => slots.find((s) => s.i === n) ?? { src: '', text: '' };

  const menuIconless = menu.filter((r) => r.src === '').map((r) => r.name);
  const menuUnexplained = menuIconless.filter((n) => !explained.has(n));
  const menuSrcs = menu.filter((r) => r.src !== '').map((r) => r.src);

  // --- PER-ID ASSERTIONS ----------------------------------------------------
  const perId = H7.map(([id, name, part], k) => {
    const d = byId[id] ?? null;
    const row = menu.find((r) => r.name === name) ?? null;
    const slot = slotAt(7 + k);
    return {
      id, name, part,
      node: d === null ? '' : d.nodes,
      tris: d === null ? 0 : d.tris,
      pixels: d === null ? 0 : d.pixels,
      bytes: d === null ? 0 : d.bytes,
      fallback: d === null ? 'no table row' : d.fallback,
      coreNamesIt: rep.recipes.some((r) => r.name === name),
      inMenuWithIcon: row !== null && row.src.startsWith('data:image/'),
      onHotbarWithIcon: slot.src.startsWith('data:image/'),
      ok: d !== null && d.name === name && d.fallback === '' && d.tris > 0
        && d.pixels >= MIN_PIXELS && d.bytes >= MIN_BYTES
        && (bytes[name] ?? 0) >= MIN_BYTES
        && rep.recipes.some((r) => r.name === name)
        && row !== null && row.src.startsWith('data:image/')
        && slot.src.startsWith('data:image/'),
    };
  });

  // --- REGRESSION: the whole previously-working set, one by one -------------
  const regressed = BEFORE_OK.filter((n) => {
    const d = byName[n];
    return d === undefined || d.fallback !== '' || d.tris <= 0
      || d.pixels < MIN_PIXELS || (bytes[n] ?? 0) < MIN_BYTES;
  });

  // --- NEGATIVE CONTROLS ----------------------------------------------------
  const unmappedRow = menu.find((r) => r.name === UNMAPPED) ?? null;
  const negatives = {
    // 1. A real, listed, deliberately mesh-less item still falls back to text,
    //    and the report SAYS WHY rather than just omitting it.
    unmappedItemFallsBack: unmappedRow !== null && unmappedRow.src === ''
      && !(UNMAPPED in bytes) && explained.has(UNMAPPED)
      && (icons.textOnly.find((t) => t.name === UNMAPPED)?.why ?? '') !== '',
    // 2. A bogus id has no row, and the table is fully accounted for: every row
    //    is exactly one of baked, broken, or deliberately text.
    bogusIdHasNoIcon: byId[BOGUS_ID] === undefined
      && icons.detail.length === icons.icons + icons.broken.length
        + icons.textOnly.length,
    // 3. The hotbar's own deliberate blank still renders TEXT, on the same path
    //    as the three slots beside it that now render a picture.
    blankHotbarSlotIsText: slotAt(NO_ICON_SLOT).src === ''
      && slotAt(NO_ICON_SLOT).text !== '',
    // 4. Every picture in the menu is a DIFFERENT picture. One shared blank or
    //    one shared placeholder standing in for everything fails here.
    everyIconDistinct: menuSrcs.length > 0
      && new Set(menuSrcs).size === menuSrcs.length,
  };

  const setupRan = swings > 0 && (of.world().tick - t0.tick) > 60
    && crafted.length >= 3 && rep.panelOpen === true && menu.length >= 13
    && slots.length === 9 && icons.px === 64;

  return {
    // --- THE ACCEPTANCE -----------------------------------------------------
    valid: setupRan
      && perId.every((p) => p.ok)
      && regressed.length === 0
      && icons.broken.length === 0
      && menuUnexplained.length === 0
      && Object.values(negatives).every(Boolean),
    setupRan,
    perId,
    regressed,
    negatives,
    // H-7's own number. Three hotbar slots held these three parts and drew
    // their names; they now draw their meshes.
    hotbarIconlessBefore: 3,
    hotbarIconlessNow: perId.filter((p) => !p.onHotbarWithIcon).length,
    // The wider truth this lane found: NINE craft rows had no picture, not
    // three. Seven are now drawn and the two that are not say why.
    menuRows: menu.length,
    menuIconlessBefore: 9,
    menuIconlessNow: menuIconless,
    menuUnexplained,
    icons: {
      baked: icons.icons, px: icons.px, ms: icons.ms,
      broken: icons.broken, textOnly: icons.textOnly,
      smallestBytes: Math.min(...Object.values(bytes)),
      smallestPixels: Math.min(...icons.detail.filter((d) => d.nodes !== '')
        .map((d) => d.pixels)),
      totalKB: +(Object.values(bytes).reduce((a, b) => a + b, 0) / 1024).toFixed(1),
    },
    detail: icons.detail,
    crafted,
    swings,
    carried: rep.carried.map((c) => c.name),
    hotbar: slots.map((s) => `${s.i}:${s.src === '' ? `text(${s.text})` : 'icon'}`),
    cost: { frameMs: of.stats().frameMs, draw: of.stats().draw.calls },
  };
})()
