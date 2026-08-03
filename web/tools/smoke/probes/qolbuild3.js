// qolbuild3.js: QOL SURVEY, stage 3. DEMOLITION, machine scale, and the VAB.
// --evalargs={"stage":"demolish"|"scale"|"vab"|"vabinsert"}
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const stage = (OF_ARGS && OF_ARGS.stage) || 'demolish';
  const txt = (el) => (el === null || el === undefined ? null
    : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
  const chrome = () => ({
    prompt: txt(document.querySelector('#of-prompt')),
    toast: txt(document.querySelector('#of-toast')),
    banner: txt(document.querySelector('#of-banner')),
    carry: txt(document.querySelector('#of-carry')),
  });
  const out = { stage, sandbox: of.sandbox().sandbox };
  const press = async (f) => {
    of.input.tape([{ hold: f || 4, actions: ['use'] }, { hold: 8, keys: [] }]);
    await sleep(0.35);
  };
  const yaw0 = () => of.world().observer.yawDeg;
  const aimAt = async (want) => {
    for (let p = -75; p <= -5; p += 3) {
      of.look(yaw0(), p);
      await sleep(0.06);
      if (want()) return p;
    }
    return null;
  };
  await sleep(0.9);

  if (stage === 'scale') {
    // How big is a machine next to the player, and does placing it put the
    // player INSIDE it?
    const feet = () => of.world().player.feet;
    const f0 = feet().slice();
    of.hotbar(5);
    await sleep(0.4);
    of.look(yaw0(), -45);
    await sleep(0.3);
    const g = of.build().ghost;
    out.ghostDistM = Math.round(Math.hypot(g.pos[0] - f0[0], g.pos[1] - f0[1],
      g.pos[2] - f0[2]) * 100) / 100;
    out.ghostFootprint = g.footprint;
    await press(4);
    await sleep(0.6);
    const b = of.game().factory.buildingList
      || (of.game().factory.placedList ?? null);
    out.factoryKeys = Object.keys(of.game().factory);
    out.machineTileM = of.game().factory.tileM ?? null;
    const w = of.world().player;
    out.after = { blockedByBuild: w.blockedByBuild, onDeck: w.onDeck,
      structureTests: w.structureTests, chrome: chrome() };
    // Walk forward into it and see whether anything says so
    of.input.tape([{ hold: 60, actions: ['forward'] }, { hold: 4, keys: [] }]);
    await sleep(1.6);
    const w2 = of.world().player;
    out.afterWalk = { blockedByBuild: w2.blockedByBuild,
      movedM: Math.round(Math.hypot(w2.feet[0] - f0[0], w2.feet[1] - f0[1],
        w2.feet[2] - f0[2]) * 100) / 100, chrome: chrome() };
  }

  if (stage === 'demolish') {
    // Build three things, then remove them three ways and record EVERY word.
    of.hotbar(4);
    await sleep(0.4);
    of.look(yaw0(), -50);
    await sleep(0.3);
    // a run of belts, so there is plenty to remove
    of.input.tape([{ hold: 70, actions: ['use', 'forward'] }, { hold: 6, keys: [] }]);
    await sleep(2.0);
    out.builtFactory = of.game().factory.buildings;
    out.dem0 = of.game().demolition;

    // 1. X with a PART in hand: does it demolish, or place?
    of.hotbar(4);
    await sleep(0.3);
    const b0 = of.game().factory.buildings;
    await aimAt(() => of.game().aimed.build !== null);
    out.aimedForX = of.game().aimed;
    of.input.act(['demolish'], 4);
    await sleep(0.6);
    out.xWithPartInHand = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b0, chrome: chrome(),
      demolition: of.game().demolition };

    // 2. Mouse2 by REFLEX. Bound to `demolish`. Fire it as a real DOM event
    //    on the canvas, which is what a right-click actually is.
    // THE BIG canvas: the icon baker keeps small hidden ones and
    // querySelector('canvas') hands back whichever is first in the DOM.
    const cvs = [...document.querySelectorAll('canvas')];
    out.canvases = cvs.map((c) => `${c.width}x${c.height}`);
    let cv = null;
    for (const c of cvs) {
      if (cv === null || c.width * c.height > cv.width * cv.height) cv = c;
    }
    out.canvasPicked = cv === null ? null : `${cv.width}x${cv.height}`;
    const b1 = of.game().factory.buildings;
    await aimAt(() => of.game().aimed.build !== null);
    out.aimedForMouse2 = of.game().aimed;
    if (cv !== null) {
      const o = { bubbles: true, pointerId: 1, pointerType: 'mouse' };
      cv.dispatchEvent(new PointerEvent('pointerdown',
        { ...o, button: 2, buttons: 2 }));
      await sleep(0.25);
      cv.dispatchEvent(new PointerEvent('pointerup',
        { ...o, button: 2, buttons: 0 }));
    }
    await sleep(0.5);
    out.mouse2dom = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b1 };
    // AND the raw key code, which is what the binding table says Mouse2 is.
    const b1b = of.game().factory.buildings;
    await aimAt(() => of.game().aimed.build !== null);
    of.input.tape([{ hold: 4, keys: ['Mouse2'] }, { hold: 8, keys: [] }]);
    await sleep(0.6);
    out.mouse2code = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b1b, chrome: chrome() };
    out.mouse2 = { buildings: of.game().factory.buildings,
      delta: of.game().factory.buildings - b1, chrome: chrome(),
      demolition: of.game().demolition };

    // 3. The X key on a STRUCTURE. Is there a confirm? A refund?
    of.hotbar(6);
    await sleep(0.4);
    of.look(yaw0(), -50);
    await sleep(0.3);
    await press(4);
    out.builtStructures = of.game().structures.parts.length;
    of.hotbar(1);
    await sleep(0.3);
    const s0 = of.game().structures.parts.length;
    const carried0 = of.game().carried;
    await aimAt(() => of.game().aimed.part !== null);
    out.aimedPart = of.game().aimed;
    of.input.act(['demolish'], 4);
    await sleep(0.7);
    out.xOnStructure = { parts: of.game().structures.parts.length,
      delta: of.game().structures.parts.length - s0,
      carriedBefore: carried0, carriedAfter: of.game().carried,
      chrome: chrome(), demolition: of.game().demolition,
      modals: of.modals().modals.filter((m) => m.open).map((m) => m.name) };

    // 4. Held X: how many does one hold remove?
    of.input.tape([{ hold: 60, actions: ['demolish'] }, { hold: 4, keys: [] }]);
    await sleep(1.6);
    out.heldX = { buildings: of.game().factory.buildings,
      parts: of.game().structures.parts.length,
      demolition: of.game().demolition, chrome: chrome() };
    out.refundText = txt(document.querySelector('#of-gain'));
  }

  if (stage === 'vab') {
    out.before = { modals: of.modals().modals.filter((m) => m.open)
      .map((m) => m.name), chrome: chrome() };
    of.input.act(['assembly'], 4);
    await sleep(1.2);
    const r = of.vab();
    out.report = r;
    const root = document.querySelector('#of-vab');
    out.vabText = txt(root);
    out.tabs = of.vab('tabs');
    out.catalogue = of.vab('catalogue');
    out.line = of.vab('line');
    out.verdictBand = of.vab('verdictBand');
    out.buttons = root === null ? null
      : [...root.querySelectorAll('button, [data-vab]')].slice(0, 60)
        .map((e) => ({ t: txt(e), v: e.getAttribute('data-vab'),
          n: e.getAttribute('data-name'), title: e.getAttribute('title'),
          dis: e.disabled === true }));
    out.floor = of.vab('floor');
    out.cam = of.vab('orbit', 35, -20);
  }

  if (stage === 'vabinsert') {
    of.input.act(['assembly'], 4);
    await sleep(1.2);
    // Take the first catalogue part and place it, counting the gestures.
    const cat = of.vab('catalogue');
    out.catalogueIds = (cat.parts || cat.rows || []).slice(0, 20);
    const first = of.vab('take', 0);
    out.tookFirst = { holding: first && first.holding, line: of.vab('line') };
    out.nodes0 = of.vab('nodes');
    const placed0 = of.vab().parts;
    out.place0 = of.vab('place');
    out.afterFirst = { parts: of.vab().parts, line: of.vab('line'),
      verdict: of.vab('verdictBand') };
    // second part, snapped
    of.vab('take', 1);
    const ns = of.vab('nodes');
    out.nodeCount = Array.isArray(ns) ? ns.length : null;
    if (Array.isArray(ns) && ns.length > 0) {
      const n = ns[0];
      out.hover = of.vab('hover', n.ndcX ?? n.x ?? 0, n.ndcY ?? n.y ?? 0);
    }
    out.place1 = of.vab('place');
    out.afterSecond = { parts: of.vab().parts, line: of.vab('line'),
      verdict: of.vab('verdictBand') };
    out.gaps = of.vab('gaps');
    // insert into the stack
    out.insert = of.vab('insert', 0, 1);
    out.afterInsert = { parts: of.vab().parts, line: of.vab('line') };
    // remove
    out.remove = of.vab('remove', 1);
    out.afterRemove = { parts: of.vab().parts, line: of.vab('line') };
    out.rollout = of.vab('rollout');
    out.verdict = of.vab('verdict');
    out.vabText = txt(document.querySelector('#of-vab'));
  }

  out.endChrome = chrome();
  return out;
})()
