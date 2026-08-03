// qolbuild1.js: QOL SURVEY, stage 1. The build menu, the hotbar, and what a
// player can READ off the screen. Records DRAWN text, never model state alone.
// Stages via --evalargs={"stage":"..."}: menu | hotbar | pack
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const stage = (OF_ARGS && OF_ARGS.stage) || 'menu';
  const txt = (el) => (el === null || el === undefined ? null
    : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
  const out = { stage, sandbox: of.sandbox().sandbox };

  await sleep(0.8);

  // What the keyboard actually does, as the game's own table says.
  out.bindings = of.input.bindings();

  if (stage === 'menu') {
    of.input.act(['build'], 4);
    await sleep(0.6);
    const root = document.querySelector('#of-build');
    out.menuOpen = of.buildMenu().open;
    out.menuHeading = txt(root && root.querySelector('h3'));
    out.menuHint = txt(root && root.querySelector('.hint'));
    out.groups = [...(root ? root.querySelectorAll('.grp') : [])].map((g) => ({
      name: txt(g.querySelector('h4')),
      tiles: [...g.querySelectorAll('.of-btile')].map((t) => ({
        id: t.getAttribute('data-build'),
        cls: t.className,
        name: txt(t.querySelector('.nm')),
        cost: txt(t.querySelector('.cost')),
        ing: txt(t.querySelector('.ing')),
        lock: txt(t.querySelector('.lock')),
        title: t.getAttribute('title'),
        hasImg: t.querySelector('.art img') !== null,
        imgAlt: (t.querySelector('.art img') || {}).alt || null,
      })),
    }));
    // Is there ANY description of what a thing DOES anywhere in the menu?
    out.menuFullText = txt(root);
    out.tilesWithTitle = out.groups.reduce((a, g) =>
      a + g.tiles.filter((t) => t.title !== null && t.title !== '').length, 0);
    out.tileCount = out.groups.reduce((a, g) => a + g.tiles.length, 0);
  }

  if (stage === 'hotbar') {
    const chrome = () => ({
      prompt: txt(document.querySelector('#of-prompt')),
      toast: txt(document.querySelector('#of-toast')),
      banner: txt(document.querySelector('#of-banner')),
      carry: txt(document.querySelector('#of-carry')),
      gain: txt(document.querySelector('#of-gain')),
      mode: txt(document.querySelector('#of-mode')),
    });
    out.chrome0 = chrome();
    const bar = document.querySelector('#of-hotbar');
    out.barVisible = bar !== null && bar.style.display !== 'none';
    out.barText = txt(bar);
    out.barLive = bar !== null && bar.classList.contains('live');
    out.slots = [...(bar ? bar.querySelectorAll('.of-hslot') : [])].map((s) => ({
      i: s.getAttribute('data-i'),
      cls: s.className,
      drawn: txt(s),
      title: s.getAttribute('title'),
      hasImg: s.querySelector('img') !== null,
      imgAlt: (s.querySelector('img') || {}).alt || null,
      imgTitle: (s.querySelector('img') || {}).title || null,
    }));
    out.model = of.hotbar();
    // Does selecting a slot tell you what you picked up?
    of.hotbar(4);
    await sleep(0.3);
    out.afterSelect = { chrome: chrome(), part: of.hotbar().part,
      label: of.hotbar().label, ghost: of.build() };
    // wheel: does the bar say what the new slot is?
    of.input.wheel(1);
    await sleep(0.3);
    out.afterWheel = { chrome: chrome(), sel: of.hotbar().selected,
      label: of.hotbar().label };
    // an EMPTY-ish slot: what does slot 2 (the hand furnace) say?
    of.hotbar(2);
    await sleep(0.3);
    out.slot2 = { chrome: chrome(), label: of.hotbar().label,
      kind: of.hotbar().kind, ghost: of.build() };
  }

  if (stage === 'pack') {
    of.panel(true);
    await sleep(0.7);
    out.packOpen = of.game().panelOpen;
    const panel = document.querySelector('#of-pack') || document.querySelector('.of-pack');
    out.packIds = [...document.querySelectorAll('.of-ui')].map((e) => e.id)
      .filter((s) => s !== '');
    out.packText = txt(panel);
    out.barLiveWithPack = (document.querySelector('#of-hotbar') || { classList: { contains: () => null } })
      .classList.contains('live');
    of.panel(false);
    await sleep(0.4);
  }

  out.hudText = txt(document.querySelector('#of-hud'));
  out.goalPanel = txt(document.querySelector('#of-goals'));
  out.allUiIds = [...document.querySelectorAll('.of-ui')].map((e) => e.id);
  out.endState = { build: of.buildMenu().open, pause: of.pause().open,
    modals: of.modals().modals.filter((m) => m.open).map((m) => m.name) };
  if (OF_ARGS && OF_ARGS.shot) {
    await of.settle(6);
    const blob = await of.screenshot();
    out.png = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  }
  return out;
})()
