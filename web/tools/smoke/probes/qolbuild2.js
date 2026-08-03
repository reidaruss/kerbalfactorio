// qolbuild2.js: QOL SURVEY, stage 2. PLACING THINGS and THE FACTORY.
// Records the DRAWN prompt/toast for every gesture and every refusal.
// --evalargs={"stage":"place"|"drill"|"belt"|"machine"|"power"}
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const stage = (OF_ARGS && OF_ARGS.stage) || 'place';
  const txt = (el) => (el === null || el === undefined ? null
    : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
  const chrome = () => ({
    prompt: txt(document.querySelector('#of-prompt')),
    toast: txt(document.querySelector('#of-toast')),
    banner: txt(document.querySelector('#of-banner')),
    carry: txt(document.querySelector('#of-carry')),
    gain: txt(document.querySelector('#of-gain')),
  });
  const log = [];
  const out = { stage, sandbox: of.sandbox().sandbox, log };
  const press = async (frames) => {
    of.input.tape([{ hold: frames || 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };
  const yaw0 = () => of.world().observer.yawDeg;

  await sleep(0.9);

  if (stage === 'place') {
    // ---- a foundation, the first thing a player builds ------------------
    of.hotbar(6);
    await sleep(0.4);
    out.holdingFoundation = { chrome: chrome(), label: of.hotbar().label };
    const sweep = [];
    const y0 = yaw0();
    const feet = of.world().player.feet;
    const dOf = (g) => Math.round(Math.hypot(g.pos[0] - feet[0],
      g.pos[1] - feet[1], g.pos[2] - feet[2]) * 100) / 100;
    // PITCH ONLY: does aiming further away move the preview further away?
    for (let p = -85; p <= -5; p += 10) {
      of.look(y0, p);
      await sleep(0.06);
      const g = of.build().structGhost;
      sweep.push({ what: 'pitch', v: p, key: g && g.key, distM: g && dOf(g),
        ok: g && g.ok, reason: g && g.reason, ba: of.buildAim() });
    }
    // YAW: does turning move it?
    for (const dy of [0, 45, 90, 135, 180]) {
      of.look((y0 + dy + 360) % 360, -20);
      await sleep(0.06);
      const g = of.build().structGhost;
      sweep.push({ what: 'yaw', v: dy, key: g && g.key, distM: g && dOf(g),
        ok: g && g.ok, reason: g && g.reason, ba: of.buildAim() });
    }
    of.look(y0, -20);
    await sleep(0.1);
    out.aimSweep = sweep;
    // put one down straight ahead-ish
    of.look(yaw0(), -60);
    await sleep(0.2);
    out.beforeFirst = { chrome: chrome(), ghost: of.build().structGhost };
    await press(4);
    out.afterFirst = { chrome: chrome(),
      parts: of.game().structures.parts.length };
    // press again on the SAME cell: what does it say?
    await press(4);
    out.sameCellAgain = { chrome: chrome(),
      parts: of.game().structures.parts.length,
      ghost: of.build().structGhost };
    // aim at the sky: a placement with nothing under it
    of.look(yaw0(), 45);
    await sleep(0.3);
    out.skyGhost = { ghost: of.build().structGhost, chrome: chrome() };
    await press(4);
    out.skyPress = { chrome: chrome(),
      parts: of.game().structures.parts.length };
    // a WALL with no deck under it
    of.hotbar(8);
    await sleep(0.3);
    of.look(yaw0(), 20);
    await sleep(0.3);
    out.wallInAir = { ghost: of.build().structGhost, chrome: chrome() };
    await press(4);
    out.wallInAirPress = { chrome: chrome() };
    // rotate key with a structure in hand
    const t0 = of.build().turns;
    of.input.act(['rotate'], 4);
    await sleep(0.4);
    out.rotate = { turns0: t0, turns1: of.build().turns,
      rotation: of.build().rotation, chrome: chrome() };
    // free snap key
    const f0 = of.build().freePlace;
    of.input.act(['freeSnap'], 4);
    await sleep(0.4);
    out.freeSnap = { before: f0, after: of.build().freePlace, chrome: chrome() };
    out.buildAim = of.buildAim();
  }

  if (stage === 'drill') {
    // What does a player SEE that tells them where ore is?
    out.ore = of.game().ore;
    out.oreNodes = of.nodes().slice(0, 6);
    of.hotbar(3);
    await sleep(0.4);
    out.holdingDrill = { chrome: chrome(), label: of.hotbar().label };
    // sweep for a spot with NO ore -> record the refusal text
    const seen = [];
    for (let p = -80; p <= -15; p += 5) {
      of.look(yaw0(), p);
      await sleep(0.08);
      const g = of.build().ghost;
      seen.push({ pitch: p, ok: g && g.ok, reason: g && g.reason,
        rate: g && g.ratePerSec, patch: g && g.patch,
        prompt: txt(document.querySelector('#of-prompt')) });
    }
    out.drillSweep = seen;
    of.look(yaw0(), -50);
    await sleep(0.3);
    out.beforeDrillPress = chrome();
    await press(4);
    out.afterDrillPress = { chrome: chrome(),
      buildings: of.game().factory.buildings };
  }

  if (stage === 'onore') {
    // Stand ON the iron patch and look at it: what does the ground say?
    const p = of.game().ore.list.find((q) => q.resource === 51)
      || of.game().ore.list[0];
    const r = Math.hypot(p.centre[0], p.centre[1], p.centre[2]);
    const k = (r + 3) / r;
    of.standAt(p.centre[0] * k, p.centre[1] * k, p.centre[2] * k);
    await sleep(1.2);
    of.hotbar(3);
    await sleep(0.5);
    const seen = [];
    for (let dy = 0; dy < 360; dy += 30) {
      for (const pit of [-70, -45, -25]) {
        of.look(dy, pit);
        await sleep(0.05);
        const g = of.build().ghost;
        seen.push({ yaw: dy, pitch: pit, ok: g && g.ok,
          reason: g && g.reason, rate: g && g.ratePerSec, patch: g && g.patch });
      }
    }
    out.onOreSweep = seen.filter((s) => s.ok);
    out.onOreAll = seen.length;
    out.onOreOk = out.onOreSweep.length;
    const best = out.onOreSweep[0];
    if (best) { of.look(best.yaw, best.pitch); await sleep(0.3); }
    out.onOrePrompt = chrome();
    await press(4);
    out.onOrePlaced = { chrome: chrome(),
      buildings: of.game().factory.buildings };
    // aim at the placed drill with an empty hand
    of.hotbar(1);
    await sleep(0.4);
    for (let pit = -70; pit <= -5; pit += 3) {
      of.look(best ? best.yaw : 0, pit);
      await sleep(0.06);
      if (of.game().aimed.build !== null) break;
    }
    out.aimedDrill = { aimed: of.game().aimed, chrome: chrome() };
    // E on the drill
    of.input.act(['interact'], 4);
    await sleep(0.8);
    out.drillScreen = of.game().screen;
    out.drillPanel = txt(document.querySelector('#of-furnace'));
  }

  if (stage === 'belt') {
    of.hotbar(4);
    await sleep(0.4);
    out.holdingBelt = { chrome: chrome(), label: of.hotbar().label };
    of.look(yaw0(), -45);
    await sleep(0.25);
    // ONE tap = how many tiles?
    const b0 = of.game().factory.buildings;
    await press(4);
    out.oneTap = { placed: of.game().factory.buildings - b0,
      chrome: chrome(), build: of.build() };
    // A HELD drag while walking forward: how far does one gesture get you?
    const b1 = of.game().factory.buildings;
    of.input.tape([{ hold: 90, actions: ['use', 'forward'] }, { hold: 6, keys: [] }]);
    await sleep(2.2);
    out.heldDrag = { placed: of.game().factory.buildings - b1,
      chrome: chrome(), dragLength: of.build().longestDrag,
      dragSettles: of.build().dragSettles };
    out.runs = of.game().factory.runs;
    // Which way is it going? Is that visible anywhere?
    out.factory = { refusals: of.game().factory.refusals,
      links: of.game().factory.links };
    // aim at a placed belt with an EMPTY hand and read the prompt
    of.hotbar(1);
    await sleep(0.4);
    for (let p = -60; p <= -10; p += 4) {
      of.look(yaw0(), p);
      await sleep(0.08);
      if (of.game().aimed.build !== null) break;
    }
    out.aimedBelt = { aimed: of.game().aimed, chrome: chrome() };
  }

  if (stage === 'machine') {
    // a smelter, then E
    of.hotbar(5);
    await sleep(0.4);
    of.look(yaw0(), -45);
    await sleep(0.3);
    out.smelterGhost = { ghost: of.build().ghost, chrome: chrome() };
    await press(4);
    out.afterSmelter = { chrome: chrome(),
      buildings: of.game().factory.buildings };
    of.hotbar(1);
    await sleep(0.4);
    let found = null;
    for (let p = -60; p <= -5; p += 3) {
      of.look(yaw0(), p);
      await sleep(0.08);
      if (of.game().aimed.build !== null) { found = of.game().aimed; break; }
    }
    out.aimedSmelter = { found, chrome: chrome() };
    of.input.act(['interact'], 4);
    await sleep(0.7);
    out.screen = of.game().screen;
    const panel = document.querySelector('#of-furnace');
    out.panelText = txt(panel);
    out.panelOpen = of.game().furnaceOpen;
    out.panelHtmlIds = panel === null ? null
      : [...panel.querySelectorAll('[data-recipe],[data-slot],button')]
        .map((e) => ({ tag: e.tagName, t: txt(e),
          r: e.getAttribute('data-recipe'), s: e.getAttribute('data-slot'),
          title: e.getAttribute('title'), dis: e.disabled === true }));
  }

  if (stage === 'power') {
    // generator, then pole, then U
    of.hotbar(1);
    await sleep(0.3);
    of.build(0);
    // place a burner generator from the BUILD MENU, as a player would
    of.buildMenu(true);
    await sleep(0.5);
    const tile = document.querySelector('#of-build .of-btile[data-build="generator"]');
    out.pickedGenerator = tile !== null;
    if (tile !== null) { tile.click(); await sleep(0.6); }
    out.holdingGenerator = { chrome: chrome(), label: of.hotbar().label };
    of.look(yaw0(), -45);
    await sleep(0.3);
    await press(4);
    out.afterGenerator = { chrome: chrome(),
      buildings: of.game().factory.buildings,
      offGrid: of.game().offGridGenerators };
    // aim at it with an empty hand
    of.hotbar(1);
    await sleep(0.4);
    for (let p = -60; p <= -5; p += 3) {
      of.look(yaw0(), p);
      await sleep(0.08);
      if (of.game().aimed.build !== null) break;
    }
    out.aimedGenerator = { aimed: of.game().aimed, chrome: chrome() };
    // the power panel
    of.input.act(['power'], 4);
    await sleep(0.7);
    const p = document.querySelector('#of-power');
    out.powerPanelText = txt(p);
    out.powerModel = of.game().factory.power;
    out.progress = of.game().progress;
  }

  out.endChrome = chrome();
  out.counts = { structures: of.game().structures.parts.length,
    factory: of.game().factory.buildings,
    machines: of.game().machines.length };
  return out;
})()
