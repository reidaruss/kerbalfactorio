// Do the leaf tips actually carry the tint, and does the off state recover
// the untinted bake exactly? (RN-102)
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:<port>/ \
//     --evalfile=tools/smoke/probes/leafvar.js
//   ... --leafvar=0 --evalargs='{"off":true}' ...   # the negative control
//
// The instrument is probes/wind.js's zero-floor pair: `of.framehash` renders
// synchronously and advances no ticks, and the wind clock is FROZEN first, so
// `__ofProps.setLeafVar` is the only thing that can differ between captures.
//
// PREDICTED FROM THE MECHANISM: a normalized Uint8 vertex colour is a
// multiplier that cannot exceed 1.0 (the first version of this tint raised r
// at the tips and THIS PROBE falsified it: 30 tiles, all darker, only the
// blue cut had survived the clamp). A brighter tip is expressible only as a
// darker interior, so the shipped tint dims r in the plant's body and b at
// its tips, and switching it ON must come out predominantly DARKER. The
// restore must be BIT-EXACT, which is what the green-channel invariant
// exists to make possible on a concatenated BatchedMesh buffer.
(async () => {
  const of = window.__of;
  const wind = window.__ofWind;
  const props = window.__ofProps;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const fails = [];
  const check = (name, ok) => { if (!ok) fails.push(name); };

  of.teleport(A.lat ?? 12, A.lon ?? 150, A.alt ?? 2);
  of.look(A.yaw ?? 300, A.pitch ?? -10);
  of.setTime(A.sunT ?? 0.30);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.5);

  if (A.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  const TX = 160; const TY = 90; const EPS = 0.5;
  wind.freeze(A.t ?? 40.0);
  const grab = () => of.framehash(TX, TY);
  const diff = (a, b) => {
    let moved = 0; let up = 0; let down = 0; let peak = 0;
    const tiles = [];
    for (let i = 0; i < a.tiles.length; ++i) {
      const d = b.tiles[i] - a.tiles[i];
      const m = Math.abs(d);
      if (m > peak) peak = m;
      if (m > EPS) { moved++; tiles.push(i); if (d > 0) up++; else down++; }
    }
    return { moved, up, down, peak, tiles };
  };

  const capOn1 = grab();
  const capOn2 = grab();
  check('floor: same state hashes identical', capOn1.hash === capOn2.hash);

  const touched = props.setLeafVar(false);
  const capOff = grab();
  const touchedBack = props.setLeafVar(true);
  const capOn3 = grab();
  check('restore is BIT-EXACT (the green-channel invariant paid)',
    capOn3.hash === capOn1.hash);
  check('toggle matched foliage batches (>= 5, both directions agree)',
    touched >= 5 && touchedBack === touched);

  const d = diff(capOff, capOn1);   // off against on: positive d is the tint

  if (A.off === true) {
    // ?leafvar=0 bakes flat greyscale, so flattening changes NOTHING: the
    // pre-RN-102 bytes exactly, and the toggle is proved a no-op on them.
    check('leafvar=0: off state is identical to baked state',
      capOff.hash === capOn1.hash && d.moved === 0);
  } else {
    check('the tint moves tiles', d.moved > 100);
    check('net DARKER with the tint on (a multiplier <= 1 can only dim)',
      d.down > 1.2 * d.up);
    of.propsVisible(false);
    const capHid = grab();
    of.propsVisible(true);
    const capShown = grab();
    check('mask recapture matches', capShown.hash === capOn1.hash);
    const mask = new Set(diff(capHid, capShown).tiles);
    let onProps = 0;
    for (const t of d.tiles) if (mask.has(t)) onProps++;
    const conc = d.moved > 0 ? onProps / d.moved : 0;
    check('moved tiles are ON the foliage: >= 85% inside the prop mask',
      conc >= 0.85);
    A.conc = +conc.toFixed(4);
  }
  wind.thaw();

  const s = of.stats();
  return {
    valid: fails.length === 0, fails,
    touched,
    offOn: { moved: d.moved, up: d.up, down: d.down, peak: d.peak },
    concentration: A.conc ?? null,
    stats: {
      calls: s.draw.calls, triangles: s.draw.triangles, programs: s.draw.programs,
      geometries: s.draw.geometries, vramMB: s.vramEstimateMB,
    },
  };
})()
